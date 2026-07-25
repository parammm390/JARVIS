import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { clearFallbackLogsForTesting, createRedactingLogger, recentFallbackLogs } from "@finnor/tools";

describe("Pino PII redaction", () => {
  it("keeps only redacted records in the bounded Axiom fallback buffer", () => {
    clearFallbackLogsForTesting();
    const destination = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    createRedactingLogger(destination).info({ email: "person@example.test" }, "contact +1 555 010 0100");
    expect(JSON.stringify(recentFallbackLogs())).toContain("[REDACTED]");
    expect(JSON.stringify(recentFallbackLogs())).not.toContain("person@example.test");
    expect(JSON.stringify(recentFallbackLogs())).not.toContain("555 010 0100");
  });

  it("redacts direct, nested, payload, and authorization fields before a log destination receives them", () => {
    let output = "";
    const destination = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    const log = createRedactingLogger(destination);
    log.info({
      email: "person@example.test",
      phone: "+1 555 010 0100",
      household: { address: "123 Water Street" },
      payload: { mobile: "+1 555 010 0101" },
      req: { headers: { authorization: "Bearer private-token" } },
    }, "structured event");

    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("person@example.test");
    expect(output).not.toContain("555 010 0100");
    expect(output).not.toContain("123 Water Street");
    expect(output).not.toContain("private-token");
  });
});
