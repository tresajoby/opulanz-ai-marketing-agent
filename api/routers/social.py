"""
Social media accounts router — OAuth connect + account management.

OAuth flow:
  GET /social/connect/{platform}?brand_id=X  → redirect to platform OAuth page
  GET /social/callback/{platform}             → exchange code, store token, close popup

Account management:
  GET    /social/brands/{brand_id}/accounts  → list connected accounts
  DELETE /social/accounts/{account_id}       → disconnect an account
"""

import hashlib
import hmac
import json
import time
import urllib.parse
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models.social import SocialAccount
from ..models.user import User
from ..routers.auth import get_current_user
from ..services.token_service import encrypt

router = APIRouter()

SUPPORTED_PLATFORMS = {"facebook", "instagram", "linkedin", "tiktok"}

# ─── OAuth platform config ────────────────────────────────────────────────────

_PLATFORM_CONFIG = {
    "facebook": {
        "auth_url": "https://www.facebook.com/v18.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v18.0/oauth/access_token",
        "scopes": "pages_show_list,pages_read_engagement,pages_manage_posts",
    },
    "instagram": {
        "auth_url": "https://www.facebook.com/v18.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v18.0/oauth/access_token",
        "scopes": "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish",
    },
    "linkedin": {
        "auth_url": "https://www.linkedin.com/oauth/v2/authorization",
        "token_url": "https://www.linkedin.com/oauth/v2/accessToken",
        "scopes": "openid profile email w_member_social",
    },
    "tiktok": {
        "auth_url": "https://www.tiktok.com/v2/auth/authorize/",
        "token_url": "https://open.tiktokapis.com/v2/oauth/token/",
        "scopes": "user.info.basic,video.publish",
    },
}

# ─── HMAC state helpers ───────────────────────────────────────────────────────

def _make_state(brand_id: int, platform: str) -> str:
    payload = json.dumps({"brand_id": brand_id, "platform": platform, "ts": int(time.time())})
    sig = hmac.new(settings.secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()
    b64 = urllib.parse.quote(payload)
    return f"{b64}.{sig}"


def _verify_state(state: str) -> dict:
    try:
        b64, sig = state.rsplit(".", 1)
        payload = urllib.parse.unquote(b64)
        expected = hmac.new(settings.secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise ValueError("bad sig")
        data = json.loads(payload)
        if int(time.time()) - data["ts"] > 600:
            raise ValueError("state expired")
        return data
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state.")


def _redirect_uri(platform: str) -> str:
    base = settings.api_base_url.rstrip("/") or "http://localhost:8000"
    return f"{base}/api/social/callback/{platform}"


def _client_credentials(platform: str) -> tuple[str, str]:
    pairs = {
        "facebook": (settings.meta_app_id, settings.meta_app_secret),
        "instagram": (settings.meta_app_id, settings.meta_app_secret),
        "linkedin": (settings.linkedin_client_id, settings.linkedin_client_secret),
        "tiktok": (settings.tiktok_client_key, settings.tiktok_client_secret),
    }
    client_id, client_secret = pairs.get(platform, ("", ""))
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=503,
            detail=f"{platform.title()} OAuth is not configured on this server.",
        )
    return client_id, client_secret


# ─── HTML popup close helper ──────────────────────────────────────────────────

def _popup_result(success: bool, message: str, data: dict | None = None) -> HTMLResponse:
    payload = json.dumps({"success": success, "message": message, **(data or {})})
    script = f"""
<!DOCTYPE html><html><body>
<p>{'Connected!' if success else 'Error: ' + message}</p>
<script>
  try {{ window.opener.postMessage({payload}, '*'); }} catch(e) {{}}
  window.close();
</script>
</body></html>"""
    return HTMLResponse(content=script)


# ─── OAuth connect ────────────────────────────────────────────────────────────

@router.get("/connect/{platform}")
async def connect_platform(
    platform: str,
    brand_id: int = Query(...),
    current_user: User = Depends(get_current_user),
):
    """Generate an OAuth authorization URL and redirect the user there."""
    if platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform}")

    cfg = _PLATFORM_CONFIG[platform]
    client_id, _ = _client_credentials(platform)
    state = _make_state(brand_id, platform)
    redirect_uri = _redirect_uri(platform)

    params: dict = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": cfg["scopes"],
        "state": state,
        "response_type": "code",
    }
    if platform == "tiktok":
        params["client_key"] = client_id
        del params["client_id"]

    url = cfg["auth_url"] + "?" + urllib.parse.urlencode(params)
    return RedirectResponse(url=url)


