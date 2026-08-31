from pydantic import BaseModel, EmailStr
from app.middleware.casing import CamelModel


class RegisterRequest(CamelModel):
    email: EmailStr
    password: str
    first_name: str | None = None
    last_name: str | None = None


class LoginRequest(CamelModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    first_name: str | None
    last_name: str | None
    currency: str
    tone: str

    class Config:
        from_attributes = True


class AuthResponse(BaseModel):
    token: str
    user: UserResponse


class UpdateProfileRequest(CamelModel):
    first_name: str | None = None
    last_name: str | None = None
    tone: str | None = None
    currency: str | None = None
