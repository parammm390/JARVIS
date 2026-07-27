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
