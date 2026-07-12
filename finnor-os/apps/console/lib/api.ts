// Console → API client. In production the bearer token comes from Supabase Auth;
// in dev-bypass mode the headers name the seed tenant directly.
"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3100";
const DEV_TENANT = process.env.NEXT_PUBLIC_DEV_TENANT_ID ?? "00000000-0000-4000-8000-000000000001";

export function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("finnor_token") : null;
  if (token) return { Authorization: `Bearer ${token}` };
  // Dev bypass (API must run with AUTH_DEV_BYPASS=1)
  return { "x-tenant-id": DEV_TENANT, "x-user-role": "owner" };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}
