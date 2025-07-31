"""File management endpoints for document extraction evaluation."""
from __future__ import annotations

import hashlib
import os
import uuid
import logging
from typing import Optional
from urllib.parse import urlparse

import aiomysql
import boto3
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query, Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import io
import json
import traceback

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

# Use same DB connection helper as db.py
def _ensure_vars() -> None:
    missing = [k for k in ("DB_HOST", "DB_USER", "DB_PASSWORD") if not os.getenv(k)]
    if missing:
        raise HTTPException(status_code=500, detail=f"Missing env vars: {', '.join(missing)}")

def _pool():
    return aiomysql.create_pool(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", 3306)),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        db=(os.getenv("DB_NAME") or None),
        autocommit=True,
        minsize=1,
        maxsize=2,
    )

# S3 client for file storage
s3_client = boto3.client("s3")
S3_BUCKET = os.getenv("S3_BUCKET", "default-bucket")  # Configure in env


class FileResponse(BaseModel):
    file_id: str
    file_hash: str
    original_name: str
    s3_key: str
    uploaded_at: str
    is_duplicate: bool = False


@router.post("/upload-pdf/", response_model=FileResponse, tags=["files"])
async def upload_pdf(file: UploadFile = File(...)):
    """Upload a PDF file, compute hash, check for duplicates, store to S3 and DB."""
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    _ensure_vars()
    
    # Read file content and compute hash
    content = await file.read()
    file_hash = hashlib.sha256(content).hexdigest()
    
    # Log file details for debugging
    logger.info(f"PDF Upload - Filename: {file.filename}, Hash: {file_hash}")
    
    pool = await _pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Check if file already exists in database
            await cur.execute("SELECT file_id, original_name, s3_key, uploaded_at FROM files WHERE file_hash = %s", (file_hash,))
            existing = await cur.fetchone()
            
            if existing:
                # File exists in database - check if it actually exists in S3
                existing_s3_key = existing[2]
                try:
                    s3_client.head_object(Bucket=S3_BUCKET, Key=existing_s3_key)
                    logger.info(f"File exists in both database and S3 - File ID: {existing[0]}")
                    # File exists in both DB and S3 - return existing record
                    return FileResponse(
                        file_id=existing[0],
                        file_hash=file_hash,
                        original_name=existing[1],
                        s3_key=existing[2],
                        uploaded_at=str(existing[3]),
                        is_duplicate=True
                    )
                except Exception as e:
                    # File exists in DB but not in S3 - re-upload to S3
                    logger.warning(f"File exists in database but not in S3 - re-uploading. File ID: {existing[0]}, S3 Key: {existing_s3_key}")
                    try:
                        from urllib.parse import quote_plus
                        s3_client.put_object(
                            Bucket=S3_BUCKET,
                            Key=existing_s3_key,
                            Body=content,
                            ContentType=file.content_type or "application/pdf",
                            Tagging=f"original_name={quote_plus(file.filename)}"
                        )
                        logger.info(f"S3 re-upload successful for {file.filename}")
                        return FileResponse(
                            file_id=existing[0],
                            file_hash=file_hash,
                            original_name=existing[1],
                            s3_key=existing[2],
                            uploaded_at=str(existing[3]),
                            is_duplicate=False  # Not a duplicate since we had to re-upload
                        )
                    except Exception as s3_error:
                        logger.error(f"S3 re-upload failed for {file.filename}: {str(s3_error)}")
                        raise HTTPException(status_code=500, detail=f"S3 re-upload failed: {str(s3_error)}")
            
            # New file - generate UUID and S3 key (store under source_files/ to allow future non-PDF types)
            file_id = str(uuid.uuid4())
            _, ext = os.path.splitext(file.filename)
            ext = ext.lower() or '.dat'
            s3_key = f"source_files/{file_hash}{ext}"
            
            logger.info(f"Uploading new file to S3 - Key: {s3_key}")
            
            # Upload to S3
            try:
                from urllib.parse import quote_plus
                s3_client.put_object(
                    Bucket=S3_BUCKET,
                    Key=s3_key,
                    Body=content,
                    ContentType=file.content_type or "application/pdf",
                    Tagging=f"original_name={quote_plus(file.filename)}"
                )
                logger.info(f"S3 upload successful for {file.filename}")
            except Exception as e:
                logger.error(f"S3 upload failed for {file.filename}: {str(e)}")
                raise HTTPException(status_code=500, detail=f"S3 upload failed: {str(e)}")
            
            # Insert into database
            await cur.execute(
                """INSERT INTO files (file_id, file_hash, original_name, s3_key) 
                   VALUES (%s, %s, %s, %s)""",
                (file_id, file_hash, file.filename, s3_key)
            )
            
            # Get the inserted record
            await cur.execute("SELECT uploaded_at FROM files WHERE file_id = %s", (file_id,))
            uploaded_at = await cur.fetchone()
            
            logger.info(f"File successfully uploaded and stored - File ID: {file_id}")
    
    pool.close(); await pool.wait_closed()
    
    return FileResponse(
        file_id=file_id,
        file_hash=file_hash,
        original_name=file.filename,
        s3_key=s3_key,
        uploaded_at=str(uploaded_at[0]),
        is_duplicate=False
    )


