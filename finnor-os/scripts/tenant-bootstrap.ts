// B6.T5: the database half of Dealer-in-a-Day. Owner Auth creation stays in
// provision-tenant.ts; this function is independently testable and never creates a
// Supabase account as a side effect.
import { adminDb, tenantIntegrations, tenantSettings, tenants } from "@finnor/db";
import { seedTenantPolicies } from "./seed-tenant-policies";

export async function bootstrapTenant(input: { name: string; timezone: string; reviewLinkUrl?: string; trainingMode?: boolean }) {
  const [tenant] = await adminDb().insert(tenants).values({ name: input.name, timezone: input.timezone }).returning();
  const tenantId = tenant!.id;
  await adminDb().insert(tenantSettings).values({ tenantId, trainingMode: input.trainingMode ?? false, simulatorEnabled: false, isDealerZero: false });
  await adminDb().insert(tenantIntegrations).values([
    { tenantId, capability: "crm", binding: "native", mode: "real" }, { tenantId, capability: "scheduling", binding: "native", mode: "real" },
    { tenantId, capability: "inventory", binding: "native", mode: "real" }, { tenantId, capability: "documents", binding: "native", mode: "real" },
    ...(["communications", "esign", "accounting", "payments", "marketing"] as const).map((capability) => ({ tenantId, capability, binding: "emulator", mode: "emulator" as const })),
  ]);
  const policies = await seedTenantPolicies(tenantId, { reviewLinkUrl: input.reviewLinkUrl ?? null });
  return { tenantId, policies, integrations: 9, humanOnlyField: input.reviewLinkUrl ? null : "create_review_request.review_link_url" };
}
