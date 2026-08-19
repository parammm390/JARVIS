import { describe, expect, it } from "vitest";
import { mapSourceRow, parseImportDefinition, parseSource } from "@finnor/import-engine";

describe("declarative import mapping", () => {
  it("maps composed fields, conversions, normalization and enums without dealer code", () => {
    const definition = parseImportDefinition({
      key: "dealer-a-customers",
      format: "csv",
      version: 1,
      entity: "customer",
      sourceSystem: "dealer-a",
      fields: {
        firstName: { from: "cust_fname", required: true, normalize: ["trim", "title_case"] },
        lastName: { from: "cust_lname", normalize: ["trim", "title_case"] },
        name: { compose: { from: ["cust_fname", "cust_lname"] }, normalize: ["trim", "title_case"] },
        phone: { from: "mobile", normalize: ["phone_e164"] },
        marketingConsent: { from: "opt_in", type: "boolean", valueMap: { Y: true, N: false } },
      },
      externalId: { from: "cust_no", required: true },
      identity: [{ fields: ["phone"] }],
    });
    const parsed = parseSource('cust_no,cust_fname,cust_lname,mobile,opt_in\n42,"  aDA ",lovelace,319-555-0100,Y\n', "csv");
    const mapped = mapSourceRow(parsed[0]!.value!, definition);
    expect(mapped.issues).toEqual([]);
    expect(mapped.externalId).toBe("42");
    expect(mapped.data).toMatchObject({ firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace", phone: "+13195550100", marketingConsent: true });
  });

  it("reports malformed JSONL rows independently", () => {
    const rows = parseSource('{"id":1}\nnot-json\n{"id":3}\n', "jsonl");
    expect(rows).toHaveLength(3);
    expect(rows[1]!.error).toMatch(/invalid JSON/);
    expect(rows[2]!.value).toEqual({ id: 3 });
  });
});
