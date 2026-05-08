# OMMA — Quick Start Guide

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Docker Desktop | Latest | https://docs.docker.com/desktop/install/windows/ |
| Python | 3.11+ | https://python.org |
| Git | Any | Already installed |

---

## Step 1 — Configure environment

```powershell
cd "C:\Users\Adven\OneDrive\Documents\Claude\OMMA"
Copy-Item .env.example .env
```

Open `.env` and set your Anthropic API key:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Generate a secret key and paste it into `SECRET_KEY=` in `.env`:
```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## Step 2 — Start database and Redis

```powershell
docker-compose up -d
```

Wait ~10 seconds for containers to become healthy:
```powershell
docker-compose ps
# postgres and redis should both show "healthy"
```

---

## Step 3 — Install Python dependencies

```powershell
cd api
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

`sentence-transformers` will download the embedding model (~90 MB) on first install.

---

## Step 4 — Start the API server

```powershell
# From the api/ directory with venv activated:
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

| URL | Purpose |
|---|---|
| http://localhost:8000/api/health | Health check |
| http://localhost:8000/docs | Interactive Swagger UI |
| http://localhost:8000/redoc | ReDoc API reference |

The database tables are created automatically on first startup.

---

## Step 5 — Start Celery worker (separate terminal)

```powershell
cd "C:\Users\Adven\OneDrive\Documents\Claude\OMMA\api"
.\venv\Scripts\Activate.ps1
celery -A tasks.celery_app:celery_app worker --loglevel=info
```

---

## Step 6 — Create your first admin user

In Swagger at http://localhost:8000/docs:

**POST** `/api/auth/register`
```json
{
  "email": "admin@opulanz.com",
  "name": "Opulanz Admin",
  "password": "your-strong-password",
  "role": "super_admin"
}
```

**POST** `/api/auth/login` → copy the `access_token`

Click **Authorize** (top-right in Swagger) → paste the token → click Authorize.

---

## Step 7 — Create the Opulanz brand

**POST** `/api/brands/`
```json
{
  "name": "Opulanz",
  "tagline": "Your tagline here",
  "tone_of_voice": "Professional yet approachable. Confident. Clear. Never pushy."
}
```

Note the `id` returned (e.g. `1`). Then add:

**POST** `/api/brands/1/products`
```json
{
  "name": "Product Name",
  "description": "What it does and why it matters",
  "price": 99.00,
  "url": "https://opulanz.com/product",
  "category": "category-name"
}
```

**POST** `/api/brands/1/audiences`
```json
{
  "persona_name": "Decision Maker Dana",
  "demographics": {"age": "30-50", "location": "UK, US, AU"},
  "pain_points": "Needs reliable, professional solutions. Time-poor."
}
```

**POST** `/api/brands/1/guidelines/text`
```json
{
  "text": "Paste your full brand guidelines document text here...",
  "version": 1
}
```

**POST** `/api/brands/1/prohibited`
```json
{
  "content_type": "phrase",
  "content_value": "cheap",
  "reason": "Conflicts with premium brand positioning"
}
```

---

## Step 8 — Generate your first AI content

**POST** `/api/content/generate`
```json
{
  "brand_id": 1,
  "platform": "instagram",
  "goal": "Drive awareness of our flagship product launch",
  "additional_context": "Launch is this Friday. Limited early-bird pricing available.",
  "num_variants": 3
}
```

The agent generates 3 variants, runs compliance checks, and queues them for review.

**GET** `/api/content/queue?brand_id=1` — view pending approval items

**POST** `/api/content/{id}/approve` — approve a variant

**POST** `/api/content/{id}/publish` — dispatch to platform (Celery runs it)

---

## Project structure

```
OMMA/
├── docker-compose.yml          PostgreSQL (pgvector) + Redis
├── .env                        Your config (never commit to git)
├── .env.example                Config template
├── scripts/init.sql            Enables pgvector extension on first DB start
└── api/
    ├── main.py                 FastAPI app entry point
    ├── config.py               Settings loaded from .env
    ├── database.py             Async SQLAlchemy engine + session + init
    ├── requirements.txt
    ├── alembic.ini             Migration config
    ├── alembic/env.py          Async migration runner
    ├── models/
    │   ├── user.py             User, UserRole enum
    │   ├── brand.py            Brand, BrandGuideline, Product, Audience, Prohibited
    │   └── content.py          ContentItem, ApprovalQueue, AuditLog
    ├── routers/
    │   ├── auth.py             JWT auth — register, login, /me
    │   ├── brands.py           Brand CRUD + RAG guideline ingestion
    │   └── content.py          Generation, approval queue, publish
    ├── services/
    │   └── rag_service.py      Embedding + pgvector retrieval (brand memory)
    ├── agents/
    │   ├── brand_context.py    Claude content generator with RAG context
    │   └── compliance_agent.py Content safety + brand-voice checker
    └── tasks/
        └── celery_app.py       Background jobs: publish, metrics fetch, expiry
```

---

## What is built vs. what comes next

| Module | Status |
|---|---|
| JWT auth (register / login / roles) | Done |
| Brand management + RAG ingestion | Done |
| AI content generation (Claude + pgvector) | Done |
| Compliance + safety gate | Done |
| Approval queue (approve / reject / revise) | Done |
| Background publishing (Celery) | Done (stub — add real API calls) |
| Facebook / Instagram posting (Meta Graph API) | Phase 3 |
| Facebook Ads campaign manager | Phase 3 |
| Google Ads manager | Phase 4 |
| TikTok channel + ads | Phase 5 |
| Affiliate management module | Phase 6 |
| Analytics hub + unified dashboard | Phase 7 |
| Next.js frontend dashboard | Phase 7 |
