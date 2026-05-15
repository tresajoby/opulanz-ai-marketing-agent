from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .routers import auth, brands, content


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Pre-load embedding model so first request is fast
    from .services.rag_service import rag_service
    await rag_service.load_model()
    yield


app = FastAPI(
    title="OMMA — Opulanz Marketing Manager Agent",
    description=(
        "AI-powered multi-channel marketing automation for Opulanz. "
        "Generates content, manages ad campaigns, and coordinates approvals "
        "across Facebook, Instagram, Google Ads, TikTok, and affiliate channels."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "https://*.azurestaticapps.net",
        "https://*.azurewebsites.net",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,    prefix="/api/auth",    tags=["Authentication"])
app.include_router(brands.router,  prefix="/api/brands",  tags=["Brand Management"])
app.include_router(content.router, prefix="/api/content", tags=["Content & Approvals"])


@app.get("/api/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "version": "0.1.0",
        "agent": "OMMA — Opulanz Marketing Manager Agent",
    }
