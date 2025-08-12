"""Evaluation endpoints for comparing ground truth data with extraction API results."""
from __future__ import annotations

import json
import asyncio
import time
from typing import Dict, List, Optional, Any, Union
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

# Set up logging
import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import DB helpers
from .db import _pool, _vars

# Import services
from ...services.comparison_service import EvaluationMetrics, calculate_overall_metrics
from ...services.storage_service import parse_s3_uri, get_file_hash_from_key, s3_client
from ...services.evaluation_runner_service import (
    generate_evaluation_run_id, run_evaluation_task, evaluation_lock,
    seed_ground_truth_from_extraction
)
from ...services.history_service import (
    load_evaluation_from_s3, check_missing_ground_truth, list_source_files
)

router = APIRouter()

# -------------------------------------------------------------------------
# Models
# -------------------------------------------------------------------------

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
    evaluation_run_id: Optional[str] = Field(None, description="Evaluation run ID (generated automatically if not provided)")

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
    responses_uri: str = Field(..., description="S3 URI to evaluation responses (where run data is stored)")
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

# -------------------------------------------------------------------------
# Route Handlers
# -------------------------------------------------------------------------

@router.post("/run-evaluation/", response_model=dict, tags=["evaluation"])
async def run_evaluation(request: EvaluationRequest, background_tasks: BackgroundTasks):
    """Start a new evaluation run with the specified parameters."""
    
    # Generate evaluation run ID upfront (this will be used consistently)
    evaluation_run_id = generate_evaluation_run_id()
    
    # Check if evaluation lock is currently held
    lock_acquired = evaluation_lock.locked()
    if lock_acquired:
        logger.info(f"Evaluation {evaluation_run_id} queued - another evaluation is currently running")
    else:
        logger.info(f"Evaluation {evaluation_run_id} starting - no queue")
    
    # Calculate total iterations upfront for proper progress tracking
    # We need to estimate the number of files that will be processed
    # For now, we'll set a reasonable default and update it in the background task
    estimated_total_iterations = 0
    if request.selected_files:
        estimated_total_iterations = len(request.selected_files) * request.iterations
        logger.info(f"Evaluation {evaluation_run_id}: Initial estimate based on {len(request.selected_files)} selected files * {request.iterations} iterations = {estimated_total_iterations}")
    else:
        # If no specific files selected, we'll estimate based on typical file counts
        # This will be updated with the actual count in the background task
        estimated_total_iterations = 10 * request.iterations  # Conservative estimate
        logger.info(f"Evaluation {evaluation_run_id}: Initial estimate (no file selection) = {estimated_total_iterations}")
    
    # Initialize evaluation result using evaluation_run_id as key
    evaluation_store[evaluation_run_id] = EvaluationResult(
        evaluation_id=evaluation_run_id,
        status="queued" if lock_acquired else "running",
        documents=[],
        metrics=EvaluationMetrics(
            true_positives=0, false_positives=0, false_negatives=0, true_negatives=0,
            precision=0.0, recall=0.0, f1_score=0.0, accuracy=0.0
        ),
        total_files=0,
        completed_files=0,
        total_iterations=estimated_total_iterations,
        completed_iterations=0,
        errors=[]
    )
    
    # Add evaluation_run_id to the request so background task can use it
    request.evaluation_run_id = evaluation_run_id
    
    # Start background evaluation task
    background_tasks.add_task(run_evaluation_task, evaluation_run_id, request, evaluation_store)
    
    return {
        "evaluation_id": evaluation_run_id, 
        "status": "queued" if lock_acquired else "started",
        "message": "Evaluation queued - another evaluation is running" if lock_acquired else "Evaluation started"
    }

@router.post("/test-progress/", tags=["debug"])
async def test_progress():
    """Test endpoint to verify progress tracking works with artificial delays."""
    test_id = "test-" + str(int(time.time()))
    
    # Initialize test evaluation
    evaluation_store[test_id] = EvaluationResult(
        evaluation_id=test_id,
        status="running",
        documents=[],
        metrics=EvaluationMetrics(
            true_positives=0, false_positives=0, false_negatives=0, true_negatives=0,
            precision=0.0, recall=0.0, f1_score=0.0, accuracy=0.0
        ),
        total_files=2,
        completed_files=0,
        total_iterations=6,  # 2 files × 3 iterations
        completed_iterations=0,
        errors=[]
    )
    
    # Start background task to simulate slow progress
    async def simulate_progress():
        try:
            result = evaluation_store[test_id]
            logger.info(f"🧪 Test {test_id}: Starting simulation with {result.total_iterations} iterations")
            
            for i in range(result.total_iterations):
                await asyncio.sleep(2.0)  # 2 second delay per iteration
                result.completed_iterations += 1
                if i % 3 == 2:  # Every 3rd iteration, increment file count
                    result.completed_files += 1
                logger.info(f"🧪 Test {test_id}: Completed iteration {result.completed_iterations}/{result.total_iterations}")
            
            result.status = "completed"
            logger.info(f"🧪 Test {test_id}: Simulation completed!")
        except Exception as e:
            logger.error(f"🧪 Test {test_id}: Simulation failed: {e}")
            result.status = "failed"
    
    # Start the simulation in the background
    asyncio.create_task(simulate_progress())
    
    return {
        "test_id": test_id,
        "message": "Test progress simulation started",
        "instructions": f"Poll GET /api/v1/evaluation/{test_id} to see progress"
    }

