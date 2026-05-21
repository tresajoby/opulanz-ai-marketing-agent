"""
Social media OAuth router.

Endpoints:
  GET  /social/connect/{platform}         — redirect to OAuth provider (browser popup)
  GET  /social/callback/{platform}        — handle provider callback, store token
  GET  /social/brands/{brand_id}/accounts — list connected accounts for a brand
  DELETE /social/accounts/{account_id}   — disconnect an account
"""

import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models.social import SocialAccount
from ..routers.auth import get_current_user
from ..models.user import User

router = APIRouter()

# ─── Platform OAuth config ────────────────────────────────────────────────────

PLATFORM_CONFIG: dict[str, dict] = {
    "facebook": {
        "auth_url": "https://www.facebook.com/v19.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v19.0/oauth/access_token",
        "scopes": "pages_manage_posts,pages_read_engagement",
    },
    "instagram": {
        "auth_url": "https://www.facebook.com/v19.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v19.0/oauth/access_token",
        "scopes": "instagram_basic,instagram_content_publish,pages_manage_posts,pages_read_engagement",
    },
    "linkedin": {
        "auth_url": "https://www.linkedin.com/oauth/v2/authorization",
        "token_url": "https://www.linkedin.com/oauth/v2/accessToken",
        "scopes": "w_member_social,r_liteprofile",
    },
    "tiktok": {
        "auth_url": "https://www.tiktok.com/v2/auth/authorize/",
        "token_url": "https://open.tiktokapis.com/v2/oauth/token/",
        "scopes": "video.upload,video.publish",
    },
}


def _platform_client_id(platform: str) -> str:
    return {
        "facebook":  settings.meta_app_id,
        "instagram": settings.meta_app_id,
        "linkedin":  settings.linkedin_client_id,
        "tiktok":    settings.tiktok_client_key,
    }.get(platform, "")


def _platform_client_secret(platform: str) -> str:
    return {
        "facebook":  settings.meta_app_secret,
        "instagram": settings.meta_app_secret,
        "linkedin":  settings.linkedin_client_secret,
        "tiktok":    settings.tiktok_client_secret,
    }.get(platform, "")


# ─── Token encryption ─────────────────────────────────────────────────────────

