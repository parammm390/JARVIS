# P2.T5 — Cash Pressure Field verification

## Source binding

- `/resources/invoices` is the exact invoice ledger source for invoice ID, household ID, amount, status, memo, due date, and created timestamp.
- `/read-models/cash-collections` is reused for collected total and payment-link workflow summary.
- `read-models/work-cases` is reused and filtered only by the exact invoice-to-cash action family: `start_invoice_to_cash_workflow`, `create_invoice`, `send_payment_reminder`, `record_payment`, and `call_overdue_invoices`.
- Invoice detail links back to the exact household ID, invoice-linked Work case IDs, and receipt IDs. The surface exposes no payment mutation or bypass path.

## Truth behavior

- Aging bands are rendered only when every open (`sent` or `overdue`) invoice has a usable due date and numeric amount.
- When due-date or amount truth is incomplete, the surface renders the exact invoice ledger and an honest fallback message instead of synthesizing aging buckets or zero values.
- Payment and communication facts are read through the existing Household 360 read model after an exact invoice is selected.
- No invoice, collection case, payment event, or evidence receipt is fabricated when source data is absent.

## Verification

- `npx vitest run src/components/jarvis/panels/CashPressureSurface.test.ts --reporter=verbose` — 3/3 passed.
- `npx tsc -p tsconfig.json --noEmit --pretty false --incremental false` — passed.
- `npm run lint` — passed with no warnings or errors.
- `git diff --check` — passed.
- In-app Browser route `/jarvis/money` — truthful unauthenticated state; no private data exposed.
- Responsive metrics at 1440×900, 768×1024, and 390×844 — zero horizontal overflow; see `responsive-metrics.json`.

## Boundary

No authenticated tenant session was available for a populated Cash Pressure capture. The real route therefore shows `Cash Pressure is unavailable` and `Sign in`; no fixture invoices, aging bars, collection Work, payment facts, or evidence links were added. Populated visual evidence remains `BLOCKED-ENV` while source, contract, truth, and responsive checks are green.
