/**
 * Deterministic operational-query latency certification.
 *
 * This is a release guard for the typed query plane, not an LLM/load test. It
 * exercises all eight v1 requests against canonical PostgreSQL, records p50/p95,
 * and runs the natural-language entry point once with a planner that throws if it
 * is ever invoked. Set QUERY_CERT_TENANT_ID to a migrated tenant with representative
 * data. `--seed` creates a bounded, deterministic fixture tenant; rerunning against
 * the same QUERY_CERT_TENANT_ID is idempotent because every fixture id is stable.
 */

import { performance } from "node:perf_hooks";
import { migrate } from "../../packages/db/migrate";
import { closePool, getPool } from "@finnor/db";
import { executeOperationalQuery } from "@finnor/read-models";
import type { OperationalQueryRequest, TenantContext } from "@finnor/shared-types";
import { FinnorOrchestrator, type Planner } from "@finnor/orchestration";
import type { Executor } from "../../packages/orchestration/src/executor";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const DEFAULT_SEED_TENANT_ID = "00000000-0000-4000-8000-00000000c066";
const CERT_USER_ID = "00000000-0000-4000-8000-00000000c067";
const ITERATIONS = Math.max(5, Number(process.env.QUERY_CERT_ITERATIONS ?? 20));
const P50_LIMIT_MS = Number(process.env.QUERY_CERT_P50_MS ?? 750);
const P95_LIMIT_MS = Number(process.env.QUERY_CERT_P95_MS ?? 2_000);
const SEED_HOUSEHOLDS = Math.max(100, Number(process.env.QUERY_CERT_SEED_HOUSEHOLDS ?? 1_000));

const CERT_RANGE = {
  start: "2026-01-01T00:00:00.000Z",
  end: "2026-01-03T00:00:00.000Z",
} as const;

const requests: OperationalQueryRequest[] = [
  { intent: "customer_lookup", query: "Certification Household 1", page: { limit: 100 } },
  { intent: "customer_cohort", cohort: "inactive", minDaysInactive: 90, page: { limit: 100 } },
  { intent: "schedule_range", range: CERT_RANGE, page: { limit: 100 } },
  { intent: "money_summary", range: CERT_RANGE, page: { limit: 100 } },
  { intent: "work_list", section: "all", page: { limit: 100 } },
  { intent: "inventory_status", lowStockOnly: false, includeOpenProcurement: true, page: { limit: 100 } },
  { intent: "agent_activity", range: CERT_RANGE, page: { limit: 100 } },
  { intent: "business_state", page: { limit: 100 } },
];

const naturalLanguageRequests = [
  "Find the customer record for Certification Household 1",
  "Find every customer inactive for more than 90 days",
  "Show everything today through tomorrow",
  "How much cash have we collected?",
  "What work is open right now?",
  "Which inventory items are low?",
  "Show agent activity for today",
  "What is the current business state?",
] as const;

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

