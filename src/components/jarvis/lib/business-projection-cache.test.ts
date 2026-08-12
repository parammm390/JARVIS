import { describe, expect, it, vi } from "vitest"
import { BusinessProjectionCache, type ProjectionDefinition } from "./business-projection-cache"
import { businessEventProjectionTags, mutationProjectionTags } from "./business-invalidation"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function definition(load: () => Promise<{ version: number }>): ProjectionDefinition<{ version: number }> {
  return { key: ["work", "cases"], owner: "test", staleMs: 10_000, pollMs: 30_000, tags: ["work"], load }
}

describe("BusinessProjectionCache", () => {
  it("deduplicates concurrent reads for one canonical key", async () => {
    const pending = deferred<{ version: number }>()
    const load = vi.fn(() => pending.promise)
    const cache = new BusinessProjectionCache()
    const id = cache.register(definition(load))
    const first = cache.ensure(id)
    const second = cache.ensure(id)
    expect(load).toHaveBeenCalledTimes(1)
    pending.resolve({ version: 1 })
    await expect(first).resolves.toEqual({ version: 1 })
    await expect(second).resolves.toEqual({ version: 1 })
    expect(cache.metricsSnapshot().requestsDeduped).toBe(1)
  })

  it("discards a response that started before invalidation", async () => {
    const first = deferred<{ version: number }>()
    const load = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ version: 2 })
    const cache = new BusinessProjectionCache()
    const id = cache.register(definition(load))
    const request = cache.ensure(id)
    cache.invalidate(["work"])
    first.resolve({ version: 1 })
    await request
    expect(cache.snapshot(id).data).toBeNull()
    expect(cache.metricsSnapshot().staleResponsesDiscarded).toBe(1)
    await cache.ensure(id, true)
    expect(cache.snapshot(id).data).toEqual({ version: 2 })
  })

  it("does not issue reads while hidden and recovers on visibility", async () => {
    const load = vi.fn().mockResolvedValue({ version: 1 })
    const cache = new BusinessProjectionCache()
    const id = cache.register(definition(load))
    cache.setVisible(false)
    await expect(cache.ensure(id)).resolves.toBeNull()
    expect(load).not.toHaveBeenCalled()
    cache.setVisible(true)
    await cache.ensure(id)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("clears every tenant-scoped entry on a session boundary reset", async () => {
    const cache = new BusinessProjectionCache()
    const id = cache.register(definition(async () => ({ version: 1 })))
    await cache.ensure(id)
    expect(cache.snapshot(id).data).toEqual({ version: 1 })
    cache.reset()
    expect(cache.snapshot(id).data).toBeNull()
    expect(cache.metricsSnapshot().requestsStarted).toBe(0)
  })
})

describe("projection invalidation mapping", () => {
  it("fans an approved action into all business projections that can change", () => {
    const tags = mutationProjectionTags("actions/action-1/confirm")
    expect(tags).toEqual(expect.arrayContaining(["work", "actions", "approvals", "receipts", "customers", "schedule", "money", "queries"]))
  })

  it("keeps operational-query POSTs read-only", () => {
    expect(mutationProjectionTags("queries")).toEqual([])
  })

  it("targets payment events at money, customer, Work, and query projections", () => {
    expect(businessEventProjectionTags("payment_recorded", "invoice")).toEqual(expect.arrayContaining(["money", "customers", "work", "queries"]))
  })
})

