from app import create_app

app = create_app()

 
@app.get("/health")
async def health_check():
    """Simple health-check endpoint."""
    return {"status": "ok"} 