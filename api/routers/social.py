"""
Social media accounts router — credentials managed by n8n.

Users connect social accounts inside n8n (see GET /social/n8n-url).
These endpoints track which platforms are marked as active per brand
so the Content Studio knows which platforms are available.

Endpoints:
  GET    /social/n8n-url                    — return n8n dashboard URL
  GET    /social/brands/{brand_id}/accounts — list connected platforms for a brand
  POST   /social/brands/{brand_id}/accounts — mark a platform as connected
  DELETE /social/accounts/{account_id}      — disconnect a platform
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models.social import SocialAccount
from ..routers.auth import get_current_user
from ..models.user import User

router = APIRouter()

SUPPORTED_PLATFORMS = {"facebook", "instagram", "linkedin", "tiktok"}


# ─── n8n URL ──────────────────────────────────────────────────────────────────

class N8nUrlOut(BaseModel):
    url: str


@router.get("/n8n-url", response_model=N8nUrlOut)
async def get_n8n_url(current_user: User = Depends(get_current_user)):
    """Return the n8n dashboard URL where users connect their social accounts."""
    if not settings.n8n_url:
        raise HTTPException(
            status_code=503,
            detail="n8n is not configured on this server. Set N8N_URL in environment variables.",
        )
    return N8nUrlOut(url=settings.n8n_url)


# ─── Account models ───────────────────────────────────────────────────────────

class ConnectPlatformIn(BaseModel):
    platform: str
    account_name: str = ""


class SocialAccountOut(BaseModel):
    id: int
    brand_id: int
    platform: str
    account_id: str
    account_name: str
    avatar_url: str | None
    scopes: str | None
    is_active: bool
    connected_at: datetime
    token_expires_at: datetime | None

    model_config = {"from_attributes": True}


# ─── Mark connected ───────────────────────────────────────────────────────────

@router.post("/brands/{brand_id}/accounts", response_model=SocialAccountOut, status_code=status.HTTP_201_CREATED)
async def mark_platform_connected(
    brand_id: int,
    body: ConnectPlatformIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Mark a social platform as connected for a brand.
    The actual OAuth credential lives in n8n; this record tells OMMA the platform is active.
    """
    if body.platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(status_code=400, detail=f"Unsupported platform: {body.platform}")

    existing = await db.execute(
        select(SocialAccount).where(
            SocialAccount.brand_id == brand_id,
            SocialAccount.platform == body.platform,
        )
    )
    acct = existing.scalar_one_or_none()

    if acct:
        acct.is_active = True
        if body.account_name:
            acct.account_name = body.account_name
        acct.updated_at = datetime.utcnow()
    else:
        acct = SocialAccount(
            brand_id=brand_id,
            platform=body.platform,
            account_id=f"n8n_{body.platform}_{brand_id}",
            account_name=body.account_name or body.platform.title(),
            avatar_url=None,
            access_token="n8n_managed",
            refresh_token=None,
            token_expires_at=None,
            scopes=None,
            is_active=True,
            connected_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(acct)

    await db.commit()
    await db.refresh(acct)
    return acct


# ─── List connected accounts ──────────────────────────────────────────────────

@router.get("/brands/{brand_id}/accounts", response_model=list[SocialAccountOut])
async def list_accounts(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(SocialAccount).where(
            SocialAccount.brand_id == brand_id,
            SocialAccount.is_active == True,
        ).order_by(SocialAccount.platform)
    )
    return result.scalars().all()


# ─── Disconnect ───────────────────────────────────────────────────────────────

@router.delete("/accounts/{account_id}", status_code=status.HTTP_200_OK)
async def disconnect_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(SocialAccount).where(SocialAccount.id == account_id))
    acct = result.scalar_one_or_none()
    if not acct:
        raise HTTPException(status_code=404, detail="Social account not found.")

    acct.is_active = False
    acct.updated_at = datetime.utcnow()
    await db.commit()
    return {"message": f"Disconnected {acct.account_name} ({acct.platform})."}
