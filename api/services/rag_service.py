"""
RAG (Retrieval-Augmented Generation) service.

Responsibilities:
- Chunk and embed brand guideline text using sentence-transformers (runs locally, no API key).
- Store embeddings in pgvector (PostgreSQL).
- Retrieve the most relevant chunks for a given query to inject as context into LLM prompts.
"""

import io
import re
from typing import Sequence

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models.brand import BrandGuideline, Product, TargetAudience, ProhibitedContent, Brand

# sentence-transformers is imported lazily so the app starts fast even without GPU
_model = None


class RAGService:
    CHUNK_SIZE = 400   # characters per chunk
    CHUNK_OVERLAP = 80 # overlap to preserve context across chunk boundaries

    async def load_model(self):
        global _model
        if _model is None:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer(settings.embedding_model)

    def _embed(self, texts: list[str]) -> list[list[float]]:
        if _model is None:
            raise RuntimeError("Embedding model not loaded. Call load_model() first.")
        return _model.encode(texts, normalize_embeddings=True).tolist()

    # ─── Chunking ────────────────────────────────────────────────────────────

    def _chunk_text(self, text: str) -> list[str]:
        """Split text into overlapping fixed-size character chunks."""
        text = re.sub(r'\s+', ' ', text).strip()
        chunks: list[str] = []
        start = 0
        while start < len(text):
            end = start + self.CHUNK_SIZE
            chunks.append(text[start:end])
            start += self.CHUNK_SIZE - self.CHUNK_OVERLAP
        return [c for c in chunks if len(c.strip()) > 20]

    # ─── Ingestion ───────────────────────────────────────────────────────────

    async def ingest_text(
        self,
        db: AsyncSession,
        brand_id: int,
        raw_text: str,
        version: int = 1,
    ) -> int:
        await self.load_model()
        chunks = self._chunk_text(raw_text)
        vectors = self._embed(chunks)

        records = [
            BrandGuideline(
                brand_id=brand_id,
                version=version,
                chunk_index=i,
                content_text=chunk,
                content_vector=vec,
            )
            for i, (chunk, vec) in enumerate(zip(chunks, vectors))
        ]
        db.add_all(records)
        await db.commit()
        return len(records)

    async def ingest_pdf(self, db: AsyncSession, brand_id: int, pdf_bytes: bytes) -> int:
        import PyPDF2
        reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
        full_text = " ".join(page.extract_text() or "" for page in reader.pages)
        return await self.ingest_text(db, brand_id, full_text)

    # ─── Retrieval ───────────────────────────────────────────────────────────

    async def retrieve_context(
        self,
        db: AsyncSession,
        brand_id: int,
        query: str,
        top_k: int | None = None,
    ) -> str:
        """
        Return the top-k most semantically relevant guideline chunks as a single string,
        ready to be injected into an LLM prompt.
        """
        await self.load_model()
        k = top_k or settings.rag_top_k
        query_vec = self._embed([query])[0]

        # pgvector cosine distance operator: <=>
        result = await db.execute(
            text(
                """
                SELECT content_text
                FROM brand_guidelines
                WHERE brand_id = :brand_id
                ORDER BY content_vector <=> CAST(:vec AS vector)
                LIMIT :k
                """
            ),
            {"brand_id": brand_id, "vec": str(query_vec), "k": k},
        )
        rows = result.fetchall()
        if not rows:
            return ""
        return "\n\n".join(row[0] for row in rows)

    # ─── Brand summary builder (injected into every generation prompt) ────────

    async def build_brand_context(self, db: AsyncSession, brand_id: int, query: str) -> str:
        """
        Assembles a structured brand context block for LLM prompts:
          - Brand name, tagline, tone of voice
          - Active products summary
          - Target audience personas
          - Prohibited content rules
          - Top-k relevant guideline chunks via vector search
        """
        brand_res = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand = brand_res.scalar_one_or_none()
        if not brand:
            return ""

        products_res = await db.execute(
            select(Product).where(Product.brand_id == brand_id, Product.is_active == True)
        )
        products: Sequence[Product] = products_res.scalars().all()

        audiences_res = await db.execute(
            select(TargetAudience).where(TargetAudience.brand_id == brand_id)
        )
        audiences: Sequence[TargetAudience] = audiences_res.scalars().all()

        prohibited_res = await db.execute(
            select(ProhibitedContent).where(ProhibitedContent.brand_id == brand_id)
        )
        prohibited: Sequence[ProhibitedContent] = prohibited_res.scalars().all()

        guideline_chunks = await self.retrieve_context(db, brand_id, query)

        lines = [
            "=== BRAND CONTEXT ===",
            f"Brand: {brand.name}",
        ]
        if brand.tagline:
            lines.append(f"Tagline: {brand.tagline}")
        if brand.tone_of_voice:
            lines.append(f"Tone of voice: {brand.tone_of_voice}")

        if products:
            lines.append("\n--- PRODUCTS ---")
            for p in products:
                desc = f"  • {p.name}"
                if p.price:
                    desc += f" (${p.price:.2f})"
                if p.description:
                    desc += f" — {p.description[:120]}"
                lines.append(desc)

        if audiences:
            lines.append("\n--- TARGET AUDIENCES ---")
            for a in audiences:
                lines.append(f"  • {a.persona_name}")
                if a.pain_points:
                    lines.append(f"    Pain points: {a.pain_points[:200]}")

        if prohibited:
            lines.append("\n--- PROHIBITED CONTENT (never use these) ---")
            for item in prohibited:
                lines.append(f"  ✗ [{item.content_type}] {item.content_value}")

        if guideline_chunks:
            lines.append("\n--- RELEVANT BRAND GUIDELINES ---")
            lines.append(guideline_chunks)

        lines.append("=== END BRAND CONTEXT ===")
        return "\n".join(lines)


rag_service = RAGService()
