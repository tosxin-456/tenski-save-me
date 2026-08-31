import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.user import User
from app.models.account import Account
from app.middleware.auth import get_current_user
from app.middleware.casing import CamelModel

router = APIRouter(prefix="/accounts", tags=["accounts"])


class CreateAccountRequest(CamelModel):
    bank_name: str | None = None
    account_number: str | None = None
    account_name: str | None = None
    account_type: str = "current"
    currency: str = "NGN"


def _account_dict(a: Account) -> dict:
    return {
        "id": str(a.id),
        "bank_name": a.bank_name,
        "account_number": a.account_number,
        "account_name": a.account_name,
        "account_type": a.account_type,
        "currency": a.currency,
        "current_balance": float(a.current_balance) if a.current_balance else None,
        "created_at": a.created_at.isoformat(),
    }


@router.get("", response_model=dict)
async def list_accounts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Account).where(Account.user_id == current_user.id)
    )
    accounts = result.scalars().all()
    return {"success": True, "data": [_account_dict(a) for a in accounts]}


@router.post("", response_model=dict)
async def create_account(
    body: CreateAccountRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account = Account(
        id=uuid.uuid4(),
        user_id=current_user.id,
        bank_name=body.bank_name,
        account_number=body.account_number,
        account_name=body.account_name,
        account_type=body.account_type,
        currency=body.currency,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return {"success": True, "data": _account_dict(account)}


@router.delete("/{account_id}", response_model=dict)
async def delete_account(
    account_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Account).where(
            Account.id == uuid.UUID(account_id),
            Account.user_id == current_user.id,
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    await db.delete(account)
    await db.commit()
    return {"success": True}
