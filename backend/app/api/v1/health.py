from fastapi import APIRouter

router = APIRouter()
 
@router.get("/health", tags=["health"])
async def health_check():
    """Health-check endpoint used by monitoring and frontend ping."""
    return {"status": "ok"} 