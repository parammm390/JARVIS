import { describe, expect, it } from "vitest";
import { reminderBundle, P6_OPTIONS } from "../fixtures/locked-corpus";
import { normalizeExecutionTrace } from "./normalize";

describe("dataflow reconstruction", () => {
  it("reconstructs explicit customer → invoice → reminder → payment bindings", () => {
    const trace = normalizeExecutionTrace(reminderBundle({ suffix: "dataflow" }), P6_OPTIONS);
    const bindings = trace.edges.filter((edge) => edge.kind === "DATA").flatMap((edge) => edge.valueBindings);
    expect(bindings.length).toBeGreaterThanOrEqual(5);
    const values = new Map(trace.nodes.flatMap((node) => [...node.inputs, ...node.outputs].map((value) => [value.valueId, value.path] as const)));
    expect(bindings.map((binding) => `${values.get(binding.fromValueId)}->${values.get(binding.toValueId)}`)).toContain("customer.id->invoice.customer_id");
    expect(bindings.map((binding) => `${values.get(binding.fromValueId)}->${values.get(binding.toValueId)}`)).toContain("invoice.id->payment.invoice_id");
  });

  it("requires provenance for derived values and preserves explicit transform rules", () => {
    const trace = normalizeExecutionTrace(reminderBundle({ suffix: "derived", derived: true }), P6_OPTIONS);
    const derived = trace.nodes.flatMap((node) => node.inputs).find((value) => value.role === "DERIVED");
    expect(derived?.provenance.complete).toBe(true);
    expect(derived?.provenance.derivationRule).toEqual({ id: "format-currency", version: "1" });
    expect(trace.edges.some((edge) => edge.valueBindings.some((binding) => binding.derivation === "EXPLICIT_TRANSFORM" && binding.ruleRef === "format-currency@1"))).toBe(true);
  });

  it("does not infer a binding merely because paths or values look similar", () => {
    const bundle = reminderBundle({ suffix: "no-fuzzy-binding" });
    const send = bundle.events.find((event) => event.eventId === "send-no-fuzzy-binding")!;
    send.inputs!.push({ path: "reminder.approximate_amount", value: 2481, role: "PARAMETER", semanticType: "Amount", sensitivity: "FINANCIAL" });
    const trace = normalizeExecutionTrace(bundle, P6_OPTIONS);
    const approximate = trace.nodes.flatMap((node) => node.inputs).find((value) => value.path === "reminder.approximate_amount")!;
    expect(trace.edges.flatMap((edge) => edge.valueBindings).some((binding) => binding.toValueId === approximate.valueId)).toBe(false);
  });
});
