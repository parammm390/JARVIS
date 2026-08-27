import { describe, expect, it, vi } from "vitest";
import { withRetryAndTimeout } from "@finnor/workflow-runtime";

const policy = { attempts: 3, baseDelayMs: 0, timeoutMs: 100 };

describe("production-correctness capability retry semantics", () => {
  it("does not repeat an ambiguous mutation when retryOnUnknown is false", async () => {
    const call = vi.fn(async () => { throw new Error("connection lost after dispatch"); });

    await expect(withRetryAndTimeout(call, policy, false)).rejects.toMatchObject({ kind: "unknown_outcome" });
    expect(call).toHaveBeenCalledOnce();
  });

  it("retries an ambiguous mutation only when the contract explicitly permits it", async () => {
    const call = vi.fn()
      .mockRejectedValueOnce(new Error("connection lost after dispatch"))
      .mockResolvedValueOnce({ ok: true });

    await expect(withRetryAndTimeout(call, policy, true)).resolves.toEqual({ ok: true });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("classifies exhausted ambiguous retries as unknown, never known-failed", async () => {
    const call = vi.fn(async () => { throw Object.assign(new Error("provider 503"), { retryable: true }); });

    await expect(withRetryAndTimeout(call, policy, true)).rejects.toMatchObject({ kind: "unknown_outcome" });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("does not relabel an explicit pre-dispatch/nonretryable failure as unknown", async () => {
    const failure = Object.assign(new Error("invalid credentials"), { retryable: false });
    const call = vi.fn(async () => { throw failure; });

    await expect(withRetryAndTimeout(call, policy, false)).rejects.toBe(failure);
    expect(call).toHaveBeenCalledOnce();
  });
});
