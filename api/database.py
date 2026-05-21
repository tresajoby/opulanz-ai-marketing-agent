from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from .config import settings

engine = create_async_engine(
    settings.database_url,
    echo=settings.environment == "development",
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Create pgvector extension and all tables on startup."""
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        # Import all models so Base.metadata knows about them
        from .models import user, brand, content, social  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
        # create_all only creates missing tables, not missing columns on existing tables.
        # These ALTER TABLE statements are idempotent and fill the gap until
        # Alembic migrations have run.
        await conn.execute(text(
            "ALTER TABLE brands ADD COLUMN IF NOT EXISTS website_url VARCHAR(500)"
        ))
        await conn.execute(text(
            "ALTER TABLE content_items ALTER COLUMN image_url TYPE TEXT"
        ))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS social_accounts (
                id SERIAL PRIMARY KEY,
                brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
                platform VARCHAR(50) NOT NULL,
                account_id VARCHAR(255) NOT NULL,
                account_name VARCHAR(255) NOT NULL,
                avatar_url VARCHAR(500),
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                token_expires_at TIMESTAMP,
                scopes VARCHAR(500),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                connected_at TIMESTAMP NOT NULL,
                updated_at TIMESTAMP NOT NULL,
                CONSTRAINT uq_social_brand_platform_account UNIQUE (brand_id, platform, account_id)
            )
        """))