async function seedFixture(tenantId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO finnor_os.tenants (id, name, timezone)
     VALUES ($1::uuid, 'Operational Query Latency Certification', 'America/Chicago')
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.users (id, tenant_id, email, role)
     VALUES ($2::uuid, $1::uuid, 'query-cert-' || $1::text || '@example.invalid', 'owner')
     ON CONFLICT (id) DO NOTHING`,
    [tenantId, CERT_USER_ID],
  );
  await pool.query(
    `INSERT INTO finnor_os.technicians (id, tenant_id, name, contact_info, availability)
     SELECT md5($1::text || ':tech:' || n)::uuid, $1::uuid, 'Certification Technician ' || n, '{}', '{}'
     FROM generate_series(1, 5) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.households (id, tenant_id, address, contact_info, marketing_consent, created_at)
     SELECT md5($1::text || ':household:' || n)::uuid, $1::uuid,
       'cert-' || n || ' Main Street',
       jsonb_build_object('name', 'Certification Household ' || n),
       (n % 3 = 0), now() - make_interval(days => (n % 240)::int)
     FROM generate_series(1, $2::int) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId, SEED_HOUSEHOLDS],
  );
  await pool.query(
    `INSERT INTO finnor_os.contacts (id, tenant_id, household_id, name, role)
     SELECT md5($1::text || ':contact:' || n)::uuid, $1::uuid,
       md5($1::text || ':household:' || n)::uuid, 'Certification Contact ' || n, 'primary'
     FROM generate_series(1, $2::int) AS n
     WHERE n % 10 = 0
     ON CONFLICT (id) DO NOTHING`,
    [tenantId, SEED_HOUSEHOLDS],
  );
  await pool.query(
    `INSERT INTO finnor_os.contact_methods (id, tenant_id, contact_id, method_type, value, consent)
     SELECT md5($1::text || ':contact-method:' || n)::uuid, $1::uuid,
       md5($1::text || ':contact:' || n)::uuid, 'email', 'cert-' || n || '@example.invalid', true
     FROM generate_series(1, $2::int) AS n
     WHERE n % 10 = 0
     ON CONFLICT (id) DO NOTHING`,
    [tenantId, SEED_HOUSEHOLDS],
  );
  await pool.query(
    `WITH conversation_rows AS (
       INSERT INTO finnor_os.conversations(
         id,tenant_id,household_id,channel,status,last_activity_at,source_system,external_id,created_by,created_at
       )
       SELECT md5($1::text || ':communication-conversation:' || n)::uuid,$1::uuid,
         md5($1::text || ':household:' || n)::uuid,'email','closed',now()-interval '120 days',
         'query_certification','conversation:' || n,'query-certification',now()-interval '120 days'
       FROM generate_series(1,$2::int) AS n WHERE n%4=0
       ON CONFLICT (id) DO NOTHING RETURNING id
     ), message_rows AS (
       INSERT INTO finnor_os.messages(
         id,tenant_id,conversation_id,channel,direction,content,sent_at,source_system,external_id,created_by,created_at
       )
       SELECT md5($1::text || ':communication:' || n)::uuid,$1::uuid,
         md5($1::text || ':communication-conversation:' || n)::uuid,
         'email','inbound','certification activity',now()-interval '120 days',
         'query_certification','message:' || n,'query-certification',now()-interval '120 days'
       FROM generate_series(1,$2::int) AS n WHERE n%4=0
       ON CONFLICT (id) DO NOTHING RETURNING id
     )
     INSERT INTO finnor_os.business_events(tenant_id,entity_type,entity_id,event_type,payload,source)
     SELECT $1::uuid,'message',id,'message_recorded','{"certification":true}'::jsonb,'query_certification'
     FROM message_rows`,
    [tenantId, SEED_HOUSEHOLDS],
  );
  await pool.query(
    `INSERT INTO finnor_os.service_visits (id, tenant_id, household_id, technician_id, type, scheduled_at, completed_at, notes)
     SELECT md5($1::text || ':visit:' || n)::uuid, $1::uuid,
       md5($1::text || ':household:' || n)::uuid,
       md5($1::text || ':tech:' || ((n % 5) + 1))::uuid,
       'maintenance', now() - interval '120 days', now() - interval '120 days', NULL
     FROM generate_series(1, $2::int) AS n
     WHERE n % 5 = 0
     ON CONFLICT (id) DO NOTHING`,
    [tenantId, SEED_HOUSEHOLDS],
  );
  await pool.query(
    `INSERT INTO finnor_os.appointments (id, tenant_id, subject_type, subject_id, technician_id, status, scheduled_at, duration_minutes)
     SELECT md5($1::text || ':appointment:' || n)::uuid, $1::uuid, 'household',
       md5($1::text || ':household:' || n)::uuid,
       md5($1::text || ':tech:' || ((n % 5) + 1))::uuid, 'confirmed',
       timestamp with time zone '2026-01-01 08:00:00+00' + ((n % 48) * interval '1 hour'), 60
     FROM generate_series(1, 100) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.work_orders (id, tenant_id, household_id, type, status, technician_id, scheduled_at)
     SELECT md5($1::text || ':work-order:' || n)::uuid, $1::uuid,
       md5($1::text || ':household:' || n)::uuid, 'repair', 'scheduled',
       md5($1::text || ':tech:' || ((n % 5) + 1))::uuid,
       timestamp with time zone '2026-01-01 09:00:00+00' + ((n % 48) * interval '1 hour')
     FROM generate_series(1, 100) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.inventory_items (id, tenant_id, sku, name, quantity, reorder_threshold, unit_cost_usd)
     SELECT md5($1::text || ':inventory:' || n)::uuid, $1::uuid, 'CERT-' || n, 'Certification Item ' || n, n % 20, 10, 12.50
     FROM generate_series(1, 100) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.warehouses (id, tenant_id, name, address, is_default)
     VALUES (md5($1::text || ':warehouse:1')::uuid, $1::uuid, 'Certification Warehouse', '1 Warehouse Way', true)
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.warehouse_stock (id, tenant_id, warehouse_id, sku, quantity, unit_of_measure, reorder_threshold)
     SELECT md5($1::text || ':warehouse-stock:' || n)::uuid, $1::uuid,
       md5($1::text || ':warehouse:1')::uuid, 'CERT-' || n, n % 12, 'each', 8
     FROM generate_series(1, 100) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.procurement_orders (id, tenant_id, warehouse_id, sku, quantity_ordered, status, expected_at)
     SELECT md5($1::text || ':procurement:' || n)::uuid, $1::uuid, md5($1::text || ':warehouse:1')::uuid,
       'CERT-' || n, 25, 'ordered', timestamp with time zone '2026-01-02 12:00:00+00'
     FROM generate_series(1, 10) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.invoices (id, tenant_id, household_id, amount_usd, status, memo, due_date, created_at)
     SELECT md5($1::text || ':invoice:' || n)::uuid, $1::uuid, md5($1::text || ':household:' || n)::uuid,
       (100 + n)::numeric, CASE WHEN n % 3 = 0 THEN 'paid' WHEN n % 3 = 1 THEN 'sent' ELSE 'overdue' END,
       'query certification invoice', timestamp with time zone '2026-01-02 12:00:00+00', timestamp with time zone '2026-01-01 12:00:00+00'
     FROM generate_series(1, 100) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.payments (id, tenant_id, invoice_id, amount_usd, method, status, received_at)
     SELECT md5($1::text || ':payment:' || n)::uuid, $1::uuid, md5($1::text || ':invoice:' || n)::uuid,
       (100 + n)::numeric, 'card', 'succeeded', timestamp with time zone '2026-01-02 12:00:00+00'
     FROM generate_series(1, 100) AS n
     WHERE n % 3 = 0
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.works (id, tenant_id, status, initial_channel, initial_instruction, active_context, created_at, updated_at)
     SELECT md5($1::text || ':work:' || n)::uuid, $1::uuid, CASE WHEN n % 2 = 0 THEN 'completed' ELSE 'received' END,
       'console', 'query certification work', '{}', timestamp with time zone '2026-01-01 12:00:00+00', timestamp with time zone '2026-01-02 12:00:00+00'
     FROM generate_series(1, 100) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.commands (id, tenant_id, command_type, payload, status)
     SELECT md5($1::text || ':command:' || n)::uuid, $1::uuid, 'query_certification', '{}', 'completed'
     FROM generate_series(1, 10) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.workflow_runs (id, tenant_id, command_id, work_id, workflow_type, status, created_at, updated_at)
     SELECT md5($1::text || ':workflow:' || n)::uuid, $1::uuid,
       md5($1::text || ':command:' || n)::uuid, md5($1::text || ':work:' || n)::uuid,
       'query_certification', 'completed', timestamp with time zone '2026-01-02 12:00:00+00', timestamp with time zone '2026-01-02 12:00:00+00'
     FROM generate_series(1, 10) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.domain_actions (id, tenant_id, action_type, payload, status)
     SELECT md5($1::text || ':action:' || n)::uuid, $1::uuid, 'query_certification', '{}', 'completed'
     FROM generate_series(1, 10) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.calls (id, tenant_id, direction, started_at, ended_at, ended_reason, raw, created_at)
     SELECT md5($1::text || ':call:' || n)::uuid, $1::uuid, CASE WHEN n % 2 = 0 THEN 'inbound' ELSE 'outbound' END,
       timestamp with time zone '2026-01-02 12:00:00+00', timestamp with time zone '2026-01-02 12:05:00+00', 'completed', '{}', timestamp with time zone '2026-01-02 12:00:00+00'
     FROM generate_series(1, 10) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO finnor_os.tasks (id, tenant_id, subject_type, subject_id, title, due_at, status, priority)
     SELECT md5($1::text || ':task:' || n)::uuid, $1::uuid, 'household', md5($1::text || ':household:' || n)::uuid,
       'Certification follow-up ' || n, timestamp with time zone '2026-01-02 12:00:00+00', 'open', 'normal'
     FROM generate_series(1, 100) AS n
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
}

async function assertPlannerBypass(tenantId: string): Promise<number> {
  let plannerInvocations = 0;
  const forbiddenPlanner = {
    async plan(): Promise<never> {
      plannerInvocations += 1;
      throw new Error("Operational query certification invoked the planner");
    },
  } as unknown as Planner;
  const orchestrator = new FinnorOrchestrator({
    planner: forbiddenPlanner,
    executor: { execute: async () => { throw new Error("Operational query certification invoked the executor"); } } as unknown as Executor,
  });
  const context: TenantContext = { tenantId, userId: CERT_USER_ID, role: "owner" };
  for (const [index, instruction] of naturalLanguageRequests.entries()) {
    try {
      await orchestrator.handleInstructionResult(instruction, context, {
        channel: "console",
        idempotencyKey: `query-certification-${index}-${Date.now()}`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Natural-language certification failed at intent ${index + 1}/${naturalLanguageRequests.length} (${instruction}): ${detail}`, { cause: error });
    }
  }
  return plannerInvocations;
}

