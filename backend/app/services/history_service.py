"""Service for loading evaluation history and managing ground truth data."""
import json
from typing import Dict, List, Any, Optional
from fastapi import HTTPException

from .storage_service import (
    parse_s3_uri, get_file_hash_from_key, fetch_s3_file_content, s3_client
)
from .comparison_service import (
    filter_ground_truth_by_extraction_types, remove_excluded_fields_from_ground_truth,
    compare_extraction_results, calculate_overall_metrics
)


async def load_evaluation_from_s3(run_id: str, responses_uri: str):
    """Load evaluation results from S3 using run ID."""
    try:
        # Parse responses S3 URI
        responses_bucket, responses_prefix = parse_s3_uri(responses_uri)
        
        # Build paths for metadata and results
        if responses_prefix:
            metadata_key = f"{responses_prefix.rstrip('/')}/{run_id}/metadata.json"
            results_key = f"{responses_prefix.rstrip('/')}/{run_id}/results/summary.json"
            responses_prefix_path = f"{responses_prefix.rstrip('/')}/{run_id}/responses/"
        else:
            metadata_key = f"{run_id}/metadata.json"
            results_key = f"{run_id}/results/summary.json"
            responses_prefix_path = f"{run_id}/responses/"
        
        print(f"Loading evaluation from S3:")
        print(f"  Metadata: s3://{responses_bucket}/{metadata_key}")
        print(f"  Results: s3://{responses_bucket}/{results_key}")
        print(f"  Responses: s3://{responses_bucket}/{responses_prefix_path}")
        
        # Load metadata
        try:
            metadata_content = await fetch_s3_file_content(responses_bucket, metadata_key)
            metadata = json.loads(metadata_content.decode('utf-8'))
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"Evaluation metadata not found for run {run_id}: {str(e)}")
        
        # Load results summary if available
        try:
            results_content = await fetch_s3_file_content(responses_bucket, results_key)
            results_summary = json.loads(results_content.decode('utf-8'))
        except Exception as e:
            print(f"Results summary not found for run {run_id}: {str(e)}")
            results_summary = None
        
        # Get ground truth URI from metadata
        config = metadata.get('config', {})
        ground_truth_uri = config.get('ground_truth_uri')
        if not ground_truth_uri:
            raise HTTPException(status_code=400, detail="Ground truth URI not found in evaluation metadata")
        
        # Parse ground truth URI
        gt_bucket, gt_prefix = parse_s3_uri(ground_truth_uri)
        
        # List all response files for this run
        response_objects = s3_client.list_objects_v2(
            Bucket=responses_bucket, 
            Prefix=responses_prefix_path
        )
        
        documents = []
        all_scores = []
        
        # Group responses by file hash
        file_responses = {}
        for obj in response_objects.get('Contents', []):
            key = obj['Key']
            if key.endswith('.json'):
                # Extract file hash and iteration from path
                # Path format: {prefix}/{run_id}/responses/{file_hash}/{iteration}.json
                path_parts = key.replace(responses_prefix_path, '').split('/')
                if len(path_parts) >= 2:
                    file_hash = path_parts[0]
                    iteration_file = path_parts[1]
                    iteration = int(iteration_file.replace('.json', ''))
                    
                    if file_hash not in file_responses:
                        file_responses[file_hash] = {}
                    file_responses[file_hash][iteration] = key
        
        print(f"Found responses for {len(file_responses)} files")
        
        # Process each file's responses
        for file_hash, iterations in file_responses.items():
            try:
                # Load ground truth for this file
                gt_key = f"{gt_prefix.rstrip('/')}/{file_hash}.json"
                ground_truth_data = None
                ground_truth_full = None
                try:
                    gt_content = await fetch_s3_file_content(gt_bucket, gt_key)
                    ground_truth_full = json.loads(gt_content.decode('utf-8'))
                    ground_truth_data = ground_truth_full.get('extracted_data', ground_truth_full)
                except Exception as e:
                    print(f"No ground truth found for {file_hash}: {str(e)}")
                
                # Load all iterations for this file
                api_responses = []
                sorted_iterations = sorted(iterations.keys())
                for iteration in sorted_iterations:
                    response_key = iterations[iteration]
                    try:
                        response_content = await fetch_s3_file_content(responses_bucket, response_key)
                        api_response = json.loads(response_content.decode('utf-8'))
                        api_responses.append(api_response)
                    except Exception as e:
                        print(f"Failed to load response {response_key}: {str(e)}")
                
                if not api_responses:
                    print(f"No valid responses found for {file_hash}")
                    continue
                
                # Get filename from S3 object tags (where original filename is stored)
                filename = file_hash  # Default fallback
                
                # Try to get the original filename from S3 object tags
                try:
                    # Determine the source file bucket and prefix from config
                    config = metadata.get('config', {})
                    source_data_uri = config.get('source_data_uri')
                    if source_data_uri:
                        source_bucket, source_prefix = parse_s3_uri(source_data_uri)
                        
                        # Construct the likely S3 key for the source file
                        # Try common extensions
                        for ext in ['.pdf', '.PDF']:
                            source_key = f"{source_prefix.rstrip('/')}/{file_hash}{ext}" if source_prefix else f"{file_hash}{ext}"
                            try:
                                # Get object tags to find original filename
                                tags_response = s3_client.get_object_tagging(
                                    Bucket=source_bucket,
                                    Key=source_key
                                )
                                
                                # Look for original_name tag
                                for tag in tags_response.get('TagSet', []):
                                    if tag['Key'] == 'original_name':
                                        from urllib.parse import unquote_plus
                                        filename = unquote_plus(tag['Value'])
                                        print(f"Found original filename from S3 tags: {filename}")
                                        break
                                
                                if filename != file_hash:
                                    break  # Found filename, stop trying extensions
                                    
                            except Exception as tag_error:
                                print(f"Could not get tags for {source_key}: {tag_error}")
                                continue

                except Exception as e:
                    print(f"Could not retrieve filename from S3 tags: {e}")
                
                # Fall back to API response filename if not found in S3 tags
                if filename == file_hash and api_responses and 'filename' in api_responses[0]:
                    filename = api_responses[0]['filename']
                
                # Final fallback: if we still have file_hash, try to construct a reasonable filename
                if filename == file_hash:
                    # Convert hash to a PDF filename that the viewer can recognize
                    filename = f"{file_hash}.pdf"
                
                # Calculate scores if ground truth exists
                scores = {}
                mismatches = []
                true_negatives = 0
                iteration_scores = []
                iteration_mismatches = []
                # Legacy: iteration_true_negatives no longer needed (TN is encoded per-field as score 0.0)
                
                if ground_truth_data:
                    # Apply extraction types filter if specified
                    extraction_types = config.get('extraction_types', [])
                    excluded_fields = config.get('excluded_fields', [])
                    
                    filtered_ground_truth = ground_truth_data
                    if extraction_types:
                        filtered_ground_truth = filter_ground_truth_by_extraction_types(filtered_ground_truth, extraction_types)
                    if excluded_fields:
                        filtered_ground_truth = remove_excluded_fields_from_ground_truth(filtered_ground_truth, excluded_fields)
                    
                    # Calculate scores for each iteration
                    for idx, api_response in enumerate(api_responses):
                        iter_scores, iter_mismatches, iter_true_negatives = compare_extraction_results(filtered_ground_truth, api_response)
                        iteration_scores.append(iter_scores)
                        iteration_mismatches.append(iter_mismatches)
                        # TN is encoded per-field in scores (0.0), no need to collect per-iteration TN
                        
                        # Use the last iteration for main scores
                        if idx == len(api_responses) - 1:
                            scores = iter_scores
                            mismatches = iter_mismatches
                            true_negatives = iter_true_negatives
                    
                    if iteration_scores:
                        all_scores.extend(iteration_scores)
                
                # Create document evaluation with proper model import
                from ..api.v1.evaluation import DocumentEvaluation
                document_eval = DocumentEvaluation(
                    filename=filename,
                    file_hash=file_hash,
                    ground_truth=filtered_ground_truth if ground_truth_data else None,
                    api_responses=api_responses,
                    scores=scores,
                    mismatches=mismatches,
                    true_negatives=true_negatives,
                    iteration_scores=iteration_scores if ground_truth_data else None,
                    iteration_mismatches=iteration_mismatches if ground_truth_data else None
                )
                
                documents.append(document_eval)
                
            except Exception as e:
                print(f"Failed to process file {file_hash}: {str(e)}")
                continue
        
        # Calculate overall metrics
        if all_scores:
            metrics = calculate_overall_metrics(all_scores)
        else:
            from .comparison_service import EvaluationMetrics
            metrics = EvaluationMetrics(
                true_positives=0, false_positives=0, false_negatives=0, true_negatives=0,
                precision=0.0, recall=0.0, f1_score=0.0, accuracy=0.0
            )
        
        # Create evaluation result with proper model import
        from ..api.v1.evaluation import EvaluationResult
        result = EvaluationResult(
            evaluation_id=run_id,
            status="completed" if results_summary else "loaded_from_s3",
            documents=documents,
            metrics=metrics,
            total_files=len(documents),
            completed_files=len(documents),
            total_iterations=sum(len(doc.api_responses) for doc in documents),
            completed_iterations=sum(len(doc.api_responses) for doc in documents),
            errors=results_summary.get('errors', []) if results_summary else []
        )
        
        print(f"Successfully loaded evaluation {run_id} with {len(documents)} documents")
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load evaluation from S3: {str(e)}")


