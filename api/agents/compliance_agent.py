"""
Compliance Agent — safety and brand-voice gate.

Every piece of AI-generated content passes through this agent before
entering the approval queue. It checks for:
  1. Prohibited words / phrases / claims (database rules)
  2. Platform policy red flags (superlatives, misleading claims)
  3. PII patterns (email, phone, SSN)
  4. Brand voice alignment (Claude-scored)
"""

import re
from dataclasses import dataclass, field

import anthropic
import openai
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models.brand import ProhibitedContent
from ..models.content import Platform

# Regex patterns for quick pre-LLM checks
_PII_PATTERNS = [
    re.compile(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', re.IGNORECASE),  # email
    re.compile(r'\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b'),                           # phone
    re.compile(r'\b\d{3}-\d{2}-\d{4}\b'),                                         # SSN
]

_SUPERLATIVES = re.compile(
    r'\b(best|#1|number one|guaranteed|100%|proven|certified|risk-free|unlimited)\b',
    re.IGNORECASE,
)


@dataclass
class ComplianceIssue:
    rule: str
    detail: str
    severity: str  # "block" | "warn"


@dataclass
class ComplianceResult:
    passed: bool
    issues: list[ComplianceIssue] = field(default_factory=list)
    brand_voice_score: float = 1.0  # 0.0 – 1.0
    overall_score: float = 1.0


class ComplianceAgent:
    MODEL = "claude-haiku-4-5-20251001"  # fast + cheap for bulk safety checks

    FALLBACK_MODEL = "gpt-4o-mini"  # cheap for single-score compliance checks

    def __init__(self):
        self._anthropic = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        self._openai = openai.AsyncOpenAI(api_key=settings.openai_api_key)

    async def check(
        self,
        db: AsyncSession,
        brand_id: int,
        platform: Platform,
        text: str,
        tone_of_voice: str = "",
    ) -> ComplianceResult:
        issues: list[ComplianceIssue] = []

        # 1. Prohibited content (database rules)
        issues.extend(await self._check_prohibited(db, brand_id, text))

        # 2. PII check (regex)
        issues.extend(self._check_pii(text))

        # 3. Superlatives / regulated claims
        issues.extend(self._check_superlatives(text))

        # 4. Platform character limits
        issues.extend(self._check_length(platform, text))

        # Block immediately if any hard violations found
        blocking = [i for i in issues if i.severity == "block"]
        if blocking:
            return ComplianceResult(
                passed=False,
                issues=issues,
                brand_voice_score=0.0,
                overall_score=0.0,
            )

        # 5. Brand voice score (LLM-based, only runs if basics pass)
        voice_score = await self._score_brand_voice(text, tone_of_voice)

        overall = voice_score - (len(issues) * 0.05)  # each warning docks 5%
        overall = max(0.0, round(overall, 2))

        return ComplianceResult(
            passed=overall >= settings.compliance_threshold,
            issues=issues,
            brand_voice_score=voice_score,
            overall_score=overall,
        )

    # ─── Check methods ────────────────────────────────────────────────────────

    async def _check_prohibited(
        self, db: AsyncSession, brand_id: int, text: str
    ) -> list[ComplianceIssue]:
        result = await db.execute(
            select(ProhibitedContent).where(ProhibitedContent.brand_id == brand_id)
        )
        prohibited = result.scalars().all()
        issues = []
        text_lower = text.lower()
        for item in prohibited:
            if item.content_value.lower() in text_lower:
                issues.append(ComplianceIssue(
                    rule="prohibited_content",
                    detail=f"Contains prohibited {item.content_type}: '{item.content_value}'",
                    severity="block",
                ))
        return issues

    def _check_pii(self, text: str) -> list[ComplianceIssue]:
        issues = []
        for pattern in _PII_PATTERNS:
            if pattern.search(text):
                issues.append(ComplianceIssue(
                    rule="pii_detected",
                    detail="Content appears to contain personal information (email, phone, or ID).",
                    severity="block",
                ))
                break
        return issues

    def _check_superlatives(self, text: str) -> list[ComplianceIssue]:
        found = _SUPERLATIVES.findall(text)
        if found:
            return [ComplianceIssue(
                rule="regulated_claim",
                detail=f"Contains superlative/regulated claim: {', '.join(set(found))}. Needs human review.",
                severity="warn",
            )]
        return []

    def _check_length(self, platform: Platform, text: str) -> list[ComplianceIssue]:
        limits = {
            Platform.instagram: 2200,
            Platform.facebook: 63206,
            Platform.tiktok: 2200,
            Platform.facebook_ads: 125,
            Platform.google_ads: 90,
        }
        limit = limits.get(platform)
        if limit and len(text) > limit:
            return [ComplianceIssue(
                rule="character_limit",
                detail=f"Content exceeds {platform.value} limit ({len(text)}/{limit} chars).",
                severity="warn",
            )]
        return []

    async def _score_brand_voice(self, text: str, tone_of_voice: str) -> float:
        """Ask Claude Haiku to score how well the text matches the brand voice."""
        if not tone_of_voice:
            return 0.85  # no tone defined — give benefit of the doubt

        prompt = (
            f"Brand tone of voice: {tone_of_voice}\n\n"
            f"Marketing text to evaluate:\n{text}\n\n"
            "Score how well this text matches the brand tone of voice on a scale from 0.0 to 1.0. "
            "Return ONLY a number between 0.0 and 1.0. Nothing else."
        )
        try:
            response = await self._anthropic.messages.create(
                model=self.MODEL,
                max_tokens=10,
                messages=[{"role": "user", "content": prompt}],
            )
            score_str = response.content[0].text.strip()
        except Exception:
            try:
                response = await self._openai.chat.completions.create(
                    model=self.FALLBACK_MODEL,
                    max_tokens=10,
                    messages=[{"role": "user", "content": prompt}],
                )
                score_str = (response.choices[0].message.content or "").strip()
            except Exception:
                return 0.75  # both providers failed
        try:
            return max(0.0, min(1.0, float(score_str)))
        except ValueError:
            return 0.75


compliance_agent = ComplianceAgent()
