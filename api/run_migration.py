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
        print("Migration complete: added 'linkedin' to platform enum.")
    await engine.dispose()


asyncio.run(main())
