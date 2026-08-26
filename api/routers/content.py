"""
Content router — generation, approval queue, and publish control.

Endpoints:
  POST /content/generate          — trigger AI content generation
  GET  /content/queue             — view pending approval queue
  GET  /content/                  — list all content items (with filters)
  GET  /content/{id}              — get single content item
  POST /content/{id}/approve      — approve content for publishing
  POST /content/{id}/reject       — reject content
  POST /content/{id}/request-revision — ask agent to regenerate with notes
"""

from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status, Query, Request, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, field_serializer
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

import anthropic
import openai
import base64
import io
import httpx

from ..database import get_db
from ..models.content import ContentItem, ApprovalQueue, AuditLog, Platform, ContentStatus, ApprovalStatus
from ..models.user import User, UserRole
from ..routers.auth import get_current_user, require_role
from ..agents.brand_context import brand_context_agent, GenerationResult
from ..agents.compliance_agent import compliance_agent
from ..config import settings

router = APIRouter()

APPROVAL_DEADLINE_HOURS = 24
_MAX_IMAGE_PROMPT_CHARS = 3000


def _api_public_base(request: Request | None = None) -> str:
    """Prefer configured API base URL; fall back to the incoming request host."""
    if settings.api_base_url:
        return settings.api_base_url.rstrip("/")
    if request is not None:
        return str(request.base_url).rstrip("/")
    return ""


def _content_image_public_url(item_id: int, request: Request | None = None, version: int | None = None) -> str:
    base = _api_public_base(request)
    path = f"/api/content/{item_id}/image"
    url = f"{base}{path}" if base else path
    v = version if version is not None else int(datetime.utcnow().timestamp())
    return f"{url}?v={v}"


async def _bytes_to_data_url(image_bytes: bytes, content_type: str = "image/png") -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


async def _download_to_data_url(url: str) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        ctype = (resp.headers.get("content-type") or "image/png").split(";")[0].strip()
        if not ctype.startswith("image/"):
            ctype = "image/png"
        return await _bytes_to_data_url(resp.content, ctype)


# ─── Schemas ─────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    brand_id: int
    platform: Platform
    goal: str
    additional_context: str = ""
    num_variants: int = 3
    content_type: str = "social_post"
    conversation_history: list[dict] = []


class ContentItemOut(BaseModel):
    id: int
    brand_id: int
    platform: Platform
    content_type: str
    text_body: str
    hashtags: str | None
    image_prompt: str | None
    image_url: str | None
    status: ContentStatus
    ai_confidence_score: float | None
    ai_model_used: str | None
    generation_metadata: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("image_url")
    def serialize_image_url(self, value: str | None) -> str | None:
        """Never ship multi-MB data URLs over list/get — clients use the public image route."""
        if value and value.startswith("data:"):
            return f"/api/content/{self.id}/image"
        return value


class ApprovalQueueOut(BaseModel):
    id: int
    content_item_id: int
    action_type: str
    status: ApprovalStatus
    assigned_to_role: str | None
    ai_reasoning: str | None
    reviewer_comment: str | None
    reviewed_by: int | None
    reviewed_at: datetime | None
    requested_at: datetime
    deadline_at: datetime | None
    content_item: ContentItemOut

    model_config = {"from_attributes": True}


class ApproveRequest(BaseModel):
    comment: str = ""


class RejectRequest(BaseModel):
    comment: str


class RevisionRequest(BaseModel):
    notes: str  # feedback to pass back into the generation prompt


class GenerateResponse(BaseModel):
    items_created: int
    approval_queue_ids: list[int]
    compliance_warnings: list[str]
    message: str


# ─── Content generation ───────────────────────────────────────────────────────

