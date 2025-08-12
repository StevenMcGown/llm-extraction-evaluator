"""Service for running evaluations and orchestrating the evaluation process."""
import asyncio
import time
import json
import uuid
import logging
from datetime import datetime
from typing import Dict, List, Any, Union, Optional
from fastapi import HTTPException
import aiohttp

from .storage_service import (
    parse_s3_uri, get_file_hash_from_key, fetch_s3_file_content,
    save_evaluation_metadata_to_s3, save_iteration_response_to_s3, 
    save_evaluation_results_to_s3, s3_client
)
from .comparison_service import (
    filter_ground_truth_by_extraction_types, remove_excluded_fields_from_ground_truth,
    compare_extraction_results, calculate_overall_metrics, calculate_field_metrics
)

# Set up logging
logger = logging.getLogger(__name__)

# Global evaluation lock to prevent concurrent evaluations
evaluation_lock = asyncio.Lock()


def generate_evaluation_run_id() -> str:
    """Generate a unique evaluation run ID with timestamp."""
    timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H-%M-%S")
    run_id = str(uuid.uuid4())[:8]  # First 8 chars of UUID
    return f"{timestamp}-{run_id}"


async def call_extraction_api_async(
    pdf_content: bytes,
    filename: str,
    endpoint: str,
    extraction_types: List[str],
    oauth_token: Optional[str] = None,
    datacontext: str = 'eval_testing',
    poll_interval: float = 2.0,
    timeout_s: int = 600,
) -> Dict[str, Any]:
    """
    Asynchronously call the extraction service via upload → status → retrieve.

    - Uploads the PDF and gets a GUID
    - Polls status until completion or timeout
    - Retrieves the final result JSON
    """
    upload_url = endpoint.rstrip('/') + '/api/v1/upload/'
    headers = {'accept': 'application/json'}
    if oauth_token:
        headers['Authorization'] = f'Bearer {oauth_token}'

    # Build query params
    params: Dict[str, Any] = {}
    for ext_type in extraction_types:
        params.setdefault('extraction_types', []).append(ext_type)
    params['datacontext'] = datacontext

    async with aiohttp.ClientSession() as session:
        # 1) Upload
        form_data = aiohttp.FormData()
        form_data.add_field('file', pdf_content, filename=filename, content_type='application/pdf')
        async with session.post(upload_url, data=form_data, headers=headers, params=params) as upload_resp:
            if upload_resp.status not in (200, 202):
                raise HTTPException(status_code=upload_resp.status, detail=f"Upload failed: {upload_resp.status} {await upload_resp.text()}")
            upload_body = await upload_resp.json()
            guid = (
                upload_body.get('guid')
                or upload_body.get('id')
                or upload_body.get('job_id')
                or upload_body.get('task_id')
                or upload_body.get('JobId')
            )
            if not guid:
                # Case-insensitive fallback
                for k, v in upload_body.items():
                    if isinstance(k, str) and k.lower() in {'guid', 'id', 'job_id', 'task_id', 'jobid'}:
                        guid = v
                        break
            if not guid:
                raise HTTPException(status_code=500, detail=f"Upload response missing GUID: {upload_body}")

        # 2) Poll status
        status_url = endpoint.rstrip('/') + f'/api/v1/status/{guid}'
        retrieve_url = endpoint.rstrip('/') + f'/api/v1/retrieve/{guid}'

        start_ts = time.time()
        attempt = 0
        last_status_text = ''
        while True:
            attempt += 1
            async with session.get(status_url, headers=headers) as status_resp:
                if status_resp.status != 200:
                    # Treat non-200 as transient for a short while
                    text = await status_resp.text()
                    last_status_text = f"HTTP {status_resp.status}: {text}"
                else:
                    status_body = await status_resp.json()
                    status_value = str(status_body.get('status', '')).lower()
                    # Accept a few common completion labels
                    if status_value in {'completed', 'complete', 'done', 'finished', 'success'}:
                        break
                    if status_value in {'failed', 'error'}:
                        raise HTTPException(status_code=500, detail=f"Extraction failed for {filename}: {status_body}")
                    last_status_text = status_value or str(status_body)

            if time.time() - start_ts > timeout_s:
                raise HTTPException(status_code=504, detail=f"Timed out after {timeout_s}s waiting for extraction of {filename}. Last status: {last_status_text}")

            await asyncio.sleep(poll_interval)

        # 3) Retrieve
        async with session.get(retrieve_url, headers=headers) as retrieve_resp:
            if retrieve_resp.status != 200:
                raise HTTPException(status_code=retrieve_resp.status, detail=f"Retrieve failed: {retrieve_resp.status} {await retrieve_resp.text()}")
            return await retrieve_resp.json()


