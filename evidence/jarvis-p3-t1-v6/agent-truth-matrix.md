# P3.T1 — Agent / provider / call truth binding

**Snapshot:** 2026-08-08 · HEAD `1ea6d4de7d5bc877b54c3bf85eb432d81dc55f98`  
**Scope:** discovery and truth binding only; no product UI was changed for P3.T1.  
**Rule:** the durable source rows and provider boundaries below are authoritative. A missing edge remains unavailable; it is not inferred from names, timing, or environment variables.

## Five-agent source matrix

| Agent | Fixed role copy | Source identity / binding | Config or health source | Activity source | Work / customer link | Rendered status allowed now |
|---|---|---|---|---|---|---|
| JARVIS | Understands your instruction, plans against the business, asks when uncertain, and routes consequential actions through approval. | Server outbound persona `VOICE_PERSONAS.main` → `process.env.VAPI_ASSISTANT_ID`; browser session uses `NEXT_PUBLIC_VAPI_ASSISTANT_ID`; the dedicated Thread voice channel requires `NEXT_PUBLIC_VAPI_WEB_ASSISTANT_ID` and fails closed when absent. | `/api/setup/status` and `/api/integrations/status` expose provider-level `integrations.vapi`; no assistant-specific readiness/config endpoint exists. | `calls`, `voice_sessions`, `voice_turns`, `instruction_sessions`, `instruction_events`, `action_log`, `workflow_steps`, `business_events`; browser voice state is local until the provider webhook records durable rows. | Exact inbound voice path exists through `voice_sessions.call_external_id` → `voice_turns.resolved_action_ids` → `domain_actions.instruction_id`; household edge is only exact when `voice_identities.matched_household_id` is resolved and carried through. | Provider result may be shown as a separate provider fact; agent status must remain `Status unavailable — assistant configuration is not exposed to JARVIS yet.` |
| Follow-up | Checks in after a new installation or major service visit, captures satisfaction, and can gently ask for a review. | `VOICE_PERSONAS.install_followup` → hard-coded Vapi assistant id `5c1a88a9-1a9b-4ed0-a2c0-6089422ca9c0`; source persona name is `install_followup`, while the product label is fixed as Follow-up. | Same provider-level Vapi checks; no per-assistant config/health row or API. | Durable activity is the generic `calls` / `action_log` / workflow feed; `purpose` is only carried in outbound Vapi metadata and is not persisted into the canonical `calls` row by the current webhook path. | No exact agent-specific call → customer or call → Work link is currently persisted for outbound persona calls; do not infer from `purpose`, assistant name, timestamp, or phone similarity. | `Status unavailable — assistant configuration is not exposed to JARVIS yet.` |
| Service Reminder | Contacts customers whose treatment equipment is due or coming due for filter, membrane, or service work. | `VOICE_PERSONAS.service_reminder` → hard-coded Vapi assistant id `33dbdbfb-cf60-4bf8-8f58-2f9a1c37b0aa`. | Same provider-level Vapi checks; no per-assistant config/health row or API. | Generic calls / action log / workflow sources only; no agent field in the activity contract. | No exact agent-specific link currently persisted for outbound calls; only a source-proven action payload/entity link may be used once the exact call edge is present. | `Status unavailable — assistant configuration is not exposed to JARVIS yet.` |
| Win-back | Reconnects with past customers who have gone quiet and can present an approved win-back offer. | `VOICE_PERSONAS.winback` → hard-coded Vapi assistant id `787ec013-a44f-474d-a719-c5d37c0372ae`. | Same provider-level Vapi checks; no per-assistant config/health row or API. | Generic calls / action log / workflow sources only; no agent field in the activity contract. | No exact agent-specific link currently persisted for outbound calls; no inferred customer join is permitted. | `Status unavailable — assistant configuration is not exposed to JARVIS yet.` |
| Payment Collector | Gives a friendly heads-up about overdue invoices using the collection context a human approved. | `VOICE_PERSONAS.payment_collector` → hard-coded Vapi assistant id `359a7dfe-4cb3-4ccb-9055-5d0cbc5b2e2c`. | Same provider-level Vapi checks; outbound collection context is human approval / action payload truth, not provider health. | Generic calls / action log / workflow sources; exact approval is `pending_confirmations` / `action_log` for the action. | Exact invoice/customer links can come from the approved action payload; an outbound call itself is not yet durably joined to the action or invoice in `calls`. | `Status unavailable — assistant configuration is not exposed to JARVIS yet.` |

## Provider and configuration truth

| Source | What it proves | What it does not prove |
|---|---|---|
| `finnor-os/packages/tools/src/health.ts` → `testVapiConnection()` | `configured` means `VAPI_API_KEY` exists; `healthy:true/false` is the result of an actual Vapi MCP connection attempt; `healthy:null` means the key is absent. | It does not verify any assistant id, assistant prompt/tools, phone-number binding, persona binding, or per-agent readiness. |
| `finnor-os/apps/api/app/api/setup/status/route.ts` | Authenticated setup truth: provider integrations, tenant phone-routing rows, resolved capability bindings, and durable provider circuit snapshots. | It does not expose assistant ids or a five-agent manifest. `phoneRouting` is routing configuration, not agent health. |
| `finnor-os/apps/api/app/api/integrations/status/route.ts` | Provider integration health and communications binding (`vapi`, plus exact `bindings.communications` through the binding report). | It does not expose agent-level health, call outcome, or assistant identity. |
| `finnor-os/packages/tools/src/provider-circuit-breaker.ts` | Global durable Vapi circuit state: closed/open, consecutive failures, opened-at. | It is provider-wide, not persona-specific; `closed` is not “all five agents are ready.” |
| `finnor-os/packages/tools/src/provider-health.ts` | In-process LLM provider fallback observations, including latency/failure windows. | It is not Vapi assistant health and must not drive Agent Fleet status. |
| `finnor-os/packages/tools/src/voice-personas.ts` | Server-side persona-to-assistant binding names/ids used by outbound calls. | It is configuration, not proof that a provider resource is reachable or correctly configured. IDs never belong in browser UI. |