@router.post("/generate", response_model=GenerateResponse, status_code=status.HTTP_201_CREATED)
async def generate_content(
    body: GenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(
        UserRole.super_admin, UserRole.marketing_manager, UserRole.content_creator
    )),
):
    """
    Triggers the Brand Context Agent to generate content variants.
    Each variant is compliance-checked before entering the approval queue.
    Nothing is published at this step.
    """
    result: GenerationResult = await brand_context_agent.generate_social_post(
        db=db,
        brand_id=body.brand_id,
        platform=body.platform,
        goal=body.goal,
        additional_context=body.additional_context,
        num_variants=body.num_variants,
        conversation_history=body.conversation_history or None,
    )

    if result.error:
        raise HTTPException(status_code=500, detail=f"Generation failed: {result.error}")

    if not result.variants:
        raise HTTPException(status_code=500, detail="Agent returned no content variants.")

    queue_ids: list[int] = []
    all_warnings: list[str] = []

    # Run all compliance checks in parallel
    import asyncio as _asyncio
    compliance_results = await _asyncio.gather(*[
        compliance_agent.check(
            db=db,
            brand_id=body.brand_id,
            platform=body.platform,
            text=variant.text_body,
        )
        for variant in result.variants
    ])

    # All variants go to the queue — compliance failures become warnings, not blockers.
    # Reviewers see the warning and decide whether to approve or reject.
    for variant, compliance in zip(result.variants, compliance_results):
        warnings = [i.detail for i in compliance.issues]
        all_warnings.extend(warnings)

        item = ContentItem(
            brand_id=body.brand_id,
            platform=body.platform,
            content_type=body.content_type,
            text_body=variant.text_body,
            hashtags=variant.hashtags or None,
            image_prompt=variant.image_prompt or None,
            status=ContentStatus.pending_review,
            ai_confidence_score=result.ai_confidence_score,
            ai_model_used=result.ai_model_used,
            generation_metadata={
                **(result.generation_metadata or {}),
                "variant_label": variant.variant_label,
                "compliance_score": compliance.overall_score,
                "compliance_warnings": warnings,
            },
        )
        db.add(item)
        await db.flush()

        deadline = datetime.utcnow() + timedelta(hours=APPROVAL_DEADLINE_HOURS)
        queue_entry = ApprovalQueue(
            content_item_id=item.id,
            action_type="publish_post",
            status=ApprovalStatus.pending,
            assigned_to_role=UserRole.marketing_manager.value,
            ai_reasoning=(
                f"Variant: {variant.variant_label}. "
                f"Confidence: {result.ai_confidence_score}. "
                f"Compliance score: {compliance.overall_score}."
                + (" ⚠ Review compliance warnings before approving." if warnings else "")
            ),
            deadline_at=deadline,
        )
        db.add(queue_entry)
        await db.flush()
        queue_ids.append(queue_entry.id)

    await db.commit()

    await _write_audit(db, current_user.id, "content_generation", "generate_variants", {
        "brand_id": body.brand_id,
        "platform": body.platform.value,
        "variants_created": len(queue_ids),
    })

    return GenerateResponse(
        items_created=len(queue_ids),
        approval_queue_ids=queue_ids,
        compliance_warnings=list(set(all_warnings)),
        message=(
            f"{len(queue_ids)} variant(s) generated and awaiting approval. "
            f"{body.num_variants - len(queue_ids)} variant(s) blocked by compliance."
            if len(queue_ids) < body.num_variants
            else f"All {len(queue_ids)} variant(s) generated and in the approval queue."
        ),
    )


# ─── Approval queue ───────────────────────────────────────────────────────────

