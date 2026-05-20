import json
import re
import anthropic
import httpx
from bs4 import BeautifulSoup
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
from ..config import settings

router = APIRouter()

# ─── Schemas ─────────────────────────────────────────────────────────────────

class BrandCreate(BaseModel):
    name: str
    tagline: str | None = None
    tone_of_voice: str | None = None
    color_palette: dict | None = None
    website_url: str | None = None


class BrandOut(BaseModel):
    id: int
    name: str
    tagline: str | None
    tone_of_voice: str | None
    color_palette: dict | None
    website_url: str | None
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class WebsiteFetchRequest(BaseModel):
    url: str


class WebsiteFetchResult(BaseModel):
    website_url: str
    tagline: str | None
    tone_summary: str | None
    key_messages: list[str]
    products_mentioned: list[str]
    guidelines_chunks: int
    message: str


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


# ─── Website auto-fetch ───────────────────────────────────────────────────────

@router.post("/{brand_id}/fetch-website", response_model=WebsiteFetchResult)
async def fetch_website(
    brand_id: int,
    body: WebsiteFetchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.super_admin, UserRole.marketing_manager)),
):
    """
    Fetch a brand website, extract text with BeautifulSoup, use Claude to
    identify brand signals, and ingest the result as brand guidelines.
    Also saves the URL on the brand record.
    """
    brand = await _get_brand_or_404(brand_id, db)

    # ── 1. Fetch the page ────────────────────────────────────────────────────
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    try:
        async with httpx.AsyncClient(
            timeout=20,
            follow_redirects=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                )
            },
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Website returned {e.response.status_code}.")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach website: {e}")

    # ── 2. Parse with BeautifulSoup ──────────────────────────────────────────
    soup = BeautifulSoup(resp.text, "lxml")

    # Remove script/style noise
    for tag in soup(["script", "style", "nav", "footer", "noscript", "svg", "iframe"]):
        tag.decompose()

    title = soup.title.get_text(strip=True) if soup.title else ""
    meta_desc = ""
    meta_tag = soup.find("meta", attrs={"name": re.compile(r"description", re.I)})
    if meta_tag and meta_tag.get("content"):
        meta_desc = meta_tag["content"]

    headings = " | ".join(
        h.get_text(strip=True) for h in soup.find_all(["h1", "h2", "h3"])[:20]
    )
    body_text = soup.get_text(separator="\n", strip=True)
    # Trim to ~8 000 chars so the prompt stays lean
    body_text = body_text[:8000]

    raw_page_text = (
        f"PAGE TITLE: {title}\n"
        f"META DESCRIPTION: {meta_desc}\n"
        f"HEADINGS: {headings}\n\n"
        f"BODY TEXT:\n{body_text}"
    )

    # ── 3. Ask Claude to extract brand signals ───────────────────────────────
    client_ai = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    analysis_prompt = (
        "You are a brand strategist. Analyse the website text below and return JSON with exactly "
        "these keys:\n"
        '  "tagline": one-sentence brand positioning (max 120 chars, or null),\n'
        '  "tone_summary": 2-3 sentences describing the brand\'s tone of voice,\n'
        '  "key_messages": array of up to 6 key marketing messages found on the page,\n'
        '  "products_mentioned": array of product/service names mentioned,\n'
        '  "brand_guidelines_text": a paragraph (200-400 words) summarising brand voice, '
        "positioning, target audience signals, and unique selling points — "
        "written as brand guidelines for a copywriter.\n\n"
        "Return ONLY valid JSON, no markdown fences.\n\n"
        f"WEBSITE CONTENT:\n{raw_page_text}"
    )

    try:
        ai_resp = await client_ai.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            messages=[{"role": "user", "content": analysis_prompt}],
        )
        raw_json = ai_resp.content[0].text.strip()
        # Strip markdown fences if Claude adds them despite instructions
        raw_json = re.sub(r"^```(?:json)?\s*", "", raw_json)
        raw_json = re.sub(r"\s*```$", "", raw_json)
        analysis = json.loads(raw_json)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {e}")

    tagline = analysis.get("tagline") or None
    tone_summary = analysis.get("tone_summary") or None
    key_messages = analysis.get("key_messages") or []
    products_mentioned = analysis.get("products_mentioned") or []
    guidelines_text = analysis.get("brand_guidelines_text") or raw_page_text[:2000]

    # ── 4. Save website_url + optionally backfill tagline/tone ───────────────
    brand.website_url = url
    if tagline and not brand.tagline:
        brand.tagline = tagline[:500]
    if tone_summary and not brand.tone_of_voice:
        brand.tone_of_voice = tone_summary
    await db.commit()

    # ── 5. Ingest extracted text as brand guidelines ─────────────────────────
    full_guidelines = (
        f"SOURCE: {url}\n\n"
        f"BRAND TAGLINE: {tagline or 'N/A'}\n\n"
        f"TONE OF VOICE: {tone_summary or 'N/A'}\n\n"
        f"KEY MESSAGES:\n" + "\n".join(f"- {m}" for m in key_messages) + "\n\n"
        f"PRODUCTS/SERVICES: {', '.join(products_mentioned) or 'N/A'}\n\n"
        f"BRAND GUIDELINES SUMMARY:\n{guidelines_text}"
    )
    chunk_count = await rag_service.ingest_text(db, brand_id, full_guidelines, version=1)

    return WebsiteFetchResult(
        website_url=url,
        tagline=tagline,
        tone_summary=tone_summary,
        key_messages=key_messages,
        products_mentioned=products_mentioned,
        guidelines_chunks=chunk_count,
        message=(
            f"Website analysed and ingested as {chunk_count} brand guideline chunk(s). "
            "The AI now has full brand context from your website."
        ),
    )


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
