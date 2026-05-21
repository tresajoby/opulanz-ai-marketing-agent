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
            print(f"[OMMA] Dispatching to {platform}: {item.text_body[:80]}...")

            post_id = None
            try:
                post_id = await _publish_to_platform(db, item)
            except Exception as exc:
                print(f"[OMMA] Platform publish error ({platform}): {exc}")

            item.status = ContentStatus.published
            item.published_at = datetime.utcnow()
            item.platform_post_id = post_id or f"mock_{platform}_{content_item_id}"

            await db.commit()
        await engine.dispose()
        return {"status": "published", "content_item_id": content_item_id}

    try:
        import asyncio
        return asyncio.run(_run())
    except Exception as exc:
        raise self.retry(exc=exc, countdown=2 ** self.request.retries * 60)


# ─── Platform publish helper ─────────────────────────────────────────────────

async def _publish_to_platform(db, item) -> str | None:
    """Post to the social platform using the brand's stored OAuth token."""
    import httpx
    from sqlalchemy import select
    from ..models.social import SocialAccount
    from ..routers.social import decrypt_token

    platform = item.platform.value
    result = await db.execute(
        select(SocialAccount).where(
            SocialAccount.brand_id == item.brand_id,
            SocialAccount.platform == platform,
            SocialAccount.is_active == True,
        ).limit(1)
    )
    acct = result.scalar_one_or_none()
    if not acct:
        print(f"[OMMA] No connected {platform} account for brand {item.brand_id} — skipping live post.")
        return None

    token = decrypt_token(acct.access_token)
    caption = "\n\n".join(filter(None, [item.text_body, item.hashtags]))

    async with httpx.AsyncClient(timeout=20) as http:
        if platform == "facebook":
            pages_r = await http.get(
                "https://graph.facebook.com/v19.0/me/accounts",
                params={"access_token": token},
            )
            pages = pages_r.json().get("data", [])
            if not pages:
                raise ValueError("No Facebook Pages found for this token.")
            page = pages[0]
            r = await http.post(
                f"https://graph.facebook.com/v19.0/{page['id']}/feed",
                json={"message": caption, "access_token": page["access_token"]},
            )
            r.raise_for_status()
            return r.json().get("id")

        elif platform == "instagram":
            # Get the IG Business account linked to the user's page
            pages_r = await http.get(
                "https://graph.facebook.com/v19.0/me/accounts",
                params={"access_token": token, "fields": "id,instagram_business_account"},
            )
            pages = pages_r.json().get("data", [])
            ig_id = next(
                (p["instagram_business_account"]["id"] for p in pages if "instagram_business_account" in p),
                None,
            )
            if not ig_id:
                raise ValueError("No Instagram Business account linked to this token.")
            # Step 1: create media container
            container_r = await http.post(
                f"https://graph.facebook.com/v19.0/{ig_id}/media",
                params={
                    "caption": caption,
                    "image_url": item.image_url or "",
                    "access_token": token,
                },
            )
            container_r.raise_for_status()
            container_id = container_r.json()["id"]
            # Step 2: publish container
            pub_r = await http.post(
                f"https://graph.facebook.com/v19.0/{ig_id}/media_publish",
                params={"creation_id": container_id, "access_token": token},
            )
            pub_r.raise_for_status()
            return pub_r.json().get("id")

        elif platform == "linkedin":
            # Fetch member URN
            me_r = await http.get(
                "https://api.linkedin.com/v2/me",
                headers={"Authorization": f"Bearer {token}"},
            )
            me_r.raise_for_status()
            urn = f"urn:li:person:{me_r.json()['id']}"
            post_r = await http.post(
                "https://api.linkedin.com/v2/ugcPosts",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={
                    "author": urn,
                    "lifecycleState": "PUBLISHED",
                    "specificContent": {
                        "com.linkedin.ugc.ShareContent": {
                            "shareCommentary": {"text": caption},
                            "shareMediaCategory": "NONE",
                        }
                    },
                    "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
                },
            )
            post_r.raise_for_status()
            return post_r.headers.get("x-restli-id")

        elif platform == "tiktok":
            r = await http.post(
                "https://open.tiktokapis.com/v2/post/publish/text/create/",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={
                    "post_info": {
                        "title": caption[:150],
                        "privacy_level": "PUBLIC_TO_EVERYONE",
                        "disable_comment": False,
                        "disable_duet": False,
                        "disable_stitch": False,
                    },
                    "source_info": {"source": "FILE_UPLOAD"},
                },
            )
            r.raise_for_status()
            return r.json().get("data", {}).get("publish_id")

    return None


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
