"""One-off migration runner — bypasses alembic configparser % escaping issue."""
import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


async def main():
    url = os.environ["DATABASE_URL"]
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TYPE platform ADD VALUE IF NOT EXISTS 'linkedin'"))
        print("✓ Added 'linkedin' to platform enum.")
        await conn.execute(text(
            "ALTER TABLE brands ADD COLUMN IF NOT EXISTS logo_url TEXT"
        ))
        print("✓ Added logo_url column to brands table.")
    await engine.dispose()


asyncio.run(main())
