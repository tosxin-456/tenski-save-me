import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.user import User
from app.models.subscription import Subscription
from app.middleware.auth import get_current_user
from app.middleware.casing import CamelModel, normalize_keys_to_snake

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


class CreateSubRequest(CamelModel):
    name: str
    amount: float
    frequency: str = "monthly"
    subcategory: str | None = None
    merchant: str | None = None


def _sub_dict(s: Subscription) -> dict:
    freq_multipliers = {"daily": 365, "weekly": 52, "monthly": 12, "quarterly": 4, "annual": 1}
    monthly = float(s.amount)
    if s.frequency != "monthly":
        multiplier = freq_multipliers.get(s.frequency, 12)
        monthly = float(s.amount) * multiplier / 12
    return {
        "id": str(s.id),
        "name": s.name,
        "merchant": s.merchant,
        "amount": float(s.amount),
        "monthly_equivalent": round(monthly, 2),
        "frequency": s.frequency,
        "subcategory": s.subcategory,
        "annual_cost": round(monthly * 12, 2),
        "is_active": s.is_active,
        "is_auto_detected": s.is_auto_detected,
        "confidence": float(s.confidence) if s.confidence else None,
        "next_expected": str(s.next_expected) if s.next_expected else None,
        "last_seen": str(s.last_seen) if s.last_seen else None,
    }


@router.get("", response_model=dict)
async def list_subscriptions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == current_user.id, Subscription.is_active == True)
        .order_by(Subscription.amount.desc())
    )
    subs = result.scalars().all()
    sub_list = [_sub_dict(s) for s in subs]

    total_monthly = sum(s["monthly_equivalent"] for s in sub_list)
    return {
        "success": True,
        "data": {
            "subscriptions": sub_list,
            "summary": {
                "count": len(sub_list),
                "total_monthly": round(total_monthly, 2),
                "total_annual": round(total_monthly * 12, 2),
            },
        },
    }


@router.post("", response_model=dict)
async def create_subscription(
    body: CreateSubRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sub = Subscription(
        id=uuid.uuid4(),
        user_id=current_user.id,
        name=body.name,
        amount=body.amount,
        frequency=body.frequency,
        subcategory=body.subcategory,
        merchant=body.merchant or body.name,
        is_auto_detected=False,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return {"success": True, "data": _sub_dict(sub)}


@router.patch("/{sub_id}", response_model=dict)
async def update_subscription(
    sub_id: str,
    body: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Subscription).where(
            Subscription.id == uuid.UUID(sub_id),
            Subscription.user_id == current_user.id,
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    body = normalize_keys_to_snake(body)
    for field in ("name", "amount", "frequency", "subcategory", "is_active"):
        if field in body:
            setattr(sub, field, body[field])

    await db.commit()
    await db.refresh(sub)
    return {"success": True, "data": _sub_dict(sub)}


@router.delete("/{sub_id}", response_model=dict)
async def delete_subscription(
    sub_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Subscription).where(
            Subscription.id == uuid.UUID(sub_id),
            Subscription.user_id == current_user.id,
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    await db.delete(sub)
    await db.commit()
    return {"success": True}
