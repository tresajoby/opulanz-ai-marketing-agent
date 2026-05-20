"""add website_url to brands

Revision ID: 3f8a2c1d9e4b
Revises:
Create Date: 2026-05-20
"""
from alembic import op

revision = "3f8a2c1d9e4b"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS guards against re-running on a DB that already has the column
    op.execute("ALTER TABLE brands ADD COLUMN IF NOT EXISTS website_url VARCHAR(500)")


def downgrade() -> None:
    op.drop_column("brands", "website_url")
