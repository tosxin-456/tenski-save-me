from __future__ import annotations

TONES = {"professional", "friendly", "minimal", "genz", "playful", "brutally_honest"}


def verbalize_savings_rate(rate: float, tone: str = "friendly") -> str:
    if tone == "professional":
        label = "excellent" if rate >= 20 else "adequate" if rate >= 10 else "below target"
        return f"Your savings rate is {rate:.1f}% — {label} by financial planning standards."
    if tone == "friendly":
        if rate >= 20:
            return f"Amazing! You saved {rate:.1f}% of your income. Your future self says thank you! 🎉"
        if rate >= 10:
            return f"Nice work — {rate:.1f}% saved. You're on the right track, keep going!"
        return f"You saved {rate:.1f}% this period. Let's work on bumping that up!"
    if tone == "minimal":
        return f"Savings rate: {rate:.1f}%"
    if tone == "genz":
        if rate >= 20:
            return f"Bestie you ate {rate:.1f}% savings rate?? That's lowkey amazing no cap"
        return f"Ngl {rate:.1f}% savings rate could be better bestie"
    if tone == "playful":
        if rate >= 20:
            return f"Woohoo! {rate:.1f}% saved! Your piggy bank is doing the cha-cha! 🐷💃"
        return f"Your savings rate is {rate:.1f}%. The piggy bank is hungry — feed it more! 🐷"
    if tone == "brutally_honest":
        if rate < 10:
            return f"{rate:.1f}% savings rate. That's basically nothing. You need to do better."
        return f"{rate:.1f}% saved. Decent, but don't let up."
    return f"Savings rate: {rate:.1f}%"


def verbalize_subscriptions(monthly: float, annual: float, count: int, tone: str = "friendly") -> str:
    if tone == "professional":
        return f"Recurring subscription expenditure: ₦{monthly:,.0f}/month (₦{annual:,.0f} annually) across {count} services."
    if tone == "friendly":
        return f"You're spending ₦{monthly:,.0f}/month on {count} subscriptions — that's ₦{annual:,.0f} a year!"
    if tone == "minimal":
        return f"Subscriptions: ₦{monthly:,.0f}/mo · {count} active"
    if tone == "genz":
        return f"Bestie you're spending ₦{monthly:,.0f}/month on {count} subscriptions?? That's ₦{annual:,.0f} a year fr fr"
    if tone == "playful":
        return f"You've got {count} subscriptions munching ₦{monthly:,.0f} every month! That's ₦{annual:,.0f}/year. Time to audit! 🔍"
    if tone == "brutally_honest":
        return f"₦{monthly:,.0f}/month on {count} subscriptions. ₦{annual:,.0f} a year. How many of those do you actually use?"
    return f"Subscriptions: ₦{monthly:,.0f}/month"


def get_spending_personality(savings_rate: float, top_category: str, tone: str = "friendly") -> dict:
    if savings_rate >= 25:
        label = "Odogwu Saver" if tone in ("genz", "playful") else "Financial Champion"
        color = "#22c55e"
    elif savings_rate >= 15:
        label = "Frugal King" if tone in ("genz", "playful") else "Smart Spender"
        color = "#3b82f6"
    elif savings_rate >= 5:
        label = "Balanced Vibes" if tone in ("genz", "playful") else "Balanced Spender"
        color = "#f59e0b"
    else:
        label = "Odogwu Spender" if tone in ("genz", "playful") else "High Spender"
        color = "#ef4444"
    return {"label": label, "color": color, "savings_rate": round(savings_rate, 1)}


def classify_intent(question: str) -> str:
    q = question.lower()
    if any(k in q for k in ["how much did i spend", "total spend", "total spending", "spent"]):
        if any(k in q for k in ["food", "eat", "restaurant", "grocery"]):
            return "CATEGORY_SPENDING:Food"
        if any(k in q for k in ["transport", "fuel", "uber", "ride"]):
            return "CATEGORY_SPENDING:Transport"
        if any(k in q for k in ["bill", "utility", "electricity", "data"]):
            return "CATEGORY_SPENDING:Bills"
        if any(k in q for k in ["subscription", "netflix", "spotify"]):
            return "CATEGORY_SPENDING:Subscriptions"
        return "TOTAL_SPENDING"
    if any(k in q for k in ["subscription", "recurring", "monthly charge"]):
        return "SUBSCRIPTION_LIST"
    if any(k in q for k in ["who", "person", "people", "sent to", "transfer to"]):
        return "PERSON_SPENDING"
    if any(k in q for k in ["compare", "last month", "previous", "this month vs"]):
        return "COMPARE_PERIODS"
    if any(k in q for k in ["save", "saving", "cut", "reduce", "opportunity", "leak"]):
        return "SAVINGS_OPPORTUNITIES"
    if any(k in q for k in ["biggest", "largest", "most expensive", "highest"]):
        return "LARGEST_TRANSACTION"
    if any(k in q for k in ["income", "salary", "received", "earn"]):
        return "INCOME_TOTAL"
    if any(k in q for k in ["merchant", "shop", "store", "where"]):
        return "MERCHANT_SPENDING"
    return "UNKNOWN"
