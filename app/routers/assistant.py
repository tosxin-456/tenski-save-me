from datetime import date
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from app.database import get_db
from app.models.user import User
from app.models.transaction import Transaction
from app.middleware.auth import get_current_user
from app.middleware.casing import CamelModel
from app.services.nlg.templates import classify_intent, verbalize_savings_rate, verbalize_subscriptions
from app.services.analytics.engine import analytics_engine

router = APIRouter(prefix="/assistant", tags=["assistant"])


class AskRequest(CamelModel):
    question: str
    date_range: dict | None = None


@router.post("/ask", response_model=dict)
async def ask(
    body: AskRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    now = date.today()
    from_ = body.date_range.get("from") if body.date_range else None
    to_ = body.date_range.get("to") if body.date_range else None
    # When the user doesn't specify a period, answer over ALL their data — a
    # plain question shouldn't come back empty just because this calendar month
    # happens to have no transactions (e.g. a historical statement was uploaded).
    if from_ or to_:
        period_from = date.fromisoformat(from_) if from_ else date(2000, 1, 1)
        period_to = date.fromisoformat(to_) if to_ else now
    else:
        bounds = await db.execute(
            select(func.min(Transaction.date), func.max(Transaction.date)).where(
                and_(
                    Transaction.user_id == current_user.id,
                    Transaction.is_duplicate == False,
                )
            )
        )
        min_d, max_d = bounds.one()
        period_from = min_d or date(now.year, now.month, 1)
        period_to = max_d or now

    intent = classify_intent(body.question)
    tone = current_user.tone or "friendly"

    # Fetch transactions for period
    result = await db.execute(
        select(Transaction).where(
            and_(
                Transaction.user_id == current_user.id,
                Transaction.is_duplicate == False,
                Transaction.date >= period_from,
                Transaction.date <= period_to,
            )
        )
    )
    txs = result.scalars().all()
    tx_dicts = [
        {
            "date": t.date, "amount": float(t.amount), "type": t.type,
            "category": t.category, "subcategory": t.subcategory,
            "merchant": t.merchant, "description": t.description,
            "is_recurring": t.is_recurring, "is_subscription": t.is_subscription,
            "is_bank_charge": t.is_bank_charge, "is_duplicate": False,
            "entity_name": None,
        }
        for t in txs
    ]
    analytics = analytics_engine.compute(tx_dicts)

    answer = _answer(intent, body.question, analytics, tx_dicts, tone, period_from, period_to)
    return {"success": True, "data": {"answer": answer, "intent": intent}}


def _fmt(amount: float) -> str:
    return f"₦{amount:,.0f}"


def _answer(
    intent: str, question: str, analytics, txs: list[dict],
    tone: str, from_: date, to_: date,
) -> str:
    period_label = f"{from_.strftime('%b %d')} – {to_.strftime('%b %d, %Y')}"

    if intent == "TOTAL_SPENDING":
        return (
            f"You spent {_fmt(analytics.total_expenditure)} between {period_label} "
            f"across {len([t for t in txs if t['type'] == 'debit'])} transactions. "
            f"Your income was {_fmt(analytics.total_income)}, leaving {_fmt(analytics.net_cash_flow)} saved."
        )

    if intent.startswith("CATEGORY_SPENDING:"):
        cat = intent.split(":", 1)[1]
        stat = next((c for c in analytics.by_category if c.category.lower() == cat.lower()), None)
        if stat:
            return (
                f"You spent {_fmt(stat.total)} on {stat.category} ({period_label}). "
                f"That's {stat.percentage:.1f}% of your total spending and {stat.count} transactions."
            )
        return f"No {cat} spending found for {period_label}."

    if intent == "SUBSCRIPTION_LIST":
        sub_total = analytics.subscription_total
        sub_count = len([t for t in txs if t.get("is_subscription")])
        return verbalize_subscriptions(sub_total, sub_total * 12, sub_count, tone)

    if intent == "PERSON_SPENDING":
        if not analytics.by_entity:
            return "I didn't find any person-to-person transfers in this period."
        top = analytics.by_entity[:3]
        lines = [f"{e.name}: {_fmt(e.sent_total)} sent" for e in top if e.sent_total > 0]
        if not lines:
            return "No personal transfers found in this period."
        return "Top people you sent money to:\n" + "\n".join(f"• {l}" for l in lines)

    if intent == "SAVINGS_OPPORTUNITIES":
        recs = []
        if analytics.subscription_total > 0:
            recs.append(f"Subscriptions ({_fmt(analytics.subscription_total)}/mo) — review unused ones")
        if analytics.bank_charges_total > 0:
            recs.append(f"Bank charges ({_fmt(analytics.bank_charges_total)}) — consider a zero-fee digital bank")
        if analytics.by_category:
            top_cat = analytics.by_category[0]
            if top_cat.percentage > 25:
                saving = top_cat.total * 0.25
                recs.append(f"{top_cat.category} ({_fmt(top_cat.total)}) — a 25% cut saves {_fmt(saving)}/month")
        if not recs:
            return "Your spending looks well-controlled this period. Keep it up!"
        return "Potential savings opportunities:\n" + "\n".join(f"• {r}" for r in recs)

    if intent == "LARGEST_TRANSACTION":
        if analytics.largest_debit:
            tx = analytics.largest_debit
            return (
                f"Your largest spend was {_fmt(float(tx.get('amount', 0)))} — "
                f"{tx.get('description', 'Unknown')[:60]} on {tx.get('date', '')}."
            )
        return "No transactions found for this period."

    if intent == "INCOME_TOTAL":
        return (
            f"Your total income for {period_label} was {_fmt(analytics.total_income)}. "
            + verbalize_savings_rate(analytics.savings_rate, tone)
        )

    if intent == "COMPARE_PERIODS":
        return (
            f"This period ({period_label}): income {_fmt(analytics.total_income)}, "
            f"spent {_fmt(analytics.total_expenditure)}, saved {analytics.savings_rate:.1f}%. "
            f"For a detailed comparison, I need two periods — try specifying dates."
        )

    return (
        f"I can see {len(txs)} transactions for {period_label}. "
        f"Total income: {_fmt(analytics.total_income)}, total spent: {_fmt(analytics.total_expenditure)}. "
        f"Try asking me about a specific category, person, or subscription."
    )
