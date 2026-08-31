import uuid
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import load_only

from app.database import get_db
from app.models.user import User
from app.models.transaction import Transaction
from app.middleware.auth import get_current_user
from app.services.ml.classifier import classifier, CATEGORIES

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _tx_dict(t: Transaction) -> dict:
    return {
        "id": str(t.id),
        "date": str(t.date),
        "description": t.description,
        "amount": float(t.amount),
        "balance": float(t.balance) if t.balance else None,
        "type": t.type,
        "category": t.category,
        "subcategory": t.subcategory,
        "merchant": t.merchant,
        "confidence": float(t.confidence) if t.confidence else None,
        "classified_by": t.classified_by,
        "is_recurring": t.is_recurring,
        "is_subscription": t.is_subscription,
        "is_bank_charge": t.is_bank_charge,
        "is_duplicate": t.is_duplicate,
        "user_verified": t.user_verified,
        "statement_id": str(t.statement_id) if t.statement_id else None,
    }


@router.get("", response_model=dict)
async def list_transactions(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = None,
    type: str | None = None,
    category: str | None = None,
    statement_id: str | None = None,
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conditions = [
        Transaction.user_id == current_user.id,
        Transaction.is_duplicate == False,
    ]

    if search:
        conditions.append(
            or_(
                Transaction.description.ilike(f"%{search}%"),
                Transaction.merchant.ilike(f"%{search}%"),
            )
        )
    if type:
        conditions.append(Transaction.type == type)
    if category:
        conditions.append(Transaction.category == category)
    if statement_id:
        conditions.append(Transaction.statement_id == uuid.UUID(statement_id))
    if from_date:
        from datetime import date
        conditions.append(Transaction.date >= date.fromisoformat(from_date))
    if to_date:
        from datetime import date
        conditions.append(Transaction.date <= date.fromisoformat(to_date))

    total_q = await db.execute(
        select(func.count()).select_from(Transaction).where(and_(*conditions))
    )
    total = total_q.scalar_one()

    q = await db.execute(
        select(Transaction)
        .where(and_(*conditions))
        .order_by(Transaction.date.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    txs = q.scalars().all()

    return {
        "success": True,
        "data": [_tx_dict(t) for t in txs],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit,
        },
    }


@router.patch("/{transaction_id}", response_model=dict)
async def update_transaction(
    transaction_id: str,
    body: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == uuid.UUID(transaction_id),
            Transaction.user_id == current_user.id,
        )
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    old_category = tx.category
    if "category" in body:
        tx.category = body["category"]
        tx.user_verified = True
        tx.classified_by = "user"

        # Feed correction to ML classifier for online learning
        if old_category and old_category != body["category"]:
            try:
                classifier.partial_train([tx.description], [body["category"]])
            except Exception:
                pass

    if "subcategory" in body:
        tx.subcategory = body["subcategory"]
    if "description" in body:
        tx.description = body["description"]

    await db.commit()
    await db.refresh(tx)
    return {"success": True, "data": _tx_dict(tx)}


@router.get("/meta/categories", response_model=dict)
async def get_categories():
    return {"success": True, "data": CATEGORIES}


@router.get("/meta/uncertain", response_model=dict)
async def get_uncertain_transactions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction)
        .where(
            Transaction.user_id == current_user.id,
            Transaction.is_duplicate == False,
            Transaction.confidence < 0.6,
            Transaction.user_verified == False,
        )
        .order_by(Transaction.date.desc())
        .limit(50)
    )
    txs = result.scalars().all()
    return {"success": True, "data": [_tx_dict(t) for t in txs]}


@router.post("/train", response_model=dict)
async def train_classifier(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrain classifier using all user-verified transactions."""
    result = await db.execute(
        select(Transaction).where(
            Transaction.user_id == current_user.id,
            Transaction.user_verified == True,
            Transaction.category.isnot(None),
        )
    )
    txs = result.scalars().all()

    if len(txs) < 10:
        return {"success": False, "data": {"error": f"Need at least 10 verified transactions. You have {len(txs)}."}}

    texts = [t.description for t in txs]
    labels = [t.category for t in txs]
    report = classifier.train(texts, labels)
    return {"success": True, "data": report}
