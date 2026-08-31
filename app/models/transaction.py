from sqlalchemy import String, ForeignKey, DateTime, Boolean, Numeric, Date, Index, func, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime, date
from app.database import Base
import uuid


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("accounts.id", ondelete="SET NULL"))
    statement_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("statements.id", ondelete="SET NULL"))

    # Raw extracted data
    raw_description: Mapped[str] = mapped_column(String(1000))
    raw_date: Mapped[str | None] = mapped_column(String(50))
    raw_amount: Mapped[str | None] = mapped_column(String(50))
    raw_balance: Mapped[str | None] = mapped_column(String(50))

    # Normalized
    description: Mapped[str] = mapped_column(String(500))
    date: Mapped[date] = mapped_column(Date, index=True)
    amount: Mapped[float] = mapped_column(Numeric(15, 2))
    balance: Mapped[float | None] = mapped_column(Numeric(15, 2))
    currency: Mapped[str] = mapped_column(String(3), default="NGN")
    type: Mapped[str] = mapped_column(String(10))  # debit | credit | transfer

    # Classification
    category: Mapped[str | None] = mapped_column(String(50), index=True)
    subcategory: Mapped[str | None] = mapped_column(String(100))
    merchant: Mapped[str | None] = mapped_column(String(200), index=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("entities.id", ondelete="SET NULL"))
    confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))
    classified_by: Mapped[str] = mapped_column(String(10), default="rule")  # rule | ml | user

    # Flags
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False)
    is_subscription: Mapped[bool] = mapped_column(Boolean, default=False)
    is_bank_charge: Mapped[bool] = mapped_column(Boolean, default=False)
    is_duplicate: Mapped[bool] = mapped_column(Boolean, default=False)
    user_verified: Mapped[bool] = mapped_column(Boolean, default=False)

    # Dedup hash
    hash: Mapped[str | None] = mapped_column(String(64), index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship("User", back_populates="transactions")
    account: Mapped["Account"] = relationship("Account", back_populates="transactions")
    statement: Mapped["Statement"] = relationship("Statement", back_populates="transactions")

    __table_args__ = (
        Index("ix_transactions_user_date", "user_id", "date"),
        Index("ix_transactions_user_category", "user_id", "category"),
    )
