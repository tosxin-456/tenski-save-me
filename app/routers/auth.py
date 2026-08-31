from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User
from app.middleware.auth import create_token, get_current_user
from app.middleware.security import hash_password, verify_password
from app.schemas.auth import RegisterRequest, LoginRequest, AuthResponse, UserResponse, UpdateProfileRequest
import uuid

router = APIRouter(prefix="/auth", tags=["auth"])


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        first_name=user.first_name,
        last_name=user.last_name,
        currency=user.currency,
        tone=user.tone,
    )


@router.post("/register", response_model=dict)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        id=uuid.uuid4(),
        email=body.email,
        password_hash=hash_password(body.password),
        first_name=body.first_name,
        last_name=body.last_name,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return {
        "success": True,
        "data": {"token": create_token(str(user.id)), "user": _user_response(user).model_dump()},
    }


@router.post("/login", response_model=dict)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return {
        "success": True,
        "data": {"token": create_token(str(user.id)), "user": _user_response(user).model_dump()},
    }


@router.get("/me", response_model=dict)
async def me(current_user: User = Depends(get_current_user)):
    return {"success": True, "data": _user_response(current_user).model_dump()}


@router.patch("/me", response_model=dict)
async def update_profile(
    body: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.first_name is not None:
        current_user.first_name = body.first_name
    if body.last_name is not None:
        current_user.last_name = body.last_name
    if body.tone is not None:
        current_user.tone = body.tone
    if body.currency is not None:
        current_user.currency = body.currency

    await db.commit()
    await db.refresh(current_user)
    return {"success": True, "data": _user_response(current_user).model_dump()}
