"""
Analytics router — content performance metrics.

GET /api/analytics/summary  — OMMA DB stats + live engagement from Meta/LinkedIn
"""

import asyncio
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.content import ContentItem, ContentStatus
from ..models.social import SocialAccount
from ..models.user import User
from ..routers.auth import get_current_user
from ..services.token_service import decrypt

router = APIRouter()


@router.get("/summary")
async def get_analytics_summary(
    brand_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """OMMA content stats + live engagement metrics from connected social platforms."""

    # ── DB counts (no limit — full dataset) ───────────────────────────────────
    stmt = select(ContentItem)
    if brand_id:
        stmt = stmt.where(ContentItem.brand_id == brand_id)
    result = await db.execute(stmt)
    all_items = result.scalars().all()

    confidences = [c.ai_confidence_score for c in all_items if c.ai_confidence_score is not None]
    totals = {
        "generated": len(all_items),
        "published": sum(1 for c in all_items if c.status == ContentStatus.published),
        "pending_review": sum(1 for c in all_items if c.status == ContentStatus.pending_review),
        "approved": sum(1 for c in all_items if c.status == ContentStatus.approved),
        "rejected": sum(1 for c in all_items if c.status == ContentStatus.rejected),
        "avg_confidence": sum(confidences) / len(confidences) if confidences else 0,
    }

    by_platform: dict[str, dict] = {}
    for item in all_items:
        p = item.platform.value
        if p not in by_platform:
            by_platform[p] = {"generated": 0, "published": 0}
        by_platform[p]["generated"] += 1
        if item.status == ContentStatus.published:
            by_platform[p]["published"] += 1

    # ── Live platform metrics ─────────────────────────────────────────────────
    published_items = [
        c for c in all_items
        if c.status == ContentStatus.published and c.platform_post_id
    ]
    published_items.sort(key=lambda c: c.published_at or c.created_at, reverse=True)

    # Load active social accounts (keyed by platform)
    acc_stmt = select(SocialAccount).where(SocialAccount.is_active == True)
    if brand_id:
        acc_stmt = acc_stmt.where(SocialAccount.brand_id == brand_id)
    acc_result = await db.execute(acc_stmt)
    accounts: dict[str, SocialAccount] = {a.platform: a for a in acc_result.scalars().all()}

    async with httpx.AsyncClient(timeout=10) as http:
        tasks = [
            _get_post_metrics(http, item, accounts)
            for item in published_items[:20]
        ]
        metrics_list = await asyncio.gather(*tasks, return_exceptions=True)

    post_metrics = []
    for item, metrics in zip(published_items[:20], metrics_list):
        if isinstance(metrics, Exception):
            metrics = {"likes": None, "comments": None, "shares": None, "impressions": None}
        post_metrics.append({
            "content_item_id": item.id,
            "platform": item.platform.value,
            "text_body": item.text_body[:120],
            "published_at": item.published_at.isoformat() if item.published_at else None,
            "platform_post_id": item.platform_post_id,
            **metrics,
        })

    # Aggregate totals from real metrics
    metric_totals = {
        "total_likes": sum(p["likes"] or 0 for p in post_metrics),
        "total_comments": sum(p["comments"] or 0 for p in post_metrics),
        "total_shares": sum(p["shares"] or 0 for p in post_metrics),
    }

    return {
        "totals": {**totals, **metric_totals},
        "by_platform": by_platform,
        "post_metrics": post_metrics,
    }


async def _get_post_metrics(
    http: httpx.AsyncClient,
    item: ContentItem,
    accounts: dict[str, SocialAccount],
) -> dict[str, Any]:
    platform = item.platform.value
    account = accounts.get(platform)
    if not account:
        return {"likes": None, "comments": None, "shares": None, "impressions": None}
    token = decrypt(account.access_token)
    if not token:
        return {"likes": None, "comments": None, "shares": None, "impressions": None}

    try:
        if platform == "facebook":
            return await _meta_facebook_metrics(http, item.platform_post_id, token)
        if platform == "instagram":
            return await _meta_instagram_metrics(http, item.platform_post_id, token)
        if platform == "linkedin":
            return await _linkedin_metrics(http, item.platform_post_id, token)
    except Exception as exc:
        print(f"[OMMA] Analytics fetch error ({platform}/{item.platform_post_id}): {exc}")

    return {"likes": None, "comments": None, "shares": None, "impressions": None}


async def _meta_facebook_metrics(http: httpx.AsyncClient, post_id: str, token: str) -> dict:
    r = await http.get(
        f"https://graph.facebook.com/v18.0/{post_id}",
        params={
            "fields": "likes.summary(true),comments.summary(true),shares",
            "access_token": token,
        },
    )
    if not r.is_success:
        print(f"[OMMA] FB metrics error {r.status_code}: {r.text}")
        return {"likes": None, "comments": None, "shares": None, "impressions": None}
    d = r.json()
    return {
        "likes": d.get("likes", {}).get("summary", {}).get("total_count"),
        "comments": d.get("comments", {}).get("summary", {}).get("total_count"),
        "shares": d.get("shares", {}).get("count"),
        "impressions": None,
    }


async def _meta_instagram_metrics(http: httpx.AsyncClient, media_id: str, token: str) -> dict:
    r = await http.get(
        f"https://graph.facebook.com/v18.0/{media_id}",
        params={"fields": "like_count,comments_count", "access_token": token},
    )
    if not r.is_success:
        print(f"[OMMA] IG metrics error {r.status_code}: {r.text}")
        return {"likes": None, "comments": None, "shares": None, "impressions": None}
    d = r.json()
    return {
        "likes": d.get("like_count"),
        "comments": d.get("comments_count"),
        "shares": None,
        "impressions": None,
    }


async def _linkedin_metrics(http: httpx.AsyncClient, post_id: str, token: str) -> dict:
    from urllib.parse import quote
    encoded = quote(post_id, safe="")
    r = await http.get(
        f"https://api.linkedin.com/v2/socialActions/{encoded}",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Restli-Protocol-Version": "2.0.0",
        },
    )
    if not r.is_success:
        print(f"[OMMA] LinkedIn metrics error {r.status_code}: {r.text}")
        return {"likes": None, "comments": None, "shares": None, "impressions": None}
    d = r.json()
    return {
        "likes": d.get("likesSummary", {}).get("totalLikes"),
        "comments": d.get("commentsSummary", {}).get("totalFirstLevelComments"),
        "shares": None,
        "impressions": None,
    }