@router.get("/debug/evaluation-store/", tags=["debug"])
async def debug_evaluation_store():
    """Debug endpoint to see the current evaluation store state."""
    return {
        "evaluation_store": {
            eval_id: {
                "evaluation_id": result.evaluation_id,
                "status": result.status,
                "total_files": result.total_files,
                "completed_files": result.completed_files,
                "total_iterations": result.total_iterations,
                "completed_iterations": result.completed_iterations,
                "errors": result.errors
            }
            for eval_id, result in evaluation_store.items()
        }
    }

@router.get("/evaluation-status/", response_model=dict, tags=["evaluation"])
async def get_evaluation_status():
    """Get the current status of the evaluation system (running/queue info)."""
    
    lock_held = evaluation_lock.locked()
    running_evaluations = []
    queued_evaluations = []
    
    # Find running and queued evaluations
    for eval_id, result in evaluation_store.items():
        if result.status == "running":
            running_evaluations.append({
                "evaluation_id": eval_id,
                "completed_files": result.completed_files,
                "total_files": result.total_files,
                "completed_iterations": result.completed_iterations,
                "total_iterations": result.total_iterations
            })
        elif result.status == "queued":
            queued_evaluations.append({
                "evaluation_id": eval_id
            })
    
    return {
        "lock_held": lock_held,
        "running_evaluations": running_evaluations,
        "queued_evaluations": queued_evaluations,
        "queue_length": len(queued_evaluations)
    }

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

@router.get("/evaluation-metrics/", tags=["evaluation"])
async def get_evaluation_metrics(limit: int = 100):
    """Get evaluation metrics from database for dashboard."""
    try:
        _vars()
        pool = await _pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT 
                        id,
                        file_id,
                        evaluation_timestamp,
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
                    FROM evaluation_metrics 
                    ORDER BY evaluation_timestamp DESC 
                    LIMIT %s
                    """,
                    (limit,)
                )
                rows = await cur.fetchall()
                
                # Convert to list of dictionaries
                metrics = []
                for row in rows:
                    metrics.append({
                        "id": row[0],
                        "file_id": row[1],
                        "evaluation_timestamp": row[2].isoformat() if row[2] else None,
                        "overall_precision": float(row[3]) if row[3] is not None else None,
                        "overall_recall": float(row[4]) if row[4] is not None else None,
                        "overall_f1_score": float(row[5]) if row[5] is not None else None,
                        "overall_accuracy": float(row[6]) if row[6] is not None else None,
                        "overall_tp": row[7],
                        "overall_tn": row[8],
                        "overall_fp": row[9],
                        "overall_fn": row[10],
                        "ground_truth_file_id": row[11],
                        "extraction_run_id": row[12],
                        "evaluation_config": json.loads(row[13]) if row[13] else {}
                    })
        
        pool.close(); await pool.wait_closed()
        return {"metrics": metrics, "count": len(metrics)}
        
    except Exception as e:
        logger.error(f"Failed to get evaluation metrics: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get evaluation metrics: {str(e)}")

@router.get("/evaluation/s3/{run_id}", response_model=EvaluationResult, tags=["evaluation"])
async def get_evaluation_from_s3(run_id: str, responses_uri: str):
    """Load evaluation results from S3 using run ID."""
    return await load_evaluation_from_s3(run_id, responses_uri)

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
        
        from ...services.storage_service import fetch_s3_file_content
        
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
                    pdf_content, filename, file_hash, 
                    request.extraction_endpoint, request.extraction_types,
                    request.oauth_token, request.ground_truth_uri
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
async def list_source_files_endpoint(source_data_uri: str):
    """List all source files with their original names from S3 tags."""
    return await list_source_files(source_data_uri)

@router.post("/recalculate-evaluation/{evaluation_id}", response_model=EvaluationResult, tags=["evaluation"])
async def recalculate_evaluation(evaluation_id: str, request: RecalculateRequest):
    """Recalculate metrics and scores for an existing evaluation, loading data from S3."""
    
    # Load the evaluation from S3 first
    try:
        result = await load_evaluation_from_s3(evaluation_id, request.responses_uri)
    except HTTPException as e:
        # If it's a 404, make the error more specific
        if e.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Evaluation run '{evaluation_id}' not found in S3")
        raise
    
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
        
        from ...services.storage_service import fetch_s3_file_content
        from ...services.comparison_service import (
            filter_ground_truth_by_extraction_types, remove_excluded_fields_from_ground_truth,
            compare_extraction_results, calculate_overall_metrics
        )
        
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
                
                ground_truth_data = gt_cache.get(doc_eval.file_hash)
                
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
                    iteration_true_negatives: List[int] = []
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
                        iteration_true_negatives.append(iter_true_negatives)
                        
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
                    updated_documents.append(updated_doc)
                    
                    if iteration_scores:
                        all_scores.extend(iteration_scores)
                        all_true_negatives.extend(iteration_true_negatives)
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
                    updated_documents.append(updated_doc)
                    all_true_negatives.append(0)
            else:
                # Keep documents without API responses unchanged
                updated_documents.append(doc_eval)
                all_true_negatives.append(doc_eval.true_negatives)
        
        # Recalculate overall metrics
        new_metrics = calculate_overall_metrics(all_scores)
        
        # Update the stored result
        result.documents = updated_documents
        result.metrics = new_metrics
        
        return result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to recalculate evaluation: {str(e)}")

@router.get("/check-missing-ground-truth/", tags=["evaluation"])
async def check_missing_ground_truth_endpoint(
    source_data_uri: str,
    ground_truth_uri: str
):
    """Check which PDF files are missing ground truth files."""
    return await check_missing_ground_truth(source_data_uri, ground_truth_uri)