"""add logo_url to brands

Revision ID: 005
Revises: 004
Create Date: 2026-06-04
"""

from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("brands", sa.Column("logo_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("brands", "logo_url")
