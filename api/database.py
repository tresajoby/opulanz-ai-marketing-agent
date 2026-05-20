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
        from .models import user, brand, content  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
        # create_all only creates missing tables, not missing columns on existing tables.
        # These ALTER TABLE statements are idempotent and fill the gap until
        # Alembic migrations have run.
        await conn.execute(text(
            "ALTER TABLE brands ADD COLUMN IF NOT EXISTS website_url VARCHAR(500)"
        ))
