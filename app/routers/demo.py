from fastapi import APIRouter

router = APIRouter(prefix="/demo", tags=["demo"])

DEMO_DATA = {
    "user": {"name": "Demo User", "tone": "friendly"},
    "analytics": {
        "total_income": 500000,
        "total_expenditure": 431200,
        "net_cash_flow": 68800,
        "savings_rate": 13.76,
        "avg_daily": 13909.68,
        "avg_weekly": 97367.74,
        "avg_monthly": 417290.32,
        "recurring_total": 49900,
        "subscription_total": 49900,
        "bank_charges_total": 24200,
        "by_category": [
            {"category": "People", "total": 100000, "count": 14, "percentage": 23.2},
            {"category": "Food", "total": 82000, "count": 22, "percentage": 19.0},
            {"category": "Bills", "total": 78200, "count": 18, "percentage": 18.1},
            {"category": "Subscriptions", "total": 49900, "count": 6, "percentage": 11.6},
            {"category": "Shopping", "total": 42000, "count": 9, "percentage": 9.7},
            {"category": "Transport", "total": 38600, "count": 16, "percentage": 9.0},
            {"category": "Financial", "total": 24200, "count": 10, "percentage": 5.6},
            {"category": "Health", "total": 16300, "count": 4, "percentage": 3.8},
        ],
        "by_merchant": [
            {"merchant": "MTN", "total": 18400, "count": 9},
            {"merchant": "Shoprite", "total": 14200, "count": 3},
            {"merchant": "Uber", "total": 12600, "count": 6},
            {"merchant": "Bolt", "total": 9800, "count": 7},
            {"merchant": "Netflix", "total": 8000, "count": 1},
        ],
        "by_month": [
            {"month": "May 2024", "income": 490000, "expenditure": 380000},
            {"month": "Jun 2024", "income": 495000, "expenditure": 402000},
            {"month": "Jul 2024", "income": 500000, "expenditure": 431200},
        ],
        "by_entity": [
            {"name": "Yuanna", "sent_total": 85000, "received_total": 0, "net_flow": -85000, "transaction_count": 14},
            {"name": "Mum", "sent_total": 60000, "received_total": 0, "net_flow": -60000, "transaction_count": 8},
            {"name": "David", "sent_total": 40000, "received_total": 5000, "net_flow": -35000, "transaction_count": 11},
        ],
    },
    "spending_personality": {"label": "Balanced Spender", "color": "#f59e0b", "savings_rate": 13.76},
    "comparison": {
        "income_change_pct": 1.02,
        "spend_change_pct": 7.26,
    },
    "money_leaks": [
        {"category": "Subscriptions", "current_amount": 49900, "previous_amount": 33600, "change_percent": 48.5, "potential_saving_monthly": 12475, "potential_saving_annual": 149700},
        {"category": "Food", "current_amount": 82000, "previous_amount": 62000, "change_percent": 32.3, "potential_saving_monthly": 20500, "potential_saving_annual": 246000},
    ],
}


@router.get("/overview", response_model=dict)
async def demo_overview():
    return {"success": True, "data": DEMO_DATA}
