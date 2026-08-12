import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonSchema = {
  anyOf?: Array<{
    properties?: Record<string, unknown>;
    additionalProperties?: boolean;
  }>;
  allOf?: unknown[];
};

const openapi = JSON.parse(readFileSync(join(process.cwd(), "openapi.json"), "utf8")) as {
  paths: {
    "/api/queries": {
      post: {
        requestBody: { content: { "application/json": { schema: JsonSchema } } };
      };
    };
    "/api/works/{id}": { get: { summary: string } };
  };
};

describe("generated Upgrade 3 OpenAPI contract", () => {
  it("composes Work metadata into each strict intent branch", () => {
    const schema = openapi.paths["/api/queries"].post.requestBody.content["application/json"].schema;
    expect(schema.allOf).toBeUndefined();
    expect(schema.anyOf).toHaveLength(8);

    for (const branch of schema.anyOf ?? []) {
      expect(branch.additionalProperties).toBe(false);
      expect(branch.properties).toEqual(expect.objectContaining({
        intent: expect.any(Object),
        workId: expect.any(Object),
        executionKey: expect.any(Object),
        idempotencyKey: expect.any(Object),
      }));
      expect(branch.properties).not.toHaveProperty("workInputId");
    }
  });

  it("documents the final public fields on their canonical branches", () => {
    const branches = openapi.paths["/api/queries"].post.requestBody.content["application/json"].schema.anyOf ?? [];
    const byIntent = new Map(branches.map((branch) => [
      (branch.properties?.intent as { const?: string } | undefined)?.const,
      branch.properties ?? {},
    ]));
    expect(byIntent.get("schedule_range")).toEqual(expect.objectContaining({ localDateRange: expect.any(Object) }));
    expect(byIntent.get("agent_activity")).toEqual(expect.objectContaining({ localDateRange: expect.any(Object) }));
    expect(byIntent.get("work_list")).toEqual(expect.objectContaining({
      openOnly: expect.any(Object),
      recordId: expect.any(Object),
      // workId is the durable Work attachment metadata, not the query filter.
      workId: expect.any(Object),
    }));
    expect(byIntent.get("inventory_status")).toEqual(expect.objectContaining({ sku: expect.any(Object) }));
    expect(byIntent.get("customer_cohort")).toEqual(expect.objectContaining({ asOf: expect.any(Object) }));
    expect(openapi.paths["/api/works/{id}"].get.summary).toMatch(/query executions/i);
  });
});
