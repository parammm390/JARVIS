// A5.T2: intentionally small, fail-closed live probe. It compares the authenticated
// tenant-A and tenant-B household read models on each supplied environment; UUID rows
// may never overlap. Tokens are GitHub secrets and are never printed.

export {};

type EnvironmentName = "staging" | "production";
const environments: ReadonlyArray<{ name: EnvironmentName; url: string | undefined }> = [
  { name: "staging", url: process.env.STAGING_API_URL },
  { name: "production", url: process.env.PRODUCTION_API_URL },
];
const tenantAToken = process.env.TENANT_A_PROBE_JWT;
const tenantBToken = process.env.TENANT_B_PROBE_JWT;
const productionMarkerHouseholdId = process.env.PRODUCTION_TENANT_A_MARKER_HOUSEHOLD_ID;
const stagingMarkerHouseholdId = process.env.STAGING_TENANT_A_MARKER_HOUSEHOLD_ID;
const vercelAutomationBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!tenantAToken || !tenantBToken || !productionMarkerHouseholdId || !stagingMarkerHouseholdId || environments.some((environment) => !environment.url)) {
  throw new Error("A5 tenant-isolation probe requires URLs, both JWTs, and one tenant-A marker household ID per environment");
}

async function householdIds(environment: { name: EnvironmentName; url: string }, actor: "tenant-a" | "tenant-b", token: string): Promise<string[]> {
  const response = await fetch(new URL("/api/resources/households", environment.url), {
    headers: {
      authorization: `Bearer ${token}`,
      ...(vercelAutomationBypassSecret ? { "x-vercel-protection-bypass": vercelAutomationBypassSecret } : {}),
    },
  });
  if (!response.ok) {
    const requestId = response.headers.get("x-vercel-id") ?? response.headers.get("x-request-id") ?? "unavailable";
    throw new Error(`${environment.name}/${actor}: household read returned HTTP ${response.status} (request=${requestId})`);
  }
  const body = (await response.json()) as { rows?: Array<{ id?: unknown }> };
  if (!Array.isArray(body.rows)) throw new Error(`${environment.name}/${actor}: household read returned no rows array`);
  return body.rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
}

async function main(): Promise<void> {
  for (const configured of environments) {
    const environment = { name: configured.name, url: configured.url! };
    const [aIds, bIds] = await Promise.all([
      householdIds(environment, "tenant-a", tenantAToken!),
      householdIds(environment, "tenant-b", tenantBToken!),
    ]);
    const overlap = aIds.filter((id) => bIds.includes(id));
    if (overlap.length > 0) throw new Error(`${environment.name}: tenant data leak (${overlap.length} overlapping household IDs)`);
    const markerId = environment.name === "production" ? productionMarkerHouseholdId : stagingMarkerHouseholdId;
    if (!aIds.includes(markerId!)) throw new Error(`${environment.name}: tenant A marker household is not visible to tenant A`);
    if (bIds.includes(markerId!)) throw new Error(`${environment.name}: tenant A marker household leaked to tenant B`);
    console.log(`${environment.name}: PASS — tenant A rows=${aIds.length}, tenant B rows=${bIds.length}, overlap=0, marker visible only to tenant A`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});