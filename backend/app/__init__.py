from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import settings
# routers
from .api.v1 import health as health_router
from .api.v1 import s3 as s3_router
from .api.v1 import data_sync as data_router
from .api.v1 import db as db_router
from .api.v1 import files as files_router
from .api.v1 import evaluation as evaluation_router


def create_app() -> FastAPI:
    app = FastAPI(title="My App API", version="1.0.0")

    # CORS configuration
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register routers
    app.include_router(health_router.router)
    app.include_router(s3_router.router)
    app.include_router(data_router.router)
    app.include_router(db_router.router)
    app.include_router(files_router.router)
    app.include_router(evaluation_router.router)

    return app 