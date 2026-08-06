# P3 release-boundary follow-up — 2026-08-03

## Scope

This was a read-only check of the authenticated trace release boundary. It did
not apply migrations, submit an instruction, approve an action, or change
production state.

## Checks and results

- The frontend restore path was re-read in the current worktree. It persists
  the exact `instructionId` in `sessionStorage`, fetches both
  `GET /instructions/:id` and `GET /instructions/:id/events?after=0`, folds
  returned events, and resumes transport from the last sequence for a
  non-terminal snapshot. Terminal snapshots clear the pointer intentionally.
- A read-only PostgREST attempt to inspect `finnor_os._migrations` was not
  available through the configured REST schema: the request returned
  `PGRST106` because `finnor_os` is not an exposed REST schema. A public
  `_migrations` request returned `PGRST205` because that table is not in the
  public schema cache. These results do **not** prove whether migration 0062 is
  applied.
- Authentication against the configured JARVIS service account succeeded for
  this bounded read-only probe. Direct authenticated requests to the deployed
  API for an all-zero unknown UUID returned `404 Instruction not found` for
  both the instruction route and its event route. This proves the deployed
  routes reached their tenant-scoped not-found boundary rather than returning
  the unauthenticated `401` or a missing-table `500`; it does not prove a real
  instruction trace or migration ledger state.
- The existing Chrome binding no longer had the previously claimed owner tab
  available to the browser-control session (`Tab not found`; the browser
  session reported no existing tabs). No new browser interaction was attempted
  from that state.

## Gate consequence

The release boundary is partially narrowed, but the exact production migration
ledger, a real authenticated instruction/event trace, live event→pixel/CLS,
and mid-flight restore remain unproven. No score moved: P3 remains **2/7
supported**, the evidence-backed score remains **10/100**, and no Phase 3
completion claim is made.