async function main(): Promise<void> {
  const shouldSeed = process.argv.includes("--seed");
  const tenantId = process.env.QUERY_CERT_TENANT_ID ?? (shouldSeed ? DEFAULT_SEED_TENANT_ID : undefined);
  if (!tenantId) throw new Error("QUERY_CERT_TENANT_ID is required (or pass --seed for the bounded fixture tenant)");

  process.env.DATABASE_URL = DATABASE_URL;
  await migrate(DATABASE_URL);
  if (shouldSeed) await seedFixture(tenantId);

  const plannerInvocations = await assertPlannerBypass(tenantId);
  const samples: number[] = [];
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    for (const request of requests) {
      const started = performance.now();
      await executeOperationalQuery(tenantId, request);
      samples.push(performance.now() - started);
    }
  }

  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const report = {
    tenantId,
    intents: requests.map((request) => request.intent),
    iterations: ITERATIONS,
    queryCount: samples.length,
    p50Ms: Number(p50.toFixed(2)),
    p95Ms: Number(p95.toFixed(2)),
    plannerInvocations,
    thresholdsMs: { p50: P50_LIMIT_MS, p95: P95_LIMIT_MS },
    status: plannerInvocations === 0 && p50 <= P50_LIMIT_MS && p95 <= P95_LIMIT_MS ? "pass" : "fail",
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "pass") process.exitCode = 1;
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => undefined));
