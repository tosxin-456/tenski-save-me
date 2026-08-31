"""
Transaction Classifier
Primary: Rule-based pattern matching (200+ Nigerian-first patterns)
Secondary: scikit-learn SGDClassifier (trained on user corrections)
Training: Call train() with labeled data to improve accuracy over time
"""
from __future__ import annotations

import re
import os
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
from sklearn.linear_model import SGDClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report
from rapidfuzz import fuzz

logger = logging.getLogger(__name__)

CATEGORIES = [
    "Income", "Food", "Bills", "Transport", "Shopping",
    "People", "Housing", "Entertainment", "Financial",
    "Subscriptions", "Health", "Education", "Savings", "Unknown",
]

MERCHANT_MAP: dict[str, tuple[str, str]] = {
    # Telecom
    "mtn": ("Bills", "Mobile Data"), "airtel": ("Bills", "Mobile Data"),
    "glo": ("Bills", "Mobile Data"), "9mobile": ("Bills", "Mobile Data"),
    "etisalat": ("Bills", "Mobile Data"), "smile": ("Bills", "Internet"),
    "spectranet": ("Bills", "Internet"), "swift": ("Bills", "Internet"),
    # Streaming
    "netflix": ("Subscriptions", "Streaming"), "spotify": ("Subscriptions", "Music"),
    "youtube premium": ("Subscriptions", "Streaming"), "showmax": ("Subscriptions", "Streaming"),
    "apple music": ("Subscriptions", "Music"), "deezer": ("Subscriptions", "Music"),
    "amazon prime": ("Subscriptions", "Streaming"), "prime video": ("Subscriptions", "Streaming"),
    "audible": ("Subscriptions", "Audiobooks"), "chatgpt": ("Subscriptions", "Software"),
    "canva": ("Subscriptions", "Software"), "adobe": ("Subscriptions", "Software"),
    "microsoft 365": ("Subscriptions", "Software"), "office 365": ("Subscriptions", "Software"),
    "google one": ("Subscriptions", "Cloud Storage"), "icloud": ("Subscriptions", "Cloud Storage"),
    "dropbox": ("Subscriptions", "Cloud Storage"), "nordvpn": ("Subscriptions", "VPN"),
    "expressvpn": ("Subscriptions", "VPN"),
    # TV / Cable
    "dstv": ("Bills", "Cable TV"), "gotv": ("Bills", "Cable TV"),
    "startimes": ("Bills", "Cable TV"),
    # Utilities
    "ekedc": ("Bills", "Electricity"), "ikedc": ("Bills", "Electricity"),
    "aedc": ("Bills", "Electricity"), "bedc": ("Bills", "Electricity"),
    "kedco": ("Bills", "Electricity"), "nepa": ("Bills", "Electricity"),
    "phcn": ("Bills", "Electricity"), "jed": ("Bills", "Electricity"),
    "lawma": ("Bills", "Waste"), "abuja water": ("Bills", "Water"),
    "lwsc": ("Bills", "Water"),
    # Ride-hailing
    "uber": ("Transport", "Ride-hailing"), "bolt": ("Transport", "Ride-hailing"),
    "taxify": ("Transport", "Ride-hailing"), "indriver": ("Transport", "Ride-hailing"),
    "rida": ("Transport", "Ride-hailing"),
    # Food & Grocery
    "shoprite": ("Food", "Groceries"), "spar": ("Food", "Groceries"),
    "everyday supermart": ("Food", "Groceries"), "market square": ("Food", "Groceries"),
    "kfc": ("Food", "Fast Food"), "mcdonald": ("Food", "Fast Food"),
    "chicken republic": ("Food", "Fast Food"), "dominos": ("Food", "Fast Food"),
    "pizza hut": ("Food", "Fast Food"), "coldstone": ("Food", "Fast Food"),
    "tantalizers": ("Food", "Fast Food"), "mr biggs": ("Food", "Fast Food"),
    "sweet sensation": ("Food", "Fast Food"), "tastee fried chicken": ("Food", "Fast Food"),
    "tfc": ("Food", "Fast Food"), "burger king": ("Food", "Fast Food"),
    "subway": ("Food", "Fast Food"), "cafe neo": ("Food", "Restaurants"),
    "the place": ("Food", "Restaurants"),
    # Delivery
    "jumia food": ("Food", "Delivery"), "chowdeck": ("Food", "Delivery"),
    "glovo": ("Food", "Delivery"), "sendchamp": ("Food", "Delivery"),
    # E-commerce
    "jumia": ("Shopping", "E-commerce"), "konga": ("Shopping", "E-commerce"),
    "jiji": ("Shopping", "E-commerce"),
    # Fuel
    "total": ("Transport", "Fuel"), "mobil": ("Transport", "Fuel"),
    "oando": ("Transport", "Fuel"), "ardova": ("Transport", "Fuel"),
    "conoil": ("Transport", "Fuel"),
    # Finance / Crypto
    "binance": ("Financial", "Crypto"), "luno": ("Financial", "Crypto"),
    "buycoins": ("Financial", "Crypto"), "quidax": ("Financial", "Crypto"),
    "piggyvest": ("Savings", "Investment"), "cowrywise": ("Savings", "Investment"),
    "risevest": ("Savings", "Investment"), "bamboo": ("Savings", "Investment"),
    # Fintech
    "kuda": ("Financial", "Transfer"), "opay": ("Financial", "Transfer"),
    "palmpay": ("Financial", "Transfer"), "moniepoint": ("Financial", "Transfer"),
    "carbon": ("Financial", "Loan"), "fairmoney": ("Financial", "Loan"),
    # Health
    "reliance hmo": ("Health", "Insurance"), "hygeia": ("Health", "Insurance"),
    "axamansard": ("Health", "Insurance"), "avon hmo": ("Health", "Insurance"),
    "pharmacy": ("Health", "Pharmacy"), "health plus": ("Health", "Pharmacy"),
    # Education
    "udemy": ("Education", "Online Course"), "coursera": ("Education", "Online Course"),
    "pluralsight": ("Education", "Online Course"),
}

