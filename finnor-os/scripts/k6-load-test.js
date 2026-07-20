// k6 load test (Phase 6, JARVIS 95% MAESTRO PACK §6.4) — the exact scenario the pack
// specifies: 50 inbox events/s sustained 10 min + 200 concurrent read-model queries +
// 20 approval round-trips/min, against real staging infra (never production — this
// creates real leads/rows and approves real gated actions, which is fine on Dealer
// Zero staging traffic and NOT fine to point at a live dealer's tenant).
//
// k6 is not installed in this development environment (`which k6` finds nothing) — this
// script is written and reviewed against the real route contracts (verified by reading
// apps/api/app/api/webhooks/marketing/route.ts, apps/api/app/api/read-models/[view]/
// route.ts, apps/api/app/api/actions/pending+[id]/confirm/route.ts) but has NOT been
// executed end-to-end. Run it with: k6 run scripts/k6-load-test.js
//
// Required env vars:
//   BASE_URL              — e.g. https://finnor-os-staging.up.railway.app (staging only)
//   TENANT_ID             — the Dealer Zero tenant id on that environment
//   AUTH_BEARER_TOKEN     — a real Supabase JWT for a user on TENANT_ID (staging runs
//                           with AUTH_DEV_BYPASS=0 per docs/staging-setup.md, so this is
//                           not optional the way local dev's x-tenant-id header is)
//   MARKETING_WEBHOOK_SECRET — same value as the target environment's env var, used to
//                           authenticate synthetic inbox events at the marketing webhook
//
// Assertions (from the pack's own EXIT GATE wording):
//   - inbox ack p95 < 500ms
//   - read-model query p95 < 800ms
//   - zero event loss: every inbox event this script sends must produce exactly one
//     `leads` row — verified by a companion script (verify-load-test-completeness.ts,
//     not this file) that reconciles sent-event-ids against the database AFTER the run,
//     since k6 itself has no DB access and asserting "zero loss" from HTTP responses
//     alone would only prove "the API accepted the request," not "it was durably
//     processed" — the actual reconciliation point this repo's own runtime already
//     tracks via reconciliation_cases if delivery is ever unknown.

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3100";
const TENANT_ID = __ENV.TENANT_ID;
const AUTH_BEARER_TOKEN = __ENV.AUTH_BEARER_TOKEN;
const MARKETING_WEBHOOK_SECRET = __ENV.MARKETING_WEBHOOK_SECRET;

const inboxAckDuration = new Trend("inbox_ack_duration", true);
const readModelDuration = new Trend("read_model_duration", true);
const approvalDuration = new Trend("approval_round_trip_duration", true);

const READ_MODEL_VIEWS = [
  "pipeline-health",
  "technician-load",
  "stock-risk",
  "cash-collections",
  "service-due",
  "sla-breaches",
  "follow-up-debt",
  "data-quality",
  "reliability",
];

// Env-overridable so a real, smaller validation run can prove the mechanics work
// without committing to the full 10-minute/50rps pack scenario (and the ~30k synthetic
// rows it would create) on a first attempt. Defaults are the pack's exact numbers.
const INBOX_RATE = Number(__ENV.INBOX_RATE ?? 50);
const READ_VUS = Number(__ENV.READ_VUS ?? 200);
const APPROVAL_RATE = Number(__ENV.APPROVAL_RATE ?? 20);
const DURATION = __ENV.LOAD_DURATION ?? "10m";

export const options = {
  scenarios: {
    inbox_events: {
      executor: "constant-arrival-rate",
      rate: INBOX_RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: Math.max(10, Math.ceil(INBOX_RATE * 1.2)),
      maxVUs: Math.max(20, INBOX_RATE * 3),
      exec: "inboxEvent",
    },
    read_model_queries: {
      executor: "constant-vus",
      vus: READ_VUS,
      duration: DURATION,
      exec: "readModelQuery",
    },
    approval_round_trips: {
      executor: "constant-arrival-rate",
      rate: APPROVAL_RATE,
      timeUnit: "1m",
      duration: DURATION,
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: "approvalRoundTrip",
    },
  },
  thresholds: {
    inbox_ack_duration: ["p(95)<500"],
    read_model_duration: ["p(95)<800"],
  },
};

// Vercel's team-level deployment protection (SSO wall) sits in front of every
// non-custom-domain deployment, including Preview URLs — separate from the app's own
// auth. VERCEL_BYPASS_SECRET is the "Protection Bypass for Automation" secret from the
// project's dashboard settings; sent on every request when set, no-op otherwise (e.g.
// against production's custom domain, which isn't behind this wall).
function vercelBypassHeaders() {
  return __ENV.VERCEL_BYPASS_SECRET ? { "x-vercel-protection-bypass": __ENV.VERCEL_BYPASS_SECRET } : {};
}

function authHeaders() {
  // AUTH_MODE=devbypass is for local/dev-bypass verification runs only (matches this
  // repo's own AUTH_DEV_BYPASS convention) — real staging/production runs always use a
  // real bearer token, never this branch.
  if (__ENV.AUTH_MODE === "devbypass") {
    return { "x-tenant-id": TENANT_ID, "x-user-role": "owner", "Content-Type": "application/json", ...vercelBypassHeaders() };
  }
  return { Authorization: `Bearer ${AUTH_BEARER_TOKEN}`, "Content-Type": "application/json", ...vercelBypassHeaders() };
}

export function inboxEvent() {
  const eventId = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const payload = JSON.stringify({
    tenantId: TENANT_ID,
    campaignId: "k6-load-test-campaign",
    eventId,
    name: `Load Test Lead ${eventId}`,
    phone: `+1999${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
  });
  const res = http.post(`${BASE_URL}/api/webhooks/marketing`, payload, {
    headers: { "Content-Type": "application/json", "x-webhook-secret": MARKETING_WEBHOOK_SECRET, ...vercelBypassHeaders() },
  });
  inboxAckDuration.add(res.timings.duration);
  check(res, { "inbox event accepted (200/201)": (r) => r.status === 200 || r.status === 201 });
}

export function readModelQuery() {
  const view = READ_MODEL_VIEWS[Math.floor(Math.random() * READ_MODEL_VIEWS.length)];
  const res = http.get(`${BASE_URL}/api/read-models/${view}`, { headers: authHeaders() });
  readModelDuration.add(res.timings.duration);
  check(res, { "read-model query ok (200)": (r) => r.status === 200 });
  sleep(0.1);
}

export function approvalRoundTrip() {
  const pendingRes = http.get(`${BASE_URL}/api/actions/pending`, { headers: authHeaders() });
  approvalDuration.add(pendingRes.timings.duration);
  if (pendingRes.status !== 200) return;
  const body = JSON.parse(pendingRes.body);
  const action = body.actions && body.actions[0];
  if (!action) return; // no pending action available this tick — a real, honest condition, not a failure
  const confirmRes = http.post(`${BASE_URL}/api/actions/${action.id}/confirm`, JSON.stringify({}), { headers: authHeaders() });
  approvalDuration.add(confirmRes.timings.duration);
  check(confirmRes, { "approval round-trip ok (200/409)": (r) => r.status === 200 || r.status === 409 });
}
