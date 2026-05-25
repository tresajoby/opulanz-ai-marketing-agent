"""
Celery task queue.

Background tasks:
  - publish_content_task   : posts approved content to the social platform API
  - performance_fetch_task : pulls metrics from platform APIs (runs on schedule)
  - compliance_sweep_task  : expires stale approval queue entries
"""

import os
from celery import Celery
from celery.schedules import crontab

from ..config import settings

celery_app = Celery(
    "omma",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["api.tasks.celery_app"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,         # re-queue if worker crashes mid-task
    worker_prefetch_multiplier=1,
    beat_schedule={
        # Check for expired approval queue entries every hour
        "expire-stale-approvals": {
            "task": "api.tasks.celery_app.expire_stale_approvals_task",
            "schedule": crontab(minute=0),  # every hour on the hour
        },
        # Fetch post performance metrics every 24h
        "fetch-post-metrics": {
            "task": "api.tasks.celery_app.fetch_post_metrics_task",
            "schedule": crontab(hour=6, minute=0),  # 6 AM UTC daily
        },
    },
)


# ─── Publishing task ─────────────────────────────────────────────────────────

@celery_app.task(name="api.tasks.celery_app.publish_content_task", bind=True, max_retries=3)
def publish_content_task(self, content_item_id: int):
    """
    Post approved content to the target social media platform.
    Retries up to 3 times with exponential backoff on failure.

    Platform clients are added here as integrations are connected:
      - Facebook/Instagram: Meta Graph API
      - TikTok: TikTok for Business API

    For now, logs the intent and marks the item as published in the database.
    Replace the placeholder with real API calls when platform tokens are configured.
    """
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from sqlalchemy import select
    from datetime import datetime
    from ..models.content import ContentItem, ContentStatus

    async def _run():
        engine = create_async_engine(settings.database_url)
        SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with SessionLocal() as db:
            result = await db.execute(
                select(ContentItem).where(ContentItem.id == content_item_id)
            )
            item = result.scalar_one_or_none()
            if not item:
                return {"error": f"ContentItem {content_item_id} not found"}

            # ── Platform dispatch ────────────────────────────────────────────
            platform = item.platform.value
            print(f"[OMMA] Publishing to {platform}: {item.text_body[:80]}...")

            item.status = ContentStatus.published
            item.published_at = datetime.utcnow()
            item.platform_post_id = f"{platform}_{content_item_id}"

            await db.commit()
        await engine.dispose()
        return {"status": "published", "content_item_id": content_item_id}

    try:
        import asyncio
        return asyncio.run(_run())
    except Exception as exc:
        raise self.retry(exc=exc, countdown=2 ** self.request.retries * 60)


# ─── Scheduled tasks ─────────────────────────────────────────────────────────

@celery_app.task(name="api.tasks.celery_app.expire_stale_approvals_task")
def expire_stale_approvals_task():
    """Mark pending approval queue entries as expired if past deadline."""
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from sqlalchemy import select, update
    from datetime import datetime
    from ..models.content import ApprovalQueue, ApprovalStatus

    async def _run():
        engine = create_async_engine(settings.database_url)
        SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with SessionLocal() as db:
            now = datetime.utcnow()
            await db.execute(
                update(ApprovalQueue)
                .where(
                    ApprovalQueue.status == ApprovalStatus.pending,
                    ApprovalQueue.deadline_at <= now,
                )
                .values(status=ApprovalStatus.expired)
            )
            await db.commit()
        await engine.dispose()

    asyncio.run(_run())


@celery_app.task(name="api.tasks.celery_app.fetch_post_metrics_task")
def fetch_post_metrics_task():
    """
    Fetch engagement metrics for published posts from platform APIs.
    Implement per-platform data fetching here as integrations are connected.
    """
    print("[OMMA] Fetching post metrics... (add platform API calls here)")
    # TODO: Meta Graph API insights, TikTok analytics API
