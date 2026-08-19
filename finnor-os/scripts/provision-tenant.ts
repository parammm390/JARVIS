import "dotenv/config";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { closePool } from "@finnor/db";
import { directProvisionManifest, loadClientManifest } from "./client-manifest";
import { provisionClient } from "./client-provisioning";

function args(): Record<string, string> {
  return Object.fromEntries(process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }));
}

async function main(): Promise<void> {
  const input = args();
  if (!input.manifest && (!input.clientKey || !input.name || !input.ownerEmail)) {
    throw new Error("Usage: --manifest=client.json OR --clientKey=acme-water --name=\"Acme Water Co\" --ownerEmail=owner@acme.com [--timezone=America/Chicago] [--reviewLinkUrl=...]");
  }
  const manifest = input.manifest
    ? await loadClientManifest(resolve(input.manifest))
    : directProvisionManifest({
      clientKey: input.clientKey!,
      name: input.name!,
      ownerEmail: input.ownerEmail!,
      timezone: input.timezone,
      reviewLinkUrl: input.reviewLinkUrl,
      trainingMode: "trainingMode" in input,
    });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const result = await provisionClient(manifest, { auth: supabase.auth.admin });

  console.log(`Tenant converged: ${result.tenantId} (clientKey=${result.clientKey})`);
  console.log(`Policies: ${result.policies.inserted} inserted, ${result.policies.updated} updated, ${result.policies.unchanged} unchanged`);
  console.log(`Configuration: ${result.integrations} integrations, ${result.locations} locations, ${result.users.length} users`);
  for (const user of result.users) {
    if (!user.password) continue;
    console.log("");
    console.log("=== LOGIN PASSWORD — shown once, not stored anywhere ===");
    console.log(`  email:    ${user.email}`);
    console.log(`  password: ${user.password}`);
    console.log("==========================================================");
  }
  if (result.humanOnlyField) {
    console.warn(`${result.humanOnlyField} remains PLACEHOLDER_NEEDS_REAL_VALUE.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
