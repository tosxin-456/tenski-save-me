from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str
    jwt_secret: str = "change-me-in-production-min-32-chars"
    jwt_expires_days: int = 7
    port: int = 4000
    environment: str = "development"
    frontend_url: str = "http://localhost:3000"
    upload_dir: str = "uploads"
    model_dir: str = "models"
    max_upload_mb: int = 20


@lru_cache
def get_settings() -> Settings:
    return Settings()
