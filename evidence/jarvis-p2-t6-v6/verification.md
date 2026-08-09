# P2.T6 — Cross-surface causal continuity verification

## Exact-ID route contract

| Required handoff | Exact route/evidence |
|---|---|
| Home → Work | Home operational dock links to `/jarvis/work`; a household context appends the exact `householdId`. |
| Work → Customer | `destinationForEntity()` maps the exact `household` link to `/jarvis/customers?householdId=…`. |
| Work → Schedule | `destinationForEntity()` maps exact `visit`, `service_visit`, `work_order`, or `appointment` links to Schedule query IDs. |
| Work → Money | `destinationForEntity()` maps the exact `invoice` link to `/jarvis/money?invoiceId=…` plus the exact household context when present. |
| Customer → Work/Schedule/Money | Household 360 links preserve its exact `householdId`. |
| Schedule/Money → Work | Dispatch/My-Day and Cash Pressure include exact visit/work-order/appointment/invoice/work-case/receipt IDs in their Work hrefs. |
| context dock → Home → return | Home preserves `householdId`; the Home dock propagates it back to Work, Customer, Schedule, and Money. Browser audit observed all four exact hrefs. |

Work deep-link matching requires every supplied identifier to match the same Work root's exact linked entity or receipt. Shared household or invoice IDs do not merge separate instruction roots.

## Exit gate — 11/11 green

- [x] Work matrix tests green — focused P2 surface contract 11/11; backend Work correlation/unit/integration 17/17; frontend full suite 48 files / 475 tests.
- [x] Work feels unlike a task manager — queue rows plus one closed-by-default seven-chapter Causal Spine; no generic task list/card grid.
- [x] Customer feels unlike generic CRM — dense Household 360 index and continuous identity/service-equipment/business record.
- [x] Schedule is map/My-Day dominant — existing stored-coordinate DispatchMapCore and existing technician My-Day remain the rendered sources; no calendar engine was introduced.
- [x] Money shows cash-pressure truth or honest fallback — due-date + amount gates aging; incomplete truth stays an exact invoice ledger/fallback.
- [x] Exact cross-links preserve identical facts — exact-ID helpers and route tests cover household, invoice, service visit, work order, appointment, Work case, and receipt paths.
- [x] Context command round-trip works — Home query context and surface dock hrefs were browser-audited; no command or authority boundary was bypassed.
- [x] 1440/768/390 — all five route contexts show zero horizontal overflow; see `responsive-metrics.json`.
- [x] Keyboard/reduced motion — Tab reached the Money dock link with `:focus-visible`; existing surface reduced-motion rules and focused controls remain source-verified.
- [x] No raw JSON/fake zeros — private unauthenticated routes show explicit unavailable/sign-in states; no invoice, household, map, Work, payment, or receipt facts were fabricated.
- [x] Checks green — frontend TypeScript, lint, diff check, full Vitest, proxy/client tests, and Finnor P2 integrations all pass.

## Browser evidence

- Home `/jarvis?householdId=hh-1` displayed the exact context capsule and propagated `hh-1` to Work, Customers, Schedule, and Money links.
- Work, Household 360, Dispatch Field, and Money rendered their source-backed unauthenticated boundary without private rows.
- Desktop and mobile previews were visually inspected; Work retains its causal document hierarchy and the operational dock remains horizontally scrollable without widening the page.

## Boundary

No authenticated tenant session was available for populated Work, Household 360, Dispatch/My-Day, or Cash Pressure captures. The Phase 2 exit gate is green on source contracts, exact-ID routes, truthful private-route behavior, responsive/focus evidence, and automated verification; populated Golden Frames #7–#11 remain unclaimed and are not represented by fixtures.
