from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .routers import auth, brands, content, social, analytics


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
app.include_router(social.router,     prefix="/api/social",     tags=["Social Media OAuth"])
app.include_router(analytics.router,  prefix="/api/analytics",  tags=["Analytics"])


@app.get("/api/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "version": "0.1.0",
        "agent": "OMMA — Opulanz Marketing Manager Agent",
    }


from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
import logging

logger = logging.getLogger("omma")

@app.exception_handler(SQLAlchemyError)
async def database_exception_handler(request: Request, exc: SQLAlchemyError):
    logger.error(f"Database error on {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=503,
        content={"detail": "Database service is temporarily unavailable. Please try again."},
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Global exception handled for {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred. Please try again later."},
    )

