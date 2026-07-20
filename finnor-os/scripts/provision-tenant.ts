// Phase 8 (§8.5, dealer-onboarding pack): the one real command that turns "a dealer
// signed up" into a working tenant. Orchestrates three already-real, independently
// tested building blocks rather than reimplementing any of them:
//   1. creates the tenant row,
//   2. seeds all 42 policies + the price book (packages/data-platform via
//      seedTenantPolicies — the exact function scripts/seed-tenant-policies.ts's own
//      CLI calls, imported directly here, not duplicated),
//   3. creates the owner's real Supabase login (shells out to scripts/create-user.ts,
//      which already owns the Supabase Auth + users-row upsert logic correctly and
//      idempotently — reused, not re-implemented).
//
// Deliberately does NOT run scripts/import-synthetic-dealer.ts — that's fixture data
// for tests/staging, never appropriate for a real dealer's real tenant. Real customer
// data import is a separate, deliberate step (see docs/dealer-onboarding.md's import
// section) using the same @finnor/data-platform createLead/createHousehold primitives
// that script demonstrates, against the dealer's real exported data.
//
// Usage:
//   npx tsx scripts/provision-tenant.ts --name="Acme Water Co" --ownerEmail=owner@acme.com [--timezone=America/Chicago] [--reviewLinkUrl=https://g.page/r/...]

import "dotenv/config";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { adminDb, tenants, closePool } from "@finnor/db";
import { seedTenantPolicies } from "./seed-tenant-policies";

function parseArgs(): { name: string; ownerEmail: string; timezone: string; reviewLinkUrl?: string } {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...rest] = a.replace(/^--/, "").split("=");
      return [k, rest.join("=")];
    }),
  );
  if (!args.name || !args.ownerEmail) {
    console.error("Usage: npx tsx scripts/provision-tenant.ts --name=\"Acme Water Co\" --ownerEmail=owner@acme.com [--timezone=America/Chicago] [--reviewLinkUrl=...]");
    process.exit(1);
  }
  return { name: args.name, ownerEmail: args.ownerEmail, timezone: args.timezone ?? "America/Chicago", reviewLinkUrl: args.reviewLinkUrl };
}

async function main(): Promise<void> {
  const { name, ownerEmail, timezone, reviewLinkUrl } = parseArgs();

  const [tenant] = await adminDb().insert(tenants).values({ name, timezone }).returning();
  const tenantId = tenant!.id;
  console.log(`1/3 tenant created: ${tenantId} (${name})`);

  const policyResult = await seedTenantPolicies(tenantId, { reviewLinkUrl: reviewLinkUrl ?? null });
  console.log(`2/3 policies seeded: ${policyResult.actionTypesSeeded} action types, ${policyResult.priceBookItemsSeeded} price-book items`);
  if (!reviewLinkUrl) {
    console.warn("    create_review_request.review_link_url left as PLACEHOLDER_NEEDS_REAL_VALUE — pass --reviewLinkUrl once the dealer's Google review link exists.");
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  execFileSync("npx", ["tsx", join(scriptDir, "create-user.ts"), `--email=${ownerEmail}`, "--role=owner", `--tenant=${tenantId}`], {
    stdio: "inherit",
    cwd: join(scriptDir, ".."),
  });
  console.log(`3/3 owner login created for ${ownerEmail}`);

  console.log(`\nTenant ${tenantId} is provisioned. Next: run setup/status for this tenant to confirm 42/42 configured, then follow docs/dealer-onboarding.md's data-import and provider-flip sections.`);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
