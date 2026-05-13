"""
Brand Context Agent — core content generation module.

Takes a generation request, builds a brand-aware prompt using RAG context,
calls Claude, and returns structured content variants ready for the approval queue.
"""

import json
import re
from dataclasses import dataclass, field

import anthropic
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models.content import Platform
from ..services.rag_service import rag_service

PLATFORM_SPECS = {
    Platform.facebook: {
        "max_chars": 63206,
        "recommended_chars": 400,
        "supports_hashtags": True,
        "notes": "Conversational tone. Stories and value perform well. Include a clear CTA.",
    },
    Platform.instagram: {
        "max_chars": 2200,
        "recommended_chars": 150,
        "supports_hashtags": True,
        "notes": "Visual-first. Hook in first line. Hashtags go at end (5-10 max).",
    },
    Platform.tiktok: {
        "max_chars": 2200,
        "recommended_chars": 150,
        "supports_hashtags": True,
        "notes": "Trend-aware. First 3 seconds = the hook. Casual, authentic, direct.",
    },
    Platform.facebook_ads: {
        "max_chars": 125,
        "recommended_chars": 90,
        "supports_hashtags": False,
        "notes": (
            "Ad copy: Primary text (125 chars), Headline (40 chars), Description (30 chars). "
            "Lead with benefit. CTA must be specific."
        ),
    },
    Platform.google_ads: {
        "max_chars": 30,  # per headline
        "recommended_chars": 30,
        "supports_hashtags": False,
        "notes": (
            "Responsive Search Ads: 15 headlines (30 chars each), 4 descriptions (90 chars each). "
            "Include keywords. Match search intent."
        ),
    },
}


@dataclass
class ContentVariant:
    text_body: str
    hashtags: str = ""
    image_prompt: str = ""
    variant_label: str = ""  # e.g. "short", "medium", "long"


@dataclass
class GenerationResult:
    variants: list[ContentVariant] = field(default_factory=list)
    ai_confidence_score: float = 0.0
    ai_model_used: str = ""
    generation_metadata: dict = field(default_factory=dict)
    error: str | None = None


