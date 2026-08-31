import os
import uuid
import hashlib
import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.database import get_db
from app.models.user import User
from app.models.statement import Statement, UploadedFile
from app.middleware.auth import get_current_user
from app.services.statement_processor import process_statement
from app.config import get_settings

router = APIRouter(prefix="/statements", tags=["statements"])
logger = logging.getLogger(__name__)
settings = get_settings()

ALLOWED_MIME = {
    "application/pdf", "text/csv", "text/plain",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/jpeg", "image/png",
}
MAX_BYTES = settings.max_upload_mb * 1024 * 1024


@router.get("", response_model=dict)
async def list_statements(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Statement)
        .where(Statement.user_id == current_user.id)
        .order_by(Statement.created_at.desc())
    )
    stmts = result.scalars().all()
    return {
        "success": True,
        "data": [
            {
                "id": str(s.id),
                "bank_name": s.bank_name,
                "status": s.status,
                "transaction_count": s.transaction_count,
                "period_from": str(s.period_from) if s.period_from else None,
                "period_to": str(s.period_to) if s.period_to else None,
                "created_at": s.created_at.isoformat(),
                "error_message": s.error_message,
            }
            for s in stmts
        ],
    }


@router.post("/upload", response_model=dict)
async def upload_statement(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    account_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"File type {file.content_type} not supported")

    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {settings.max_upload_mb}MB)")

    checksum = hashlib.sha256(content).hexdigest()

    # Save file
    upload_dir = Path(settings.upload_dir) / str(current_user.id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4()}_{file.filename}"
    file_path = upload_dir / stored_name
    file_path.write_bytes(content)

    # Create DB records
    uploaded = UploadedFile(
        id=uuid.uuid4(),
        user_id=current_user.id,
        original_name=file.filename or "upload",
        stored_name=stored_name,
        mime_type=file.content_type,
        size_bytes=len(content),
        checksum=checksum,
    )
    db.add(uploaded)

    statement = Statement(
        id=uuid.uuid4(),
        user_id=current_user.id,
        account_id=uuid.UUID(account_id) if account_id else None,
        file_id=uploaded.id,
        status="uploaded",
    )
    db.add(statement)
    await db.commit()

    # Process in background
    statement_id = str(statement.id)
    background_tasks.add_task(
        process_statement,
        statement_id=statement_id,
        file_path=str(file_path),
        mime_type=file.content_type,
        user_id=str(current_user.id),
        account_id=account_id,
    )

    return {"success": True, "data": {"id": statement_id, "status": "processing"}}


@router.get("/{statement_id}", response_model=dict)
async def get_statement(
    statement_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Statement).where(
            Statement.id == uuid.UUID(statement_id),
            Statement.user_id == current_user.id,
        )
    )
    stmt = result.scalar_one_or_none()
    if not stmt:
        raise HTTPException(status_code=404, detail="Statement not found")

    return {
        "success": True,
        "data": {
            "id": str(stmt.id),
            "status": stmt.status,
            "bank_name": stmt.bank_name,
            "transaction_count": stmt.transaction_count,
            "period_from": str(stmt.period_from) if stmt.period_from else None,
            "period_to": str(stmt.period_to) if stmt.period_to else None,
            "opening_balance": float(stmt.opening_balance) if stmt.opening_balance else None,
            "closing_balance": float(stmt.closing_balance) if stmt.closing_balance else None,
            "error_message": stmt.error_message,
            "created_at": stmt.created_at.isoformat(),
        },
    }


@router.delete("/{statement_id}", response_model=dict)
async def delete_statement(
    statement_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Statement).where(
            Statement.id == uuid.UUID(statement_id),
            Statement.user_id == current_user.id,
        )
    )
    stmt = result.scalar_one_or_none()
    if not stmt:
        raise HTTPException(status_code=404, detail="Statement not found")

    await db.delete(stmt)
    await db.commit()
    return {"success": True}
