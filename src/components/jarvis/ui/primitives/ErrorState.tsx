"use client"

// C3.T2 — ErrorState with a recovery action, per plan spec. The pattern already
// existed inline at several fetch-error call sites (a red-tinted div + message,
// e.g. ReceiptDrawer's `error &&` block, LiveQueryFixtureSection on the Stage) but
// never as a named, reusable component with an actual retry affordance — this adds
// the retry action those inline versions were missing, not just a repackaging.

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 rounded-full border border-red-400/40 px-2.5 py-1 text-[9.5px] font-bold text-red-200 hover:bg-red-400/10">
          Retry
        </button>
      )}
    </div>
  )
}