NIGERIAN_NAMES = [
    "chidi", "emeka", "chioma", "adaeze", "ngozi", "obinna", "chinwe", "ifeanyi",
    "chukwu", "nneka", "uche", "okechukwu", "nwachukwu", "chinedu", "obi", "eze",
    "tunde", "bola", "sola", "yemi", "kunle", "tobi", "seun", "feyi", "busola",
    "funke", "wale", "gbenga", "biodun", "kemi", "titi", "dayo", "lola", "bimpe",
    "ade", "femi", "lanre", "rotimi", "taiwo", "kehinde", "akin", "dele", "olu",
    "amaka", "ifeoma", "nkem", "adanna", "onyeka", "uchechi", "ekene", "uzor",
    "abubakar", "ibrahim", "musa", "aliyu", "suleiman", "usman", "aminu", "garba",
    "fatima", "hauwa", "zainab", "aisha", "halima", "ramatu", "bilkisu",
    "john", "peter", "paul", "mary", "blessing", "grace", "faith", "hope",
    "david", "daniel", "samuel", "esther", "ruth", "judith", "moses",
    "yuanna", "yuana", "mama", "mum", "mom", "dad", "daddy", "brother",
    "sister", "aunty", "uncle", "bro", "sis",
]

PATTERNS: list[tuple[re.Pattern, str, str]] = [
    # Income
    (re.compile(r"\b(salary|salari|pay(ment)?|payroll|wages?|stipend|income|earning|bonus|commission|pension|dividend|refund|reimbursement|credit alert)\b", re.I), "Income", "Salary"),
    (re.compile(r"\b(freelance|contract pay|consulting fee|service fee|invoice payment)\b", re.I), "Income", "Freelance"),
    (re.compile(r"\b(loan disbursement|loan credit|credit facility)\b", re.I), "Income", "Loan Received"),
    # Food
    (re.compile(r"\b(restaurant|eatery|kitchen|canteen|cafeteria|bistro|grill|buka|mama put|food court|suya|shawarma|pepper soup)\b", re.I), "Food", "Restaurants"),
    (re.compile(r"\b(grocery|supermarket|market|provision|foodstuff|farm produce|fresh produce)\b", re.I), "Food", "Groceries"),
    (re.compile(r"\b(food delivery|food order|meal|lunch|dinner|breakfast|snack)\b", re.I), "Food", "Food & Dining"),
    # Bills
    (re.compile(r"\b(electricity|light bill|power|prepaid meter|token|utility)\b", re.I), "Bills", "Electricity"),
    (re.compile(r"\b(data plan|data bundle|data sub|airtime|recharge|vtu|top.?up|binge plan|social plan|data\s*\(\d|plan data|\d+\s*gb)\b", re.I), "Bills", "Mobile Data"),
    (re.compile(r"\b(internet|broadband|fibre|wifi|wi-fi|subscription.*internet)\b", re.I), "Bills", "Internet"),
    (re.compile(r"\b(water bill|water board|water rate)\b", re.I), "Bills", "Water"),
    (re.compile(r"\b(cable tv|satellite tv|decoder|hdtv)\b", re.I), "Bills", "Cable TV"),
    (re.compile(r"\b(waste|refuse|sanitation|lawma)\b", re.I), "Bills", "Waste"),
    # Transport
    (re.compile(r"\b(fuel|petrol|diesel|filling station|gas station|pump)\b", re.I), "Transport", "Fuel"),
    (re.compile(r"\b(ride|trip|cab|taxi|transport|commute|bus fare|train|brt|lrt|ferry)\b", re.I), "Transport", "Transit"),
    (re.compile(r"\b(vehicle|car wash|mechanic|repairs?|service|tyre|spare part)\b", re.I), "Transport", "Vehicle Maintenance"),
    (re.compile(r"\b(parking|toll)\b", re.I), "Transport", "Parking & Toll"),
    (re.compile(r"\b(flight|airline|airport|aviation|ticket|travel|hotel|lodge|hostel)\b", re.I), "Transport", "Travel"),
    # Shopping
    (re.compile(r"\b(fashion|cloth|dress|shoe|bag|accessory|accessories|wear|boutique|market)\b", re.I), "Shopping", "Fashion"),
    (re.compile(r"\b(electronics|gadget|phone|laptop|appliance|device)\b", re.I), "Shopping", "Electronics"),
    (re.compile(r"\b(amazon|aliexpress|temu|shein)\b", re.I), "Shopping", "E-commerce"),
    (re.compile(r"\b(gift|present|souvenir)\b", re.I), "Shopping", "Gifts"),
    # Housing
    (re.compile(r"\b(rent|tenancy|housing|accommodation|landlord|agent fee|agency)\b", re.I), "Housing", "Rent"),
    (re.compile(r"\b(mortgage|home loan)\b", re.I), "Housing", "Mortgage"),
    (re.compile(r"\b(service charge|estate|facility management)\b", re.I), "Housing", "Service Charge"),
    (re.compile(r"\b(furniture|furnishing|decor|interior)\b", re.I), "Housing", "Furnishing"),
    # Entertainment
    (re.compile(r"\b(cinema|movie|film|theatre|show|concert|event|ticket|game|sport)\b", re.I), "Entertainment", "Events"),
    (re.compile(r"\b(bar|club|lounge|nightlife|party|hangout)\b", re.I), "Entertainment", "Nightlife"),
    # Health
    (re.compile(r"\b(hospital|clinic|pharmacy|medic|health|doctor|dentist|optician|lab test|blood test|scan|surgery|drug|medication|prescription|hmo|nhis)\b", re.I), "Health", "Medical"),
    (re.compile(r"\b(gym|fitness|yoga|pilates|wellness|spa|massage)\b", re.I), "Health", "Fitness"),
    # Education
    (re.compile(r"\b(school fee|tuition|university|college|academy|lesson|tutorial|course|certification|exam|waec|neco|jamb|registration)\b", re.I), "Education", "School"),
    (re.compile(r"\b(book|textbook|stationery|library)\b", re.I), "Education", "Books & Supplies"),
    # Financial
    (re.compile(r"\b(loan repayment|loan payment|loan installment|emi|credit repayment)\b", re.I), "Financial", "Loan Repayment"),
    (re.compile(r"\b(insurance|assurance|policy|premium)\b", re.I), "Financial", "Insurance"),
    (re.compile(r"\b(investment|stock|shares|mutual fund|bond)\b", re.I), "Financial", "Investment"),
    (re.compile(r"\b(bank charge|maintenance fee|sms alert|vat|stamp duty|commission on turnover|cot|ledger fee|atm fee|card fee|account fee)\b", re.I), "Financial", "Bank Charges"),
    (re.compile(r"\b(transfer|trf|trn|nip|neft|rtgs|swift)\b", re.I), "Financial", "Transfer"),
    (re.compile(r"\b(atm withdrawal|cash withdrawal|pos withdrawal|withdrawal)\b", re.I), "Financial", "Cash Withdrawal"),
    # Savings
    (re.compile(r"\b(piggybank|piggy vest|cowrywise|rise vest|bamboo|save|savings|fixed deposit|fd|target savings)\b", re.I), "Savings", "Investment"),
]