# Generic upload endpoint ------------------------------------------------------

@router.post("/upload-file/", response_model=FileResponse, tags=["files"])
async def upload_any_file(file: UploadFile = File(...), target_uri: str | None = Form(None)):
    """Upload *any* file to S3 using SHA-256 hash as name, keep original extension."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="File must have a name")

    _ensure_vars()

    # Read bytes and compute hash
    content = await file.read()
    file_hash = hashlib.sha256(content).hexdigest()
    _, ext = os.path.splitext(file.filename)
    ext = ext.lower()

    # Log file details for debugging
    logger.info(f"File Upload - Filename: {file.filename}, Hash: {file_hash}, Extension: {ext}")

    # Determine bucket/prefix
    if target_uri and target_uri.startswith("s3://"):
        from urllib.parse import urlparse
        parsed = urlparse(target_uri)
        bucket_override = parsed.netloc
        prefix_override = parsed.path.lstrip("/")
        if prefix_override and not prefix_override.endswith('/'):
            prefix_override += '/'
    else:
        bucket_override = S3_BUCKET
        prefix_override = "source_files/"

    logger.info(f"Target bucket: {bucket_override}, prefix: {prefix_override}")

    pool = await _pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT file_id, original_name, s3_key, uploaded_at FROM files WHERE file_hash = %s", (file_hash,))
            existing = await cur.fetchone()
            if existing:
                # File exists in database - check if it actually exists in S3
                existing_s3_key = existing[2]
                try:
                    s3_client.head_object(Bucket=bucket_override, Key=existing_s3_key)
                    logger.info(f"File exists in both database and S3 - File ID: {existing[0]}, Original name: {existing[1]}")
                    return FileResponse(
                        file_id=existing[0],
                        file_hash=file_hash,
                        original_name=existing[1],
                        s3_key=existing[2],
                        uploaded_at=str(existing[3]),
                        is_duplicate=True,
                    )
                except Exception as e:
                    # File exists in DB but not in S3 - re-upload to S3
                    logger.warning(f"File exists in database but not in S3 - re-uploading. File ID: {existing[0]}, S3 Key: {existing_s3_key}")
                    try:
                        from urllib.parse import quote_plus
                        s3_client.put_object(
                            Bucket=bucket_override,
                            Key=existing_s3_key,
                            Body=content,
                            ContentType=file.content_type or "application/octet-stream",
                            Tagging=f"original_name={quote_plus(file.filename)}"
                        )
                        logger.info(f"S3 re-upload successful for {file.filename}")
                        return FileResponse(
                            file_id=existing[0],
                            file_hash=file_hash,
                            original_name=existing[1],
                            s3_key=existing[2],
                            uploaded_at=str(existing[3]),
                            is_duplicate=False  # Not a duplicate since we had to re-upload
                        )
                    except Exception as s3_error:
                        logger.error(f"S3 re-upload failed for {file.filename}: {str(s3_error)}")
                        raise HTTPException(status_code=500, detail=f"S3 re-upload failed: {str(s3_error)}")

            file_id = str(uuid.uuid4())
            s3_key = f"{prefix_override}{file_hash}{ext}"

            logger.info(f"Uploading new file to S3 - Key: {s3_key}")

            try:
                from urllib.parse import quote_plus
                s3_client.put_object(
                    Bucket=bucket_override,
                    Key=s3_key,
                    Body=content,
                    ContentType=file.content_type or "application/octet-stream",
                    Tagging=f"original_name={quote_plus(file.filename)}"
                )
                logger.info(f"S3 upload successful for {file.filename}")
            except Exception as e:
                logger.error(f"S3 upload failed for {file.filename}: {str(e)}")
                raise HTTPException(status_code=500, detail=f"S3 upload failed: {str(e)}")

            await cur.execute(
                """INSERT INTO files (file_id, file_hash, original_name, s3_key)
                   VALUES (%s, %s, %s, %s)""",
                (file_id, file_hash, file.filename, s3_key),
            )

            await cur.execute("SELECT uploaded_at FROM files WHERE file_id = %s", (file_id,))
            uploaded_at = await cur.fetchone()

            logger.info(f"File successfully uploaded and stored - File ID: {file_id}")

    pool.close(); await pool.wait_closed()

    return FileResponse(
        file_id=file_id,
        file_hash=file_hash,
        original_name=file.filename,
        s3_key=s3_key,
        uploaded_at=str(uploaded_at[0]),
        is_duplicate=False,
    )


@router.post('/save-ground-truth', tags=['files'])
async def save_ground_truth(
    filename: str = Body(...),
    content: dict = Body(...),
    ground_truth_uri: str = Body(...)
):
    def parse_s3_uri(uri: str):
        parsed = urlparse(uri)
        bucket = parsed.netloc
        prefix = parsed.path.lstrip('/')
        if prefix and not prefix.endswith('/'):
            prefix += '/'
        return bucket, prefix

    bucket, prefix = parse_s3_uri(ground_truth_uri)
    key = f'{prefix}{filename}'
    try:
        print(f"Uploading ground truth to {bucket}/{key}")
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(content),
            ContentType='application/json'
        )
        print("Save successful")
        return {'status': 'ok'}
    except Exception as e:
        print("Save failed:", e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files/", tags=["files"])
async def list_files(limit: int = 50):
    """List all uploaded files with basic metadata."""
    _ensure_vars()
    pool = await _pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """SELECT file_id, file_hash, original_name, s3_key, uploaded_at 
                   FROM files ORDER BY uploaded_at DESC LIMIT %s""",
                (limit,)
            )
            rows = await cur.fetchall()
    
    pool.close(); await pool.wait_closed()
    
    files = []
    for row in rows:
        files.append({
            "file_id": row[0],
            "file_hash": row[1],
            "original_name": row[2],
            "s3_key": row[3],
            "uploaded_at": str(row[4])
        })
    
    return {"files": files, "count": len(files)}


@router.get("/files/{file_id}", tags=["files"])
async def get_file_details(file_id: str):
    """Get detailed information about a specific file including related data."""
    _ensure_vars()
    pool = await _pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Get file info
            await cur.execute(
                "SELECT file_id, file_hash, original_name, s3_key, uploaded_at FROM files WHERE file_id = %s",
                (file_id,)
            )
            file_row = await cur.fetchone()
            
            if not file_row:
                raise HTTPException(status_code=404, detail="File not found")
            
            # Get ground truth count
            await cur.execute("SELECT COUNT(*) FROM ground_truths WHERE file_id = %s", (file_id,))
            gt_count = (await cur.fetchone())[0]
            
            # Get extraction runs count
            await cur.execute("SELECT COUNT(*) FROM extraction_runs WHERE file_id = %s", (file_id,))
            runs_count = (await cur.fetchone())[0]
    
    pool.close(); await pool.wait_closed()
    
    return {
        "file_id": file_row[0],
        "file_hash": file_row[1],
        "original_name": file_row[2],
        "s3_key": file_row[3],
        "uploaded_at": str(file_row[4]),
        "ground_truth_count": gt_count,
        "extraction_runs_count": runs_count
    } 


@router.get("/proxy-pdf", tags=["files"])
async def proxy_pdf(uri: str = Query(..., description="S3 URI to proxy")):
    """Proxy a PDF from S3 to avoid CORS issues."""
    try:
        # Parse s3://bucket/key
        parsed = urlparse(uri)
        if parsed.scheme != 's3':
            raise HTTPException(status_code=400, detail="Only s3:// URIs are supported")
        
        bucket = parsed.netloc
        key = parsed.path.lstrip('/')
        
        if not bucket or not key:
            raise HTTPException(status_code=400, detail="Invalid S3 URI format")
        
        # Get the object from S3
        response = s3_client.get_object(Bucket=bucket, Key=key)
        
        # Stream the content
        def generate():
            for chunk in response['Body'].iter_chunks():
                yield chunk
        
        return StreamingResponse(
            generate(),
            media_type="application/pdf",
            headers={
                "Content-Disposition": "inline",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET",
                "Access-Control-Allow-Headers": "*"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to proxy PDF: {str(e)}") 