"""Evaluation endpoints for comparing ground truth data with extraction API results."""
from __future__ import annotations

import json
import asyncio
import hashlib
from typing import Dict, List, Optional, Any, Union, Tuple
from urllib.parse import urlparse
import aiohttp
import boto3
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
import Levenshtein

router = APIRouter()
s3_client = boto3.client("s3")

class EvaluationRequest(BaseModel):
    source_data_uri: str = Field(..., description="S3 URI to source PDF files")
    ground_truth_uri: str = Field(..., description="S3 URI to ground truth JSON files")
    extraction_endpoint: str = Field(..., description="API endpoint for extraction")
    responses_uri: Optional[str] = Field(None, description="S3 URI to save iteration responses")
    oauth_token: Optional[str] = Field(None, description="OAuth token for API calls")
    iterations: int = Field(default=3, ge=1, le=10, description="Number of extraction iterations per file")
    extraction_types: List[str] = Field(
        default=["patient_profile", "icd10_codes", "medications", "allergy"],
        description="Types of data to extract"
    )
    excluded_fields: Optional[List[str]] = Field(None, description="JSON pointer paths to exclude from evaluation (e.g., ['/medications/medications/frequency'])")
    selected_files: Optional[List[str]] = Field(None, description="List of specific files to process (if not provided, processes all files)")

class SeedGroundTruthRequest(BaseModel):
    source_data_uri: str = Field(..., description="S3 URI to source PDF files")
    ground_truth_uri: str = Field(..., description="S3 URI to save seeded ground truth")
    extraction_endpoint: str = Field(..., description="API endpoint for extraction")
    oauth_token: Optional[str] = Field(None, description="OAuth token for API calls")
    extraction_types: List[str] = Field(
        default=["patient_profile", "icd10_codes", "medications", "allergy"],
        description="Types of data to extract"
    )
    file_hash: Optional[str] = Field(None, description="Specific file hash to seed (if not provided, seeds all missing)")

class SeedGroundTruthResult(BaseModel):
    seeded_files: List[str]
    skipped_files: List[str]  # Files that already have ground truth
    errors: List[str]

class RecalculateRequest(BaseModel):
    ground_truth_uri: str = Field(..., description="S3 URI to ground truth JSON files")
    extraction_types: Optional[List[str]] = Field(None, description="Types of data to extract (if None, no filtering applied)")
    excluded_fields: Optional[List[str]] = Field(None, description="JSON pointer paths to exclude from evaluation")

class DocumentEvaluation(BaseModel):
    filename: str
    file_hash: str
    ground_truth: Optional[Dict[str, Any]]
    api_responses: List[Dict[str, Any]]
    scores: Dict[str, float]  # Scores for the best/selected iteration for backward compatibility
    mismatches: List[str]  # Mismatches for the best/selected iteration for backward compatibility
    true_negatives: int = 0
    # New fields for per-iteration evaluation
    iteration_scores: Optional[List[Dict[str, float]]] = None  # Scores for each iteration
    iteration_mismatches: Optional[List[List[str]]] = None  # Mismatches for each iteration

class EvaluationMetrics(BaseModel):
    true_positives: int
    false_positives: int
    false_negatives: int
    true_negatives: int
    precision: float
    recall: float
    f1_score: float
    accuracy: float

class EvaluationResult(BaseModel):
    evaluation_id: str
    status: str
    documents: List[DocumentEvaluation]
    metrics: EvaluationMetrics
    total_files: int
    completed_files: int
    total_iterations: int
    completed_iterations: int
    errors: List[str]

# In-memory storage for evaluation results (replace with database in production)
evaluation_store: Dict[str, EvaluationResult] = {}

def parse_s3_uri(uri: str) -> tuple[str, str]:
    """Parse S3 URI into bucket and prefix."""
    parsed = urlparse(uri)
    if parsed.scheme != 's3':
        raise ValueError(f"Invalid S3 URI: {uri}")
    return parsed.netloc, parsed.path.lstrip('/')

