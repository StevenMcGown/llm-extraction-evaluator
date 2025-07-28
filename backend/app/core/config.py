from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    """Application settings loaded from environment variables or .env file."""

    cors_origins: List[str] = ["http://localhost:3000"]

    class Config:
        env_file = ".env"


settings = Settings() 