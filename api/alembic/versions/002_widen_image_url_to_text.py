"""Widen content_items.image_url from VARCHAR(500) to TEXT for base64 storage

Revision ID: 002
Revises: 001
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE content_items ALTER COLUMN image_url TYPE TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE content_items ALTER COLUMN image_url TYPE VARCHAR(500) USING image_url::VARCHAR(500)")
