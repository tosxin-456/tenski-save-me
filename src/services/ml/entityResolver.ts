import Fuse from "fuse.js";
import type { ResolvedEntity } from "../../types";

interface EntityRecord {
  id: string;
  canonicalName: string;
  type: ResolvedEntity["type"];
  aliases: string[];
  accountNumber?: string;
  confidence: number;
}

// ─── Entity Resolver ──────────────────────────────────────────────────────────

export class EntityResolver {
  private entities: EntityRecord[] = [];
  private fuse: Fuse<EntityRecord>;
  private aliasIndex: Map<string, EntityRecord> = new Map();

  constructor() {
    this.fuse = this.buildFuse();
  }

  private buildFuse(): Fuse<EntityRecord> {
    return new Fuse(this.entities, {
      keys: ["canonicalName", "aliases"],
      threshold: 0.35,
      includeScore: true,
      minMatchCharLength: 3,
    });
  }

  loadEntities(records: EntityRecord[]): void {
    this.entities = records;
    this.fuse = this.buildFuse();
    this.aliasIndex.clear();
    for (const e of records) {
      const key = this.normalizeKey(e.canonicalName);
      this.aliasIndex.set(key, e);
      for (const alias of e.aliases) {
        this.aliasIndex.set(this.normalizeKey(alias), e);
      }
    }
  }

  resolve(rawName: string, accountNumber?: string): ResolvedEntity | null {
    if (!rawName || rawName.trim().length < 2) return null;

    // 1. Account number exact match (highest confidence)
    if (accountNumber) {
      for (const e of this.entities) {
        if (e.accountNumber === accountNumber) {
          return {
            canonicalName: e.canonicalName,
            type: e.type,
            aliases: e.aliases,
            accountNumber: e.accountNumber,
            confidence: 0.99,
          };
        }
      }
    }

    // 2. Normalized exact alias match
    const normalizedInput = this.normalizeKey(rawName);
    const exactMatch = this.aliasIndex.get(normalizedInput);
    if (exactMatch) {
      return {
        canonicalName: exactMatch.canonicalName,
        type: exactMatch.type,
        aliases: exactMatch.aliases,
        accountNumber: exactMatch.accountNumber,
        confidence: 0.97,
      };
    }

    // 3. Fuzzy match via Fuse.js
    const results = this.fuse.search(rawName);
    if (results.length > 0 && results[0].score! < 0.3) {
      const best = results[0].item;
      return {
        canonicalName: best.canonicalName,
        type: best.type,
        aliases: best.aliases,
        accountNumber: best.accountNumber,
        confidence: 1 - results[0].score!,
      };
    }

    // 4. Partial name matching (handles "YUANNA" vs "YUANNA ADEBAYO")
    const partialMatch = this.findPartialMatch(normalizedInput);
    if (partialMatch) {
      return {
        canonicalName: partialMatch.canonicalName,
        type: partialMatch.type,
        aliases: partialMatch.aliases,
        accountNumber: partialMatch.accountNumber,
        confidence: 0.78,
      };
    }

    return null;
  }

  suggestCanonical(rawName: string): string {
    // Clean up raw transaction description to produce a canonical name
    let name = rawName
      .replace(/^(TRANSFER\s+TO|TRF\/|NIP\/|SEND\s+TO|SENT\s+TO|PAYMENT\s+TO)\s*/i, "")
      .replace(/\s*\(.*?\)\s*/g, "")
      .replace(/\d{10,}/g, "") // Remove account numbers
      .replace(/[^a-zA-Z\s\-'\.]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Title case
    return name
      .split(" ")
      .map((w) => {
        if (w.length <= 1) return w;
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      })
      .filter((w) => w.length > 0)
      .join(" ");
  }

  addAlias(entityId: string, alias: string): void {
    const entity = this.entities.find((e) => e.id === entityId);
    if (entity && !entity.aliases.includes(alias)) {
      entity.aliases.push(alias);
      this.aliasIndex.set(this.normalizeKey(alias), entity);
      this.fuse = this.buildFuse();
    }
  }

  private normalizeKey(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private findPartialMatch(normalizedInput: string): EntityRecord | null {
    const inputWords = new Set(normalizedInput.split(/\s+/));
    let bestMatch: EntityRecord | null = null;
    let bestOverlap = 0;

    for (const entity of this.entities) {
      const entityWords = new Set(
        this.normalizeKey(entity.canonicalName).split(/\s+/)
      );

      // Check overlap between input words and entity name words
      let overlap = 0;
      for (const w of inputWords) {
        if (entityWords.has(w) && w.length > 2) overlap++;
      }

      if (overlap > bestOverlap && overlap >= Math.min(inputWords.size, entityWords.size) * 0.5) {
        bestOverlap = overlap;
        bestMatch = entity;
      }

      // Also check aliases
      for (const alias of entity.aliases) {
        const aliasWords = new Set(this.normalizeKey(alias).split(/\s+/));
        overlap = 0;
        for (const w of inputWords) {
          if (aliasWords.has(w) && w.length > 2) overlap++;
        }
        if (overlap > bestOverlap && overlap >= Math.min(inputWords.size, aliasWords.size) * 0.5) {
          bestOverlap = overlap;
          bestMatch = entity;
        }
      }
    }

    return bestOverlap >= 1 ? bestMatch : null;
  }
}

export const entityResolver = new EntityResolver();
