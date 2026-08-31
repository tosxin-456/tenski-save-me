import uuid
import math
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User
from app.models.goal import SavingsGoal
from app.middleware.auth import get_current_user
from app.middleware.casing import CamelModel, normalize_keys_to_snake

router = APIRouter(prefix="/goals", tags=["goals"])


class CreateGoalRequest(CamelModel):
    name: str
    icon: str | None = "🎯"
    target_amount: float
    current_amount: float = 0.0
    monthly_contribution: float | None = None


def _goal_dict(g: SavingsGoal) -> dict:
    target = float(g.target_amount)
    current = float(g.current_amount)
    monthly = float(g.monthly_contribution) if g.monthly_contribution else None
    months = math.ceil((target - current) / monthly) if monthly and monthly > 0 and (target - current) > 0 else None
    return {
        "id": str(g.id),
        "name": g.name,
        "icon": g.icon,
        "target_amount": target,
        "current_amount": current,
        "monthly_contribution": monthly,
        "estimated_months_to_complete": months,
        "progress_pct": round(min(current / target * 100, 100), 2) if target > 0 else 0,
        "status": g.status,
        "created_at": g.created_at.isoformat(),
    }


@router.get("", response_model=dict)
async def list_goals(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SavingsGoal)
        .where(SavingsGoal.user_id == current_user.id)
        .order_by(SavingsGoal.created_at.desc())
    )
    goals = result.scalars().all()
    return {"success": True, "data": [_goal_dict(g) for g in goals]}


@router.post("", response_model=dict)
async def create_goal(
    body: CreateGoalRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    goal = SavingsGoal(
        id=uuid.uuid4(),
        user_id=current_user.id,
        name=body.name,
        icon=body.icon,
        target_amount=body.target_amount,
        current_amount=body.current_amount,
        monthly_contribution=body.monthly_contribution,
    )
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return {"success": True, "data": _goal_dict(goal)}


@router.patch("/{goal_id}", response_model=dict)
async def update_goal(
    goal_id: str,
    body: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SavingsGoal).where(
            SavingsGoal.id == uuid.UUID(goal_id),
            SavingsGoal.user_id == current_user.id,
        )
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    body = normalize_keys_to_snake(body)
    for field in ("name", "icon", "target_amount", "current_amount", "monthly_contribution", "status"):
        if field in body:
            setattr(goal, field, body[field])

    await db.commit()
    await db.refresh(goal)
    return {"success": True, "data": _goal_dict(goal)}


@router.delete("/{goal_id}", response_model=dict)
async def delete_goal(
    goal_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SavingsGoal).where(
            SavingsGoal.id == uuid.UUID(goal_id),
            SavingsGoal.user_id == current_user.id,
        )
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")

    await db.delete(goal)
    await db.commit()
    return {"success": True}


@router.post("/what-if", response_model=dict)
async def what_if(body: dict):
    target = float(body.get("target_amount", body.get("targetAmount", 0)) or 0)
    monthly = float(body.get("monthly_contribution", body.get("monthlyContribution", 0)) or 0)
    current = float(body.get("current_amount", body.get("currentAmount", 0)) or 0)
    if monthly <= 0 or target <= 0:
        return {"success": False, "data": {"error": "Invalid input"}}
    remaining = target - current
    months = math.ceil(remaining / monthly) if remaining > 0 else 0
    return {
        "success": True,
        "data": {
            "months_to_complete": months,
            "total_to_save": round(remaining, 2),
            "monthly_contribution": monthly,
        },
    }
