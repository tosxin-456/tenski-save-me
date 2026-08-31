import uuid
from datetime import date, datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func

from app.database import get_db
from app.models.user import User
from app.models.transaction import Transaction
from app.models.subscription import Subscription
from app.middleware.auth import get_current_user
from app.services.analytics.engine import analytics_engine
from app.services.analytics.recommendations import recommendation_engine
from app.services.analytics.insights import insights_generator
from dataclasses import asdict

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _period(from_date: str | None, to_date: str | None) -> tuple[date, date]:
    now = datetime.utcnow().date()
    from_ = date.fromisoformat(from_date) if from_date else date(now.year, now.month, 1)
    to_ = date.fromisoformat(to_date) if to_date else now
    return from_, to_


def _month_end(d: date) -> date:
    if d.month == 12:
        return date(d.year, 12, 31)
    return date.fromordinal(date(d.year, d.month + 1, 1).toordinal() - 1)


async def _default_month(db: AsyncSession, user_id: uuid.UUID) -> tuple[date, date]:
    """Full latest calendar month that has data (so an uploaded statement shows
    up even when it isn't from the current month); falls back to current month."""
    now = date.today()
    res = await db.execute(
        select(func.max(Transaction.date)).where(
            Transaction.user_id == user_id,
            Transaction.is_duplicate == False,
        )
    )
    latest = res.scalar_one_or_none()
    if not latest:
        return date(now.year, now.month, 1), now
    month_start = date(latest.year, latest.month, 1)
    return month_start, min(_month_end(latest), now)


async def _fetch_txs(
    db: AsyncSession,
    user_id: uuid.UUID,
    from_: date,
    to_: date,
    account_id: str | None = None,
) -> list[dict]:
    conds = [
        Transaction.user_id == user_id,
        Transaction.is_duplicate == False,
        Transaction.date >= from_,
        Transaction.date <= to_,
    ]
    if account_id:
        conds.append(Transaction.account_id == uuid.UUID(account_id))

    result = await db.execute(select(Transaction).where(and_(*conds)))
    rows = result.scalars().all()
    return [
        {
            "date": r.date,
            "amount": float(r.amount),
            "type": r.type,
            "category": r.category,
            "subcategory": r.subcategory,
            "merchant": r.merchant,
            "description": r.description,
            "is_recurring": r.is_recurring,
            "is_subscription": r.is_subscription,
            "is_bank_charge": r.is_bank_charge,
            "is_duplicate": r.is_duplicate,
            "entity_name": None,
            "confidence": float(r.confidence) if r.confidence else None,
        }
        for r in rows
    ]


def _prev_period(from_: date, to_: date) -> tuple[date, date]:
    delta = (to_ - from_).days + 1
    prev_to = date.fromordinal(from_.toordinal() - 1)
    prev_from = date.fromordinal(prev_to.toordinal() - delta + 1)
    return prev_from, prev_to


