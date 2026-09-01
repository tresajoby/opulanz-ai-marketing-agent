"""
Social platform publishers — direct API calls to post content.

MetaPublisher     : Facebook Pages + Instagram Business (Graph API v18)
LinkedInPublisher : LinkedIn UGC Posts API v2
TikTokPublisher   : TikTok Creator API (Photo Post)

Each publisher decrypts the stored access token at call time.
"""

import asyncio
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

def _friendly_meta_error(response: httpx.Response, platform: str) -> str:
    """Turn Graph API / httpx failures into short user-facing messages (no tokens/URLs)."""
    err: dict = {}
    try:
        err = (response.json() or {}).get("error") or {}
    except Exception:
        err = {}

    user_msg = (err.get("error_user_msg") or err.get("error_user_title") or "").strip()
    api_msg = (err.get("message") or "").strip()
    code = err.get("code")
    subcode = err.get("error_subcode")
    combined = f"{api_msg} {user_msg}".lower()

    if subcode in (2207009, 36003) or "aspect ratio" in combined:
        return (
            "Image aspect ratio is not supported. "
            "Use a square or portrait crop between 4:5 and 1.91:1 (Instagram: ~1080×1080)."
        )
    if subcode in (2207005, 36001) or ("format" in combined and "not supported" in combined):
        return "Image format is not supported. Please upload a JPEG or PNG and try again."
    if (
        code == 9004
        or subcode in (2207052, 2207001)
        or "could not be fetched" in combined
        or "media download" in combined
        or "download has failed" in combined
    ):
        return (
            "The platform could not download the image. "
            "Re-upload or regenerate the image, then publish again."
        )
    if "access token" in combined or code in (190, 102):
        return f"{platform.capitalize()} access token is invalid or expired. Reconnect the account."
    if "permission" in combined or code in (10, 200):
        return f"Missing permission to publish to {platform}. Reconnect the account with publishing access."

    if user_msg:
        return user_msg
    if api_msg and "http" not in api_msg.lower() and "access_token" not in api_msg.lower():
        return api_msg
    return f"{platform.capitalize()} rejected the post. Please try again or re-upload the image."


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
            if not r.is_success:
                print(f"[OMMA] Instagram API error {r.status_code}: {r.text}")
                raise ValueError(_friendly_meta_error(r, "instagram"))
            creation_id = r.json()["id"]

            # Wait for Instagram to finish processing the image before publishing
            for _ in range(12):
                await asyncio.sleep(5)
                status_r = await http.get(
                    f"{self.BASE}/{creation_id}",
                    params={"fields": "status_code", "access_token": token},
                )
                if status_r.is_success:
                    status = status_r.json().get("status_code", "")
                    print(f"[OMMA] Instagram media status: {status}")
                    if status == "FINISHED":
                        break
                    if status == "ERROR":
                        raise ValueError(
                            "Instagram could not process the image. "
                            "Try a JPEG around 1080×1080 and publish again."
                        )
                else:
                    break

            # Step 2: publish
            r2 = await http.post(
                f"{self.BASE}/{ig_user_id}/media_publish",
                params={"creation_id": creation_id, "access_token": token},
            )
            if not r2.is_success:
                print(f"[OMMA] Instagram publish error {r2.status_code}: {r2.text}")
                raise ValueError(_friendly_meta_error(r2, "instagram"))
            return r2.json().get("id", creation_id)

    async def _publish_facebook(self, page_id: str, token: str, post: PostPayload) -> str:
        # Extract numeric ID if a full URL was stored
        if page_id.startswith("http"):
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(page_id).query)
            page_id = qs.get("id", [page_id])[0]

        async with httpx.AsyncClient(timeout=60) as http:
            if post.image_url:
                # Always upload images as multipart binary — the ?url= approach
                # fails whenever Facebook can't reach the URL (localhost, stale
                # production hosts, base64 data URIs, etc.).
                image_bytes = await self._resolve_image_bytes(http, post.image_url)
                if image_bytes:
                    r = await http.post(
                        f"{self.BASE}/{page_id}/photos",
                        data={"message": post.caption, "access_token": token},
                        files={"source": ("image.jpg", image_bytes, "image/jpeg")},
                    )
                else:
                    # Fallback: couldn't download — try text-only post
                    print(f"[OMMA] Could not resolve image, falling back to text-only post")
                    r = await http.post(
                        f"{self.BASE}/{page_id}/feed",
                        params={"message": post.caption, "access_token": token},
                    )
            else:
                r = await http.post(
                    f"{self.BASE}/{page_id}/feed",
                    params={"message": post.caption, "access_token": token},
                )
            if not r.is_success:
                print(f"[OMMA] Facebook API error {r.status_code}: {r.text}")
                raise ValueError(_friendly_meta_error(r, "facebook"))
            data = r.json()
            return data.get("post_id") or data.get("id", "")

    @staticmethod
    async def _resolve_image_bytes(http: httpx.AsyncClient, image_url: str) -> bytes | None:
        """Convert any image source (base64 data URI, HTTP URL) into raw bytes."""
        import base64

        if not image_url:
            return None

        # 1. Base64 data URI
        if image_url.startswith("data:"):
            try:
                _, b64data = image_url.split(",", 1)
                return base64.b64decode(b64data)
            except Exception as exc:
                print(f"[OMMA] Failed to decode base64 image: {exc}")
                return None

        # 2. HTTP(S) URL — download it server-side
        if image_url.startswith("http"):
            try:
                resp = await http.get(image_url, follow_redirects=True)
                if resp.is_success:
                    return resp.content
                print(f"[OMMA] Image download failed {resp.status_code}: {image_url}")
            except Exception as exc:
                print(f"[OMMA] Image download error: {exc}")
            return None

        return None


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

        share_content: dict = {
            "shareCommentary": {"text": post.caption},
            "shareMediaCategory": "NONE",
        }

        if post.image_url:
            asset_urn = await self._upload_image(person_urn, token, post.image_url)
            if asset_urn:
                share_content["shareMediaCategory"] = "IMAGE"
                share_content["media"] = [{
                    "status": "READY",
                    "media": asset_urn,
                }]

        body: dict = {
            "author": person_urn,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": share_content
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

    async def _upload_image(self, person_urn: str, token: str, image_url: str) -> str | None:
        """Register an image upload with LinkedIn, push the bytes, and return the asset URN."""
        try:
            # Step 1: get the raw image bytes
            if image_url.startswith("data:"):
                import base64
                _, b64data = image_url.split(",", 1)
                image_bytes = base64.b64decode(b64data)
            else:
                async with httpx.AsyncClient(timeout=30) as http:
                    img_r = await http.get(image_url)
                    img_r.raise_for_status()
                    image_bytes = img_r.content

            async with httpx.AsyncClient(timeout=30) as http:
                # Step 2: register the upload
                reg = await http.post(
                    f"{self.BASE}/assets?action=registerUpload",
                    json={
                        "registerUploadRequest": {
                            "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
                            "owner": person_urn,
                            "serviceRelationships": [{
                                "relationshipType": "OWNER",
                                "identifier": "urn:li:userGeneratedContent",
                            }],
                        }
                    },
                    headers={
                        "Authorization": f"Bearer {token}",
                        "X-Restli-Protocol-Version": "2.0.0",
                    },
                )
                reg.raise_for_status()
                reg_data = reg.json()["value"]
                upload_url = reg_data["uploadMechanism"][
                    "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
                ]["uploadUrl"]
                asset_urn = reg_data["asset"]

                # Step 3: upload the binary
                up = await http.put(
                    upload_url,
                    content=image_bytes,
                    headers={"Authorization": f"Bearer {token}"},
                )
                up.raise_for_status()

            return asset_urn
        except Exception as exc:
            print(f"[OMMA] LinkedIn image upload failed: {exc}")
            return None


# ─── TikTok ───────────────────────────────────────────────────────────────────

_VIDEO_EXTENSIONS = (".mp4", ".mov", ".webm", ".avi", ".mkv")


class TikTokPublisher:
    BASE = "https://open.tiktokapis.com/v2"

    async def publish(self, account: SocialAccount, post: PostPayload) -> str:
        token = decrypt(account.access_token)
        if not token:
            raise ValueError("No valid access token for TikTok account.")
        if not post.image_url:
            raise ValueError("TikTok requires an image or video URL.")

        url_clean = post.image_url.lower().split("?")[0]
        if any(url_clean.endswith(ext) for ext in _VIDEO_EXTENSIONS):
            return await self._publish_video(token, account.account_id, post)
        return await self._publish_photo(token, account.account_id, post)

    def _check_tiktok_response(self, data: dict, label: str) -> str:
        """Raise a clear error if TikTok's JSON body signals failure (HTTP 200 but error inside)."""
        error = data.get("error", {})
        code = error.get("code", "ok")
        print(f"[OMMA] TikTok {label} response: {data}")
        if code != "ok":
            raise ValueError(f"TikTok API error ({code}): {error.get('message', 'no message')}")
        publish_id = data.get("data", {}).get("publish_id")
        if not publish_id:
            raise ValueError(f"TikTok returned no publish_id: {data}")
        return publish_id

    async def _publish_photo(self, token: str, account_id: str, post: PostPayload) -> str:
        """Post image to TikTok as a photo post with auto-selected background music."""
        async with httpx.AsyncClient(timeout=60) as http:
            r = await http.post(
                f"{self.BASE}/post/publish/content/init/",
                json={
                    "post_info": {
                        "title": post.caption[:150],
                        "privacy_level": "PUBLIC_TO_EVERYONE",
                        "auto_add_music": True,
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
            print(f"[OMMA] TikTok photo HTTP {r.status_code}: {r.text}")
            r.raise_for_status()
            return self._check_tiktok_response(r.json(), "photo")

    async def _publish_video(self, token: str, account_id: str, post: PostPayload) -> str:
        """Post video to TikTok via PULL_FROM_URL. Video's own audio serves as sound."""
        async with httpx.AsyncClient(timeout=120) as http:
            r = await http.post(
                f"{self.BASE}/post/publish/video/init/",
                json={
                    "post_info": {
                        "title": post.caption[:150],
                        "privacy_level": "PUBLIC_TO_EVERYONE",
                        "disable_duet": False,
                        "disable_comment": False,
                        "disable_stitch": False,
                    },
                    "source_info": {
                        "source": "PULL_FROM_URL",
                        "video_url": post.image_url,
                    },
                    "post_mode": "DIRECT_POST",
                    "media_type": "VIDEO",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            print(f"[OMMA] TikTok video HTTP {r.status_code}: {r.text}")
            r.raise_for_status()
            return self._check_tiktok_response(r.json(), "video")


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
