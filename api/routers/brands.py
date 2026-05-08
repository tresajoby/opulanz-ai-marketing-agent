from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime

from ..database import get_db
from ..models.brand import Brand, BrandGuideline, Product, TargetAudience, ProhibitedContent
from ..models.user import User, UserRole
from ..routers.auth import get_current_user, require_role
from ..services.rag_service import rag_service

router = APIRouter()

# ─── Schemas ─────────────────────────────────────────────────────────────────

class BrandCreate(BaseModel):
    name: str
    tagline: str | None = None
    tone_of_voice: str | None = None
    color_palette: dict | None = None


class BrandOut(BaseModel):
    id: int
    name: str
    tagline: str | None
    tone_of_voice: str | None
    color_palette: dict | None
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class ProductCreate(BaseModel):
    name: str
    description: str | None = None
    price: float | None = None
    url: str | None = None
    category: str | None = None


class ProductOut(BaseModel):
    id: int
    brand_id: int
    name: str
    description: str | None
    price: float | None
    url: str | None
    category: str | None
    is_active: bool
    model_config = {"from_attributes": True}


class AudienceCreate(BaseModel):
    persona_name: str
    demographics: dict | None = None
    psychographics: dict | None = None
    pain_points: str | None = None


class AudienceOut(BaseModel):
    id: int
    brand_id: int
    persona_name: str
    demographics: dict | None
    psychographics: dict | None
    pain_points: str | None
    model_config = {"from_attributes": True}


class ProhibitedCreate(BaseModel):
    content_type: str  # word | phrase | claim
    content_value: str
    reason: str | None = None


class GuidelineTextIn(BaseModel):
    text: str
    version: int = 1


# ─── Brand CRUD ───────────────────────────────────────────────────────────────

@router.post("/", response_model=BrandOut, status_code=status.HTTP_201_CREATED)
async def create_brand(
    body: BrandCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.super_admin, UserRole.marketing_manager)),
):
    brand = Brand(**body.model_dump())
    db.add(brand)
    await db.commit()
    await db.refresh(brand)
    return brand


@router.get("/", response_model=list[BrandOut])
async def list_brands(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Brand).where(Brand.is_active == True))
    return result.scalars().all()


@router.get("/{brand_id}", response_model=BrandOut)
async def get_brand(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    brand = await _get_brand_or_404(brand_id, db)
    return brand


@router.put("/{brand_id}", response_model=BrandOut)
async def update_brand(
    brand_id: int,
    body: BrandCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.super_admin, UserRole.marketing_manager)),
):
    brand = await _get_brand_or_404(brand_id, db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(brand, field, value)
    await db.commit()
    await db.refresh(brand)
    return brand


# ─── Brand Guidelines (RAG ingestion) ────────────────────────────────────────

@router.post("/{brand_id}/guidelines/text", status_code=status.HTTP_201_CREATED)
async def add_guidelines_text(
    brand_id: int,
    body: GuidelineTextIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.super_admin, UserRole.marketing_manager)),
):
    """
    Ingest raw text brand guidelines. The text is chunked, embedded,
    and stored in pgvector for RAG retrieval during content generation.
    """
    await _get_brand_or_404(brand_id, db)
    chunk_count = await rag_service.ingest_text(db, brand_id, body.text, version=body.version)
    return {"message": f"Guidelines ingested successfully.", "chunks_stored": chunk_count}


@router.post("/{brand_id}/guidelines/pdf", status_code=status.HTTP_201_CREATED)
async def add_guidelines_pdf(
    brand_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.super_admin, UserRole.marketing_manager)),
):
    """Upload a PDF brand guidelines document for RAG ingestion."""
    await _get_brand_or_404(brand_id, db)
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    contents = await file.read()
    chunk_count = await rag_service.ingest_pdf(db, brand_id, contents)
    return {"message": "PDF guidelines ingested.", "chunks_stored": chunk_count}


# ─── Products ─────────────────────────────────────────────────────────────────

@router.post("/{brand_id}/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
async def add_product(
    brand_id: int,
    body: ProductCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.super_admin, UserRole.marketing_manager)),
):
    await _get_brand_or_404(brand_id, db)
    product = Product(brand_id=brand_id, **body.model_dump())
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return product


@router.get("/{brand_id}/products", response_model=list[ProductOut])
async def list_products(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Product).where(Product.brand_id == brand_id, Product.is_active == True)
    )
    return result.scalars().all()


# ─── Target Audiences ─────────────────────────────────────────────────────────

@router.post("/{brand_id}/audiences", response_model=AudienceOut, status_code=status.HTTP_201_CREATED)
async def add_audience(
    brand_id: int,
    body: AudienceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.super_admin, UserRole.marketing_manager)),
):
    await _get_brand_or_404(brand_id, db)
    audience = TargetAudience(brand_id=brand_id, **body.model_dump())
    db.add(audience)
    await db.commit()
    await db.refresh(audience)
    return audience


@router.get("/{brand_id}/audiences", response_model=list[AudienceOut])
async def list_audiences(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(TargetAudience).where(TargetAudience.brand_id == brand_id))
    return result.scalars().all()


# ─── Prohibited Content ───────────────────────────────────────────────────────

@router.post("/{brand_id}/prohibited", status_code=status.HTTP_201_CREATED)
async def add_prohibited(
    brand_id: int,
    body: ProhibitedCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.super_admin, UserRole.marketing_manager)),
):
    await _get_brand_or_404(brand_id, db)
    item = ProhibitedContent(brand_id=brand_id, **body.model_dump())
    db.add(item)
    await db.commit()
    return {"message": "Prohibited content rule added."}


@router.get("/{brand_id}/prohibited")
async def list_prohibited(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ProhibitedContent).where(ProhibitedContent.brand_id == brand_id)
    )
    return result.scalars().all()


# ─── Internal helper ──────────────────────────────────────────────────────────

async def _get_brand_or_404(brand_id: int, db: AsyncSession) -> Brand:
    result = await db.execute(select(Brand).where(Brand.id == brand_id))
    brand = result.scalar_one_or_none()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found.")
    return brand