# ─── OAuth callbacks ───────────────────────────────────────────────────────────

@router.get("/callback/{platform}", response_class=HTMLResponse)
async def oauth_callback(
    platform: str,
    db: AsyncSession = Depends(get_db),
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
):
    if error or not code or not state:
        msg = error_description or error or "Authorization was denied."
        return _popup_result(False, msg)

    try:
        state_data = _verify_state(state)
        brand_id: int = state_data["brand_id"]
    except HTTPException as exc:
        return _popup_result(False, exc.detail)

    try:
        if platform in ("facebook", "instagram"):
            acct = await _handle_meta_callback(db, brand_id, platform, code)
        elif platform == "linkedin":
            acct = await _handle_linkedin_callback(db, brand_id, code)
        elif platform == "tiktok":
            acct = await _handle_tiktok_callback(db, brand_id, code)
        else:
            return _popup_result(False, f"Unknown platform: {platform}")
    except Exception as exc:
        return _popup_result(False, str(exc))

    return _popup_result(
        True,
        f"{platform.title()} connected successfully.",
        {"platform": platform, "account_name": acct.account_name},
    )


# ─── Per-platform callback handlers ──────────────────────────────────────────

async def _exchange_code(
    token_url: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    code: str,
    extra: dict | None = None,
) -> dict:
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.post(
            token_url,
            data={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "code": code,
                **(extra or {}),
            },
        )
        if not r.is_success:
            raise Exception(f"Token exchange failed: {r.text[:300]}")
        return r.json()


async def _upsert_account(
    db: AsyncSession,
    brand_id: int,
    platform: str,
    account_id: str,
    account_name: str,
    access_token: str,
    refresh_token: str | None = None,
    scopes: str | None = None,
) -> SocialAccount:
    result = await db.execute(
        select(SocialAccount).where(
            SocialAccount.brand_id == brand_id,
            SocialAccount.platform == platform,
        )
    )
    acct = result.scalar_one_or_none()
    now = datetime.utcnow()

    if acct:
        acct.account_id = account_id
        acct.account_name = account_name
        acct.access_token = encrypt(access_token)
        acct.refresh_token = encrypt(refresh_token) if refresh_token else None
        acct.scopes = scopes
        acct.is_active = True
        acct.updated_at = now
    else:
        acct = SocialAccount(
            brand_id=brand_id,
            platform=platform,
            account_id=account_id,
            account_name=account_name,
            access_token=encrypt(access_token),
            refresh_token=encrypt(refresh_token) if refresh_token else None,
            scopes=scopes,
            is_active=True,
            connected_at=now,
            updated_at=now,
        )
        db.add(acct)

    await db.commit()
    await db.refresh(acct)
    return acct


