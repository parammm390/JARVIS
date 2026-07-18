import { describe, it, expect } from "vitest";
import complianceDocumentationPlugin, { classifyHardness } from "../../packages/domain-plugins/compliance-documentation/index";
import { ToolRegistry } from "@finnor/tools";
import type { DomainPolicy } from "@finnor/shared-types";

const EPA_POLICY: DomainPolicy = {
  id: "44444444-4444-4444-8444-444444444444",
  tenantId: "00000000-0000-4000-8000-000000000001",
  actionType: "generate_compliance_summary",
  policy: {
    pfoa_mcl_ppt: 4,
    pfos_mcl_ppt: 4,
    fluoride_mcl_mg_l: 4.0,
    fluoride_secondary_standard_mg_l: 2.0,
    hardness_classification_gpg: { soft: "<1", slightly_hard: "1-3.5", moderately_hard: "3.5-7", hard: "7-10.5", very_hard: ">10.5" },
    source: "EPA National Primary/Secondary Drinking Water Regulations",
    paperwork_format: "PLACEHOLDER_NEEDS_REAL_VALUE",
  },
  requiresConfirmation: false,
  confirmationTemplate: null,
  version: 1,
};

describe("generate_compliance_summary — real EPA reference data", () => {
  it("classifies hardness per the EPA-derived ranges", () => {
    const classes = EPA_POLICY.policy.hardness_classification_gpg as Record<string, string>;
    expect(classifyHardness(0.5, classes)).toBe("soft");
    expect(classifyHardness(5, classes)).toBe("moderately_hard");
    expect(classifyHardness(18, classes)).toBe("very_hard");
  });

  it("flags PFOA above the 4 ppt MCL and cites the source", async () => {
    const draft = await complianceDocumentationPlugin.draft(
      "generate_compliance_summary",
      { waterProfile: { hardness_gpg: 18, pfoa_ppt: 7.2 }, householdLabel: "The Hendersons" },
      EPA_POLICY,
    );
    const result = await complianceDocumentationPlugin.execute(draft, new ToolRegistry());
    expect(result.status).toBe("success");
    expect((result.output.flags as string[]).join(" ")).toMatch(/PFOA/);
    expect(String(result.output.source)).toMatch(/EPA/);
    expect(String(result.output.note)).toMatch(/paperwork format not configured/i);
  });

  it("refuses to summarize an empty profile instead of inventing numbers", async () => {
    const draft = await complianceDocumentationPlugin.draft(
      "generate_compliance_summary",
      { waterProfile: {}, householdLabel: "x" },
      EPA_POLICY,
    );
    const result = await complianceDocumentationPlugin.execute(draft, new ToolRegistry());
    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/no measurable values/i);
  });
});
