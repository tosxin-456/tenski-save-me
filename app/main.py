from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging
import os

from app.config import get_settings
from app.database import engine, Base
from app.models import *  # noqa: F401 — import all models so Base.metadata is complete
from app.middleware.casing import CamelCaseResponseMiddleware
from app.routers import auth, statements, transactions, analytics, subscriptions, goals, assistant, accounts, demo

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure upload and model dirs exist
    os.makedirs(settings.upload_dir, exist_ok=True)
    os.makedirs(settings.model_dir, exist_ok=True)

    # Create tables if they don't exist (idempotent). Don't crash the whole
    # server if the DB is briefly unreachable at boot — endpoints that need
    # the DB will surface the error per-request instead.
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database tables ready")
    except Exception as e:
        logger.error(f"Could not initialize database at startup: {e}")

    yield
    await engine.dispose()


app = FastAPI(
    title="Kashe API",
    description="AI-Powered Personal Finance Intelligence Platform",
    version="1.0.0",
    lifespan=lifespan,
)

# Convert snake_case response bodies to camelCase for the TS frontend.
# (Added before CORS so CORS runs outermost on the response.)
app.add_middleware(CamelCaseResponseMiddleware)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global error handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": "Internal server error"},
    )


# Routers
app.include_router(auth.router, prefix="/api")
app.include_router(accounts.router, prefix="/api")
app.include_router(statements.router, prefix="/api")
app.include_router(transactions.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(subscriptions.router, prefix="/api")
app.include_router(goals.router, prefix="/api")
app.include_router(assistant.router, prefix="/api")
app.include_router(demo.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "kashe-api"}


@app.get("/")
async def root():
    return {"name": "Kashe API", "version": "1.0.0", "docs": "/docs"}