async def _handle_meta_callback(
    db: AsyncSession, brand_id: int, platform: str, code: str
) -> SocialAccount:
    client_id, client_secret = _client_credentials(platform)
    redirect_uri = _redirect_uri(platform)

    token_data = await _exchange_code(
        "https://graph.facebook.com/v18.0/oauth/access_token",
        client_id, client_secret, redirect_uri, code,
    )
    user_token = token_data["access_token"]

    async with httpx.AsyncClient(timeout=15) as http:
        if platform == "instagram":
            # Get the user's pages, then find the linked IG business account
            pages_r = await http.get(
                "https://graph.facebook.com/v18.0/me/accounts",
                params={"fields": "instagram_business_account,name", "access_token": user_token},
            )
            pages_r.raise_for_status()
            pages = pages_r.json().get("data", [])
            ig_id, ig_name, page_token = None, None, user_token
            for page in pages:
                if "instagram_business_account" in page:
                    ig_id = page["instagram_business_account"]["id"]
                    ig_name = page.get("name", "Instagram")
                    # Get page-specific token
                    tok_r = await http.get(
                        f"https://graph.facebook.com/v18.0/{page['id']}",
                        params={"fields": "access_token", "access_token": user_token},
                    )
                    tok_r.raise_for_status()
                    page_token = tok_r.json().get("access_token", user_token)
                    break
            if not ig_id:
                raise Exception(
                    "No Instagram Business account found linked to your Facebook pages. "
                    "Convert your Instagram to a Business account and link it to a Facebook Page."
                )
            return await _upsert_account(
                db, brand_id, "instagram", ig_id, ig_name or "Instagram", page_token
            )
        else:
            # Facebook: get the first page's page-level token
            pages_r = await http.get(
                "https://graph.facebook.com/v18.0/me/accounts",
                params={"fields": "name,access_token", "access_token": user_token},
            )
            pages_r.raise_for_status()
            pages = pages_r.json().get("data", [])
            if not pages:
                raise Exception(
                    "No Facebook Pages found for this account. "
                    "Create a Facebook Page to connect it."
                )
            page = pages[0]
            return await _upsert_account(
                db, brand_id, "facebook",
                page["id"], page["name"], page["access_token"],
            )


async def _handle_linkedin_callback(
    db: AsyncSession, brand_id: int, code: str
) -> SocialAccount:
    client_id, client_secret = _client_credentials("linkedin")
    redirect_uri = _redirect_uri("linkedin")

    token_data = await _exchange_code(
        "https://www.linkedin.com/oauth/v2/accessToken",
        client_id, client_secret, redirect_uri, code,
    )
    access_token = token_data["access_token"]
    scopes = token_data.get("scope", "")

    async with httpx.AsyncClient(timeout=15) as http:
        me_r = await http.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        me_r.raise_for_status()
        me = me_r.json()

    person_id = me.get("sub", "")
    name = me.get("name") or me.get("given_name", "LinkedIn User")

    return await _upsert_account(
        db, brand_id, "linkedin", person_id, name, access_token, scopes=scopes
    )


async def _handle_tiktok_callback(
    db: AsyncSession, brand_id: int, code: str
) -> SocialAccount:
    client_id, client_secret = _client_credentials("tiktok")
    redirect_uri = _redirect_uri("tiktok")

    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.post(
            "https://open.tiktokapis.com/v2/oauth/token/",
            data={
                "client_key": client_id,
                "client_secret": client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if not r.is_success:
            raise Exception(f"TikTok token exchange failed: {r.text[:300]}")
        token_data = r.json()

    access_token = token_data.get("access_token", "")
    open_id = token_data.get("open_id", "")
    scopes = token_data.get("scope", "")

    async with httpx.AsyncClient(timeout=15) as http:
        info_r = await http.get(
            "https://open.tiktokapis.com/v2/user/info/",
            params={"fields": "open_id,display_name,avatar_url"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        info_r.raise_for_status()
        user_data = info_r.json().get("data", {}).get("user", {})

    name = user_data.get("display_name") or "TikTok User"
    return await _upsert_account(
        db, brand_id, "tiktok", open_id or "unknown", name,
        access_token, scopes=scopes,
    )


# ─── Account listing ──────────────────────────────────────────────────────────

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


@router.get("/brands/{brand_id}/accounts", response_model=list[SocialAccountOut])
async def list_accounts(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(SocialAccount)
        .where(SocialAccount.brand_id == brand_id, SocialAccount.is_active == True)
        .order_by(SocialAccount.platform)
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