## Durable call and causal edges

### Exact edges that exist

1. **Inbound/live call → voice session:** Vapi `call.id` is resolved to `voice_sessions.call_external_id` by `openVoiceSession()`.
2. **Voice session → action:** `voice_turns.resolved_action_ids` stores exact `domain_actions.id` values; `pending_confirmations` also stores exact `voice_session_id` + `domain_action_id`.
3. **Action → instruction:** `domain_actions.instruction_id` points to `instruction_sessions.id`; `instruction_events.payload.actionId` is a source-backed fallback for older rows.
4. **Instruction → execution/evidence:** the existing P2 projection continues through `workflow_steps.domain_action_id`, workflow run/step ids, and receipt ids.
5. **Resolved caller → household/user:** `voice_identities.matched_household_id` and `matched_user_id` are exact foreign-key edges when `resolveVoiceIdentity()` finds a registered phone.
6. **Call → tenant:** `tenant_phone_numbers.vapi_phone_number_id` or the dialed E.164 number resolves the tenant before the webhook is persisted.

### Edges deliberately not claimed

- **Call → agent:** `calls` has no `agent_id` or assistant-id column; `voice_sessions` has no agent field; the current end-of-call persistence stores `raw: { type: msg.type }` only. The Vapi assistant id and outbound `purpose` are not durable canonical call fields. This remains unproven for P3.T1 and cannot be inferred.
- **Outbound call → Work:** `placeVapiCall()` returns the provider call id and carries metadata; the action log/job can contain `callId`, but the canonical `calls.external_id` row is not linked to that action by a foreign key or current projection edge. P3.T3 may add an exact external-id match only after source tests prove it; no time-window join is allowed.
- **Call → customer in the canonical call row:** `persistCall()` accepts `householdId`, but the current normal Vapi end-of-call route does not pass the resolved identity household id, and `calls.conversation_id` can therefore remain without a household. The voice identity row is the only exact customer edge currently available.
- **Provider result → “sent/called/paid”:** `endedReason`, action output, and receipts remain separate source facts. No UI may promote a provider call request or prediction into an outcome.

## Required Agent Fleet status contract

The Fleet may render all five fixed manifest roles even when provider status is unavailable. Until an assistant-specific source is exposed, each row renders the literal bounded state:

> **Status unavailable — assistant configuration is not exposed to JARVIS yet.**

Provider-level health may appear separately with its source label and exact `unknown`/healthy/unhealthy semantics. It must never be relabeled as assistant readiness.

## Browser boundary

- `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `NEXT_PUBLIC_VAPI_ASSISTANT_ID`, and the optional `NEXT_PUBLIC_VAPI_WEB_ASSISTANT_ID` are public client configuration; they are not server-side provider health.
- `VAPI_PRIVATE_KEY`, `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_ASSISTANT_ID`, and `VAPI_WEBHOOK_SECRET` stay server-side.
- The browser receives local call state (`voiceState`, local volume, transcript, browser session id, Vapi call id) through `useVapiSession`; it does not receive the provider manifest or secrets.

## Source files probed

- `finnor-os/packages/tools/src/voice-personas.ts`
- `finnor-os/packages/tools/src/vapi-rest.ts`
- `finnor-os/packages/tools/src/health.ts`
- `finnor-os/packages/tools/src/provider-health.ts`
- `finnor-os/packages/tools/src/provider-circuit-breaker.ts`
- `finnor-os/packages/data-platform/src/conversations.ts`
- `finnor-os/apps/api/app/api/webhooks/vapi/route.ts`
- `finnor-os/apps/api/app/api/setup/status/route.ts`
- `finnor-os/apps/api/app/api/integrations/status/route.ts`
- `finnor-os/apps/api/app/api/activity/route.ts`
- `finnor-os/packages/db/schema.ts` and migrations `0010_voice_os.sql`, `0039_tenant_integrations.sql`, `0062_instruction_lifecycle.sql`
- `finnor-os/packages/read-models/src/work-cases.ts`
- `src/components/jarvis/lib/useVapiSession.tsx`
- `src/components/jarvis/panels/LiveCallPanel.tsx`
- `src/lib/jarvis-client.ts`, `src/components/jarvis/lib/api.ts`, and the JARVIS proxy allowlist

**P3.T1 conclusion:** provider-level Vapi truth and exact inbound voice/action/work edges are available; five persona bindings are server-side configuration; assistant-level status, outbound call→agent persistence, and canonical call→customer/work joins are not currently exposed. The implementation must preserve those boundaries.
