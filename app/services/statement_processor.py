"""
Async statement processing pipeline:
upload → extract → classify → insert → detect_recurring → validate_balance
"""
from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.models.statement import Statement
from app.models.transaction import Transaction
from app.services.ml.classifier import classifier
from app.services.ml.recurring_detector import recurring_detector
from app.services.extraction.pdf_extractor import pdf_extractor
from app.services.extraction.csv_extractor import csv_extractor
from app.services.extraction.excel_extractor import excel_extractor
import uuid

logger = logging.getLogger(__name__)

MIME_EXTRACTOR_MAP = {
    "application/pdf": "pdf",
    "text/csv": "csv",
    "application/vnd.ms-excel": "excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
    "text/plain": "csv",
}


def _make_hash(date: str, amount: str, description: str, tx_type: str) -> str:
    raw = f"{date}|{amount}|{description[:50]}|{tx_type}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


async def _persist_subscriptions(db: AsyncSession, user_id: str, detected: list) -> None:
    """Upsert auto-detected subscriptions by name (avoids duplicates on re-upload)."""
    from app.models.subscription import Subscription

    existing = await db.execute(
        select(Subscription).where(Subscription.user_id == uuid.UUID(user_id))
    )
    by_name = {s.name.lower(): s for s in existing.scalars().all()}

    for d in detected:
        key = d.name.lower()
        if key in by_name:
            sub = by_name[key]
            sub.amount = d.amount
            sub.frequency = d.frequency
            sub.last_seen = d.last_seen
            sub.next_expected = d.next_expected
            sub.annual_cost = d.annual_cost
            sub.confidence = d.confidence
            sub.is_active = True
        else:
            db.add(Subscription(
                id=uuid.uuid4(),
                user_id=uuid.UUID(user_id),
                name=d.name,
                merchant=d.merchant,
                amount=d.amount,
                frequency=d.frequency,
                subcategory=d.subcategory,
                last_seen=d.last_seen,
                next_expected=d.next_expected,
                annual_cost=d.annual_cost,
                is_auto_detected=True,
                confidence=d.confidence,
            ))
    await db.commit()


async def process_statement(
    statement_id: str,
    file_path: str,
    mime_type: str,
    user_id: str,
    account_id: str | None,
) -> None:
    """Runs as a background task with its own DB session (the request's
    session is already closed by the time this executes)."""
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await _process_statement_inner(
            statement_id, file_path, mime_type, user_id, account_id, db
        )


async def _process_statement_inner(
    statement_id: str,
    file_path: str,
    mime_type: str,
    user_id: str,
    account_id: str | None,
    db: AsyncSession,
) -> None:
    try:
        await db.execute(
            update(Statement)
            .where(Statement.id == uuid.UUID(statement_id))
            .values(status="processing")
        )
        await db.commit()

        # 1. Extract
        extractor_type = MIME_EXTRACTOR_MAP.get(mime_type, "csv")
        if extractor_type == "pdf":
            result = pdf_extractor.extract(file_path)
        elif extractor_type == "excel":
            result = excel_extractor.extract(file_path)
        else:
            result = csv_extractor.extract(file_path)

        if not result.transactions:
            await db.execute(
                update(Statement)
                .where(Statement.id == uuid.UUID(statement_id))
                .values(status="failed", error_message="No transactions could be extracted")
            )
            await db.commit()
            return

        # 2. Classify + build Transaction objects
        tx_objects: list[Transaction] = []
        seen_hashes: set[str] = set()

        # Check existing hashes for this user to prevent duplicates
        existing = await db.execute(
            select(Transaction.hash).where(Transaction.user_id == uuid.UUID(user_id))
        )
        db_hashes = {row[0] for row in existing.fetchall() if row[0]}

        for tx in result.transactions:
            clf = classifier.classify(tx.description, tx.amount)
            merchant = clf.merchant or classifier.extract_merchant(tx.description)

            tx_hash = _make_hash(str(tx.date), str(tx.amount), tx.description, tx.type)
            is_duplicate = tx_hash in db_hashes or tx_hash in seen_hashes
            seen_hashes.add(tx_hash)

            is_bank_charge = clf.subcategory in ("Bank Charges",)
            is_subscription = clf.category == "Subscriptions"

            obj = Transaction(
                id=uuid.uuid4(),
                user_id=uuid.UUID(user_id),
                account_id=uuid.UUID(account_id) if account_id else None,
                statement_id=uuid.UUID(statement_id),
                raw_description=tx.description,
                raw_date=tx.raw_date,
                raw_amount=tx.raw_amount,
                raw_balance=tx.raw_balance,
                description=tx.description,
                date=tx.date,
                amount=tx.amount,
                balance=tx.balance,
                currency="NGN",
                type=tx.type,
                category=clf.category if clf.category != "Unknown" else None,
                subcategory=clf.subcategory or None,
                merchant=merchant,
                confidence=clf.confidence,
                classified_by=clf.classified_by,
                is_recurring=False,
                is_subscription=is_subscription,
                is_bank_charge=is_bank_charge,
                is_duplicate=is_duplicate,
                hash=tx_hash,
            )
            tx_objects.append(obj)

        # 3. Batch insert
        BATCH = 100
        for i in range(0, len(tx_objects), BATCH):
            db.add_all(tx_objects[i:i + BATCH])
            await db.commit()

        # 4. Detect recurring subscriptions
        tx_dicts = [
            {
                "type": t.type,
                "amount": t.amount,
                "date": t.date,
                "description": t.description,
                "merchant": t.merchant,
                "category": t.category,
            }
            for t in tx_objects if not t.is_duplicate
        ]
        detected = recurring_detector.detect(tx_dicts)
        await _persist_subscriptions(db, user_id, detected)

        # 5. Update statement
        non_dup = [t for t in tx_objects if not t.is_duplicate]
        updates: dict = {
            "status": "completed",
            "transaction_count": len(non_dup),
        }
        if result.bank_name:
            updates["bank_name"] = result.bank_name
        if result.period_from:
            updates["period_from"] = result.period_from
        if result.period_to:
            updates["period_to"] = result.period_to
        if result.opening_balance:
            updates["opening_balance"] = result.opening_balance
        if result.closing_balance:
            updates["closing_balance"] = result.closing_balance

        await db.execute(
            update(Statement)
            .where(Statement.id == uuid.UUID(statement_id))
            .values(**updates)
        )
        await db.commit()

        logger.info(f"Statement {statement_id}: {len(non_dup)} transactions processed ({len(tx_objects) - len(non_dup)} duplicates skipped)")

    except Exception as e:
        logger.error(f"Statement processing failed for {statement_id}: {e}", exc_info=True)
        try:
            await db.rollback()
            await db.execute(
                update(Statement)
                .where(Statement.id == uuid.UUID(statement_id))
                .values(status="failed", error_message=str(e)[:500])
            )
            await db.commit()
        except Exception:
            pass