async def seed_ground_truth_from_extraction(
    pdf_content: bytes,
    filename: str,
    file_hash: str,
    extraction_endpoint: str,
    extraction_types: List[str],
    oauth_token: Optional[str],
    ground_truth_uri: str
) -> Dict[str, Any]:
    """Generate ground truth by calling extraction API - seeds the ground truth when it doesn't exist."""
    try:
        # Call extraction API to generate initial ground truth
        api_response = await call_extraction_api_async(
            pdf_content, filename, extraction_endpoint,
            extraction_types, oauth_token
        )
        
        # Extract just the extracted_data portion for ground truth
        ground_truth_data = api_response.get('extracted_data', {})
        
        # Save the seeded ground truth to S3
        gt_bucket, gt_prefix = parse_s3_uri(ground_truth_uri)
        gt_key = f"{gt_prefix.rstrip('/')}/{file_hash}.json"
        
        # Save ground truth with metadata indicating it was seeded
        seeded_ground_truth = {
            "file_hash": file_hash,
            "filename": filename,
            "seeded_from_api": True,
            "extraction_endpoint": extraction_endpoint,
            "extraction_types": extraction_types,
            "extracted_data": ground_truth_data
        }
        
        json_content = json.dumps(seeded_ground_truth, indent=2)
        
        s3_client.put_object(
            Bucket=gt_bucket,
            Key=gt_key,
            Body=json_content.encode('utf-8'),
            ContentType='application/json'
        )
        
        print(f"Seeded ground truth for {filename} -> s3://{gt_bucket}/{gt_key}")
        
        # Return just the extracted_data for comparison
        return ground_truth_data
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to seed ground truth for {filename}: {str(e)}")


