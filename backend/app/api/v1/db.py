"""DB utilities endpoints – MySQL / Aurora-MySQL."""
from __future__ import annotations

import os
import aiomysql
from fastapi import APIRouter, HTTPException

router = APIRouter()

# -------------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------------
def _vars():
    """Return required env vars or raise."""
    keys = ("DB_HOST", "DB_USER", "DB_PASSWORD")
    missing = [k for k in keys if not os.getenv(k)]
    if missing:
        raise HTTPException(status_code=500,
                            detail=f"Missing env vars: {', '.join(missing)}")

def _pool():
    """Create a tiny connection pool to MySQL."""
    return aiomysql.create_pool(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", 3306)),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        db=(os.getenv("DB_NAME") or None),   # can be blank on fresh cluster
        autocommit=True,
        minsize=1,
        maxsize=2,
    )

# -------------------------------------------------------------------------
# Endpoints
# -------------------------------------------------------------------------
@router.get("/db-test/", tags=["db"])
async def db_test():
    """Return server version + current timestamp."""
    _vars()
    pool = await _pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT VERSION(), NOW()")
            version, now = await cur.fetchone()
    pool.close(); await pool.wait_closed()
    return {"status": "ok", "server_version": version, "now": str(now)}

@router.post("/db-test-write/", tags=["db"])
async def db_test_write():
    """Create table if needed and insert one row."""
    _vars()
    pool = await _pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS test_table (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await cur.execute("INSERT INTO test_table () VALUES ()")
            await cur.execute("SELECT LAST_INSERT_ID(), NOW()")
            row_id, ts = await cur.fetchone()
    pool.close(); await pool.wait_closed()
    return {"status": "ok", "inserted_id": row_id, "timestamp": str(ts)}

@router.get("/db-tables/", tags=["db"])
async def list_tables():
    """List all tables in the database."""
    _vars()
    pool = await _pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SHOW TABLES")
            tables = [row[0] for row in await cur.fetchall()]
    pool.close(); await pool.wait_closed()
    return {"tables": tables}

@router.get("/db-query/", tags=["db"])
async def query_table(table: str, limit: int = 100):
    """Query all data from a specific table with optional limit."""
    _vars()
    pool = await _pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Get column info first
            await cur.execute(f"DESCRIBE `{table}`")
            columns = [row[0] for row in await cur.fetchall()]
            
            # Get data
            await cur.execute(f"SELECT * FROM `{table}` LIMIT %s", (limit,))
            rows = await cur.fetchall()
    pool.close(); await pool.wait_closed()
    
    # Convert to list of dictionaries for easier frontend consumption
    data = []
    for row in rows:
        data.append(dict(zip(columns, row)))
    
    return {"table": table, "columns": columns, "data": data, "count": len(data)} 