from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Database
    database_url: str = "postgresql+asyncpg://omma_user:omma_password@localhost:5432/omma_db"

    # Redis / Celery
    redis_url: str = "redis://localhost:6379/0"

    # Auth
    secret_key: str = "change-this-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440  # 24 hours

    # AI
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    dalle_model: str = "gpt-image-1"  # current OpenAI image model; override with DALLE_MODEL env var

    # Embeddings (local sentence-transformers model)
    embedding_model: str = "all-MiniLM-L6-v2"
    embedding_dimensions: int = 384

    # RAG
    rag_top_k: int = 5

    # Compliance — minimum brand-voice similarity score to pass (0-1)
    compliance_threshold: float = 0.70

    # Environment
    environment: str = "development"

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


settings = Settings()
