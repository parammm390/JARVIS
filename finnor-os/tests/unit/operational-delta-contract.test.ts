import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeOperationalCursor, encodeOperationalCursor, OperationalCursorError } from "../../packages/db/operational-deltas";

const SCOPE = "11111111-1111-4111-8111-111111111111";

describe("Phase 2 durable operational delta contract", () => {
  it("round-trips opaque bigint-safe cursors and rejects malformed input", () => {
    const cursor = encodeOperationalCursor(SCOPE, BigInt("9007199254740999"));
    expect(decodeOperationalCursor(cursor)).toEqual({ scope: SCOPE, seq: BigInt("9007199254740999") });
    expect(() => decodeOperationalCursor("1")).toThrow(OperationalCursorError);
    expect(() => decodeOperationalCursor(`${SCOPE}:-1`)).toThrow(OperationalCursorError);
  });

  it("migration is one RLS ledger with bounded secret-free payloads and covered sources", () => {
    const sql = readFileSync(new URL("../../packages/db/migrations/0092_phase2_live_business_world.sql", import.meta.url), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS finnor_os.operational_deltas");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("jsonb_array_length(entity_refs)<=8");
    expect(sql).toContain("pg_column_size(entity_refs)<=4096");
    expect(sql).toContain("operational_deltas is append-only");
    expect(sql).toContain("purge_operational_deltas");
    expect(sql).toContain("REVOKE INSERT,UPDATE,DELETE ON finnor_os.tenant_operational_delta_cursors,finnor_os.operational_deltas FROM finnor_app");
    for (const source of ["service_visits", "appointments", "invoices", "payments", "inventory_items", "works", "domain_actions", "authority_approval_requests", "decision_receipts", "integration_events", "computer_runs", "auth_profiles", "connection_events"]) {
      expect(sql, source).toContain(`${source}_operational_delta`);
    }
    for (const forbidden of ["provider_session_ref", "credential_ref", "payload->", "NEW.payload", "NEW.config"]) expect(sql).not.toContain(forbidden);
  });
});