ACCOUNT_NUMBER_RE = re.compile(r"\b\d{10}\b")
TRANSFER_KEYWORDS = re.compile(r"\b(transfer|trf|trn|nip|neft|rtgs|sent to|paid to|payment to|to|from)\b", re.I)
_NOISE_WORDS = re.compile(
    r"\b(transfer|trf|trn|nip|neft|rtgs|swift|to|from|via|through|sent|paid|payment|"
    r"ref|reference|mobile|web|ussd|pos|card|instant|inward|outward|credit|debit|cr|dr)\b",
    re.I,
)
P2P_PATTERN = re.compile(
    r"[A-Za-z]{2,}\s+[A-Za-z]{2,}.*?/\d{7,}/",
)
def has_match(pattern: re.Pattern, text: str) -> bool:
    return bool(pattern.search(text))

FINTECH_RAILS = {
    "opay", "moniepoint", "palmpay", "kuda", "paycom", "paycom(opay)",
    "opay digital services limited", "moniepoint microfinance bank",
    "palmpay limited", "kuda microfinance bank", "carbon", "fairmoney",
    "firstmonie", "paga", "flutterwave",
}


@dataclass
class ClassificationResult:
    category: str
    subcategory: str
    confidence: float
    classified_by: str  # "rule" | "ml" | "merchant" | "user"
    merchant: str | None = None


