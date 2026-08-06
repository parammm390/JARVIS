// F7.T2 — FLOW-95 DrawerToPage / FLOW-96 ListToDetail: ActivityTheater's feed rows
// live in Bridge's RightRail while the receipt scene they open now lives in
// CenterStage (bridge/Bridge.tsx) — two siblings under BridgeShell with no shared
// parent state today. A tiny single-listener channel (same "no new transport, just
// republish a real click" shape as pulse-bus.ts's own anchor registry) lets a row
// request the Bridge-level receipt scene without prop-drilling through RightRail/
// CenterStage. Bridge is the only subscriber by design — this is not a general
// event bus, just a named hop for one real UI action.
export interface ReceiptSceneRequest {
  receiptId: string
  rowLayoutId: string
}

const RECEIPT_HASH_PREFIX = "#receipt-"

/** The canonical address used by every receipt surface, including copied links. */
export function receiptHash(receiptId: string): string {
  return `${RECEIPT_HASH_PREFIX}${encodeURIComponent(receiptId)}`
}

/** Useful clipboard content for a receipt action: readable facts plus an
 * addressable link, never just an opaque identifier or raw JSON. */
export function receiptCopyText(input: {
  receiptId: string
  objective: string
  outcome: string
  href: string
}): string {
  return [
    `JARVIS receipt · ${input.objective}`,
    `Outcome: ${input.outcome}`,
    `Receipt ID: ${input.receiptId}`,
    `Open: ${input.href}`,
  ].join("\n")
}

/** Parse only the receipt hash shape; malformed hashes stay on the current page. */
export function receiptIdFromHash(hash: string): string | null {
  if (!hash.startsWith(RECEIPT_HASH_PREFIX)) return null
  const encoded = hash.slice(RECEIPT_HASH_PREFIX.length)
  if (!encoded || encoded.includes("/") || encoded.includes("?")) return null
  try {
    const id = decodeURIComponent(encoded)
    return /^[a-zA-Z0-9_-]+$/.test(id) ? id : null
  } catch {
    return null
  }
}

type Listener = (req: ReceiptSceneRequest) => void

let listener: Listener | null = null

export function onReceiptSceneRequest(cb: Listener): () => void {
  listener = cb
  return () => {
    if (listener === cb) listener = null
  }
}

export function requestReceiptScene(req: ReceiptSceneRequest): void {
  listener?.(req)
}
