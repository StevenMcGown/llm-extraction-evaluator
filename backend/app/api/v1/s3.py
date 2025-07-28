"""S3 object listing & download endpoints.

Assumes AWS credentials are provided via environment variables or IAM role.
"""
# noqa: D401
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import boto3
from botocore.exceptions import NoCredentialsError
import os
from typing import Optional
from pathlib import Path


from pydantic import BaseModel
import json

class GroundTruthUpload(BaseModel):
    bucket: str
    key: str  # full S3 object key (e.g. ground_truth/abc123.json or abc123.json)
    content: dict


router = APIRouter()

# Use default credential chain (env vars, shared config, IAM role, etc.)
s3_client = boto3.client("s3")


@router.get("/list-files/", tags=["s3"])
async def list_files(bucket: str, prefix: Optional[str] = None):
    """Return a list of object keys in the given S3 bucket, optionally filtered by prefix."""
    params = {"Bucket": bucket}
    if prefix:
        params["Prefix"] = prefix
    try:
        response = s3_client.list_objects_v2(**params)
    except s3_client.exceptions.NoSuchBucket:  # type: ignore  # boto3 dynamic attr
        raise HTTPException(status_code=404, detail="Bucket not found")
    except NoCredentialsError:
        raise HTTPException(
            status_code=500,
            detail="AWS credentials not found. Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or configure a profile.",
        )

    keys = [obj["Key"] for obj in response.get("Contents", []) if not obj["Key"].endswith("/")]

    # Enrich with original_name from S3 object tags
    file_meta: list[dict] = []
    for key in keys:
        try:
            # Get object tags to extract original_name
            tag_response = s3_client.get_object_tagging(Bucket=bucket, Key=key)
            original_name = None
            
            # Look for original_name in tags
            for tag in tag_response.get("TagSet", []):
                if tag["Key"] == "original_name":
                    from urllib.parse import unquote_plus
                    original_name = unquote_plus(tag["Value"])
                    break
            
            file_meta.append({"key": key, "original_name": original_name})
        except Exception as e:
            # If we can't get tags (e.g., object doesn't exist or no permissions), 
            # just include the key without original_name
            file_meta.append({"key": key, "original_name": None})

    return {"files": file_meta}


@router.get("/download/", tags=["s3"])
async def download_file(bucket: str, key: str):
    """Stream an object from S3 back to the client."""
    try:
        obj = s3_client.get_object(Bucket=bucket, Key=key)
    except s3_client.exceptions.NoSuchKey:  # type: ignore
        raise HTTPException(status_code=404, detail="File not found")
    except NoCredentialsError:
        raise HTTPException(
            status_code=500,
            detail="AWS credentials not found. Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or configure a profile.",
        )

    return StreamingResponse(
        obj["Body"].iter_chunks(),
        media_type=obj.get("ContentType", "application/octet-stream"),
        headers={
            "Content-Disposition": f'attachment; filename="{os.path.basename(key)}"'
        },
    ) 


@router.post("/upload-ground-truth/", tags=["s3"])
async def upload_ground_truth(payload: GroundTruthUpload):
    """Upload ground-truth JSON to S3 at the exact *key* provided (no hashing/prefix logic)."""
    try:
        print(f"Uploading ground truth to {payload.bucket}/{payload.key}")
        s3_client.put_object(
            Bucket=payload.bucket,
            Key=payload.key,
            Body=json.dumps(payload.content).encode("utf-8"),
            ContentType="application/json",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload ground truth: {e}")

    return {"bucket": payload.bucket, "key": payload.key} 