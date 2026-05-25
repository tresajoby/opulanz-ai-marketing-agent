"""
Social Publishing Agent — Claude-powered post formatter.

Given an approved ContentItem, this agent reformats the content to match
the target platform's tone, length, and style conventions before publishing.
Claude Haiku is used for speed and cost efficiency on this formatting step.
"""

import json
from dataclasses import dataclass
from datetime import datetime, timedelta

import anthropic

from ..config import settings
from ..models.content import ContentItem

_PLATFORM_SPECS: dict[str, dict] = {
    "facebook": {
        "tone": "conversational and engaging",
        "max_chars": 63206,
        "hashtag_count": "3-5",
        "best_times_utc": ["09:00", "13:00", "16:00"],
        "notes": "Include a clear CTA. Stories and value-driven posts perform best.",
    },
    "instagram": {
        "tone": "visual-first, aspirational, punchy",
        "max_chars": 2200,
        "hashtag_count": "8-15",
        "best_times_utc": ["08:00", "12:00", "19:00"],
        "notes": "Strong first line hook. Hashtags go at the very end.",
    },
    "linkedin": {
        "tone": "professional, insightful, authoritative",
        "max_chars": 3000,
        "hashtag_count": "3-5",
        "best_times_utc": ["08:00", "10:00", "17:00"],
        "notes": "Lead with insight. Use line breaks. Avoid fluff and exclamation marks.",
    },
    "tiktok": {
        "tone": "casual, trendy, energetic",
        "max_chars": 2200,
        "hashtag_count": "5-8",
        "best_times_utc": ["07:00", "15:00", "19:00"],
        "notes": "First sentence = hook. Short and punchy. Mirror how people talk.",
    },
}

_DEFAULT_SPEC = _PLATFORM_SPECS["instagram"]


@dataclass
class PreparedPost:
    text_body: str
    hashtags: str
    optimal_post_time: datetime
    platform: str


class SocialPublishingAgent:
    MODEL = "claude-haiku-4-5-20251001"

    def __init__(self):
        self._client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def prepare_post(self, content_item: ContentItem) -> PreparedPost:
        """Reformat approved content for optimal publishing on its target platform."""
        platform = content_item.platform.value
        spec = _PLATFORM_SPECS.get(platform, _DEFAULT_SPEC)

        prompt = (
            f"You are optimizing a social media post for {platform.upper()}.\n\n"
            f"Original post:\n{content_item.text_body}\n\n"
            f"Original hashtags: {content_item.hashtags or 'none'}\n\n"
            f"Platform requirements:\n"
            f"- Tone: {spec['tone']}\n"
            f"- Max characters: {spec['max_chars']}\n"
            f"- Hashtags to include: {spec['hashtag_count']}\n"
            f"- Platform tips: {spec['notes']}\n\n"
            "Lightly optimize this post for the platform. Preserve the core message. "
            "Only change what needs to change for platform fit.\n\n"
            "Return ONLY valid JSON with exactly two keys:\n"
            '{"text_body": "...", "hashtags": "..."}\n'
            "The hashtags value should be a single space-separated string of hashtags."
        )

        text = content_item.text_body
        hashtags = content_item.hashtags or ""

        try:
            resp = await self._client.messages.create(
                model=self.MODEL,
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            data = json.loads(raw)
            text = data.get("text_body", text)
            hashtags = data.get("hashtags", hashtags)
        except Exception as e:
            print(f"[SocialAgent] Format failed ({platform}): {e} — using original content")

        return PreparedPost(
            text_body=text,
            hashtags=hashtags,
            optimal_post_time=self._next_best_time(spec["best_times_utc"]),
            platform=platform,
        )

    def _next_best_time(self, best_times_utc: list[str]) -> datetime:
        now = datetime.utcnow()
        candidates = []
        for t in best_times_utc:
            h, m = map(int, t.split(":"))
            candidate = now.replace(hour=h, minute=m, second=0, microsecond=0)
            if candidate <= now:
                candidate += timedelta(days=1)
            candidates.append(candidate)
        return min(candidates)


social_publishing_agent = SocialPublishingAgent()
