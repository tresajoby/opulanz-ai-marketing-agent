"""
Social media accounts router — manual account management.

Users add their social account handles directly in OMMA.
These endpoints track which platforms are active per brand
so the Content Studio knows which platforms are available.

Endpoints:
  GET    /social/brands/{brand_id}/accounts — list connected platforms for a brand
  POST   /social/brands/{brand_id}/accounts — add a connected platform
  DELETE /social/accounts/{account_id}      — disconnect a platform
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.social import SocialAccount
from ..routers.auth import get_current_user
from ..models.user import User

router = APIRouter()

SUPPORTED_PLATFORMS = {"facebook", "instagram", "linkedin", "tiktok"}


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
    """Add a social platform account for a brand."""
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
            account_id=f"{body.platform}_{brand_id}",
            account_name=body.account_name or body.platform.title(),
            avatar_url=None,
            access_token="manual",
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