@router.get("/queue", response_model=list[ApprovalQueueOut])
async def get_approval_queue(
    brand_id: int | None = Query(None),
    platform: Platform | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns all pending items in the approval queue the current user can act on."""
    stmt = (
        select(ApprovalQueue)
        .options(selectinload(ApprovalQueue.content_item))
        .join(ContentItem)
        .where(ApprovalQueue.status == ApprovalStatus.pending)
    )
    if brand_id:
        stmt = stmt.where(ContentItem.brand_id == brand_id)
    if platform:
        stmt = stmt.where(ContentItem.platform == platform)

    result = await db.execute(stmt)
    return result.scalars().all()


# ─── Content CRUD ─────────────────────────────────────────────────────────────

@router.get("/", response_model=list[ContentItemOut])
async def list_content(
    brand_id: int | None = Query(None),
    platform: Platform | None = Query(None),
    content_status: ContentStatus | None = Query(None, alias="status"),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = select(ContentItem).order_by(ContentItem.created_at.desc()).limit(limit)
    if brand_id:
        stmt = stmt.where(ContentItem.brand_id == brand_id)
    if platform:
        stmt = stmt.where(ContentItem.platform == platform)
    if content_status:
        stmt = stmt.where(ContentItem.status == content_status)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{item_id}", response_model=ContentItemOut)
async def get_content_item(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _get_content_or_404(item_id, db)


# ─── Approval actions ─────────────────────────────────────────────────────────

@router.post("/{item_id}/approve", status_code=status.HTTP_200_OK)
async def approve_content(
    item_id: int,
    body: ApproveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.super_admin, UserRole.marketing_manager)),
):
    """
    Mark content as approved. Publishing is a separate step (POST /publish)
    so humans have one more chance to confirm before the post goes live.
    """
    item, queue = await _get_item_and_queue(item_id, db)

    item.status = ContentStatus.approved
    queue.status = ApprovalStatus.approved
    queue.reviewed_by = current_user.id
    queue.reviewed_at = datetime.utcnow()
    queue.reviewer_comment = body.comment

    await db.commit()
    await _write_audit(db, current_user.id, "approval", "approved", {"content_item_id": item_id})
    return {"message": "Content approved. Ready to publish."}


@router.post("/{item_id}/reject", status_code=status.HTTP_200_OK)
async def reject_content(
    item_id: int,
    body: RejectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.super_admin, UserRole.marketing_manager)),
):
    item, queue = await _get_item_and_queue(item_id, db)

    item.status = ContentStatus.rejected
    queue.status = ApprovalStatus.rejected
    queue.reviewed_by = current_user.id
    queue.reviewed_at = datetime.utcnow()
    queue.reviewer_comment = body.comment

    await db.commit()
    await _write_audit(db, current_user.id, "approval", "rejected", {
        "content_item_id": item_id, "reason": body.comment
    })
    return {"message": "Content rejected."}


@router.post("/{item_id}/request-revision", status_code=status.HTTP_200_OK)
async def request_revision(
    item_id: int,
    body: RevisionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.super_admin, UserRole.marketing_manager)),
):
    """Request the agent to regenerate this content with the provided revision notes."""
    item, queue = await _get_item_and_queue(item_id, db)

    item.status = ContentStatus.revision_requested
    queue.status = ApprovalStatus.revision_requested
    queue.reviewer_comment = body.notes
    queue.reviewed_by = current_user.id
    queue.reviewed_at = datetime.utcnow()

    await db.commit()
    await _write_audit(db, current_user.id, "approval", "revision_requested", {
        "content_item_id": item_id, "notes": body.notes
    })
    return {
        "message": "Revision requested. Re-generate using POST /content/generate with the notes included in additional_context.",
        "revision_notes": body.notes,
    }


@router.post("/{item_id}/publish", status_code=status.HTTP_200_OK)
async def publish_content(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.super_admin, UserRole.marketing_manager)),
):
    """
    Final publish step. Only approved content can be published.
    Publishes directly to the platform via the social publisher service.
    """
    from datetime import datetime as _dt
    from sqlalchemy import select as _select
    from ..models.social import SocialAccount
    from ..agents.social_agent import social_publishing_agent
    from ..services.social_publisher import PostPayload, publish_to_platform

    item = await _get_content_or_404(item_id, db)

    if item.status != ContentStatus.approved:
        raise HTTPException(
            status_code=400,
            detail=f"Content must be in 'approved' status before publishing. Current status: {item.status.value}",
        )

    platform = item.platform.value
    post_id: str | None = None
    publish_error: str | None = None

    # Find connected social account for this brand + platform
    account_res = await db.execute(
        _select(SocialAccount).where(
            SocialAccount.brand_id == item.brand_id,
            SocialAccount.platform == platform,
            SocialAccount.is_active == True,
        )
    )
    account = account_res.scalar_one_or_none()

    if account:
        try:
            prepared = await social_publishing_agent.prepare_post(item)
            # Instagram and TikTok require a public URL — base64 data URIs can't be
            # fetched by either platform's PULL_FROM_URL mechanism.
            image_url = item.image_url
            if platform in ("instagram", "tiktok") and image_url and image_url.startswith("data:"):
                base = (settings.api_base_url or "").rstrip("/")
                image_url = f"{base}/api/content/{item_id}/image"
            post = PostPayload(
                text=prepared.text_body,
                hashtags=prepared.hashtags,
                image_url=image_url,
            )
            post_id = await publish_to_platform(account, post)
            print(f"[OMMA] Published to {platform}, post_id={post_id}")
        except Exception as exc:
            publish_error = str(exc)
            print(f"[OMMA] Publish error ({platform}): {exc}")
    else:
        publish_error = f"No connected {platform} account found for this brand."

    # Only mark as published if the platform actually accepted the post.
    # If it failed, keep status as approved so the user can retry.
    if post_id:
        item.status = ContentStatus.published
        item.published_at = _dt.utcnow()
        item.platform_post_id = post_id
    await db.commit()

    await _write_audit(db, current_user.id, "publishing", "publish_dispatched", {
        "content_item_id": item_id,
        "platform": platform,
        "post_id": post_id,
        "error": publish_error,
    })

    if publish_error and not post_id:
        return {
            "message": f"Platform posting failed — content remains approved so you can retry: {publish_error}",
            "content_item_id": item_id,
            "warning": publish_error,
        }

    return {
        "message": f"Published successfully to {platform}.",
        "post_id": post_id,
        "content_item_id": item_id,
    }


# ─── Delete content item ─────────────────────────────────────────────────────

@router.delete("/{item_id}", status_code=status.HTTP_200_OK)
async def delete_content(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.super_admin, UserRole.marketing_manager, UserRole.content_creator)),
):
    """Permanently delete a content item and its approval queue entry."""
    item = await _get_content_or_404(item_id, db)
    await db.delete(item)
    await db.commit()
    return {"message": f"Content item {item_id} deleted."}


# ─── Image generation ─────────────────────────────────────────────────────────

class GenerateImageRequest(BaseModel):
    custom_prompt: str | None = None


@router.post("/{item_id}/generate-image", status_code=status.HTTP_200_OK)
async def generate_image(
    item_id: int,
    request: Request,
    body: GenerateImageRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(
        UserRole.super_admin, UserRole.marketing_manager, UserRole.content_creator
    )),
):
    """Generate an image from the content item's image_prompt (or a custom override).

    Flow: optional Claude prompt expansion → OpenAI image model → optional brand footer
    composite → persist as data URL → return a stable public image URL for the client.
    """
    item = await _get_content_or_404(item_id, db)

    custom = (body.custom_prompt.strip() if body and body.custom_prompt else "") or ""
    active_prompt = custom or (item.image_prompt or "")
    active_prompt = active_prompt.strip()

    if not active_prompt:
        raise HTTPException(status_code=400, detail="Content item has no image_prompt to generate from.")

    if not settings.openai_api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured on the server.")

    # Persist edited prompts so regenerations and reloads stay consistent
    if custom and custom != (item.image_prompt or "").strip():
        item.image_prompt = custom

    # ── Step 1: Expand the prompt with Claude Haiku (best-effort) ─────────────
    final_prompt = active_prompt
    slogan: str | None = None
    logo_url: str | None = None
    brand_name: str = ""
    if settings.anthropic_api_key:
        try:
            from ..models.brand import Brand
            brand_res = await db.execute(select(Brand).where(Brand.id == item.brand_id))
            brand = brand_res.scalar_one_or_none()

            brand_visuals = ""
            if brand:
                brand_name = brand.name
                parts = [f"Brand: {brand.name}"]
                if brand.tagline:
                    parts.append(f"Tagline: {brand.tagline}")
                if brand.color_palette:
                    colors = ", ".join(f"{k}: {v}" for k, v in brand.color_palette.items())
                    parts.append(f"Brand colors: {colors}")
                if brand.logo_url:
                    logo_url = brand.logo_url
                elif brand.website_url:
                    try:
                        from urllib.parse import urlparse
                        domain = urlparse(brand.website_url).netloc or brand.website_url.split("/")[0]
                        logo_url = f"https://www.google.com/s2/favicons?domain={domain}&sz=256"
                    except Exception:
                        pass
                if brand.website_url:
                    parts.append(f"Website: {brand.website_url}")
                if brand.tone_of_voice:
                    parts.append(f"Brand personality: {brand.tone_of_voice}")
                brand_visuals = "\n".join(parts)

            claude = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
            platform = item.platform.value
            aspect_notes = {
                "instagram":    "square 1:1 format — centred composition, no important content near edges",
                "tiktok":       "vertical 9:16 portrait format — tall composition, subject centred vertically",
                "facebook":     "horizontal 16:9 landscape format — wide scene with breathing room on sides",
                "linkedin":     "horizontal 16:9 landscape format — professional, wide editorial composition",
                "facebook_ads": "horizontal 16:9 landscape format — bold, high-contrast ad creative",
                "google_ads":   "horizontal 16:9 landscape format — clean, minimal display ad style",
            }
            aspect_hint = aspect_notes.get(platform, "square 1:1 format")

            expansion = await claude.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=500,
                messages=[{
                    "role": "user",
                    "content": (
                        f"You are a senior digital marketing art director creating scroll-stopping social media visuals.\n\n"
                        f"Platform: {platform} — {aspect_hint}\n"
                        f"Post content:\n{item.text_body[:300]}\n\n"
                        f"Brand context:\n{brand_visuals}\n\n"
                        f"Original image brief:\n{active_prompt}\n\n"
                        f"TASK: Return a JSON object with exactly two keys:\n"
                        f"1. \"prompt\": A detailed image prompt (max 200 words) following ALL rules below\n"
                        f"2. \"slogan\": A short brand slogan (3-6 words, punchy and relevant to this specific post) "
                        f"OR null if the post is informational/educational and a slogan would feel forced. "
                        f"Use a slogan for: product launches, promotions, brand awareness, CTAs. "
                        f"Skip it for: tips, news, thought leadership.\n\n"
                        f"PROMPT RULES:\n"
                        f"- SCROLL-STOP: One visually arresting element — extreme contrast, unexpected composition\n"
                        f"- DESIRE TRIGGER: Aspirational setting, premium materials, flattering lighting\n"
                        f"- PRODUCT AS HERO: Brand offering at its most desirable angle\n"
                        f"- EMOTIONAL HOOK: Trigger exactly one of: FOMO / DESIRE / CURIOSITY / TRUST / EXCITEMENT\n"
                        f"- BRAND COLORS: Name them explicitly where they appear\n"
                        f"- LEAVE SPACE: Bottom 20% slightly darker/simpler for logo/slogan overlay\n"
                        f"- CINEMATIC QUALITY: Editorial photography or premium CGI, ultra sharp\n"
                        f"- NO text, NO words, NO human faces, NO clichés (no handshakes, generic offices)\n"
                        f"- Compose for {aspect_hint}\n\n"
                        f"Return ONLY valid JSON, no markdown, no explanation."
                    ),
                }],
            )
            raw_expansion = expansion.content[0].text.strip()
            if raw_expansion.startswith("```"):
                raw_expansion = raw_expansion.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            import json as _json
            try:
                expansion_data = _json.loads(raw_expansion)
                if expansion_data.get("prompt"):
                    final_prompt = str(expansion_data["prompt"]).strip()
                slogan = expansion_data.get("slogan") or None
            except Exception:
                if raw_expansion:
                    final_prompt = raw_expansion
                slogan = None
        except Exception as e:
            print(f"[OMMA] Prompt expansion failed, using original: {e}")

    final_prompt = (final_prompt or active_prompt).strip()[:_MAX_IMAGE_PROMPT_CHARS]
    if not final_prompt:
        raise HTTPException(status_code=400, detail="Image prompt is empty after processing.")

    # ── Step 2: Pick image size based on platform + model ─────────────────────
    model_name = (settings.dalle_model or "gpt-image-1").lower()
    gpt_image = model_name.startswith("gpt-image")

    _PLATFORM_SIZE_GPT: dict[str, str] = {
        "instagram":    "1024x1024",
        "tiktok":       "1024x1536",
        "facebook":     "1536x1024",
        "linkedin":     "1536x1024",
        "facebook_ads": "1536x1024",
        "google_ads":   "1536x1024",
    }
    _PLATFORM_SIZE_DALLE3: dict[str, str] = {
        "instagram":    "1024x1024",
        "tiktok":       "1024x1792",
        "facebook":     "1792x1024",
        "linkedin":     "1792x1024",
        "facebook_ads": "1792x1024",
        "google_ads":   "1792x1024",
    }
    size_map = _PLATFORM_SIZE_GPT if gpt_image or "dall-e-2" in model_name else _PLATFORM_SIZE_DALLE3
    if "dall-e-2" in model_name:
        image_size = "1024x1024"
    else:
        image_size = size_map.get(item.platform.value, "1024x1024")

    # ── Step 3: Generate image ────────────────────────────────────────────────
    try:
        client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
        gen_kwargs: dict = {
            "model": settings.dalle_model,
            "prompt": final_prompt,
            "size": image_size,
            "n": 1,
        }
        if gpt_image:
            # medium is a good speed/quality balance for interactive UI
            gen_kwargs["quality"] = "medium"
        elif "dall-e-3" in model_name:
            gen_kwargs["quality"] = "standard"
            gen_kwargs["response_format"] = "b64_json"

        response = await client.images.generate(**gen_kwargs)
    except openai.AuthenticationError:
        raise HTTPException(
            status_code=500,
            detail="OpenAI authentication failed — check OPENAI_API_KEY in server env vars.",
        )
    except openai.RateLimitError:
        raise HTTPException(status_code=429, detail="OpenAI rate limit exceeded. Please try again in a moment.")
    except openai.BadRequestError as e:
        raise HTTPException(status_code=400, detail=f"Image prompt was rejected by OpenAI: {e.message}")
    except openai.APITimeoutError:
        raise HTTPException(status_code=504, detail="Image generation timed out. Please try again.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image generation failed: {str(e)}")

    if not response.data:
        raise HTTPException(status_code=500, detail="OpenAI returned no image data.")

    img = response.data[0]
    try:
        if getattr(img, "b64_json", None):
            raw_url = f"data:image/png;base64,{img.b64_json}"
        elif getattr(img, "url", None):
            # OpenAI URLs expire — download immediately and persist
            raw_url = await _download_to_data_url(img.url)
        else:
            raise HTTPException(status_code=500, detail="OpenAI returned no image data.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download generated image: {e}")

    # ── Step 4: Branded footer — logo + slogan composited via Pillow ─────────
    image_url = raw_url
    if logo_url or slogan:
        try:
            import os, tempfile
            from PIL import Image as PILImage, ImageDraw as PILDraw, ImageFont

            _, b64data = raw_url.split(",", 1)
            base_bytes = base64.b64decode(b64data)
            base_img = PILImage.open(io.BytesIO(base_bytes)).convert("RGBA")
            img_w, img_h = base_img.size

            footer_h = int(img_h * 0.14)
            pad = int(img_w * 0.04)

            gradient = PILImage.new("RGBA", (img_w, footer_h * 2), (0, 0, 0, 0))
            for y_px in range(footer_h * 2):
                alpha = int(200 * (y_px / (footer_h * 2)))
                PILDraw.Draw(gradient).line([(0, y_px), (img_w, y_px)], fill=(0, 0, 0, alpha))
            base_img.paste(gradient, (0, img_h - footer_h * 2), gradient)

            draw = PILDraw.Draw(base_img)

            font_path = os.path.join(tempfile.gettempdir(), "omma_Inter_Bold.ttf")
            if not os.path.exists(font_path):
                try:
                    async with httpx.AsyncClient(timeout=15) as _http:
                        font_r = await _http.get(
                            "https://github.com/google/fonts/raw/main/ofl/inter/static/Inter_18pt-Bold.ttf"
                        )
                        font_r.raise_for_status()
                    with open(font_path, "wb") as _f:
                        _f.write(font_r.content)
                except Exception:
                    font_path = None

            slogan_font_size = max(24, int(img_w * 0.032))
            name_font_size = max(18, int(img_w * 0.022))
            try:
                slogan_font = ImageFont.truetype(font_path, slogan_font_size) if font_path else ImageFont.load_default()
                name_font = ImageFont.truetype(font_path, name_font_size) if font_path else ImageFont.load_default()
            except Exception:
                slogan_font = ImageFont.load_default()
                name_font = ImageFont.load_default()

            logo_x = pad
            logo_rendered_w = 0

            if logo_url:
                try:
                    if logo_url.startswith("data:"):
                        _, logo_b64 = logo_url.split(",", 1)
                        logo_bytes = base64.b64decode(logo_b64)
                    else:
                        async with httpx.AsyncClient(timeout=10) as _http:
                            logo_r = await _http.get(logo_url)
                            logo_r.raise_for_status()
                            logo_bytes = logo_r.content
                    logo_img = PILImage.open(io.BytesIO(logo_bytes)).convert("RGBA")
                    logo_h_target = int(footer_h * 0.6)
                    logo_w_target = max(1, int(logo_img.width * (logo_h_target / max(logo_img.height, 1))))
                    logo_img = logo_img.resize((logo_w_target, logo_h_target), PILImage.LANCZOS)
                    logo_y = img_h - footer_h + (footer_h - logo_h_target) // 2
                    base_img.paste(logo_img, (logo_x, logo_y), logo_img)
                    logo_rendered_w = logo_w_target
                except Exception as logo_err:
                    print(f"[OMMA] Logo composite skipped: {logo_err}")

            text_x = logo_x + logo_rendered_w + (pad if logo_rendered_w else 0)
            name_y = img_h - footer_h + int(footer_h * 0.18)
            slogan_y = name_y + name_font_size + int(img_h * 0.008)

            if brand_name:
                draw.text((text_x, name_y), brand_name.upper(), font=name_font, fill=(200, 200, 200, 220))
            if slogan:
                draw.text((text_x, slogan_y), str(slogan), font=slogan_font, fill=(255, 255, 255, 255))

            out = io.BytesIO()
            base_img.convert("RGB").save(out, format="PNG", optimize=True)
            out.seek(0)
            image_url = await _bytes_to_data_url(out.read(), "image/png")
            print(f"[OMMA] Branded footer composited — logo={'yes' if logo_rendered_w else 'no'}, slogan={slogan!r}")
        except Exception as comp_err:
            print(f"[OMMA] Compositing failed ({comp_err}), using raw image")
            image_url = raw_url

    item.image_url = image_url
    await db.commit()

    # Never put multi-MB data URLs into audit payloads
    await _write_audit(db, current_user.id, "content_generation", "image_generated", {
        "content_item_id": item_id,
        "has_image": True,
        "prompt_chars": len(final_prompt),
    })

    public_url = _content_image_public_url(item_id, request)
    return {"image_url": public_url, "content_item_id": item_id}


@router.post("/{item_id}/upload-image", response_model=ContentItemOut, status_code=status.HTTP_200_OK)
async def upload_image(
    item_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(
        UserRole.super_admin, UserRole.marketing_manager, UserRole.content_creator
    )),
):
    """Upload a custom image for a content item and persist it as a data URL."""
    item = await _get_content_or_404(item_id, db)

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image (PNG, JPG, WebP, etc.).")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 8 MB.")

    ctype = file.content_type.split(";")[0].strip() or "image/png"
    item.image_url = await _bytes_to_data_url(data, ctype)
    await db.commit()
    await db.refresh(item)

    await _write_audit(db, current_user.id, "content_generation", "image_uploaded", {
        "content_item_id": item_id,
        "content_type": ctype,
        "bytes": len(data),
    })

    return ContentItemOut.model_validate(item)


# ─── Public image endpoint (for Instagram which requires a public URL) ────────

@router.get("/{item_id}/image")
async def get_content_image(
    item_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Return the raw image bytes for a content item — used as a public URL for Instagram publishing."""
    item = await _get_content_or_404(item_id, db)
    if not item.image_url:
        raise HTTPException(status_code=404, detail="No image for this content item.")
    if item.image_url.startswith("data:"):
        import base64 as _b64
        header, b64data = item.image_url.split(",", 1)
        content_type = header.split(";")[0].replace("data:", "") or "image/png"
        image_bytes = _b64.b64decode(b64data)
    else:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=20) as _http:
            r = await _http.get(item.image_url)
            r.raise_for_status()
            image_bytes = r.content
            content_type = r.headers.get("content-type", "image/png").split(";")[0]
    return Response(content=image_bytes, media_type=content_type)


# ─── Internal helpers ─────────────────────────────────────────────────────────

async def _get_content_or_404(item_id: int, db: AsyncSession) -> ContentItem:
    result = await db.execute(select(ContentItem).where(ContentItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Content item not found.")
    return item


async def _get_item_and_queue(
    item_id: int, db: AsyncSession
) -> tuple[ContentItem, ApprovalQueue]:
    item = await _get_content_or_404(item_id, db)

    result = await db.execute(
        select(ApprovalQueue)
        .where(
            ApprovalQueue.content_item_id == item_id,
            ApprovalQueue.status == ApprovalStatus.pending,
        )
        .order_by(ApprovalQueue.requested_at.desc())
        .limit(1)
    )
    queue = result.scalar_one_or_none()
    if not queue:
        raise HTTPException(
            status_code=400,
            detail="No pending approval queue entry found for this content item.",
        )
    return item, queue


async def _write_audit(
    db: AsyncSession,
    user_id: int,
    agent_module: str,
    action_type: str,
    payload: dict,
):
    log = AuditLog(
        user_id=user_id,
        agent_module=agent_module,
        action_type=action_type,
        entity_type="content_item",
        payload=payload,
    )
    db.add(log)
    await db.commit()
