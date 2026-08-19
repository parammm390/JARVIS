import { describe, expect, it, vi } from "vitest";
import { findAuthUserByEmail, type TenantAuthAdmin } from "../../scripts/tenant-user";

describe("Supabase auth user lookup", () => {
  it("finds a user beyond the first admin listUsers page", async () => {
    const listUsers = vi.fn(async ({ page = 1, perPage = 200 }: { page?: number; perPage?: number }) => {
      const users = Array.from({ length: page === 1 ? perPage : 1 }, (_, index) => ({
        id: `user-${page}-${index}`,
        email: page === 2 ? "target@example.test" : `user-${index}@example.test`,
      }));
      return { data: { users, aud: "authenticated", nextPage: page === 1 ? 2 : null, lastPage: 2, total: 201 }, error: null };
    });
    const auth = { listUsers } as unknown as Pick<TenantAuthAdmin, "listUsers">;
    await expect(findAuthUserByEmail(auth, "TARGET@example.test")).resolves.toEqual({ id: "user-2-0" });
    expect(listUsers).toHaveBeenCalledTimes(2);
  });
});