class BrandContextAgent:
    MODEL = "claude-sonnet-4-6"

    def __init__(self):
        self._client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def generate_social_post(
        self,
        db: AsyncSession,
        brand_id: int,
        platform: Platform,
        goal: str,
        additional_context: str = "",
        num_variants: int = 3,
    ) -> GenerationResult:
        """
        Generate brand-aligned social media post variants for the given platform.
        Returns structured variants ready for the compliance check and approval queue.
        """
        spec = PLATFORM_SPECS.get(platform, {})
        brand_ctx = await rag_service.build_brand_context(db, brand_id, query=goal)

        system_prompt = self._build_system_prompt(platform, spec, brand_ctx)
        user_prompt = self._build_user_prompt(
            platform, spec, goal, additional_context, num_variants
        )

        try:
            response = await self._client.messages.create(
                model=self.MODEL,
                max_tokens=2048,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            raw_text = response.content[0].text
            variants = self._parse_variants(raw_text, platform)

            return GenerationResult(
                variants=variants,
                ai_confidence_score=self._estimate_confidence(variants, spec),
                ai_model_used=self.MODEL,
                generation_metadata={
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                    "platform": platform.value,
                    "goal": goal,
                },
            )
        except Exception as e:
            return GenerationResult(error=str(e))

    async def generate_ad_copy(
        self,
        db: AsyncSession,
        brand_id: int,
        platform: Platform,
        product_name: str,
        objective: str,
        target_audience: str = "",
    ) -> GenerationResult:
        """
        Generate ad copy for Facebook Ads or Google Ads.
        Returns structured headline/description variants.
        """
        spec = PLATFORM_SPECS.get(platform, PLATFORM_SPECS[Platform.facebook_ads])
        brand_ctx = await rag_service.build_brand_context(
            db, brand_id, query=f"{product_name} {objective}"
        )

        system_prompt = self._build_system_prompt(platform, spec, brand_ctx)
        user_prompt = (
            f"Create ad copy for: {product_name}\n"
            f"Campaign objective: {objective}\n"
            f"Target audience: {target_audience or 'general target audience'}\n\n"
            f"Platform: {platform.value}\n"
            f"Platform notes: {spec.get('notes', '')}\n\n"
            "Produce 3 complete ad copy variants. For each variant return JSON:\n"
            '{"variant": "A", "primary_text": "...", "headline": "...", '
            '"description": "...", "cta": "...", "image_prompt": "..."}\n\n'
            "Wrap all variants in a JSON array."
        )

        try:
            response = await self._client.messages.create(
                model=self.MODEL,
                max_tokens=2048,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            raw = response.content[0].text
            variants = self._parse_ad_variants(raw)

            return GenerationResult(
                variants=variants,
                ai_confidence_score=0.85,
                ai_model_used=self.MODEL,
                generation_metadata={
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                    "platform": platform.value,
                    "product": product_name,
                },
            )
        except Exception as e:
            return GenerationResult(error=str(e))

    # ─── Prompt builders ─────────────────────────────────────────────────────

    def _build_system_prompt(self, platform: Platform, spec: dict, brand_ctx: str) -> str:
        return (
            "You are OMMA, the Opulanz Marketing Manager AI Agent. "
            "Your job is to generate high-quality, brand-aligned marketing content.\n\n"
            "STRICT RULES:\n"
            "1. Never include any content listed under PROHIBITED CONTENT in the brand context.\n"
            "2. Always match the brand's tone of voice exactly.\n"
            "3. Always stay within the platform character limits.\n"
            "4. Never make unsubstantiated superlative claims (best, #1, guaranteed).\n"
            "5. Never include personal data or private information.\n\n"
            f"{brand_ctx}"
        )

    def _build_user_prompt(
        self,
        platform: Platform,
        spec: dict,
        goal: str,
        additional_context: str,
        num_variants: int,
    ) -> str:
        hashtag_note = (
            "Include a hashtag block at the end (5-10 hashtags)."
            if spec.get("supports_hashtags")
            else "Do NOT include hashtags."
        )
        return (
            f"Platform: {platform.value.replace('_', ' ').title()}\n"
            f"Campaign goal: {goal}\n"
            f"Additional context: {additional_context or 'None'}\n"
            f"Recommended length: {spec.get('recommended_chars', 150)} characters\n"
            f"Platform notes: {spec.get('notes', '')}\n"
            f"{hashtag_note}\n\n"
            f"Generate {num_variants} distinct post variants. "
            "Label them SHORT, MEDIUM, LONG (adjust length accordingly).\n\n"
            "For each variant use this exact format:\n"
            "---VARIANT [SHORT|MEDIUM|LONG]---\n"
            "[post text here]\n"
            "HASHTAGS: [hashtags here or NONE]\n"
            "IMAGE_PROMPT: [DALL-E prompt for a matching image]\n"
            "---END VARIANT---\n"
        )

    # ─── Response parsers ────────────────────────────────────────────────────

    def _parse_variants(self, raw: str, platform: Platform) -> list[ContentVariant]:
        variants = []
        pattern = re.compile(
            r"---VARIANT\s+(SHORT|MEDIUM|LONG)---(.*?)---END VARIANT---",
            re.DOTALL | re.IGNORECASE,
        )
        for match in pattern.finditer(raw):
            label = match.group(1).strip()
            block = match.group(2).strip()

            hashtags = ""
            image_prompt = ""

            ht_match = re.search(r"HASHTAGS:\s*(.+?)(?:IMAGE_PROMPT:|$)", block, re.DOTALL)
            img_match = re.search(r"IMAGE_PROMPT:\s*(.+?)$", block, re.DOTALL)

            if ht_match:
                hashtags = ht_match.group(1).strip()
                if hashtags.upper() == "NONE":
                    hashtags = ""
            if img_match:
                image_prompt = img_match.group(1).strip()

            # Main body = everything before HASHTAGS:
            text_body = re.split(r"\nHASHTAGS:", block, flags=re.IGNORECASE)[0].strip()

            variants.append(ContentVariant(
                text_body=text_body,
                hashtags=hashtags,
                image_prompt=image_prompt,
                variant_label=label,
            ))
        return variants

    def _parse_ad_variants(self, raw: str) -> list[ContentVariant]:
        variants = []
        json_match = re.search(r"\[.*\]", raw, re.DOTALL)
        if not json_match:
            return variants
        try:
            items = json.loads(json_match.group())
            for item in items:
                body = (
                    f"Primary: {item.get('primary_text', '')}\n"
                    f"Headline: {item.get('headline', '')}\n"
                    f"Description: {item.get('description', '')}\n"
                    f"CTA: {item.get('cta', '')}"
                )
                variants.append(ContentVariant(
                    text_body=body,
                    image_prompt=item.get("image_prompt", ""),
                    variant_label=item.get("variant", ""),
                ))
        except json.JSONDecodeError:
            pass
        return variants

    def _estimate_confidence(self, variants: list[ContentVariant], spec: dict) -> float:
        if not variants:
            return 0.0
        rec = spec.get("recommended_chars", 150)
        scores = []
        for v in variants:
            length_score = min(len(v.text_body) / rec, 1.5)
            length_score = 1.0 - abs(length_score - 1.0) * 0.4
            scores.append(max(0.5, min(1.0, length_score)))
        return round(sum(scores) / len(scores), 2)


brand_context_agent = BrandContextAgent()