def get_file_hash_from_key(key: str) -> str:
    """Extract hash from S3 key like 'prefix/hash.ext'."""
    filename = key.split('/')[-1]
    return filename.split('.')[0]

async def fetch_s3_file_content(bucket: str, key: str) -> bytes:
    """Fetch file content from S3."""
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        return response['Body'].read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch {key}: {str(e)}")

async def save_iteration_response_to_s3(
    response_data: Dict[str, Any], 
    pdf_filename: str, 
    iteration: int, 
    responses_uri: str
) -> str:
    """Save API response iteration to S3, mimicking the original script's file structure."""
    try:
        # Parse responses S3 URI
        responses_bucket, responses_prefix = parse_s3_uri(responses_uri)
        
        # Get base filename without extension (like original script)
        pdf_name_base = pdf_filename.rsplit('.', 1)[0] if '.' in pdf_filename else pdf_filename
        
        # Create S3 key: prefix/pdf_name_base/iteration.json
        s3_key = f"{responses_prefix.rstrip('/')}/{pdf_name_base}/{iteration}.json"
        
        # Convert response to JSON string
        json_content = json.dumps(response_data, indent=2)
        
        # Upload to S3
        s3_client.put_object(
            Bucket=responses_bucket,
            Key=s3_key,
            Body=json_content.encode('utf-8'),
            ContentType='application/json'
        )
        
        return f"s3://{responses_bucket}/{s3_key}"
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save iteration response: {str(e)}")

