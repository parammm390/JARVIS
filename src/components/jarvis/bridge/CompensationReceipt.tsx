import { FieldList } from "./ThreadVerification"

export interface CompensationReceiptData {
  status: "compensated" | "compensation_failed"
  caseId: string
  reason: string
  error?: string
}

export function compensationReceiptFromActual(actualResult: unknown): CompensationReceiptData | null {
  if (!actualResult || typeof actualResult !== "object") return null
  const compensation = (actualResult as Record<string, unknown>).compensation
  if (!compensation || typeof compensation !== "object") return null
  const value = compensation as Record<string, unknown>
  if ((value.status !== "compensated" && value.status !== "compensation_failed") || typeof value.caseId !== "string" || typeof value.reason !== "string") return null
  return { status: value.status, caseId: value.caseId, reason: value.reason, ...(typeof value.error === "string" ? { error: value.error } : {}) }
}

/** P7.T3: an in-place receipt section for the backend's recorded compensation
 * outcome. It deliberately shows the case id and reason, rather than claiming an
 * undo occurred merely because a run changed state. */
export function CompensationReceipt({ actualResult }: { actualResult: unknown }) {
  const compensation = compensationReceiptFromActual(actualResult)
  if (!compensation) return null
  const rolledBack = compensation.status === "compensated"
  return (
    <section className={`rounded-xl border p-3 ${rolledBack ? "border-amber-300/30 bg-amber-300/5" : "border-red-400/30 bg-red-400/5"}`}>
      <p className={`j-fs-micro font-black uppercase tracking-widest ${rolledBack ? "text-amber-200" : "text-red-300"}`}>{rolledBack ? "Rolled back" : "Rollback failed"}</p>
      <p className="mt-1 j-fs-sm text-[color:var(--j-text-dim)]">{compensation.reason}</p>
      <div className="mt-2"><FieldList value={{ compensationCaseId: compensation.caseId, ...(compensation.error ? { error: compensation.error } : {}) }} /></div>
    </section>
  )
}
