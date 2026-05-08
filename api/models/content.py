import enum
from datetime import datetime
from sqlalchemy import String, Text, Integer, ForeignKey, DateTime, Float, JSON, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base


class Platform(str, enum.Enum):
    facebook = "facebook"
    instagram = "instagram"
    tiktok = "tiktok"
    google_ads = "google_ads"
    facebook_ads = "facebook_ads"


class ContentStatus(str, enum.Enum):
    draft = "draft"
    pending_review = "pending_review"
    revision_requested = "revision_requested"
    approved = "approved"
    rejected = "rejected"
    published = "published"


class ApprovalStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    revision_requested = "revision_requested"
    expired = "expired"


class ContentItem(Base):
    __tablename__ = "content_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    brand_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    platform: Mapped[Platform] = mapped_column(SQLEnum(Platform, name="platform"), nullable=False)
    content_type: Mapped[str] = mapped_column(String(50), default="social_post", nullable=False)

    # Main content
    text_body: Mapped[str] = mapped_column(Text, nullable=False)
    hashtags: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Status and metadata
    status: Mapped[ContentStatus] = mapped_column(
        SQLEnum(ContentStatus, name="contentstatus"),
        default=ContentStatus.pending_review,
        nullable=False,
    )
    ai_confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_model_used: Mapped[str | None] = mapped_column(String(100), nullable=True)
    generation_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    platform_post_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    approval_records: Mapped[list["ApprovalQueue"]] = relationship(
        back_populates="content_item", cascade="all, delete-orphan"
    )


class ApprovalQueue(Base):
    """
    Every piece of AI-generated content enters this queue before any action is taken.
    Humans approve, reject, or request a revision from here.
    """
    __tablename__ = "approval_queue"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    content_item_id: Mapped[int] = mapped_column(
        ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action_type: Mapped[str] = mapped_column(String(100), nullable=False)  # e.g. publish_post
    status: Mapped[ApprovalStatus] = mapped_column(
        SQLEnum(ApprovalStatus, name="approvalstatus"),
        default=ApprovalStatus.pending,
        nullable=False,
    )
    assigned_to_role: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ai_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Review outcome
    reviewer_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)  # user.id
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    requested_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    content_item: Mapped["ContentItem"] = relationship(back_populates="approval_records")


class AuditLog(Base):
    """Immutable record of every agent and human action in the system."""
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    agent_module: Mapped[str | None] = mapped_column(String(100), nullable=True)
    action_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="success", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
