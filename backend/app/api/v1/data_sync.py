"""Endpoints to pull ground-truth and source data from S3 to local filesystem."""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import boto3
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

s3 = boto3.client("s3")


class SyncRequest(BaseModel):
    ground_truth: Optional[str] = Field(None, description="S3 URI to ground-truth folder e.g. s3://bucket/prefix/")
    source_data: Optional[str] = Field(None, description="S3 URI to source data folder e.g. s3://bucket/prefix/")


class SyncResponse(BaseModel):
    ground_truth: int = 0
    source_data: int = 0


# Helpers ---------------------------------------------------------------------

def _parse_s3_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("s3://"):
        raise ValueError("URI must start with s3://")
    parsed = urlparse(uri)
    bucket = parsed.netloc
    prefix = parsed.path.lstrip("/")
    return bucket, prefix


def _download_prefix(bucket: str, prefix: str, dest: Path) -> int:
    paginator = s3.get_paginator("list_objects_v2")
    total = 0
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith('/'):
                # Skip folder placeholders
                continue
            rel_path = Path(key).relative_to(prefix) if prefix else Path(key)
            target_file = dest / rel_path
            target_file.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(bucket, key, str(target_file))
            total += 1
    return total

# ----------------------------------------------------------------------------

@router.post("/sync-data/", response_model=SyncResponse, tags=["data"])
async def sync_data(payload: SyncRequest):
    """Download ground-truth and/or source data prefixes to local `test_data/`."""
    base_dir = Path(__file__).resolve().parents[3] / "test_data"

    out = SyncResponse()

    if not payload.ground_truth and not payload.source_data:
        raise HTTPException(status_code=400, detail="No paths provided")

    try:
        if payload.ground_truth:
            gt_bucket, gt_prefix = _parse_s3_uri(payload.ground_truth)
            dest = base_dir / "ground_truth"
            if dest.exists():
                shutil.rmtree(dest)
            dest.mkdir(parents=True, exist_ok=True)
            out.ground_truth = _download_prefix(gt_bucket, gt_prefix, dest)

        if payload.source_data:
            src_bucket, src_prefix = _parse_s3_uri(payload.source_data)
            dest = base_dir / "source_files"
            if dest.exists():
                shutil.rmtree(dest)
            dest.mkdir(parents=True, exist_ok=True)
            out.source_data = _download_prefix(src_bucket, src_prefix, dest)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return out 