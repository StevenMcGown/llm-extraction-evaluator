"""Service for S3 storage operations."""
import json
import boto3
from typing import Dict, Any
from urllib.parse import urlparse
from fastapi import HTTPException
from datetime import datetime


s3_client = boto3.client("s3")


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


def build_s3_paths(evaluation_run_id: str, file_hash: str, iteration: int) -> Dict[str, str]:
    """Build S3 paths for an evaluation run."""
    base_path = f"{evaluation_run_id}"
    
    return {
        "metadata": f"{base_path}/metadata.json",
        "response": f"{base_path}/responses/{file_hash}/{iteration}.json",
        "results": f"{base_path}/results/summary.json"
    }


async def save_evaluation_metadata_to_s3(
    evaluation_run_id: str,
    config: Dict[str, Any],
    responses_uri: str
) -> str:
    """Save evaluation run metadata to S3."""
    try:
        # Parse responses S3 URI
        responses_bucket, responses_prefix = parse_s3_uri(responses_uri)
        
        # Create metadata object
        metadata = {
            "evaluation_run_id": evaluation_run_id,
            "created_at": datetime.utcnow().isoformat(),
            "config": config,
            "status": "running"
        }
        
        # Create S3 key for metadata
        if responses_prefix:
            s3_key = f"{responses_prefix.rstrip('/')}/{evaluation_run_id}/metadata.json"
        else:
            s3_key = f"{evaluation_run_id}/metadata.json"
        
        # Convert to JSON string
        json_content = json.dumps(metadata, indent=2)
        
        # Upload to S3
        s3_client.put_object(
            Bucket=responses_bucket,
            Key=s3_key,
            Body=json_content.encode('utf-8'),
            ContentType='application/json'
        )
        
        return f"s3://{responses_bucket}/{s3_key}"
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save evaluation metadata: {str(e)}")


async def save_evaluation_results_to_s3(
    evaluation_run_id: str,
    results: Dict[str, Any],
    responses_uri: str
) -> str:
    """Save evaluation results to S3."""
    try:
        # Parse responses S3 URI
        responses_bucket, responses_prefix = parse_s3_uri(responses_uri)
        
        # Create S3 key for results
        if responses_prefix:
            s3_key = f"{responses_prefix.rstrip('/')}/{evaluation_run_id}/results/summary.json"
        else:
            s3_key = f"{evaluation_run_id}/results/summary.json"
        
        # Convert to JSON string
        json_content = json.dumps(results, indent=2)
        
        # Upload to S3
        s3_client.put_object(
            Bucket=responses_bucket,
            Key=s3_key,
            Body=json_content.encode('utf-8'),
            ContentType='application/json'
        )
        
        return f"s3://{responses_bucket}/{s3_key}"
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save evaluation results: {str(e)}")


async def save_iteration_response_to_s3(
    response_data: Dict[str, Any], 
    file_hash: str,
    iteration: int, 
    evaluation_run_id: str,
    responses_uri: str
) -> str:
    """Save API response iteration to S3 using new evaluation run structure."""
    try:
        # Parse responses S3 URI
        responses_bucket, responses_prefix = parse_s3_uri(responses_uri)
        
        # Create S3 key using new structure: evaluation_runs/{run_id}/responses/{file_hash}/{iteration}.json
        if responses_prefix:
            s3_key = f"{responses_prefix.rstrip('/')}/{evaluation_run_id}/responses/{file_hash}/{iteration}.json"
        else:
            s3_key = f"{evaluation_run_id}/responses/{file_hash}/{iteration}.json"
        
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