class TransactionClassifier:
    MODEL_PATH = Path("models/classifier.joblib")

    def __init__(self) -> None:
        self._ml_pipeline: Optional[Pipeline] = None
        self._name_set = set(NIGERIAN_NAMES)
        self._load_model()

    def _load_model(self) -> None:
        if self.MODEL_PATH.exists():
            try:
                self._ml_pipeline = joblib.load(self.MODEL_PATH)
                logger.info("ML classifier model loaded from disk")
            except Exception as e:
                logger.warning(f"Failed to load ML model: {e}")

    def classify(self, description: str, amount: float = 0.0) -> ClassificationResult:
        text = description.strip()
        lower = text.lower()

        has_account = bool(ACCOUNT_NUMBER_RE.search(lower))

        # 1. P2P transfer detection — "PersonName/AccountNumber/Platform"
        #    Must run BEFORE merchant map so Opay/Moniepoint as payment
        #    rails don't swallow person-to-person transfers.
        if has_account and self._is_p2p_transfer(text, lower):
            return ClassificationResult(
                category="People", subcategory="Personal Transfer",
                confidence=0.92, classified_by="rule",
                merchant=self._extract_person(text),
            )

        # 2. Merchant map (high confidence, but skip fintech rails when
        #    they appear alongside an account number — those are P2P)
        for keyword, (cat, subcat) in MERCHANT_MAP.items():
            if keyword in lower:
                if has_account and keyword in FINTECH_RAILS:
                    continue
                return ClassificationResult(
                    category=cat, subcategory=subcat,
                    confidence=0.99, classified_by="merchant",
                    merchant=keyword.title(),
                )

        # 3. Person transfer detection for other formats
        has_transfer_kw = bool(TRANSFER_KEYWORDS.search(lower))
        person = self._find_person(lower)

        if person and (has_transfer_kw or has_account):
            return ClassificationResult(
                category="People", subcategory="Personal Transfer",
                confidence=0.85, classified_by="rule",
                merchant=self._extract_person(text) or person.title(),
            )

        # 4. Rule-based patterns
        for pattern, cat, subcat in PATTERNS:
            if pattern.search(lower):
                return ClassificationResult(
                    category=cat, subcategory=subcat,
                    confidence=0.88, classified_by="rule",
                )

        # 5. Account number transfer with no recognizable name → Financial
        if has_account:
            return ClassificationResult(
                category="Financial", subcategory="Transfer",
                confidence=0.75, classified_by="rule",
            )

        # 6. Bare person name (no transfer keyword) → People
        if person:
            return ClassificationResult(
                category="People", subcategory="Personal Transfer",
                confidence=0.72, classified_by="rule",
                merchant=self._extract_person(text) or person.title(),
            )

        # 7. ML model (if trained)
        if self._ml_pipeline is not None:
            try:
                pred = self._ml_pipeline.predict([text])[0]
                proba = self._ml_pipeline.predict_proba([text])[0]
                conf = float(np.max(proba))
                if conf >= 0.55:
                    return ClassificationResult(
                        category=pred, subcategory="",
                        confidence=conf, classified_by="ml",
                    )
            except Exception:
                pass

        return ClassificationResult(
            category="Unknown", subcategory="",
            confidence=0.3, classified_by="rule",
        )

    def train(self, texts: list[str], labels: list[str], model_version: str = "v1") -> dict:
        """
        Train the sklearn classifier on labeled data.
        texts: list of transaction descriptions
        labels: list of category strings
        Returns: training report dict
        """
        if len(texts) < 10:
            return {"error": "Need at least 10 labeled examples to train"}

        pipeline = Pipeline([
            ("tfidf", TfidfVectorizer(
                analyzer="char_wb",
                ngram_range=(2, 4),
                max_features=10000,
                sublinear_tf=True,
            )),
            ("clf", SGDClassifier(
                loss="modified_huber",
                class_weight="balanced",
                random_state=42,
                max_iter=1000,
                tol=1e-3,
            )),
        ])

        pipeline.fit(texts, labels)

        self.MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(pipeline, self.MODEL_PATH)
        self._ml_pipeline = pipeline

        report = classification_report(labels, pipeline.predict(texts), output_dict=True)
        logger.info(f"ML classifier trained on {len(texts)} examples. Model saved.")
        return {
            "status": "trained",
            "examples": len(texts),
            "model_version": model_version,
            "accuracy": report.get("accuracy", 0),
            "report": report,
        }

    def partial_train(self, texts: list[str], labels: list[str]) -> dict:
        """Incrementally update the model with new corrections (online learning)."""
        if self._ml_pipeline is None:
            return self.train(texts, labels)

        clf = self._ml_pipeline.named_steps["clf"]
        tfidf = self._ml_pipeline.named_steps["tfidf"]
        X = tfidf.transform(texts)
        all_classes = np.array(CATEGORIES)
        clf.partial_fit(X, labels, classes=all_classes)

        joblib.dump(self._ml_pipeline, self.MODEL_PATH)
        return {"status": "updated", "examples_added": len(texts)}

    def extract_merchant(self, description: str) -> str | None:
        lower = description.lower()
        for keyword in MERCHANT_MAP:
            if keyword in lower:
                return keyword.title()
        return None

    def _is_p2p_transfer(self, text: str, lower: str) -> bool:
        """Detect the Nigerian P2P format: PersonName/AccountNumber/Platform"""
        if P2P_PATTERN.search(text):
            parts = re.split(r"[/\\]", lower)
            for part in parts:
                part = part.strip()
                if part in FINTECH_RAILS or any(rail in part for rail in FINTECH_RAILS):
                    return True
            if len(parts) >= 3:
                return True
        if "/" in text and has_match(ACCOUNT_NUMBER_RE, text):
            parts = [p.strip() for p in text.split("/")]
            alpha_parts = [p for p in parts if p and re.match(r"^[A-Za-z\s\-]+$", p) and len(p) > 2]
            if alpha_parts:
                return True
        return False

    def _find_person(self, lower: str) -> str | None:
        """Return the matched Nigerian name if the text contains one (word-level)."""
        words = re.split(r"[\s/\-_|.,]+", lower)
        # Exact word match first (avoids the 'obi' in 'mobile' substring bug)
        for word in words:
            if len(word) >= 2 and word in self._name_set:
                return word
        # Fuzzy match for slight misspellings
        for word in words:
            if len(word) >= 4:
                for name in self._name_set:
                    if len(name) >= 4 and fuzz.ratio(word, name) >= 90:
                        return name
        return None

    def _extract_person(self, description: str) -> str | None:
        """Clean a description down to the person's name for entity grouping."""
        clean = ACCOUNT_NUMBER_RE.sub(" ", description)
        clean = re.sub(r"\d{4}[-/]\d{2}[-/]\d{2}", " ", clean)
        clean = _NOISE_WORDS.sub(" ", clean)
        clean = re.sub(r"[^A-Za-z\s]", " ", clean)
        clean = re.sub(r"\s+", " ", clean).strip()
        words = [
            w for w in clean.split()
            if len(w) > 1 and w.lower() not in FINTECH_RAILS
            and w.lower() not in ("digital", "services", "limited", "microfinance",
                                  "bank", "ltd", "plc", "paycom", "cbn")
        ]
        if not words:
            return None
        return " ".join(w.capitalize() for w in words[:3])


# Singleton
classifier = TransactionClassifier()