def _fernet_key() -> bytes:
    digest = hashlib.sha256(settings.oauth_encryption_key.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_token(token: str) -> str:
    from cryptography.fernet import Fernet
    return Fernet(_fernet_key()).encrypt(token.encode()).decode()


def decrypt_token(enc: str) -> str:
    from cryptography.fernet import Fernet
    return Fernet(_fernet_key()).decrypt(enc.encode()).decode()


# ─── CSRF state helpers ───────────────────────────────────────────────────────

def _create_state(brand_id: int, platform: str) -> str:
    payload = json.dumps({"b": brand_id, "p": platform, "t": int(time.time())})
    sig = hmac.new(settings.secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()[:20]
    raw = f"{payload}|{sig}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _verify_state(state: str) -> tuple[int, str]:
    try:
        padded = state + "=" * (4 - len(state) % 4)
        raw = base64.urlsafe_b64decode(padded).decode()
        payload_str, sig = raw.rsplit("|", 1)
        expected = hmac.new(settings.secret_key.encode(), payload_str.encode(), hashlib.sha256).hexdigest()[:20]
        if not hmac.compare_digest(sig, expected):
            raise ValueError("bad sig")
        data = json.loads(payload_str)
        if int(time.time()) - data["t"] > 600:
            raise ValueError("expired")
        return int(data["b"]), str(data["p"])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state.")


# ─── HTML helpers ─────────────────────────────────────────────────────────────

def _popup_success(platform: str, account_name: str) -> HTMLResponse:
    safe_name = account_name.replace("'", "\\'")
    return HTMLResponse(f"""<!DOCTYPE html><html><head><title>Connected</title></head><body>
<p style="font-family:sans-serif;text-align:center;margin-top:40px">
  ✅ Connected <strong>{safe_name}</strong> on {platform.title()}. Closing…
</p>
<script>
  window.opener && window.opener.postMessage(
    {{type:'oauth_success', platform:'{platform}', account:'{safe_name}'}}, '*'
  );
  setTimeout(function(){{window.close();}}, 1200);
</script>
</body></html>""")


def _popup_error(msg: str) -> HTMLResponse:
    return HTMLResponse(f"""<!DOCTYPE html><html><head><title>Error</title></head><body>
<p style="font-family:sans-serif;text-align:center;margin-top:40px;color:red">
  ❌ OAuth failed: {msg}
</p>
<script>
  window.opener && window.opener.postMessage({{type:'oauth_error', message:'{msg}'}}, '*');
  setTimeout(function(){{window.close();}}, 3000);
</script>
</body></html>""", status_code=400)


# ─── Connect ──────────────────────────────────────────────────────────────────

@router.get("/connect/{platform}")
async def connect_platform(
    platform: str,
    request: Request,
    brand_id: int = Query(...),
    token: str = Query(...),    # JWT from frontend (browser popup can't set headers)
):
    """Redirect the browser popup to the platform's OAuth consent screen."""
    if platform not in PLATFORM_CONFIG:
        raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform}")

    client_id = _platform_client_id(platform)
    if not client_id:
        raise HTTPException(
            status_code=500,
            detail=f"OAuth credentials for {platform} are not configured on the server."
        )

    # Verify JWT (query param — browser popup can't set Authorization header)
    from jose import jwt, JWTError
    try:
        jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")

    state = _create_state(brand_id, platform)
    callback = f"{request.url.scheme}://{request.url.netloc}/api/social/callback/{platform}"
    cfg = PLATFORM_CONFIG[platform]

    if platform == "tiktok":
        auth_url = (
            f"{cfg['auth_url']}?client_key={client_id}"
            f"&scope={cfg['scopes']}&response_type=code"
            f"&redirect_uri={callback}&state={state}"
        )
    else:
        auth_url = (
            f"{cfg['auth_url']}?client_id={client_id}"
            f"&redirect_uri={callback}&scope={cfg['scopes']}"
            f"&response_type=code&state={state}"
        )

    return RedirectResponse(auth_url)


# ─── Callback ─────────────────────────────────────────────────────────────────

@router.get("/callback/{platform}")
async def oauth_callback(
    platform: str,
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Handle the provider redirect, exchange code for tokens, save to DB."""
    brand_id, verified_platform = _verify_state(state)
    if verified_platform != platform:
        return _popup_error("Platform mismatch in OAuth state.")

    cfg = PLATFORM_CONFIG.get(platform)
    if not cfg:
        return _popup_error(f"Unknown platform: {platform}")

    client_id = _platform_client_id(platform)
    client_secret = _platform_client_secret(platform)
    callback = f"{request.url.scheme}://{request.url.netloc}/api/social/callback/{platform}"

    async with httpx.AsyncClient(timeout=15) as http:
        # ── Exchange code for access token ────────────────────────────────────
        try:
            if platform == "tiktok":
                token_resp = await http.post(cfg["token_url"], json={
                    "client_key": client_id,
                    "client_secret": client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": callback,
                })
            elif platform == "linkedin":
                token_resp = await http.post(cfg["token_url"], data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": callback,
                    "client_id": client_id,
                    "client_secret": client_secret,
                }, headers={"Content-Type": "application/x-www-form-urlencoded"})
            else:
                token_resp = await http.get(cfg["token_url"], params={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "code": code,
                    "redirect_uri": callback,
                })

            token_data = token_resp.json()
        except Exception as e:
            return _popup_error(f"Token exchange failed: {e}")

        if "error" in token_data:
            return _popup_error(token_data.get("error_description") or token_data["error"])

        access_token = (
            token_data.get("access_token")
            or token_data.get("data", {}).get("access_token", "")
        )
        refresh_token = (
            token_data.get("refresh_token")
            or token_data.get("data", {}).get("refresh_token")
        )
        expires_in = token_data.get("expires_in") or token_data.get("data", {}).get("expires_in")
        expires_at = (
            datetime.fromtimestamp(time.time() + int(expires_in), tz=timezone.utc).replace(tzinfo=None)
            if expires_in else None
        )

        if not access_token:
            return _popup_error("No access token returned by platform.")

        # ── Fetch account info ────────────────────────────────────────────────
        try:
            account_id, account_name, avatar_url = await _fetch_account_info(
                http, platform, access_token
            )
        except Exception as e:
            return _popup_error(f"Could not fetch account info: {e}")

    # ── Upsert SocialAccount ──────────────────────────────────────────────────
    existing = await db.execute(
        select(SocialAccount).where(
            SocialAccount.brand_id == brand_id,
            SocialAccount.platform == platform,
            SocialAccount.account_id == account_id,
        )
    )
    acct = existing.scalar_one_or_none()

    if acct:
        acct.access_token = encrypt_token(access_token)
        acct.refresh_token = encrypt_token(refresh_token) if refresh_token else None
        acct.token_expires_at = expires_at
        acct.account_name = account_name
        acct.avatar_url = avatar_url
        acct.is_active = True
        acct.updated_at = datetime.utcnow()
    else:
        acct = SocialAccount(
            brand_id=brand_id,
            platform=platform,
            account_id=account_id,
            account_name=account_name,
            avatar_url=avatar_url,
            access_token=encrypt_token(access_token),
            refresh_token=encrypt_token(refresh_token) if refresh_token else None,
            token_expires_at=expires_at,
            scopes=cfg["scopes"],
            is_active=True,
            connected_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(acct)

    await db.commit()
    return _popup_success(platform, account_name)


async def _fetch_account_info(
    http: httpx.AsyncClient, platform: str, access_token: str
) -> tuple[str, str, str | None]:
    """Returns (account_id, account_name, avatar_url)."""
    if platform in ("facebook", "instagram"):
        r = await http.get(
            "https://graph.facebook.com/v19.0/me",
            params={"access_token": access_token, "fields": "id,name,picture"},
        )
        d = r.json()
        return (
            d["id"],
            d.get("name", "Facebook Account"),
            d.get("picture", {}).get("data", {}).get("url"),
        )

    elif platform == "linkedin":
        r = await http.get(
            "https://api.linkedin.com/v2/me",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"projection": "(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))"},
        )
        d = r.json()
        name = f"{d.get('localizedFirstName','')} {d.get('localizedLastName','')}".strip()
        avatar = None
        try:
            elements = d["profilePicture"]["displayImage~"]["elements"]
            avatar = elements[-1]["identifiers"][0]["identifier"]
        except (KeyError, IndexError):
            pass
        return d["id"], name or "LinkedIn Member", avatar

    elif platform == "tiktok":
        r = await http.get(
            "https://open.tiktokapis.com/v2/user/info/",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"fields": "open_id,display_name,avatar_url"},
        )
        d = r.json().get("data", {}).get("user", {})
        return (
            d.get("open_id", ""),
            d.get("display_name", "TikTok Account"),
            d.get("avatar_url"),
        )

    raise ValueError(f"Unsupported platform: {platform}")


# ─── List connected accounts ──────────────────────────────────────────────────

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
