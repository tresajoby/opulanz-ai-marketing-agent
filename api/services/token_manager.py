"""
Token Manager Service — automated token refresh & health verification.

Handles:
- Refresh token rotation & automatic extension for TikTok and LinkedIn
- Meta (Facebook/Instagram) long-lived token extension & permission validation
- Proactive validation checks to detect revoked scopes and set validation_error
"""

from datetime import datetime, timedelta
import logging
import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models.social import SocialAccount
from .token_service import encrypt, decrypt

logger = logging.getLogger("omma.token_manager")


async def refresh_social_account_token(
    account: SocialAccount, db: AsyncSession, force: bool = False
) -> str:
    """
    Check if the account's token is expired or close to expiring (within threshold).
    If a refresh token is available (TikTok / LinkedIn), exchange it for a fresh access token,
    persist the new tokens and expiration time in the DB, and return the decrypted token.
    """
    now = datetime.utcnow()
    raw_access_token = decrypt(account.access_token)
    raw_refresh_token = decrypt(account.refresh_token) if account.refresh_token else None

    # Thresholds:
    # TikTok access tokens usually last 24 hours; refresh if <= 4 hours remaining
    # LinkedIn access tokens last 60 days; refresh if <= 48 hours remaining
    threshold = timedelta(hours=4) if account.platform == "tiktok" else timedelta(hours=48)
    needs_refresh = force or (
        account.token_expires_at is not None and account.token_expires_at <= now + threshold
    )

    if not needs_refresh:
        return raw_access_token

    if account.platform == "tiktok":
        if not raw_refresh_token:
            logger.warning(f"[OMMA] TikTok account {account.account_name} ({account.id}) has no refresh token.")
            return raw_access_token

        if not settings.tiktok_client_key or not settings.tiktok_client_secret:
            logger.error("[OMMA] TikTok client credentials missing from server settings.")
            return raw_access_token

        try:
            async with httpx.AsyncClient(timeout=20) as http:
                r = await http.post(
                    "https://open.tiktokapis.com/v2/oauth/token/",
                    data={
                        "client_key": settings.tiktok_client_key,
                        "client_secret": settings.tiktok_client_secret,
                        "grant_type": "refresh_token",
                        "refresh_token": raw_refresh_token,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                data = r.json()
                if not r.is_success or data.get("error", {}).get("code") not in (None, "ok", 0):
                    err_msg = data.get("error_description") or data.get("error", {}).get("message") or r.text[:200]
                    account.validation_error = f"TikTok token refresh failed: {err_msg}"
                    await db.commit()
                    logger.error(f"[OMMA] TikTok refresh failed for account {account.id}: {err_msg}")
                    return raw_access_token

                token_data = data.get("data") if "data" in data else data
                new_access_token = token_data.get("access_token")
                new_refresh_token = token_data.get("refresh_token")
                expires_in = token_data.get("expires_in")

                if new_access_token:
                    account.access_token = encrypt(new_access_token)
                    if new_refresh_token:
                        account.refresh_token = encrypt(new_refresh_token)
                    if expires_in:
                        account.token_expires_at = now + timedelta(seconds=int(expires_in))
                    account.validation_error = None
                    account.updated_at = now
                    await db.commit()
                    logger.info(f"[OMMA] TikTok token refreshed successfully for account {account.account_name} ({account.id})")
                    return new_access_token
        except Exception as e:
            logger.error(f"[OMMA] Exception during TikTok token refresh: {e}")
            account.validation_error = f"TikTok token refresh exception: {str(e)}"
            await db.commit()

    elif account.platform == "linkedin":
        if not raw_refresh_token:
            logger.warning(f"[OMMA] LinkedIn account {account.account_name} ({account.id}) has no refresh token.")
            return raw_access_token

        if not settings.linkedin_client_id or not settings.linkedin_client_secret:
            logger.error("[OMMA] LinkedIn client credentials missing from server settings.")
            return raw_access_token

        try:
            async with httpx.AsyncClient(timeout=20) as http:
                r = await http.post(
                    "https://www.linkedin.com/oauth/v2/accessToken",
                    data={
                        "grant_type": "refresh_token",
                        "refresh_token": raw_refresh_token,
                        "client_id": settings.linkedin_client_id,
                        "client_secret": settings.linkedin_client_secret,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                if not r.is_success:
                    err_msg = r.text[:200]
                    account.validation_error = f"LinkedIn token refresh failed: {err_msg}"
                    await db.commit()
                    logger.error(f"[OMMA] LinkedIn refresh failed for account {account.id}: {err_msg}")
                    return raw_access_token

                data = r.json()
                new_access_token = data.get("access_token")
                new_refresh_token = data.get("refresh_token")
                expires_in = data.get("expires_in")

                if new_access_token:
                    account.access_token = encrypt(new_access_token)
                    if new_refresh_token:
                        account.refresh_token = encrypt(new_refresh_token)
                    if expires_in:
                        account.token_expires_at = now + timedelta(seconds=int(expires_in))
                    account.validation_error = None
                    account.updated_at = now
                    await db.commit()
                    logger.info(f"[OMMA] LinkedIn token refreshed successfully for account {account.account_name} ({account.id})")
                    return new_access_token
        except Exception as e:
            logger.error(f"[OMMA] Exception during LinkedIn token refresh: {e}")
            account.validation_error = f"LinkedIn token refresh exception: {str(e)}"
            await db.commit()

    elif account.platform in ("facebook", "instagram"):
        # Auto-extend short-lived tokens to long-lived (60 days) if Meta app credentials exist
        if settings.meta_app_id and settings.meta_app_secret and raw_access_token:
            try:
                async with httpx.AsyncClient(timeout=15) as http:
                    r = await http.get(
                        "https://graph.facebook.com/v18.0/oauth/access_token",
                        params={
                            "grant_type": "fb_exchange_token",
                            "client_id": settings.meta_app_id,
                            "client_secret": settings.meta_app_secret,
                            "fb_exchange_token": raw_access_token,
                        },
                    )
                    if r.is_success:
                        data = r.json()
                        extended_token = data.get("access_token")
                        expires_in = data.get("expires_in")
                        if extended_token:
                            account.access_token = encrypt(extended_token)
                            if expires_in:
                                account.token_expires_at = now + timedelta(seconds=int(expires_in))
                            else:
                                account.token_expires_at = now + timedelta(days=60)
                            account.validation_error = None
                            account.updated_at = now
                            await db.commit()
                            logger.info(f"[OMMA] Meta token extended to long-lived for account {account.account_name}")
                            return extended_token
            except Exception as e:
                logger.debug(f"[OMMA] Meta token extension attempt: {e}")

    return raw_access_token


async def verify_and_validate_account(
    account: SocialAccount, db: AsyncSession
) -> tuple[bool, str | None]:
    """
    Lightweight health-check for a social account's credentials.
    Calls the platform API to confirm tokens and permissions are intact.
    If revoked or invalid, sets `account.validation_error` and returns (False, error).
    If valid, clears `account.validation_error` and returns (True, None).
    """
    token = await refresh_social_account_token(account, db, force=False)
    if not token:
        err = "No access token configured for this account."
        account.validation_error = err
        await db.commit()
        return False, err

    now = datetime.utcnow()

    try:
        async with httpx.AsyncClient(timeout=15) as http:
            if account.platform in ("facebook", "instagram"):
                # Test querying the page/account directly
                r = await http.get(
                    f"https://graph.facebook.com/v18.0/{account.account_id}",
                    params={"fields": "id,name", "access_token": token},
                )
                if r.is_success:
                    account.validation_error = None
                    account.updated_at = now
                    await db.commit()
                    return True, None

                # Parse Graph API error
                data = r.json()
                err_obj = data.get("error", {})
                code = err_obj.get("code")
                msg = err_obj.get("error_user_msg") or err_obj.get("message") or r.text[:200]
                error_summary = f"Meta authorization error (code {code}): {msg}. Please reconnect your account."
                account.validation_error = error_summary
                account.updated_at = now
                await db.commit()
                return False, error_summary

            elif account.platform == "linkedin":
                r = await http.get(
                    "https://api.linkedin.com/v2/userinfo",
                    headers={"Authorization": f"Bearer {token}"},
                )
                if r.is_success:
                    account.validation_error = None
                    account.updated_at = now
                    await db.commit()
                    return True, None

                # If 401, attempt one forced refresh
                if r.status_code in (401, 403):
                    new_token = await refresh_social_account_token(account, db, force=True)
                    if new_token and new_token != token:
                        r2 = await http.get(
                            "https://api.linkedin.com/v2/userinfo",
                            headers={"Authorization": f"Bearer {new_token}"},
                        )
                        if r2.is_success:
                            account.validation_error = None
                            account.updated_at = now
                            await db.commit()
                            return True, None

                error_summary = "LinkedIn access revoked or expired. Please reconnect your account."
                account.validation_error = error_summary
                account.updated_at = now
                await db.commit()
                return False, error_summary

            elif account.platform == "tiktok":
                r = await http.get(
                    "https://open.tiktokapis.com/v2/user/info/",
                    params={"fields": "open_id,display_name"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                data = r.json() if r.is_success else {}
                code = data.get("error", {}).get("code")
                if r.is_success and code in (None, "ok", 0):
                    account.validation_error = None
                    account.updated_at = now
                    await db.commit()
                    return True, None

                # Try forced refresh
                new_token = await refresh_social_account_token(account, db, force=True)
                if new_token and new_token != token:
                    r2 = await http.get(
                        "https://open.tiktokapis.com/v2/user/info/",
                        params={"fields": "open_id,display_name"},
                        headers={"Authorization": f"Bearer {new_token}"},
                    )
                    data2 = r2.json() if r2.is_success else {}
                    if r2.is_success and data2.get("error", {}).get("code") in (None, "ok", 0):
                        account.validation_error = None
                        account.updated_at = now
                        await db.commit()
                        return True, None

                error_summary = "TikTok authorization expired or revoked. Please reconnect your account."
                account.validation_error = error_summary
                account.updated_at = now
                await db.commit()
                return False, error_summary

    except Exception as e:
        logger.error(f"[OMMA] Validation exception for account {account.id} ({account.platform}): {e}")
        # Network errors during validation shouldn't immediately mark account as revoked unless persistent
        return False, f"Could not reach {account.platform.title()} API: {e}"

    return True, None
