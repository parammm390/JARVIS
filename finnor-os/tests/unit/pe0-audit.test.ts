import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as databaseSchema from "../../packages/db/schema";
import { CANONICAL_ENTITY_TYPES, OPERATIONAL_QUERY_INTENTS, PARTY_TYPES } from "../../packages/shared-types/src/index";
import { discoverActionRegistry } from "../../scripts/release/discover-action-registry";
import { ACTION_DISPOSITIONS, DISPOSITIONS, JOB_DISPOSITIONS, PROVIDER_DEFINITIONS, QUERY_DISPOSITIONS } from "../../scripts/pe0/model";

const architecture = join(process.cwd(), "architecture/pe0");
const json = <T>(name: string): T => JSON.parse(readFileSync(join(architecture, name), "utf8")) as T;
const exact = (values: readonly string[]) => [...new Set(values)].sort();

describe("PE0 backend forensics ledger", () => {
  it("classifies every runtime-reachable artifact exactly once with mandatory evidence", () => {
    const ledger = json<any>("artifact-ledger.json");
    expect(ledger.unknownCount).toBe(0);
    expect(ledger.runtimeReachableUnclassified).toEqual([]);
    expect(new Set(ledger.artifacts.map((row: any) => row.path)).size).toBe(ledger.artifacts.length);
    for (const artifact of ledger.artifacts.filter((row: any) => row.runtimeReachable)) {
      expect(DISPOSITIONS).toContain(artifact.finalDisposition);
      expect(artifact.reason.length).toBeGreaterThan(39);
      expect(artifact.evidenceAnchors.length).toBeGreaterThan(0);
      expect(Object.keys(artifact.decisionDimensions).length).toBeGreaterThanOrEqual(30);
    }
    expect(ledger.behaviorBaseline.behaviorEquivalent).toBe(true);
    expect(ledger.behaviorBaseline.changedRuntimeBehaviorPaths).toEqual([]);
  });

  it("matches live action, query, job, scheduler and plugin registries", async () => {
    const actions = json<any>("action-execution-map.json");
    const discovered = await discoverActionRegistry();
    expect(exact(actions.actions.map((row: any) => row.actionType))).toEqual(exact(discovered.map((row) => row.actionType)));
    expect(exact(actions.actions.map((row: any) => row.actionType))).toEqual(exact(Object.keys(ACTION_DISPOSITIONS)));
    expect(actions.pluginCount).toBe(new Set(discovered.map((row) => row.plugin)).size);

    const queries = json<any>("query-resolution-map.json");
    expect(exact(queries.queries.map((row: any) => row.intent))).toEqual(exact(OPERATIONAL_QUERY_INTENTS));
    expect(exact(queries.queries.map((row: any) => row.intent))).toEqual(exact(Object.keys(QUERY_DISPOSITIONS)));

    const worker = readFileSync(join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
    const registered = [...worker.matchAll(/queue\.register\(\s*["']([^"']+)["']/g)].map((match) => match[1]!);
    const tenantSchedules = [...worker.matchAll(/\{\s*type:\s*["']([^"']+)["']\s*,\s*intervalHours:/g)].map((match) => match[1]!);
    const globalSchedules = [...worker.matchAll(/startGlobalScheduler\(\s*["']([^"']+)["']/g)].map((match) => match[1]!);
    const jobs = json<any>("job-scheduler-map.json");
    expect(exact(jobs.jobs.map((row: any) => row.jobType))).toEqual(exact(registered));
    expect(exact(jobs.jobs.map((row: any) => row.jobType))).toEqual(exact(Object.keys(JOB_DISPOSITIONS)));
    expect(exact(jobs.schedulerRegistrations.filter((row: any) => row.scope === "tenant").map((row: any) => row.jobType))).toEqual(exact(tenantSchedules));
    expect(exact(jobs.schedulerRegistrations.filter((row: any) => row.scope === "global").map((row: any) => row.jobType))).toEqual(exact(globalSchedules));
  });

  it("matches schema, entity, provider, branch and dependency truth", () => {
    const schema = json<any>("schema-read-write-map.json");
    const tableNames: string[] = [];
    for (const value of Object.values(databaseSchema)) {
      try {
        const name = getTableName(value as never);
        if (name) tableNames.push(name);
      } catch {
        // Non-table exports are expected in the schema barrel.
      }
    }
    expect(exact(schema.tables.map((row: any) => row.table))).toEqual(exact(tableNames));
    expect(exact(schema.canonicalEntities.entities.map((row: any) => row.entityType))).toEqual(exact(CANONICAL_ENTITY_TYPES));
    expect(exact(schema.partyTypes.parties.map((row: any) => row.partyType))).toEqual(exact(PARTY_TYPES));

    const providers = json<any>("provider-truth-map.json");
    expect(exact(providers.providers.map((row: any) => row.provider))).toEqual(exact(PROVIDER_DEFINITIONS.map((row) => row.provider)));
    expect(json<any>("dependency-graph.json").unresolvedNodes).toEqual([]);
    expect(json<any>("water-contamination-map.json").unclassifiedContamination).toEqual([]);
    expect(json<any>("branch-state.json").uniqueImplementationCount).toBe(2);
  });
});
