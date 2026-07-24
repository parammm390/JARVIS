import { describe, expect, it } from "vitest";
import { ingestPublicReferencePdf } from "../../packages/memory/src/reference-corpus";

describe("B3 public reference corpus guard", () => {
  it("rejects a changed source before parsing or writing any document", async () => {
    await expect(
      ingestPublicReferencePdf({
        tenantId: "00000000-0000-4000-8000-0000000000b6",
        source: { title: "Reference", organization: "EPA", url: "https://example.gov/reference.pdf", sha256: "0".repeat(64) },
        bytes: Buffer.from("not a pdf"),
      }),
    ).rejects.toThrow("Checksum mismatch");
  });
});