async def run_evaluation_task(evaluation_id: str, request, evaluation_store: Dict):
    """Background task to run the actual evaluation."""
    try:
        # Add a startup delay to give frontend time to start polling
        logger.info(f"Evaluation {evaluation_id}: Starting in 2 seconds to allow frontend setup...")
        await asyncio.sleep(2.0)
        
        # Start evaluation without a global lock to allow concurrent runs
        # Update status to running as this task begins
        result = evaluation_store[evaluation_id]
        result.status = "running"
        logger.info(f"Starting evaluation {evaluation_id}")
        
        # Use the evaluation_run_id that was set in the request
        evaluation_run_id = request.evaluation_run_id
        
        # Save evaluation metadata to S3 if responses_uri is provided
        if request.responses_uri:
            try:
                metadata_config = {
                    "source_data_uri": request.source_data_uri,
                    "ground_truth_uri": request.ground_truth_uri,
                    "extraction_endpoint": request.extraction_endpoint,
                    "extraction_types": request.extraction_types,
                    "excluded_fields": request.excluded_fields,
                    "iterations": request.iterations,
                    "selected_files": request.selected_files
                }
                metadata_path = await save_evaluation_metadata_to_s3(
                    evaluation_run_id, metadata_config, request.responses_uri
                )
                print(f"Saved evaluation metadata to: {metadata_path}")
            except Exception as metadata_error:
                print(f"Failed to save evaluation metadata: {str(metadata_error)}")
        
        # Parse S3 URIs
        source_bucket, source_prefix = parse_s3_uri(request.source_data_uri)
        gt_bucket, gt_prefix = parse_s3_uri(request.ground_truth_uri)
        
        # List source files and get their original names from tags
        source_response = s3_client.list_objects_v2(Bucket=source_bucket, Prefix=source_prefix)
        print(f"Found {len(source_response.get('Contents', []))} objects in S3 bucket {source_bucket} with prefix {source_prefix}")
        
        all_source_files = []
        
        for obj in source_response.get('Contents', []):
            print(f"Processing S3 object: {obj['Key']}")
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
                    print(f"  Using filename: {filename} (original_name: {original_name})")
                    all_source_files.append({
                        'key': obj['Key'],
                        'filename': filename
                    })
                except Exception as e:
                    print(f"Failed to get tags for {obj['Key']}: {str(e)}")
                    # Fall back to using key name if tag retrieval fails
                    filename = obj['Key'].split('/')[-1]
                    print(f"  Using fallback filename: {filename}")
                    all_source_files.append({
                        'key': obj['Key'],
                        'filename': filename
                    })
            else:
                print(f"  Skipping non-PDF file: {obj['Key']}")
        
        # Filter source files based on selected_files parameter
        print(f"Available files: {[f['filename'] for f in all_source_files]}")
        
        if request.selected_files:
            # Filter to only include selected files
            selected_filenames = set(request.selected_files)
            source_files = [file_info for file_info in all_source_files if file_info['filename'] in selected_filenames]
            print(f"Processing {len(source_files)} selected files out of {len(all_source_files)} total files")
            print(f"Selected files to process: {[f['filename'] for f in source_files]}")
        else:
            # Process all files if no selection provided
            source_files = all_source_files
            print(f"Processing all {len(source_files)} files (no selection provided)")
        
        # List ground truth files
        gt_response = s3_client.list_objects_v2(Bucket=gt_bucket, Prefix=gt_prefix)
        gt_files = {get_file_hash_from_key(obj['Key']): obj['Key'] 
                   for obj in gt_response.get('Contents', []) if obj['Key'].endswith('.json')}
        
        # Initialize result
        result = evaluation_store[evaluation_id]
        result.total_files = len(source_files)
        
        # Only update total_iterations if it was an estimate (when no files were selected)
        # If files were selected, the initial calculation should be accurate
        if not request.selected_files:
            result.total_iterations = len(source_files) * request.iterations
            logger.info(f"Evaluation {evaluation_id}: Updated total_iterations from estimate to actual - {len(source_files)} files * {request.iterations} iterations = {result.total_iterations}")
        else:
            logger.info(f"Evaluation {evaluation_id}: Using pre-calculated total_iterations = {result.total_iterations} for {len(source_files)} selected files")
        
        document_evaluations = []
        all_scores = []
        
        for file_info in source_files:
            try:
                source_key = file_info['key']
                filename = file_info['filename']
                file_hash = get_file_hash_from_key(source_key)
                
                logger.info(f"Evaluation {evaluation_id}: Starting file {result.completed_files + 1}/{len(source_files)}: {filename} (hash: {file_hash})")
                
                # Check if ground truth exists - but don't skip if missing
                ground_truth_data = None
                if file_hash in gt_files:
                    # Fetch ground truth
                    gt_content = await fetch_s3_file_content(gt_bucket, gt_files[file_hash])
                    ground_truth = json.loads(gt_content.decode('utf-8'))
                    # Extract only the extracted_data part for comparison
                    ground_truth_data = ground_truth.get('extracted_data', ground_truth)
                else:
                    # Log that ground truth is missing but continue processing
                    print(f"No ground truth found for {filename} (hash: {file_hash}), proceeding with extraction only")
                
                # Fetch PDF content
                pdf_content = await fetch_s3_file_content(source_bucket, source_key)
                
                # Run multiple iterations
                api_responses = []
                for iteration in range(request.iterations):
                    try:
                        logger.info(f"Evaluation {evaluation_id}: Starting iteration {iteration + 1}/{request.iterations} for {filename} (current progress: {result.completed_iterations}/{result.total_iterations})")
                        api_response = await call_extraction_api_async(
                            pdf_content, filename, request.extraction_endpoint,
                            request.extraction_types, request.oauth_token
                        )
                        api_responses.append(api_response)
                        logger.info(f"Evaluation {evaluation_id}: API call completed for iteration {iteration + 1} of {filename}")
                        
                        # Update iteration progress (count only after retrieve completes)
                        result.completed_iterations += 1
                        logger.info(f"Evaluation {evaluation_id}: Completed iteration {result.completed_iterations}/{result.total_iterations} (file: {filename}, iteration: {iteration + 1})")
                        
                        # Add a delay between iterations to allow frontend polling to see progress
                        # This helps with progress tracking visibility
                        if iteration < request.iterations - 1:  # Don't delay after the last iteration
                            logger.info(f"Evaluation {evaluation_id}: Waiting 5 seconds before next iteration...")
                            await asyncio.sleep(5.0)  # Increased to 5 seconds for very visible progress
                        
                        # Save iteration response to S3 if responses_uri is provided
                        if request.responses_uri:
                            try:
                                saved_path = await save_iteration_response_to_s3(
                                    api_response, file_hash, iteration + 1, evaluation_run_id, request.responses_uri
                                )
                                print(f"Saved iteration {iteration + 1} response to: {saved_path}")
                            except Exception as save_error:
                                result.errors.append(f"Failed to save iteration {iteration + 1} for {filename}: {str(save_error)}")
                        
                    except Exception as e:
                        logger.error(f"Iteration {iteration + 1} failed for {filename}: {str(e)}")
                        result.errors.append(f"Iteration {iteration + 1} failed for {filename}: {str(e)}")
                
                if not api_responses:
                    result.errors.append(f"All iterations failed for {filename}")
                    continue
 
                # Calculate scores and mismatches for each iteration if ground truth exists
                scores = {}
                mismatches = []
                true_negatives = 0
                iteration_scores = []
                iteration_mismatches = []
                # Legacy: iteration_true_negatives no longer needed (TN is encoded per-field as score 0.0)
                
                if ground_truth_data:
                    # Filter ground truth based on selected extraction types
                    filtered_ground_truth = filter_ground_truth_by_extraction_types(ground_truth_data, request.extraction_types)
                    
                    # Remove excluded fields from ground truth
                    if request.excluded_fields is not None:
                        filtered_ground_truth = remove_excluded_fields_from_ground_truth(filtered_ground_truth, request.excluded_fields)
                    
                    # Calculate scores for each iteration
                    for idx, api_response in enumerate(api_responses):
                        # Also apply exclusions to API response for fair comparison
                        if request.excluded_fields is not None:
                            api_extracted_data = api_response.get("extracted_data", api_response)
                            filtered_api_extracted_data = filter_ground_truth_by_extraction_types(
                                api_extracted_data, request.extraction_types
                            )
                            filtered_api_extracted_data = remove_excluded_fields_from_ground_truth(
                                filtered_api_extracted_data, request.excluded_fields
                            )
                            filtered_api_response = {"extracted_data": filtered_api_extracted_data}
                            iter_scores, iter_mismatches, iter_true_negatives = compare_extraction_results(filtered_ground_truth, filtered_api_response)
                        else:
                            iter_scores, iter_mismatches, iter_true_negatives = compare_extraction_results(filtered_ground_truth, api_response)
                        # Add iteration info to mismatches
                        iter_mismatches = [f"[{filename} | Iter {idx + 1}] {mismatch}" for mismatch in iter_mismatches]
                        
                        iteration_scores.append(iter_scores)
                        iteration_mismatches.append(iter_mismatches)
                        # TN is encoded per-field in scores (0.0), no need to collect per-iteration TN
                        
                        # Use the last iteration for the main scores (backward compatibility)
                        if idx == len(api_responses) - 1:
                            scores = iter_scores
                            mismatches = iter_mismatches
                            true_negatives = iter_true_negatives
                
                # Create document evaluation with proper model import
                from ..api.v1.evaluation import DocumentEvaluation
                document_eval = DocumentEvaluation(
                    filename=filename,
                    file_hash=file_hash,
                    ground_truth=filtered_ground_truth if ground_truth_data else None,  # Use filtered ground truth
                    api_responses=api_responses,
                    scores=scores,  # Will be empty dict if no ground truth
                    mismatches=mismatches,  # Will be empty list if no ground truth
                    true_negatives=true_negatives,
                    iteration_scores=iteration_scores if ground_truth_data else None,
                    iteration_mismatches=iteration_mismatches if ground_truth_data else None
                )
                
                document_evaluations.append(document_eval)
                
                if iteration_scores:
                    all_scores.extend(iteration_scores)
                elif scores:
                    all_scores.append(scores)
                
                result.completed_files += 1
                
                # Add a small delay between files to make progress visible across multiple files
                if len(source_files) > 1 and result.completed_files < len(source_files):
                    logger.info(f"Evaluation {evaluation_id}: Completed file {result.completed_files}/{len(source_files)}, waiting 3 seconds before next file...")
                    await asyncio.sleep(3.0)  # Increased to 3 seconds
                
            except Exception as e:
                result.errors.append(f"Failed to evaluate {filename} ({source_key}): {str(e)}")
        
        # Calculate overall metrics and field-level metrics
        result.metrics = calculate_overall_metrics(all_scores)
        field_metrics = calculate_field_metrics(all_scores)
        result.documents = document_evaluations
        result.status = "completed"
        
        logger.info(f"🏁 Evaluation {evaluation_id} completed successfully! Final state: {result.completed_iterations}/{result.total_iterations} iterations, {result.completed_files}/{result.total_files} files")
        
        # Save final results to S3 if responses_uri is provided
        if request.responses_uri:
            try:
                final_results = {
                    "evaluation_run_id": evaluation_run_id,
                    "evaluation_id": evaluation_id,
                    "status": result.status,
                    "metrics": result.metrics.dict(),
                    "total_files": result.total_files,
                    "completed_files": result.completed_files,
                    "total_iterations": result.total_iterations,
                    "completed_iterations": result.completed_iterations,
                    "errors": result.errors,
                    "completed_at": datetime.utcnow().isoformat(),
                    "config": {
                        "source_data_uri": request.source_data_uri,
                        "ground_truth_uri": request.ground_truth_uri,
                        "extraction_endpoint": request.extraction_endpoint,
                        "extraction_types": request.extraction_types,
                        "excluded_fields": request.excluded_fields,
                        "iterations": request.iterations,
                        "selected_files": request.selected_files
                    }
                }
                results_path = await save_evaluation_results_to_s3(
                    evaluation_run_id, final_results, request.responses_uri
                )
                print(f"Saved evaluation results to: {results_path}")
            except Exception as results_error:
                print(f"Failed to save evaluation results: {str(results_error)}")
                result.errors.append(f"Failed to save results to S3: {str(results_error)}")
        
        # Persist overall metrics and field metrics to MySQL for dashboarding
        try:
            from ..api.v1.db import _pool, _vars
            _vars()
            pool = await _pool()
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    # Insert: store overall metrics per evaluation run
                    await cur.execute(
                        """
                        INSERT INTO evaluation_metrics (
                            file_id,
                            overall_precision,
                            overall_recall,
                            overall_f1_score,
                            overall_accuracy,
                            overall_tp,
                            overall_tn,
                            overall_fp,
                            overall_fn,
                            ground_truth_file_id,
                            extraction_run_id,
                            evaluation_config
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            evaluation_run_id,  # use run id to satisfy NOT NULL
                            result.metrics.precision,
                            result.metrics.recall,
                            result.metrics.f1_score,
                            result.metrics.accuracy,
                            result.metrics.true_positives,
                            result.metrics.true_negatives,
                            result.metrics.false_positives,
                            result.metrics.false_negatives,
                            request.ground_truth_uri,  # ground_truth_file_id
                            None,  # extraction_run_id (can be NULL)
                            json.dumps({
                                "source_data_uri": request.source_data_uri,
                                "ground_truth_uri": request.ground_truth_uri,
                                "extraction_endpoint": request.extraction_endpoint,
                                "extraction_types": request.extraction_types,
                                "excluded_fields": request.excluded_fields,
                                "iterations": request.iterations,
                                "selected_files": request.selected_files,
                            }),
                        ),
                    )
                    
                    # Get the evaluation ID for field performance records
                    evaluation_id = cur.lastrowid
                    
                    # Insert field performance records
                    logger.info(f"field_metrics contains {len(field_metrics)} fields: {list(field_metrics.keys())}")
                    for field_name, field_data in field_metrics.items():
                        # Calculate field-level metrics
                        tp = field_data.get('tp', 0)
                        tn = field_data.get('tn', 0)
                        fp = field_data.get('fp', 0)
                        fn = field_data.get('fn', 0)
                        
                        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
                        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
                        f1_score = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
                        accuracy = (tp + tn) / (tp + fp + fn + tn) if (tp + fp + fn + tn) > 0 else 0.0
                        
                        # Extract field name and path
                        field_parts = field_name.split('.')
                        simple_field_name = field_parts[-1] if field_parts else field_name
                        
                        logger.info(f"Inserting field performance for {field_name}: tp={tp}, fp={fp}, fn={fn}, tn={tn}")
                        
                        await cur.execute(
                            """
                            INSERT INTO field_performance (
                                evaluation_id,
                                field_name,
                                field_path,
                                tp,
                                tn,
                                fp,
                                fn,
                                `precision`,
                                recall,
                                f1_score,
                                accuracy
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                evaluation_id,
                                simple_field_name,
                                field_name,
                                tp,
                                tn,
                                fp,
                                fn,
                                precision,
                                recall,
                                f1_score,
                                accuracy
                            ),
                        )
                        logger.info(f"Successfully inserted field performance for {field_name}")
                    
            pool.close(); await pool.wait_closed()
            logger.info(f"Saved evaluation metrics and field performance to DB for run {evaluation_run_id}")
        except Exception as db_error:
            logger.error(f"Failed to save evaluation metrics to DB: {db_error}")
            
    except Exception as e:
        result = evaluation_store[evaluation_id]
        result.status = "failed"
        result.errors.append(f"Evaluation failed: {str(e)}")
        logger.error(f"Evaluation {evaluation_id} failed: {str(e)} - releasing lock") 