"""
Celery task queue.

Background tasks:
  - publish_content_task   : posts approved content to the social platform API
  - performance_fetch_task : pulls metrics from platform APIs (runs on schedule)
  - compliance_sweep_task  : expires stale approval queue entries
"""

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
        # Proactively check authorization health for all connected social accounts every 12 hours
        "verify-social-tokens": {
            "task": "api.tasks.celery_app.verify_all_tokens_task",
            "schedule": crontab(hour="*/12", minute=30),
        },
    },
)


# ─── Publishing task ─────────────────────────────────────────────────────────

@celery_app.task(
    name="api.tasks.celery_app.publish_content_task",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    max_retries=5
)
def publish_content_task(self, content_item_id: int):
    """
    1. Load the approved ContentItem from DB.
    2. Ask the SocialPublishingAgent (Claude) to format it for the target platform.
    3. Find the brand's connected SocialAccount for that platform.
    4. Call the platform publisher to post it.
    5. Save the resulting post ID and mark the item published.
    Retries up to 5× with exponential backoff on any failure.
    """
    import asyncio
    from datetime import datetime
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from ..agents.social_agent import social_publishing_agent
    from ..models.content import ContentItem, ContentStatus
    from ..models.social import SocialAccount
    from ..services.social_publisher import PostPayload, publish_to_platform

    async def _run():
        engine = create_async_engine(settings.database_url)
        Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with Session() as db:
            # Load content item
            item = (await db.execute(
                select(ContentItem).where(ContentItem.id == content_item_id)
            )).scalar_one_or_none()
            if not item:
                return {"error": f"ContentItem {content_item_id} not found"}

            platform = item.platform.value
            print(f"[OMMA] Publishing to {platform}: {item.text_body[:80]}...")

            # Find connected social account for this brand + platform
            account = (await db.execute(
                select(SocialAccount).where(
                    SocialAccount.brand_id == item.brand_id,
                    SocialAccount.platform == platform,
                    SocialAccount.is_active == True,
                )
            )).scalar_one_or_none()

            post_id: str | None = None

            if account:
                # Format content with the AI agent, then publish
                try:
                    prepared = await social_publishing_agent.prepare_post(item)
                    post = PostPayload(
                        text=prepared.text_body,
                        hashtags=prepared.hashtags,
                        image_url=item.image_url,
                    )
                    post_id = await publish_to_platform(account, post, db=db)
                    print(f"[OMMA] Published to {platform}, post_id={post_id}")
                except Exception as exc:
                    print(f"[OMMA] Publish error ({platform}): {exc}")
                    raise exc
            else:
                print(f"[OMMA] No connected account for {platform} on brand {item.brand_id} — skipping live post")

            item.status = ContentStatus.published
            item.published_at = datetime.utcnow()
            item.platform_post_id = post_id or f"{platform}_{content_item_id}"
            await db.commit()

        await engine.dispose()
        return {"status": "published", "content_item_id": content_item_id, "post_id": post_id}

    return asyncio.run(_run())



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


@celery_app.task(name="api.tasks.celery_app.verify_all_tokens_task")
def verify_all_tokens_task():
    """
    Check authorization & token validity for all connected social accounts.
    Proactively detects revoked permissions/expired tokens and flags them for the UI.
    """
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from sqlalchemy import select
    from ..models.social import SocialAccount
    from ..services.token_manager import verify_and_validate_account

    async def _run():
        engine = create_async_engine(settings.database_url)
        SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with SessionLocal() as db:
            accounts = (await db.execute(
                select(SocialAccount).where(SocialAccount.is_active == True)
            )).scalars().all()
            print(f"[OMMA] Running health verification for {len(accounts)} active social accounts...")

            for acct in accounts:
                try:
                    is_valid, err = await verify_and_validate_account(acct, db)
                    if not is_valid:
                        print(f"[OMMA] Token validation warning for {acct.platform} ({acct.account_name}): {err}")
                    else:
                        print(f"[OMMA] {acct.platform} account '{acct.account_name}' is healthy.")
                except Exception as exc:
                    print(f"[OMMA] Error verifying {acct.platform} account {acct.id}: {exc}")

        await engine.dispose()

    asyncio.run(_run())