async def seed_ground_truth_from_extraction(
    pdf_content: bytes,
    filename: str,
    file_hash: str,
    request: Union[EvaluationRequest, SeedGroundTruthRequest]
) -> Dict[str, Any]:
    """Generate ground truth by calling extraction API - seeds the ground truth when it doesn't exist."""
    try:
        # Call extraction API to generate initial ground truth
        api_response = await call_extraction_api(
            pdf_content, filename, request.extraction_endpoint,
            request.extraction_types, request.oauth_token
        )
        
        # Extract just the extracted_data portion for ground truth
        ground_truth_data = api_response.get('extracted_data', {})
        
        # Save the seeded ground truth to S3
        gt_bucket, gt_prefix = parse_s3_uri(request.ground_truth_uri)
        gt_key = f"{gt_prefix.rstrip('/')}/{file_hash}.json"
        
        # Save ground truth with metadata indicating it was seeded
        seeded_ground_truth = {
            "file_hash": file_hash,
            "filename": filename,
            "seeded_from_api": True,
            "extraction_endpoint": request.extraction_endpoint,
            "extraction_types": request.extraction_types,
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

async def call_extraction_api(
    pdf_content: bytes, 
    filename: str, 
    endpoint: str, 
    extraction_types: List[str],
    oauth_token: Optional[str] = None
) -> Dict[str, Any]:
    """Call the extraction API with PDF content."""
    
    # Build URL with query parameters
    base_url = endpoint.rstrip('/') + '/api/v1/process/'
    
    async with aiohttp.ClientSession() as session:
        form_data = aiohttp.FormData()
        form_data.add_field('file', pdf_content, filename=filename, content_type='application/pdf')
        
        # Add extraction types as query parameters
        params = {}
        for ext_type in extraction_types:
            if 'extraction_types' not in params:
                params['extraction_types'] = []
            params['extraction_types'].append(ext_type)
        params['datacontext'] = 'eval_test'
        
        headers = {'accept': 'application/json'}
        if oauth_token:
            headers['Authorization'] = f'Bearer {oauth_token}'
            
        async with session.post(base_url, data=form_data, headers=headers, params=params) as response:
            if response.status != 200:
                raise HTTPException(
                    status_code=response.status, 
                    detail=f"Extraction API failed: {response.status} {await response.text()}"
                )
            return await response.json()

def normalize_value_for_comparison(value: Any) -> str:
    """Convert any value to a normalized lowercase string for comparison."""
    if value is None:
        return ""
    elif isinstance(value, str):
        return value.strip().lower()
    elif isinstance(value, (int, float, bool)):
        return str(value).lower()
    elif isinstance(value, list):
        return ", ".join(normalize_value_for_comparison(item) for item in value)
    elif isinstance(value, dict):
        pairs = []
        for k, v in sorted(value.items()):
            pairs.append(f"{k}:{normalize_value_for_comparison(v)}")
        return "; ".join(pairs)
    else:
        return str(value).strip().lower()

def calculate_exact_similarity(expected: Any, actual: Any) -> float:
    """Return 1.0 if normalized strings match exactly, else 0.0."""
    exp_str = normalize_value_for_comparison(expected)
    act_str = normalize_value_for_comparison(actual)
    return 1.0 if exp_str == act_str else 0.0

def filter_ground_truth_by_extraction_types(ground_truth: Dict[str, Any], extraction_types: List[str]) -> Dict[str, Any]:
    """
    Filter ground truth to only include the specified extraction types.
    This ensures that unselected extraction types don't contribute to false negatives.
    """
    if not extraction_types:
        return ground_truth
    
    filtered_gt = {}
    for ext_type in extraction_types:
        if ext_type in ground_truth:
            filtered_gt[ext_type] = ground_truth[ext_type]
    
    return filtered_gt

def remove_excluded_fields_from_ground_truth(ground_truth: Dict[str, Any], excluded_fields: List[str]) -> Dict[str, Any]:
    """
    Remove excluded fields from ground truth based on JSON pointer paths.
    This ensures that excluded fields don't contribute to false negatives.
    Supports both specific indices (/medications/medications/0/frequency) and 
    wildcards for all array items (/medications/medications/frequency).
    """
    if not excluded_fields:
        return ground_truth
    
    import copy
    import logging
    
    logger = logging.getLogger(__name__)
    
    # Deep copy to avoid modifying original
    filtered_gt = copy.deepcopy(ground_truth)
    excluded_count = 0
    
    logger.debug(f"🔍 Excluding {len(excluded_fields)} field patterns from ground truth: {excluded_fields}")
    
    # Sort excluded fields by depth (deeper paths first) to avoid issues with deleting parent paths
    sorted_excluded = sorted(excluded_fields, key=lambda x: x.count('/'), reverse=True)
    
    for json_pointer in sorted_excluded:
        try:
            # Parse JSON pointer path (e.g., "/medications/medications/0/frequency")
            path_parts = [part for part in json_pointer.split('/') if part]
            
            if not path_parts:
                continue
            
            excluded_count += _remove_field_recursive(filtered_gt, path_parts, json_pointer)
                        
        except (ValueError, TypeError, KeyError, IndexError) as e:
            logger.warning(f"⚠️ Warning: Could not remove excluded field {json_pointer}: {e}")
            continue
    
    logger.debug(f"✅ Successfully excluded {excluded_count} field instances from ground truth")
    return filtered_gt

def _remove_field_recursive(data: Any, path_parts: List[str], original_path: str, current_path: str = "") -> int:
    """
    Recursively remove fields, handling both specific indices and wildcard array removal.
    Returns the number of fields actually removed.
    """
    if not path_parts:
        return 0
    
    import logging
    logger = logging.getLogger(__name__)
    
    removed_count = 0
    current_part = path_parts[0]
    remaining_parts = path_parts[1:]
    
    if len(remaining_parts) == 0:
        # This is the final field to remove
        if isinstance(data, dict) and current_part in data:
            del data[current_part]
            logger.debug(f"  ✓ Removed field: {current_path}/{current_part}")
            return 1
        elif isinstance(data, list) and current_part.isdigit():
            idx = int(current_part)
            if 0 <= idx < len(data):
                data.pop(idx)
                logger.debug(f"  ✓ Removed array item: {current_path}[{idx}]")
                return 1
        elif isinstance(data, list) and not current_part.isdigit():
            # Final field removal from ALL array items (wildcard case)
            logger.debug(f"  🎯 Removing field '{current_part}' from all {len(data)} array items")
            for i, item in enumerate(data):
                if isinstance(item, dict) and current_part in item:
                    del item[current_part]
                    logger.debug(f"    ✓ Removed {current_path}[{i}]/{current_part}")
                    removed_count += 1
            return removed_count
        return 0
    
    # Navigate deeper
    if isinstance(data, dict) and current_part in data:
        # Navigate into dict
        new_path = f"{current_path}/{current_part}" if current_path else current_part
        removed_count += _remove_field_recursive(data[current_part], remaining_parts, original_path, new_path)
        
    elif isinstance(data, list):
        if current_part.isdigit():
            # Specific array index
            idx = int(current_part)
            if 0 <= idx < len(data):
                new_path = f"{current_path}[{idx}]"
                removed_count += _remove_field_recursive(data[idx], remaining_parts, original_path, new_path)
        else:
            # Non-numeric part after array - apply to ALL array items (wildcard behavior)
            logger.debug(f"  🎯 Applying wildcard pattern '{current_part}' to all {len(data)} array items")
            for i, item in enumerate(data):
                new_path = f"{current_path}[{i}]"
                removed_count += _remove_field_recursive(item, [current_part] + remaining_parts, original_path, new_path)
    
    return removed_count

# Define semantic key selectors to include name, dosage, and frequency
ARRAY_KEY_FIELDS = {
    "medications.medications": lambda o: (
        f"{o.get('name','')}"
        f"|{o.get('dosage','')}"
        f"|{o.get('frequency','')}"
    ),
    "icd10_codes.codes": lambda o: o["code"],
    # …add more paths here as needed…
}

def flatten_json_for_comparison(data: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    """
    Flatten nested JSON into a key->value map.
    - Uses semantic keys for certain arrays (via ARRAY_KEY_FIELDS) instead of numeric indexes.
    - Collects multiple values under the same key into lists.
    """
    flat: Dict[str, Any] = {}

    for key, value in data.items():
        full_key = f"{prefix}.{key}" if prefix else key

        # 1) Keyed-array support
        selector = ARRAY_KEY_FIELDS.get(full_key)
        if selector and isinstance(value, list):
            for item in value:
                semantic = selector(item)
                item_prefix = f"{full_key}[{semantic}]"
                subflat = flatten_json_for_comparison(item, item_prefix)
                for subk, subv in subflat.items():
                    if subk in flat:
                        if isinstance(flat[subk], list):
                            flat[subk].append(subv)
                        else:
                            flat[subk] = [flat[subk], subv]
                    else:
                        flat[subk] = subv
            continue

        # 2) Recurse into dicts
        if isinstance(value, dict):
            flat.update(flatten_json_for_comparison(value, full_key))

        # 3) Index-based flattening for other lists
        elif isinstance(value, list):
            if value:
                for i, item in enumerate(value):
                    idx_prefix = f"{full_key}[{i}]"
                    if isinstance(item, dict):
                        flat.update(flatten_json_for_comparison(item, idx_prefix))
                    else:
                        flat[idx_prefix] = item
            else:
                flat[f"{full_key}._empty"] = True

        # 4) Scalars & nulls
        elif value is None:
            flat[f"{full_key}._empty"] = True
        else:
            flat[full_key] = value

    return flat

def compare_extraction_results(
    ground_truth: Dict[str, Any],
    api_response: Dict[str, Any]
) -> Tuple[Dict[str, float], List[str], int]:
    """
    Compare GT vs API response field‑by‑field.
    Returns (scores, mismatches, true_negatives).
    
    Score meanings:
    - 1.0: True Positive (perfect match)
    - 0.5-0.99: True Positive (partial match, but still correct extraction)
    - -1.0: False Positive (unexpected field or wrong value)
    - -2.0: False Negative (missing expected field)
    """
    scores: Dict[str, float] = {}
    mismatches: List[str] = []
    true_negatives = 0

    gt_flat = flatten_json_for_comparison(ground_truth)
    api_flat = flatten_json_for_comparison(api_response.get("extracted_data", {}))
    all_keys = set(gt_flat) | set(api_flat)

    for key in all_keys:
        exp = gt_flat.get(key)
        act = api_flat.get(key)

        # Handle list comparisons
        if isinstance(exp, list) or isinstance(act, list):
            exp_list = exp if isinstance(exp, list) else [exp] if exp is not None else []
            act_list = act if isinstance(act, list) else [act] if act is not None else []
            
            # Compare each expected item
            for exp_item in exp_list:
                if exp_item in act_list:
                    # True Positive: expected item found
                    item_key = f"{key}[{exp_item}]"
                    scores[item_key] = 1.0
                else:
                    # False Negative: expected item missing
                    item_key = f"{key}[{exp_item}]"
                    scores[item_key] = -2.0
                    mismatches.append(f"[FN] {item_key}: missing (expected='{exp_item}')")
            
            # Check for unexpected items (False Positives)
            for act_item in act_list:
                if act_item not in exp_list:
                    item_key = f"{key}[{act_item}]"
                    scores[item_key] = -1.0
                    mismatches.append(f"[FP] {item_key}: unexpected='{act_item}'")
            
            continue

        # both "missing" or empty → TN
        if exp is None and act is None:
            true_negatives += 1
            scores[key] = 1.0
            continue

        # FP: nothing expected, something found
        if exp is None and act is not None:
            scores[key] = -1.0  # Use -1.0 to mark as FP
            mismatches.append(f"[FP] {key}: unexpected='{act}'")
            continue

        # FN: something expected, nothing found
        if exp is not None and act is None:
            scores[key] = -2.0  # Use -2.0 to mark as FN
            mismatches.append(f"[FN] {key}: missing (expected='{exp}')")
            continue

        # both present: exact match or FP
        sim = calculate_exact_similarity(exp, act)
        scores[key] = sim
        if sim < 1.0:
            # Wrong value extracted - this is FP
            scores[key] = -1.0  # Use -1.0 to mark as FP
            mismatches.append(f"[FP] {key}: expected='{exp}' got='{act}'")

    return scores, mismatches, true_negatives

def calculate_overall_metrics(all_scores: List[Dict[str, float]], all_true_negatives: List[int] = None) -> EvaluationMetrics:
    """Calculate overall TP/FP/FN metrics from individual field scores."""
    tp = fp = fn = 0
    tn = sum(all_true_negatives) if all_true_negatives else 0
    
    for scores in all_scores:
        for field, score in scores.items():
            if score >= 0.99:  # Perfect or near-perfect match is TP
                tp += 1
            elif score == -1.0:  # False Positive (wrong value or unexpected field)
                fp += 1
            elif score == -2.0:  # False Negative (missing expected field)
                fn += 1
            elif score > 0.0:  # Partial match is still TP
                tp += 1
            # Note: scores for true negatives are handled separately and don't appear in individual field scores
    
    # Calculate metrics
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1_score = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
    accuracy = (tp + tn) / (tp + fp + fn + tn) if (tp + fp + fn + tn) > 0 else 0.0
    
    return EvaluationMetrics(
        true_positives=tp,
        false_positives=fp,
        false_negatives=fn,
        true_negatives=tn,
        precision=precision,
        recall=recall,
        f1_score=f1_score,
        accuracy=accuracy
    )

async def run_evaluation_task(evaluation_id: str, request: EvaluationRequest):
    """Background task to run the actual evaluation."""
    try:
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
        print(f"Request selected_files: {request.selected_files}")
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
        result.total_iterations = len(source_files) * request.iterations
        
        document_evaluations = []
        all_scores = []
        all_true_negatives = [] # Collect true negatives for overall metrics
        
        for file_info in source_files:
            try:
                source_key = file_info['key']
                filename = file_info['filename']
                file_hash = get_file_hash_from_key(source_key)
                
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
                        api_response = await call_extraction_api(
                            pdf_content, filename, request.extraction_endpoint,
                            request.extraction_types, request.oauth_token
                        )
                        api_responses.append(api_response)
                        
                        # Update iteration progress
                        result.completed_iterations += 1
                        
                        # Save iteration response to S3 if responses_uri is provided
                        if request.responses_uri:
                            try:
                                saved_path = await save_iteration_response_to_s3(
                                    api_response, filename, iteration + 1, request.responses_uri
                                )
                                print(f"Saved iteration {iteration + 1} response to: {saved_path}")
                            except Exception as save_error:
                                result.errors.append(f"Failed to save iteration {iteration + 1} for {filename}: {str(save_error)}")
                        
                    except Exception as e:
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
                        
                        # Use the last iteration for the main scores (backward compatibility)
                        if idx == len(api_responses) - 1:
                            scores = iter_scores
                            mismatches = iter_mismatches
                            true_negatives = iter_true_negatives
                
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
                    # For true negatives, replicate per iteration count
                    all_true_negatives.extend([true_negatives] * len(iteration_scores))
                elif scores:
                    # Fallback if iteration_scores is empty (no GT)
                    all_scores.append(scores)
                all_true_negatives.append(true_negatives)
                
                result.completed_files += 1
                
            except Exception as e:
                result.errors.append(f"Failed to evaluate {filename} ({source_key}): {str(e)}")
        
        # Calculate overall metrics
        result.metrics = calculate_overall_metrics(all_scores, all_true_negatives)
        result.documents = document_evaluations
        result.status = "completed"
        
    except Exception as e:
        result.status = "failed"
        result.errors.append(f"Evaluation failed: {str(e)}")

@router.post("/run-evaluation/", response_model=dict, tags=["evaluation"])
async def run_evaluation(request: EvaluationRequest, background_tasks: BackgroundTasks):
    """Start a new evaluation run with the specified parameters."""
    
    # Generate evaluation ID
    evaluation_id = hashlib.md5(f"{request.source_data_uri}{request.ground_truth_uri}{request.iterations}".encode()).hexdigest()
    
    # Initialize evaluation result
    evaluation_store[evaluation_id] = EvaluationResult(
        evaluation_id=evaluation_id,
        status="running",
        documents=[],
        metrics=EvaluationMetrics(
            true_positives=0, false_positives=0, false_negatives=0, true_negatives=0,
            precision=0.0, recall=0.0, f1_score=0.0, accuracy=0.0
        ),
        total_files=0,
        completed_files=0,
        total_iterations=0,
        completed_iterations=0,
        errors=[]
    )
    
    # Start background evaluation task
    background_tasks.add_task(run_evaluation_task, evaluation_id, request)
    
    return {"evaluation_id": evaluation_id, "status": "started"}

@router.get("/evaluation/{evaluation_id}", response_model=EvaluationResult, tags=["evaluation"])
async def get_evaluation_result(evaluation_id: str):
    """Get the result of a specific evaluation."""
    if evaluation_id not in evaluation_store:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    
    return evaluation_store[evaluation_id]

@router.get("/evaluations/", tags=["evaluation"])
async def list_evaluations():
    """List all evaluation runs."""
    return {
        "evaluations": [
            {
                "evaluation_id": eval_id,
                "status": result.status,
                "total_files": result.total_files,
                "completed_files": result.completed_files
            }
            for eval_id, result in evaluation_store.items()
        ]
    }

@router.post("/seed-ground-truth/", response_model=SeedGroundTruthResult, tags=["evaluation"])
async def seed_ground_truth(request: SeedGroundTruthRequest):
    """Manually seed ground truth for files that don't have it by calling the extraction API."""
    
    try:
        # Parse S3 URIs
        source_bucket, source_prefix = parse_s3_uri(request.source_data_uri)
        gt_bucket, gt_prefix = parse_s3_uri(request.ground_truth_uri)
        
        # List source files
        source_response = s3_client.list_objects_v2(Bucket=source_bucket, Prefix=source_prefix)
        source_files = [obj['Key'] for obj in source_response.get('Contents', []) if obj['Key'].endswith('.pdf')]
        
        # List existing ground truth files
        gt_response = s3_client.list_objects_v2(Bucket=gt_bucket, Prefix=gt_prefix)
        existing_gt_files = {get_file_hash_from_key(obj['Key']): obj['Key'] 
                           for obj in gt_response.get('Contents', []) if obj['Key'].endswith('.json')}
        
        seeded_files = []
        skipped_files = []
        errors = []
        
        for source_key in source_files:
            try:
                file_hash = get_file_hash_from_key(source_key)
                filename = source_key.split('/')[-1]
                
                # If user specified a specific file hash, only process that one
                if request.file_hash and file_hash != request.file_hash:
                    continue
                
                # Check if ground truth already exists
                if file_hash in existing_gt_files:
                    skipped_files.append(f"{filename} (ground truth already exists)")
                    continue
                
                # Fetch PDF content
                pdf_content = await fetch_s3_file_content(source_bucket, source_key)
                
                # Seed ground truth from extraction API
                gt_extracted_data = await seed_ground_truth_from_extraction(
                    pdf_content, filename, file_hash, request
                )
                
                seeded_files.append(f"{filename} -> {file_hash}.json")
                
            except Exception as e:
                errors.append(f"Failed to seed {source_key}: {str(e)}")
        
        return SeedGroundTruthResult(
            seeded_files=seeded_files,
            skipped_files=skipped_files,
            errors=errors
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Seeding operation failed: {str(e)}")

@router.get("/list-source-files/", tags=["evaluation"])
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

@router.post("/recalculate-evaluation/{evaluation_id}", response_model=EvaluationResult, tags=["evaluation"])
async def recalculate_evaluation(evaluation_id: str, request: RecalculateRequest):
    """Recalculate metrics and scores for an existing evaluation, reloading ground truth data from S3."""
    if evaluation_id not in evaluation_store:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    
    result = evaluation_store[evaluation_id]
    
    try:
        # Parse ground truth S3 URI
        gt_bucket, gt_prefix = parse_s3_uri(request.ground_truth_uri)
        
        # List ground truth files from S3
        gt_response = s3_client.list_objects_v2(Bucket=gt_bucket, Prefix=gt_prefix)
        gt_files = {get_file_hash_from_key(obj['Key']): obj['Key'] 
                   for obj in gt_response.get('Contents', []) if obj['Key'].endswith('.json')}
        
        # Recalculate scores and metrics for each document
        updated_documents = []
        all_scores = []
        all_true_negatives = []
        
        # Cache for reloaded ground truth data
        gt_cache = {}
        
        for doc_eval in result.documents:
            if doc_eval.api_responses:
                # Reload ground truth data from S3
                ground_truth_data = None
                if doc_eval.file_hash and doc_eval.file_hash in gt_files:
                    if doc_eval.file_hash not in gt_cache:
                        try:
                            # Fetch fresh ground truth from S3
                            gt_content = await fetch_s3_file_content(gt_bucket, gt_files[doc_eval.file_hash])
                            ground_truth = json.loads(gt_content.decode('utf-8'))
                            # Extract only the extracted_data part for comparison
                            gt_cache[doc_eval.file_hash] = ground_truth.get('extracted_data', ground_truth)
                        except Exception as e:
                            print(f"Failed to reload ground truth for {doc_eval.filename}: {str(e)}")
                            gt_cache[doc_eval.file_hash] = None
                    
                    ground_truth_data = gt_cache[doc_eval.file_hash]
                
                if ground_truth_data:
                    # Filter ground truth based on extraction types if provided
                    if request.extraction_types:
                        filtered_ground_truth = filter_ground_truth_by_extraction_types(ground_truth_data, request.extraction_types)
                    else:
                        filtered_ground_truth = ground_truth_data
                    
                    # Remove excluded fields from ground truth if provided
                    if request.excluded_fields is not None:
                        filtered_ground_truth = remove_excluded_fields_from_ground_truth(filtered_ground_truth, request.excluded_fields)
                    
                    # Calculate scores for each iteration
                    iteration_scores = []
                    iteration_mismatches = []
                    scores = {}
                    mismatches = []
                    true_negatives = 0
                    
                    for idx, api_response in enumerate(doc_eval.api_responses):
                        # Also apply exclusions to API response for fair comparison
                        if request.excluded_fields is not None:
                            api_extracted_data = api_response.get("extracted_data", api_response)
                            if request.extraction_types:
                                filtered_api_extracted_data = filter_ground_truth_by_extraction_types(
                                    api_extracted_data, request.extraction_types
                                )
                            else:
                                filtered_api_extracted_data = api_extracted_data
                            filtered_api_extracted_data = remove_excluded_fields_from_ground_truth(
                                filtered_api_extracted_data, request.excluded_fields
                            )
                            filtered_api_response = {"extracted_data": filtered_api_extracted_data}
                            iter_scores, iter_mismatches, iter_true_negatives = compare_extraction_results(filtered_ground_truth, filtered_api_response)
                        else:
                            iter_scores, iter_mismatches, iter_true_negatives = compare_extraction_results(filtered_ground_truth, api_response)
                        # Add iteration info to mismatches
                        iter_mismatches = [f"[{doc_eval.filename} | Iter {idx + 1}] {mismatch}" for mismatch in iter_mismatches]
                        
                        iteration_scores.append(iter_scores)
                        iteration_mismatches.append(iter_mismatches)
                        
                        # Use the last iteration for the main scores (backward compatibility)
                        if idx == len(doc_eval.api_responses) - 1:
                            scores = iter_scores
                            mismatches = iter_mismatches
                            true_negatives = iter_true_negatives
                    
                    # Update document evaluation with new calculations and reloaded ground truth
                    updated_doc = DocumentEvaluation(
                        filename=doc_eval.filename,
                        file_hash=doc_eval.file_hash,
                        ground_truth=filtered_ground_truth,  # Use filtered ground truth
                        api_responses=doc_eval.api_responses,  # Keep original responses
                        scores=scores,
                        mismatches=mismatches,
                        true_negatives=true_negatives,
                        iteration_scores=iteration_scores,
                        iteration_mismatches=iteration_mismatches
                    )
                    
                    if iteration_scores:
                        all_scores.extend(iteration_scores)
                        all_true_negatives.extend([true_negatives] * len(iteration_scores))
                    else:
                        all_scores.append(scores)
                        all_true_negatives.append(true_negatives)
                else:
                    # No ground truth available
                    updated_doc = DocumentEvaluation(
                        filename=doc_eval.filename,
                        file_hash=doc_eval.file_hash,
                        ground_truth=None,
                        api_responses=doc_eval.api_responses,
                        scores={},
                        mismatches=[],
                        true_negatives=0
                    )
                    all_true_negatives.append(0)
            else:
                # Keep documents without API responses unchanged
                updated_doc = doc_eval
                all_true_negatives.append(doc_eval.true_negatives)
            
            updated_documents.append(updated_doc)
        
        # Recalculate overall metrics
        new_metrics = calculate_overall_metrics(all_scores, all_true_negatives)
        
        # Update the stored result
        result.documents = updated_documents
        result.metrics = new_metrics
        
        return result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to recalculate evaluation: {str(e)}")

@router.get("/check-missing-ground-truth/", tags=["evaluation"])
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