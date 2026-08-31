import Fuse from "fuse.js";
import type { ClassificationResult, ClassificationPattern } from "../../types";

// ─── Classification Patterns ──────────────────────────────────────────────────
// Nigerian-first, comprehensive pattern library

const PATTERNS: ClassificationPattern[] = [
  // ── Income ──────────────────────────────────────────────────────────────────
  { pattern: /salary|salaries|payroll|pay\s*day/i, category: "Income", subcategory: "Salary", confidence: 0.97 },
  { pattern: /freelance|contract\s*pay|consulting\s*fee/i, category: "Income", subcategory: "Freelance", confidence: 0.92 },
  { pattern: /dividend|interest\s*credit|interest\s*earned/i, category: "Income", subcategory: "Interest", confidence: 0.95 },
  { pattern: /refund|reversal|credit\s*alert/i, category: "Income", subcategory: "Refund", confidence: 0.85 },
  { pattern: /business\s*income|sales\s*proceed|revenue/i, category: "Income", subcategory: "Business", confidence: 0.88 },
  { pattern: /\bNHF\b|\bPFA\b/i, category: "Income", subcategory: "Salary", confidence: 0.9 },

  // ── Food ────────────────────────────────────────────────────────────────────
  { pattern: /mcdonald|kfc|burger\s*king|chicken\s*republic|tastee|cold\s*stone|dominos|domino'?s/i, category: "Food", subcategory: "Fast Food", merchant: "Restaurant", confidence: 0.98 },
  { pattern: /shoprite|spar\b|market\s*square|justrite|game\s*store/i, category: "Food", subcategory: "Groceries", merchant: "Supermarket", confidence: 0.97 },
  { pattern: /uber\s*eat|jumia\s*food|food\s*court|bolt\s*food|chowdeck/i, category: "Food", subcategory: "Delivery", confidence: 0.98 },
  { pattern: /restaurant|eatery|grill\b|buka|mama\s*put|canteen|cafeteria/i, category: "Food", subcategory: "Restaurants", confidence: 0.88 },
  { pattern: /supermarket|grocery|provision|foodstuff/i, category: "Food", subcategory: "Groceries", confidence: 0.87 },
  { pattern: /bakery|cake|confection/i, category: "Food", subcategory: "Snacks", confidence: 0.85 },
  { pattern: /pizza|shawarma|suya|barbeque|bbq/i, category: "Food", subcategory: "Restaurants", confidence: 0.9 },

  // ── Bills ────────────────────────────────────────────────────────────────────
  { pattern: /MTN\b.*data|data.*MTN\b|MTN.*bundle|MTN.*2\.?5GB|MTN.*1GB/i, category: "Bills", subcategory: "Mobile Data", merchant: "MTN", confidence: 0.99 },
  { pattern: /airtel.*data|data.*airtel|airtel.*bundle/i, category: "Bills", subcategory: "Mobile Data", merchant: "Airtel", confidence: 0.99 },
  { pattern: /glo.*data|data.*glo|glo.*bundle/i, category: "Bills", subcategory: "Mobile Data", merchant: "Glo", confidence: 0.99 },
  { pattern: /9mobile|etisalat.*data/i, category: "Bills", subcategory: "Mobile Data", merchant: "9mobile", confidence: 0.99 },
  { pattern: /MTN\b.*airtime|airtime.*MTN|MTN.*recharge/i, category: "Bills", subcategory: "Airtime", merchant: "MTN", confidence: 0.99 },
  { pattern: /airtel.*airtime|airtime.*airtel|airtel.*recharge/i, category: "Bills", subcategory: "Airtime", merchant: "Airtel", confidence: 0.99 },
  { pattern: /glo.*airtime|airtime.*glo|glo.*recharge/i, category: "Bills", subcategory: "Airtime", merchant: "Glo", confidence: 0.99 },
  { pattern: /DSTV|GOTV|startimes/i, category: "Bills", subcategory: "Cable TV", confidence: 0.99 },
  { pattern: /NEPA|PHCN|EKEDC|EEDC|IBEDC|KEDCO|PHEDC|AEDC|electricity|prepaid.*meter|DISCO\b/i, category: "Bills", subcategory: "Electricity", confidence: 0.98 },
  { pattern: /spectranet|smile\s*comm|swift\s*net|ipnx|cool\s*link|internet\s*sub|wifi.*sub|broadband/i, category: "Bills", subcategory: "Internet", confidence: 0.97 },
  { pattern: /water\s*corp|water\s*board|water\s*bill/i, category: "Bills", subcategory: "Water", confidence: 0.97 },
  { pattern: /gas\s*bill|cooking\s*gas|lpg/i, category: "Bills", subcategory: "Gas", confidence: 0.95 },
  { pattern: /LAWMA|waste\s*mgmt|waste\s*management/i, category: "Bills", subcategory: "Utilities", confidence: 0.93 },

  // ── Transport ────────────────────────────────────────────────────────────────
  { pattern: /\bUBER\b/i, category: "Transport", subcategory: "Ride-hailing", merchant: "Uber", confidence: 0.99 },
  { pattern: /\bBOLT\b.*trip|trip.*\bBOLT\b|taxify/i, category: "Transport", subcategory: "Ride-hailing", merchant: "Bolt", confidence: 0.99 },
  { pattern: /indriver|in\s*driver/i, category: "Transport", subcategory: "Ride-hailing", merchant: "InDriver", confidence: 0.98 },
  { pattern: /fuel|petrol|pump|filling\s*station|NNPC|total\s*energies|mob[i]l|ardova/i, category: "Transport", subcategory: "Fuel", confidence: 0.97 },
  { pattern: /bus\s*fare|danfo|BRT\b|LRT\b|train\s*fare|rail/i, category: "Transport", subcategory: "Public Transport", confidence: 0.92 },
  { pattern: /mechanic|auto\s*repair|car\s*service|vehicle\s*service|tyre|tire/i, category: "Transport", subcategory: "Vehicle Maintenance", confidence: 0.9 },
  { pattern: /parking|park\s*fee/i, category: "Transport", subcategory: "Parking", confidence: 0.92 },
  { pattern: /okada|keke\s*marwa|tricycle|motorcycle/i, category: "Transport", subcategory: "Ride-hailing", confidence: 0.88 },

  // ── Shopping ─────────────────────────────────────────────────────────────────
  { pattern: /jumia\b(?!.*food)|konga\b/i, category: "Shopping", subcategory: "Online Shopping", confidence: 0.95 },
  { pattern: /amazon(?!.*prime|.*video|.*music)/i, category: "Shopping", subcategory: "Online Shopping", merchant: "Amazon", confidence: 0.9 },
  { pattern: /aliexpress|shein|temu|ebay/i, category: "Shopping", subcategory: "Online Shopping", confidence: 0.97 },
  { pattern: /clothing|fashion|boutique|clothes|apparel|wears/i, category: "Shopping", subcategory: "Clothing", confidence: 0.88 },
  { pattern: /electronics|gadget|computer|laptop|phone\s*shop|slot\b/i, category: "Shopping", subcategory: "Electronics", confidence: 0.87 },
  { pattern: /household|home\s*stuff|furniture|ikea/i, category: "Shopping", subcategory: "Household", confidence: 0.85 },
  { pattern: /pharmacy|chemist|drugstore|drugs/i, category: "Health", subcategory: "Pharmacy", confidence: 0.92 },
  { pattern: /salon|barber|haircut|beauty|spa\b|nail/i, category: "Shopping", subcategory: "Personal Care", confidence: 0.88 },

  // ── Entertainment ────────────────────────────────────────────────────────────
  { pattern: /NETFLIX/i, category: "Subscriptions", subcategory: "Streaming", merchant: "Netflix", isSubscription: true, confidence: 0.99 },
  { pattern: /SPOTIFY/i, category: "Subscriptions", subcategory: "Music", merchant: "Spotify", isSubscription: true, confidence: 0.99 },
  { pattern: /APPLE.*MUSIC|ITUNES\b/i, category: "Subscriptions", subcategory: "Music", merchant: "Apple Music", isSubscription: true, confidence: 0.99 },
  { pattern: /YOUTUBE.*PREMIUM|YT.*PREMIUM/i, category: "Subscriptions", subcategory: "Streaming", merchant: "YouTube Premium", isSubscription: true, confidence: 0.99 },
  { pattern: /AMAZON.*PRIME|PRIME.*VIDEO/i, category: "Subscriptions", subcategory: "Streaming", merchant: "Amazon Prime", isSubscription: true, confidence: 0.99 },
  { pattern: /APPLE.*TV\+?|APPLE.*ARCADE/i, category: "Subscriptions", subcategory: "Streaming", merchant: "Apple TV+", isSubscription: true, confidence: 0.99 },
  { pattern: /DISNEY\+?|HULU\b|HBO\b|PARAMOUNT\+?/i, category: "Subscriptions", subcategory: "Streaming", confidence: 0.98, isSubscription: true },
  { pattern: /SHOWMAX/i, category: "Subscriptions", subcategory: "Streaming", merchant: "Showmax", isSubscription: true, confidence: 0.99 },
  { pattern: /cinema|silverbird|genesis\s*cinema|filmhouse/i, category: "Entertainment", subcategory: "Cinema", confidence: 0.95 },
  { pattern: /concert|event\s*ticket|shows|live\s*show/i, category: "Entertainment", subcategory: "Events", confidence: 0.88 },
  { pattern: /game\b|playstation|xbox|steam|nintendo/i, category: "Entertainment", subcategory: "Games", confidence: 0.9 },
  { pattern: /audible\b/i, category: "Subscriptions", subcategory: "Education", merchant: "Audible", isSubscription: true, confidence: 0.99 },

  // ── Subscriptions ────────────────────────────────────────────────────────────
  { pattern: /MICROSOFT.*365|OFFICE.*365|MS.*365/i, category: "Subscriptions", subcategory: "Software", merchant: "Microsoft 365", isSubscription: true, confidence: 0.99 },
  { pattern: /GOOGLE.*ONE|GOOGLE.*STORAGE|GOOGLE.*WORKSPACE/i, category: "Subscriptions", subcategory: "Cloud Services", merchant: "Google", isSubscription: true, confidence: 0.99 },
  { pattern: /ICLOUD|APPLE\b.*\bSTORAGE/i, category: "Subscriptions", subcategory: "Cloud Services", merchant: "iCloud", isSubscription: true, confidence: 0.99 },
  { pattern: /DROPBOX\b/i, category: "Subscriptions", subcategory: "Cloud Services", merchant: "Dropbox", isSubscription: true, confidence: 0.99 },
  { pattern: /CANVA\b.*PRO|ADOBE\b/i, category: "Subscriptions", subcategory: "Software", confidence: 0.98, isSubscription: true },
  { pattern: /GYM|FITNESS|CROSSFIT|FLEX\s*NAIRA/i, category: "Subscriptions", subcategory: "Fitness", confidence: 0.9, isSubscription: true },
  { pattern: /COURSERA|UDEMY|SKILLSHARE|MASTERCLASS|PLURALSIGHT|LINKEDIN.*LEARNING/i, category: "Subscriptions", subcategory: "Education", confidence: 0.97, isSubscription: true },
  { pattern: /CHATGPT|OPENAI|CLAUDE\b.*PRO/i, category: "Subscriptions", subcategory: "Software", confidence: 0.97, isSubscription: true },
  { pattern: /NOTION\b|FIGMA\b|SLACK\b.*SUB|ZOOM\b.*PRO/i, category: "Subscriptions", subcategory: "Software", confidence: 0.96, isSubscription: true },
  { pattern: /VPN\b|NORDVPN|EXPRESSVPN|SURFSHARK/i, category: "Subscriptions", subcategory: "Software", confidence: 0.95, isSubscription: true },

  // ── Financial / Bank Charges ──────────────────────────────────────────────────
  { pattern: /maintenance\s*fee|account.*fee|monthly.*fee|sms.*charge|card.*fee|stamp\s*duty/i, category: "Financial", subcategory: "Bank Charges", isBankCharge: true, confidence: 0.97 },
  { pattern: /ATM.*charge|cash.*withdrawal.*charge|withdrawal.*fee/i, category: "Financial", subcategory: "ATM Fees", isBankCharge: true, confidence: 0.97 },
  { pattern: /transfer.*fee|transaction.*fee|inter.*bank.*fee/i, category: "Financial", subcategory: "Transfer Fees", isBankCharge: true, confidence: 0.96 },
  { pattern: /loan.*repay|repayment.*loan|EMI\b|installment/i, category: "Financial", subcategory: "Loans", confidence: 0.92 },
  { pattern: /interest.*debit|interest.*charge/i, category: "Financial", subcategory: "Interest", isBankCharge: true, confidence: 0.9 },
  { pattern: /insurance\b/i, category: "Financial", subcategory: "Insurance", confidence: 0.88 },
  { pattern: /\bCOT\b|commission.*turnover/i, category: "Financial", subcategory: "Bank Charges", isBankCharge: true, confidence: 0.97 },

  // ── Housing ──────────────────────────────────────────────────────────────────
  { pattern: /rent\b|tenancy|landlord|lease\s*pay/i, category: "Housing", subcategory: "Rent", confidence: 0.95 },
  { pattern: /service\s*charge|estate\s*levy|facility\s*management/i, category: "Housing", subcategory: "Maintenance", confidence: 0.88 },
  { pattern: /property\s*tax|ground\s*rent|caretaker/i, category: "Housing", subcategory: "Other", confidence: 0.87 },

  // ── Health ────────────────────────────────────────────────────────────────────
  { pattern: /hospital|clinic|medical\s*centre|health\s*center/i, category: "Health", subcategory: "Hospital", confidence: 0.95 },
  { pattern: /HMO\b|health\s*insurance|NHIS\b/i, category: "Health", subcategory: "Health Insurance", confidence: 0.93 },
  { pattern: /laboratory|lab\s*test|scan\b|X-ray/i, category: "Health", subcategory: "Medical Tests", confidence: 0.92 },
  { pattern: /dentist|dental\b/i, category: "Health", subcategory: "Dental", confidence: 0.95 },

  // ── Education ─────────────────────────────────────────────────────────────────
  { pattern: /school\s*fee|tuition\b|academy|university|college\b/i, category: "Education", subcategory: "School Fees", confidence: 0.95 },
  { pattern: /book\s*shop|textbook|stationery/i, category: "Education", subcategory: "Books & Supplies", confidence: 0.88 },
  { pattern: /WAEC|JAMB|NECO\b|NABTEB/i, category: "Education", subcategory: "Exams", confidence: 0.98 },

  // ── Savings ───────────────────────────────────────────────────────────────────
  { pattern: /piggybank|cowrywise|rising.*finance|bamboo.*inv|risevest|kuda.*save|stash\b/i, category: "Savings", subcategory: "Investment App", confidence: 0.97 },
  { pattern: /fixed\s*deposit|term\s*deposit|savings.*plan/i, category: "Savings", subcategory: "Fixed Deposit", confidence: 0.93 },
  { pattern: /ajo\b|esusu\b|thrift\b/i, category: "Savings", subcategory: "Cooperative", confidence: 0.92 },
  { pattern: /stanbic.*investment|fidelity.*inv|zenith.*inv|access.*inv/i, category: "Savings", subcategory: "Investment", confidence: 0.9 },

  // ── People Transfers ──────────────────────────────────────────────────────────
  { pattern: /transfer\s*to\s+([A-Z][A-Z\s]{2,40})/i, category: "People", subcategory: "Personal Transfer", confidence: 0.82 },
  { pattern: /send\s*to\s+([A-Z][A-Z\s]{2,40})/i, category: "People", subcategory: "Personal Transfer", confidence: 0.82 },
  { pattern: /TRF\s*\/\s*([A-Z][A-Z\s]{2,40})/i, category: "People", subcategory: "Personal Transfer", confidence: 0.85 },
  { pattern: /NIP\s*\/\s*([A-Z][A-Z\s]{2,40})/i, category: "People", subcategory: "Personal Transfer", confidence: 0.85 },
  { pattern: /sent\s*to\s+([A-Z][A-Z\s]{2,40})/i, category: "People", subcategory: "Personal Transfer", confidence: 0.82 },
  { pattern: /payment\s*to\s+([A-Z][A-Z\s]{2,40})/i, category: "People", subcategory: "Personal Transfer", confidence: 0.78 },
];

// ─── Known Merchant Map ───────────────────────────────────────────────────────

const MERCHANT_MAP: Record<string, { merchant: string; category: string; subcategory: string; entityType: string }> = {
  mtn: { merchant: "MTN", category: "Bills", subcategory: "Mobile Data", entityType: "utility" },
  airtel: { merchant: "Airtel", category: "Bills", subcategory: "Mobile Data", entityType: "utility" },
  glo: { merchant: "Glo", category: "Bills", subcategory: "Mobile Data", entityType: "utility" },
  "9mobile": { merchant: "9mobile", category: "Bills", subcategory: "Mobile Data", entityType: "utility" },
  netflix: { merchant: "Netflix", category: "Subscriptions", subcategory: "Streaming", entityType: "subscription" },
  spotify: { merchant: "Spotify", category: "Subscriptions", subcategory: "Music", entityType: "subscription" },
  apple: { merchant: "Apple", category: "Subscriptions", subcategory: "Software", entityType: "subscription" },
  google: { merchant: "Google", category: "Subscriptions", subcategory: "Cloud Services", entityType: "subscription" },
  amazon: { merchant: "Amazon", category: "Shopping", subcategory: "Online Shopping", entityType: "merchant" },
  uber: { merchant: "Uber", category: "Transport", subcategory: "Ride-hailing", entityType: "merchant" },
  bolt: { merchant: "Bolt", category: "Transport", subcategory: "Ride-hailing", entityType: "merchant" },
  shoprite: { merchant: "Shoprite", category: "Food", subcategory: "Groceries", entityType: "merchant" },
  jumia: { merchant: "Jumia", category: "Shopping", subcategory: "Online Shopping", entityType: "merchant" },
  konga: { merchant: "Konga", category: "Shopping", subcategory: "Online Shopping", entityType: "merchant" },
  flutterwave: { merchant: "Flutterwave", category: "Financial", subcategory: "Transfer Fees", entityType: "bank" },
  paystack: { merchant: "Paystack", category: "Financial", subcategory: "Transfer Fees", entityType: "bank" },
};

// ─── Person Name Patterns ─────────────────────────────────────────────────────

const NIGERIAN_NAMES = [
  "chioma", "chidi", "emeka", "ngozi", "amaka", "obinna", "adaeze", "chukwu",
  "kemi", "tunde", "bola", "ade", "segun", "funmi", "yemi", "tobi", "lola",
  "wale", "kunle", "deji", "biodun", "tosin", "femi", "sade", "ola",
  "garba", "musa", "abubakar", "ibrahim", "fatima", "amina", "halima",
  "yakubu", "aliyu", "usman", "shehu", "babangida", "abdullahi",
  "blessing", "favor", "grace", "patience", "joy", "faith", "mercy",
  "prosper", "Emmanuel", "victory", "success", "precious",
  "yuanna", "yuana", "johnson", "williams", "okafor", "okonkwo",
  "adeyemi", "bakare", "eze", "nwosu", "obi", "dike",
];

// ─── Classifier ───────────────────────────────────────────────────────────────

export class TransactionClassifier {
  private fuseNames: Fuse<string>;

  constructor() {
    this.fuseNames = new Fuse(NIGERIAN_NAMES, {
      threshold: 0.35,
      includeScore: true,
    });
  }

  classify(description: string): ClassificationResult {
    const upper = description.toUpperCase();
    const lower = description.toLowerCase();
    const normalized = description.trim();

    // 1. Try pattern matching first (highest confidence)
    for (const p of PATTERNS) {
      const regex =
        typeof p.pattern === "string" ? new RegExp(p.pattern, "i") : p.pattern;
      if (regex.test(normalized)) {
        const entityInfo = this.extractEntity(normalized, p.category);
        return {
          category: p.category,
          subcategory: p.subcategory,
          merchant: p.merchant || entityInfo.merchant,
          entity: entityInfo.entity || p.merchant,
          entityType: (p.entityType as ClassificationResult["entityType"]) || entityInfo.entityType,
          confidence: p.confidence,
          isRecurring: p.isRecurring || p.isSubscription,
          isSubscription: p.isSubscription || false,
          isBankCharge: p.isBankCharge || false,
          classifiedBy: "rule",
        };
      }
    }

    // 2. Try merchant map
    for (const [key, val] of Object.entries(MERCHANT_MAP)) {
      if (lower.includes(key)) {
        return {
          category: val.category,
          subcategory: val.subcategory,
          merchant: val.merchant,
          entity: val.merchant,
          entityType: val.entityType as ClassificationResult["entityType"],
          confidence: 0.94,
          isSubscription: val.entityType === "subscription",
          classifiedBy: "rule",
        };
      }
    }

    // 3. Check for person name patterns
    const personResult = this.classifyPerson(normalized);
    if (personResult) return personResult;

    // 4. Check for account number patterns (unknown transfers)
    if (this.isAccountNumberTransfer(normalized)) {
      return {
        category: "People",
        subcategory: "Personal Transfer",
        confidence: 0.6,
        entityType: "unknown",
        classifiedBy: "rule",
      };
    }

    // 5. Default with low confidence
    return {
      category: "Other",
      confidence: 0.3,
      isUncertain: true,
      classifiedBy: "rule",
    } as ClassificationResult;
  }

  private extractEntity(description: string, category: string): {
    entity?: string;
    merchant?: string;
    entityType?: ClassificationResult["entityType"];
  } {
    // Try to extract entity name from transfer patterns
    const transferPatterns = [
      /transfer\s+to\s+([A-Z][A-Z\s]{2,40}?)(?:\s+via|\s+using|\s*$)/i,
      /TRF\/([A-Z][A-Z\s]{2,40}?)(?:\s|$)/i,
      /NIP\/([A-Z][A-Z\s]{2,40}?)(?:\s|$)/i,
      /sent\s+to\s+([A-Z][A-Z\s]{2,40}?)(?:\s*$)/i,
      /payment\s+to\s+([A-Z][A-Z\s]{2,40}?)(?:\s*$)/i,
    ];

    if (category === "People") {
      for (const p of transferPatterns) {
        const m = description.match(p);
        if (m) {
          return { entity: m[1].trim(), entityType: "person" };
        }
      }
    }

    return {};
  }

  private classifyPerson(description: string): ClassificationResult | null {
    const lower = description.toLowerCase();

    // Match transfer/send patterns followed by a name
    const transferRegex =
      /(?:transfer|trf|nip|send|sent|payment|pay)\s*[\/\-]?\s*([a-z][a-z\s]{2,40})/i;
    const match = description.match(transferRegex);

    if (match) {
      const namePart = match[1].trim().toLowerCase();

      // Check if it matches known names
      const fuseResult = this.fuseNames.search(namePart);
      if (fuseResult.length > 0 && fuseResult[0].score! < 0.4) {
        const canonicalName = this.toTitleCase(namePart);
        return {
          category: "People",
          subcategory: "Personal Transfer",
          entity: canonicalName,
          entityType: "person",
          confidence: 0.82,
          classifiedBy: "rule",
        };
      }

      // Still likely a person even without a name match if it's a transfer
      const wordCount = namePart.split(/\s+/).length;
      if (wordCount <= 4 && /^[a-z\s]+$/.test(namePart)) {
        return {
          category: "People",
          subcategory: "Personal Transfer",
          entity: this.toTitleCase(namePart),
          entityType: "person",
          confidence: 0.72,
          classifiedBy: "rule",
        };
      }
    }

    return null;
  }

  private isAccountNumberTransfer(description: string): boolean {
    // Nigerian account numbers are 10 digits
    return /\b\d{10}\b/.test(description);
  }

  private toTitleCase(str: string): string {
    return str
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  extractMerchantName(description: string): string | undefined {
    const lower = description.toLowerCase();
    for (const [key, val] of Object.entries(MERCHANT_MAP)) {
      if (lower.includes(key)) return val.merchant;
    }

    // Try to get first significant word
    const words = description
      .replace(/[^a-zA-Z\s]/g, " ")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (words.length > 0) {
      const skip = new Set(["the", "and", "for", "from", "transfer", "payment", "purchase", "via"]);
      const meaningful = words.find((w) => !skip.has(w.toLowerCase()));
      return meaningful ? meaningful.toUpperCase() : undefined;
    }

    return undefined;
  }

  isLikelyPerson(description: string): boolean {
    const r = this.classify(description);
    return r.category === "People";
  }

  batchClassify(descriptions: string[]): ClassificationResult[] {
    return descriptions.map((d) => this.classify(d));
  }
}

export const classifier = new TransactionClassifier();