@router.get("/overview", response_model=dict)
async def overview(
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    account_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if from_date or to_date:
        from_, to_ = _period(from_date, to_date)
        prev_from, prev_to = _prev_period(from_, to_)
    else:
        from_, to_ = await _default_month(db, current_user.id)
        # Month-over-month: compare against the full previous calendar month
        prev_to = date.fromordinal(from_.toordinal() - 1)
        prev_from = date(prev_to.year, prev_to.month, 1)

    txs = await _fetch_txs(db, current_user.id, from_, to_, account_id)
    prev_txs = await _fetch_txs(db, current_user.id, prev_from, prev_to, account_id)

    a = analytics_engine.compute(txs)
    cmp = analytics_engine.compare_periods(txs, prev_txs)
    money_leaks = analytics_engine.detect_money_leaks(txs, prev_txs)

    # Per-month transaction counts (engine tracks totals, not counts)
    month_counts: dict[str, int] = {}
    for t in txs:
        key = (t["date"]).strftime("%b %Y")
        month_counts[key] = month_counts.get(key, 0) + 1

    txn_count = len([t for t in txs if not t.get("is_duplicate")])

    # Active subscriptions for the dashboard strip
    sub_rows = await db.execute(
        select(Subscription).where(
            Subscription.user_id == current_user.id, Subscription.is_active == True
        ).order_by(Subscription.amount.desc())
    )
    subscriptions = [
        {"name": s.name, "amount": float(s.amount), "frequency": s.frequency,
         "subcategory": s.subcategory or ""}
        for s in sub_rows.scalars().all()
    ]

    # Build the exact shape the frontend dashboard/charts consume. Keys are
    # snake_case here and become camelCase via CamelCaseResponseMiddleware.
    analytics_payload = {
        "total_income": a.total_income,
        "total_expenditure": a.total_expenditure,
        "net_cash_flow": a.net_cash_flow,
        "savings_rate": a.savings_rate,
        "avg_daily_spending": a.avg_daily,
        "transaction_count": txn_count,
        "bank_charges_total": a.bank_charges_total,
        "subscription_total": a.subscription_total,
        "recurring_total": a.recurring_total,
        "by_category": [
            {"category": c.category, "amount": c.total, "percentage": c.percentage, "count": c.count}
            for c in a.by_category
        ],
        "by_entity": [
            {"entity": e.name, "total_sent": e.sent_total, "total_received": e.received_total,
             "net_flow": e.net_flow, "count": e.transaction_count}
            for e in a.by_entity
        ],
        "by_merchant": [
            {"merchant": m["merchant"], "amount": m["total"], "count": m["count"], "category": None}
            for m in a.by_merchant
        ],
        "by_month": [
            {"period": m["month"], "income": m["income"], "expenditure": m["expenditure"],
             "savings": round(m["income"] - m["expenditure"], 2), "count": month_counts.get(m["month"], 0)}
            for m in a.by_month
        ],
    }

    comparison_payload = {
        "current_spend": cmp["current"]["expenditure"],
        "previous_spend": cmp["previous"]["expenditure"],
        "spend_change": cmp["spend_change_pct"],
        "income_change": cmp["income_change_pct"],
    }

    return {
        "success": True,
        "data": {
            "analytics": analytics_payload,
            "comparison": comparison_payload,
            "money_leaks": money_leaks,
            "subscriptions": subscriptions,
            "period": {"from": str(from_), "to": str(to_)},
        },
    }


@router.get("/insights", response_model=dict)
async def get_insights(
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from_, to_ = _period(from_date, to_date)
    txs = await _fetch_txs(db, current_user.id, from_, to_)
    analytics = analytics_engine.compute(txs)
    insights = insights_generator.generate(analytics)
    return {
        "success": True,
        "data": [
            {
                "id": i.id, "type": i.type, "severity": i.severity,
                "title": i.title, "description": i.description,
                "potential_saving": i.potential_saving, "category": i.category,
            }
            for i in insights
        ],
    }


@router.get("/recommendations", response_model=dict)
async def get_recommendations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from_ = date.today().replace(day=1)
    to_ = date.today()
    txs = await _fetch_txs(db, current_user.id, from_, to_)
    analytics = analytics_engine.compute(txs)
    sub_total = sum(t["amount"] for t in txs if t.get("is_subscription") and t.get("type") == "debit")
    recs = recommendation_engine.generate(analytics, sub_total)
    return {
        "success": True,
        "data": [
            {
                "type": r.type, "title": r.title, "description": r.description,
                "potential_saving_monthly": r.potential_saving_monthly,
                "potential_saving_annual": r.potential_saving_annual,
                "priority": r.priority,
            }
            for r in recs
        ],
    }


@router.get("/people", response_model=dict)
async def get_people_analytics(
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    now = date.today()
    from_ = date.fromisoformat(from_date) if from_date else date(now.year, 1, 1)
    to_ = date.fromisoformat(to_date) if to_date else now
    txs = await _fetch_txs(db, current_user.id, from_, to_)
    analytics = analytics_engine.compute(txs)
    return {
        "success": True,
        "data": [
            {
                "name": e.name,
                "sent_total": e.sent_total,
                "received_total": e.received_total,
                "net_flow": e.net_flow,
                "transaction_count": e.transaction_count,
            }
            for e in analytics.by_entity
        ],
    }


@router.get("/money-leaks", response_model=dict)
async def get_money_leaks(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    curr_from, curr_to = await _default_month(db, current_user.id)
    prev_to = date.fromordinal(curr_from.toordinal() - 1)
    prev_from = date(prev_to.year, prev_to.month, 1)

    curr_txs = await _fetch_txs(db, current_user.id, curr_from, curr_to)
    prev_txs = await _fetch_txs(db, current_user.id, prev_from, prev_to)

    leaks = analytics_engine.detect_money_leaks(curr_txs, prev_txs)
    return {"success": True, "data": leaks}