async def check_missing_ground_truth(
    source_data_uri: str,
    ground_truth_uri: str
):
    """Check which PDF files are missing ground truth files."""
    try:
        # Parse S3 URIs
        source_bucket, source_prefix = parse_s3_uri(source_data_uri)
        gt_bucket, gt_prefix = parse_s3_uri(ground_truth_uri)
        
        # List source files
        source_response = s3_client.list_objects_v2(Bucket=source_bucket, Prefix=source_prefix)
        source_files = [obj['Key'] for obj in source_response.get('Contents', []) if obj['Key'].endswith('.pdf')]
        
        # List existing ground truth files
        gt_response = s3_client.list_objects_v2(Bucket=gt_bucket, Prefix=gt_prefix)
        existing_gt_files = {get_file_hash_from_key(obj['Key']): obj['Key'] 
                           for obj in gt_response.get('Contents', []) if obj['Key'].endswith('.json')}
        
        missing_files = []
        existing_files = []
        
        for source_key in source_files:
            file_hash = get_file_hash_from_key(source_key)
            filename = source_key.split('/')[-1]
            
            if file_hash not in existing_gt_files:
                missing_files.append({
                    "filename": filename,
                    "file_hash": file_hash,
                    "source_key": source_key
                })
            else:
                existing_files.append({
                    "filename": filename,
                    "file_hash": file_hash,
                    "ground_truth_key": existing_gt_files[file_hash]
                })
        
        return {
            "missing_ground_truth": missing_files,
            "existing_ground_truth": existing_files,
            "total_source_files": len(source_files),
            "missing_count": len(missing_files),
            "existing_count": len(existing_files)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check missing ground truth: {str(e)}")


async def list_source_files(source_data_uri: str):
    """List all source files with their original names from S3 tags."""
    try:
        source_bucket, source_prefix = parse_s3_uri(source_data_uri)
        source_response = s3_client.list_objects_v2(Bucket=source_bucket, Prefix=source_prefix)
        
        files = []
        for obj in source_response.get('Contents', []):
            if obj['Key'].endswith('.pdf'):
                try:
                    # Get object tags to find original_name
                    tag_response = s3_client.get_object_tagging(Bucket=source_bucket, Key=obj['Key'])
                    original_name = None
                    for tag in tag_response.get('TagSet', []):
                        if tag['Key'] == 'original_name':
                            original_name = tag['Value']
                            break
                    
                    # Use original_name if found, otherwise fall back to key name
                    filename = original_name if original_name else obj['Key'].split('/')[-1]
                    files.append({
                        'key': obj['Key'],
                        'filename': filename
                    })
                except Exception as e:
                    print(f"Failed to get tags for {obj['Key']}: {str(e)}")
                    # Fall back to using key name if tag retrieval fails
                    files.append({
                        'key': obj['Key'],
                        'filename': obj['Key'].split('/')[-1]
                    })
        
        return {"files": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list source files: {str(e)}") 