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

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.content import ContentItem, ApprovalQueue, AuditLog, Platform, ContentStatus, ApprovalStatus
from ..models.user import User, UserRole
from ..routers.auth import get_current_user, require_role
from ..agents.brand_context import brand_context_agent, GenerationResult
from ..agents.compliance_agent import compliance_agent

router = APIRouter()

APPROVAL_DEADLINE_HOURS = 24


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

    for variant in result.variants:
        # Run compliance check on each variant
        compliance = await compliance_agent.check(
            db=db,
            brand_id=body.brand_id,
            platform=body.platform,
            text=variant.text_body,
        )

        warnings = [i.detail for i in compliance.issues]
        all_warnings.extend(warnings)

        if not compliance.passed:
            # Hard failure — log and skip this variant
            await _write_audit(db, current_user.id, "content_generation", "compliance_blocked", {
                "brand_id": body.brand_id,
                "platform": body.platform.value,
                "issues": warnings,
            })
            continue

        # Create content item
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
        await db.flush()  # get item.id without committing

        # Create approval queue entry
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
    Platform posting is handled by the Celery task queue (async).
    """
    item = await _get_content_or_404(item_id, db)

    if item.status != ContentStatus.approved:
        raise HTTPException(
            status_code=400,
            detail=f"Content must be in 'approved' status before publishing. Current status: {item.status.value}",
        )

    # Dispatch to Celery (platform posting happens in background)
    from ..tasks.celery_app import publish_content_task
    task = publish_content_task.delay(item_id)

    await _write_audit(db, current_user.id, "publishing", "publish_dispatched", {
        "content_item_id": item_id,
        "celery_task_id": task.id,
    })
    return {
        "message": "Publishing dispatched to background worker.",
        "task_id": task.id,
        "content_item_id": item_id,
    }


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
