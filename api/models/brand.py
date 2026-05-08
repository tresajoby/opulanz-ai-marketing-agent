from datetime import datetime
from sqlalchemy import String, Text, Integer, ForeignKey, DateTime, Float, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector
from ..database import Base
from ..config import settings


class Brand(Base):
    __tablename__ = "brands"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    tagline: Mapped[str | None] = mapped_column(String(500), nullable=True)
    tone_of_voice: Mapped[str | None] = mapped_column(Text, nullable=True)
    color_palette: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    guidelines: Mapped[list["BrandGuideline"]] = relationship(
        back_populates="brand", cascade="all, delete-orphan"
    )
    products: Mapped[list["Product"]] = relationship(
        back_populates="brand", cascade="all, delete-orphan"
    )
    audiences: Mapped[list["TargetAudience"]] = relationship(
        back_populates="brand", cascade="all, delete-orphan"
    )
    prohibited_content: Mapped[list["ProhibitedContent"]] = relationship(
        back_populates="brand", cascade="all, delete-orphan"
    )


class BrandGuideline(Base):
    """
    Stores brand guideline text in chunks with vector embeddings for RAG retrieval.
    One guideline document = many chunk rows.
    """
    __tablename__ = "brand_guidelines"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    content_vector: Mapped[list[float] | None] = mapped_column(
        Vector(settings.embedding_dimensions), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    brand: Mapped["Brand"] = relationship(back_populates="guidelines")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    brand: Mapped["Brand"] = relationship(back_populates="products")


class TargetAudience(Base):
    __tablename__ = "target_audiences"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    persona_name: Mapped[str] = mapped_column(String(255), nullable=False)
    demographics: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    psychographics: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    pain_points: Mapped[str | None] = mapped_column(Text, nullable=True)

    brand: Mapped["Brand"] = relationship(back_populates="audiences")


class ProhibitedContent(Base):
    """Words, phrases, or claims the AI must never include in generated content."""
    __tablename__ = "prohibited_content"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    content_type: Mapped[str] = mapped_column(String(50), nullable=False)  # word | phrase | claim
    content_value: Mapped[str] = mapped_column(String(500), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    brand: Mapped["Brand"] = relationship(back_populates="prohibited_content")
