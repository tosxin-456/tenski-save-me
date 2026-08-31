from sqlalchemy import String, ForeignKey, DateTime, Numeric, func, Uuid
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
from app.database import Base
import uuid


class ModelPrediction(Base):
    __tablename__ = "model_predictions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("transactions.id", ondelete="CASCADE"))
    model_version: Mapped[str] = mapped_column(String(50), default="rule-v1")
    predicted_category: Mapped[str | None] = mapped_column(String(50))
    confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))
    features_used: Mapped[str | None] = mapped_column(String(500))
    was_correct: Mapped[bool | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserCorrection(Base):
    __tablename__ = "user_corrections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    transaction_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("transactions.id", ondelete="CASCADE"))
    original_category: Mapped[str | None] = mapped_column(String(50))
    corrected_category: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
