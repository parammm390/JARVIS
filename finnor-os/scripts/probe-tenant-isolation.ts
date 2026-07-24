// A5.T2: intentionally small, fail-closed live probe. It compares the authenticated
// tenant-A and tenant-B household read models on each supplied environment; UUID rows
// may never overlap. Tokens are GitHub secrets and are never printed.

const environments = [
  { name: "staging", url: process.env.STAGING_API_URL },
  { name: "production", url: process.env.PRODUCTION_API_URL },
] as const;
const tenantAToken = process.env.TENANT_A_PROBE_JWT;
const tenantBToken = process.env.TENANT_B_PROBE_JWT;

if (!tenantAToken || !tenantBToken || environments.some((environment) => !environment.url)) {
  throw new Error("A5 tenant-isolation probe requires STAGING_API_URL, PRODUCTION_API_URL, TENANT_A_PROBE_JWT, and TENANT_B_PROBE_JWT");
}

async function householdIds(baseUrl: string, token: string): Promise<string[]> {
  const response = await fetch(new URL("/api/resources/households", baseUrl), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`household read returned HTTP ${response.status}`);
  const body = (await response.json()) as { rows?: Array<{ id?: unknown }> };
  if (!Array.isArray(body.rows)) throw new Error("household read returned no rows array");
  return body.rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
}

async function main(): Promise<void> {
  for (const environment of environments) {
    const [aIds, bIds] = await Promise.all([householdIds(environment.url!, tenantAToken!), householdIds(environment.url!, tenantBToken!)]);
    const overlap = aIds.filter((id) => bIds.includes(id));
    if (overlap.length > 0) throw new Error(`${environment.name}: tenant data leak (${overlap.length} overlapping household IDs)`);
    console.log(`${environment.name}: PASS — tenant A rows=${aIds.length}, tenant B rows=${bIds.length}, overlap=0`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
