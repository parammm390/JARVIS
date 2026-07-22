// D2.T1 — "param diff preview... + price-book provenance" for the Approval Cockpit.
// A domain_action payload's shape varies per action_type (41 of them); rather than
// invent a generic before/after diff engine across all of them (that's D3's renderer-
// registry job, out of scope here), this scopes to the literal, buildable ask: find
// any {sku, price} pair the planner's payload proposes and compare it against this
// tenant's real price_book_items row for that sku, so an approver can see whether a
// quoted/billed price matches the price book or is an override — real provenance, not
// a fabricated diff.

export interface PriceCandidate {
  sku: string;
  payloadPriceUsd: number | null;
}

const PRICE_KEYS = ["unitPriceUsd", "priceUsd", "unit_price_usd", "price_usd", "price"] as const;

function readPriceCandidate(obj: Record<string, unknown>): PriceCandidate | null {
  const sku = obj.sku;
  if (typeof sku !== "string" || sku.length === 0) return null;
  let payloadPriceUsd: number | null = null;
  for (const key of PRICE_KEYS) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      payloadPriceUsd = v;
      break;
    }
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      payloadPriceUsd = Number(v);
      break;
    }
  }
  return { sku, payloadPriceUsd };
}

const LINE_ITEM_KEYS = ["lineItems", "items", "products", "line_items"];
const MAX_CANDIDATES = 20;

/** Best-effort, defensive scan — never throws on an unexpected payload shape. */
export function extractPriceCandidates(payload: unknown): PriceCandidate[] {
  if (typeof payload !== "object" || payload === null) return [];
  const obj = payload as Record<string, unknown>;
  const out: PriceCandidate[] = [];

  const top = readPriceCandidate(obj);
  if (top) out.push(top);

  for (const key of LINE_ITEM_KEYS) {
    const arr = obj[key];
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      if (out.length >= MAX_CANDIDATES) break;
      if (typeof entry !== "object" || entry === null) continue;
      const candidate = readPriceCandidate(entry as Record<string, unknown>);
      if (candidate) out.push(candidate);
    }
  }
  return out.slice(0, MAX_CANDIDATES);
}

export interface PriceBookProvenanceEntry {
  sku: string;
  label: string;
  priceBookPriceUsd: number;
  payloadPriceUsd: number | null;
  matches: boolean | null;
}

/** priceBookRows: {sku, label, priceUsd (string, numeric column)}[] for this tenant. */
export function buildPriceBookProvenance(
  candidates: PriceCandidate[],
  priceBookRows: Array<{ sku: string; label: string; priceUsd: string }>,
): PriceBookProvenanceEntry[] {
  const bySku = new Map(priceBookRows.map((r) => [r.sku, r]));
  const out: PriceBookProvenanceEntry[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.sku)) continue;
    const book = bySku.get(c.sku);
    if (!book) continue;
    seen.add(c.sku);
    const priceBookPriceUsd = Number(book.priceUsd);
    out.push({
      sku: c.sku,
      label: book.label,
      priceBookPriceUsd,
      payloadPriceUsd: c.payloadPriceUsd,
      matches: c.payloadPriceUsd === null ? null : Math.abs(priceBookPriceUsd - c.payloadPriceUsd) < 0.005,
    });
  }
  return out;
}
