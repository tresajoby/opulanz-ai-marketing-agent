"""
Social platform publishers — direct API calls to post content.

MetaPublisher     : Facebook Pages + Instagram Business (Graph API v18)
LinkedInPublisher : LinkedIn UGC Posts API v2
TikTokPublisher   : TikTok Creator API (Photo Post)

Each publisher decrypts the stored access token at call time.
"""

from dataclasses import dataclass

import httpx

from ..models.social import SocialAccount
from ..services.token_service import decrypt


@dataclass
class PostPayload:
    text: str
    hashtags: str
    image_url: str | None = None

    @property
    def caption(self) -> str:
        parts = [self.text]
        if self.hashtags:
            parts.append(self.hashtags)
        return "\n\n".join(filter(None, parts))


# ─── Meta (Facebook + Instagram) ─────────────────────────────────────────────

class MetaPublisher:
    BASE = "https://graph.facebook.com/v18.0"

    async def publish(self, account: SocialAccount, post: PostPayload) -> str:
        token = decrypt(account.access_token)
        if not token:
            raise ValueError("No valid access token for Meta account.")
        if account.platform == "instagram":
            return await self._publish_instagram(account.account_id, token, post)
        return await self._publish_facebook(account.account_id, token, post)

    async def _publish_instagram(self, ig_user_id: str, token: str, post: PostPayload) -> str:
        if not post.image_url:
            raise ValueError("Instagram requires an image URL.")
        async with httpx.AsyncClient(timeout=60) as http:
            # Step 1: create media container
            r = await http.post(
                f"{self.BASE}/{ig_user_id}/media",
                params={
                    "image_url": post.image_url,
                    "caption": post.caption,
                    "media_type": "IMAGE",
                    "access_token": token,
                },
            )
            r.raise_for_status()
            creation_id = r.json()["id"]

            # Step 2: publish
            r2 = await http.post(
                f"{self.BASE}/{ig_user_id}/media_publish",
                params={"creation_id": creation_id, "access_token": token},
            )
            r2.raise_for_status()
            return r2.json().get("id", creation_id)

    async def _publish_facebook(self, page_id: str, token: str, post: PostPayload) -> str:
        # Extract numeric ID if a full URL was stored
        if page_id.startswith("http"):
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(page_id).query)
            page_id = qs.get("id", [page_id])[0]

        async with httpx.AsyncClient(timeout=30) as http:
            if post.image_url:
                r = await http.post(
                    f"{self.BASE}/{page_id}/photos",
                    params={"url": post.image_url, "message": post.caption, "access_token": token},
                )
            else:
                r = await http.post(
                    f"{self.BASE}/{page_id}/feed",
                    params={"message": post.caption, "access_token": token},
                )
            r.raise_for_status()
            data = r.json()
            return data.get("post_id") or data.get("id", "")


# ─── LinkedIn ─────────────────────────────────────────────────────────────────

class LinkedInPublisher:
    BASE = "https://api.linkedin.com/v2"

    async def publish(self, account: SocialAccount, post: PostPayload) -> str:
        token = decrypt(account.access_token)
        if not token:
            raise ValueError("No valid access token for LinkedIn account.")

        # Try to get the real member ID from LinkedIn at publish time
        # (stored account_id may be a placeholder if profile scope wasn't available)
        person_urn = None
        async with httpx.AsyncClient(timeout=15) as _http:
            for endpoint in [
                "https://api.linkedin.com/v2/userinfo",
                "https://api.linkedin.com/v2/me",
            ]:
                try:
                    r = await _http.get(endpoint, headers={"Authorization": f"Bearer {token}"})
                    if r.is_success:
                        data = r.json()
                        member_id = data.get("sub") or data.get("id")
                        if member_id:
                            person_urn = member_id if member_id.startswith("urn:") else f"urn:li:person:{member_id}"
                            break
                except Exception:
                    continue

        if not person_urn:
            stored = account.account_id
            person_urn = stored if stored.startswith("urn:") else f"urn:li:person:{stored}"
        body: dict = {
            "author": person_urn,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": post.caption},
                    "shareMediaCategory": "NONE",
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        }

        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(
                f"{self.BASE}/ugcPosts",
                json=body,
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-Restli-Protocol-Version": "2.0.0",
                },
            )
            r.raise_for_status()
            return r.headers.get("x-restli-id", account.account_id)


# ─── TikTok ───────────────────────────────────────────────────────────────────

class TikTokPublisher:
    BASE = "https://open.tiktokapis.com/v2"

    async def publish(self, account: SocialAccount, post: PostPayload) -> str:
        token = decrypt(account.access_token)
        if not token:
            raise ValueError("No valid access token for TikTok account.")
        if not post.image_url:
            raise ValueError("TikTok requires an image or video URL.")

        async with httpx.AsyncClient(timeout=60) as http:
            r = await http.post(
                f"{self.BASE}/post/publish/content/init/",
                json={
                    "post_info": {
                        "title": post.caption[:150],
                        "privacy_level": "PUBLIC_TO_EVERYONE",
                    },
                    "source_info": {
                        "source": "PULL_FROM_URL",
                        "photo_images": [post.image_url],
                        "photo_cover_index": 0,
                    },
                    "post_mode": "DIRECT_POST",
                    "media_type": "PHOTO",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
            return r.json().get("data", {}).get("publish_id", account.account_id)


# ─── Dispatcher ───────────────────────────────────────────────────────────────

_meta = MetaPublisher()
_linkedin = LinkedInPublisher()
_tiktok = TikTokPublisher()


async def publish_to_platform(account: SocialAccount, post: PostPayload) -> str:
    """Route to the correct publisher based on platform."""
    if account.platform in ("facebook", "instagram"):
        return await _meta.publish(account, post)
    if account.platform == "linkedin":
        return await _linkedin.publish(account, post)
    if account.platform == "tiktok":
        return await _tiktok.publish(account, post)
    raise ValueError(f"No publisher registered for platform: {account.platform}")
