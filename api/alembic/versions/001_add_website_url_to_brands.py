"""add website_url to brands

Revision ID: 3f8a2c1d9e4b
Revises:
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa

revision = "3f8a2c1d9e4b"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("brands", sa.Column("website_url", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("brands", "website_url")
