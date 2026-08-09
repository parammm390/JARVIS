# P3.T3 — Agent → Work → Customer causal links

Status: complete. The causal path is source-backed and deliberately narrow.

## Implemented source edges

- Outbound voice writers carry only a bounded, server-side envelope: `agentKey`, executor-stamped `domainActionId`, resolved `householdId`, optional `invoiceId`, purpose, and `direction: outbound`.
- The Vapi webhook whitelists that envelope into the durable call row. It does not copy provider metadata wholesale or expose provider assistant IDs to the browser.
- Inbound call persistence resolves the caller through the existing `resolveVoiceIdentity(tenantId, customer.number)` path and writes the exact matched household when one exists.
- Work links outbound calls to actions only through `calls.raw.domainActionId` → `domain_actions.id`.
- Work links a persisted call to its customer only through `calls.conversation_id` → `conversations.household_id`.
- Work exposes safe call facts (`agentKey`, direction, outcome, household ID) but no raw provider payload.

## Agent filters

- Payment Collector: `call_overdue_invoices`, or `send_payment_reminder` with the authoritative `channel: call` payload.
- Service Reminder, Follow-up, and Win-back: only validated `bulk_notify_existing_customers` calls with their exact `voicePersona`.
- JARVIS: instruction-rooted Work only; provider health/config is never promoted into agent readiness.
- Unknown personas, SMS rows, untagged calls, matching titles, matching timestamps, and shared customers do not create an agent edge.

## Verification

- Root Fleet projection tests: `npx vitest run src/components/jarvis/agents/agent-fleet.test.ts --reporter=verbose` — 8/8.
- Finnor OS causal/schema tests: `npx vitest run tests/unit/vapi-webhook-schema.test.ts tests/unit/voice-personas.test.ts tests/unit/provider-health.test.ts tests/unit/work-cases.test.ts --reporter=verbose` — 25/25.
- Full frontend suite: `npx vitest run --reporter=dot` — 49 files / 484 tests.
- Root TypeScript: `npx tsc --noEmit --pretty false` — pass.
- Finnor OS TypeScript: `npx tsc -p tsconfig.json --noEmit --types node --pretty false` — pass. The plain script remains blocked by stale workspace `@types/* 2` directories; the explicit Node type set is the same compiler with the invalid implicit library scan removed.
- Root lint: `npm run lint` — no warnings or errors.
- Responsive/auth boundary: `e2e/jarvis-p3-t3-agent-causality.spec.ts` — 1/1 at 1440/768/390; no unauthenticated `read-models/work-cases` request, no unexpected console/page errors, no horizontal overflow, and inspector closed by default.
- Prior in-app browser bootstrap remains `BLOCKED-ENV` (`Cannot redefine property: process`); Playwright was used for the bounded local visual audit and the limitation is not treated as provider evidence.

Captures and metrics are in this directory.
