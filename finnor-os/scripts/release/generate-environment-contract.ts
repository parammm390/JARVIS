import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { generatedReleaseDirectory, repositoryRoot } from "./discover-action-registry";

const ignored = new Set(["node_modules", ".next", ".git", "coverage"]);
const environmentFiles = [
  ".env.check.local", ".env.local", ".env.vercel", ".vercel/.env.production.local",
  "finnor-os/.env", "finnor-os/apps/api/.env.local", "finnor-os/apps/console/.env.local",
];
const systems = [
  ["Postgres", [/^(DATABASE_URL|POSTGRES_URL|MIGRATIONS_DATABASE_URL)$/], "required"],
  ["Redis", [/^REDIS_URL$/], "required"],
  ["FINNOR release identity", [/^FINNOR_(COMMIT_SHA|BUILD_ID|VERSION|ENVIRONMENT|RELEASE_SOURCE)$/], "required on every runtime"],
  ["Azure persistent runtime", [/^AZURE_(CLIENT_ID|TENANT_ID|SUBSCRIPTION_ID)$/], "required by the production release workflow"],
  ["Sentry", [/^SENTRY_|^NEXT_PUBLIC_SENTRY_/], "optional unless error reporting is enabled"],
  ["Supabase auth", [/SUPABASE/], "required"], ["Vapi", [/^VAPI_|^NEXT_PUBLIC_VAPI_/], "required if voice is enabled"],
  ["OpenAI Realtime", [/^OPENAI_.*REALTIME|^OPENAI_API_KEY$/], "required if Realtime is enabled"],
  ["Bedrock LLM chain", [/^AWS_BEDROCK_API_KEY$|^AWS_BEARER_TOKEN_BEDROCK$|^AWS_BEDROCK_REGION$|^AWS_BEDROCK_(GLM|MISTRAL|DEEPSEEK)_MODEL_ID$/], "required for the configured GLM/Mistral/DeepSeek chain"],
  ["GLM provider family", [/^GLM_|^AWS_BEDROCK_GLM_|^AWS_BEDROCK_API_KEY$|^AWS_BEARER_TOKEN_BEDROCK$/], "required if selected by router"], ["Mistral", [/^MISTRAL_|^AWS_BEDROCK_MISTRAL_|^AWS_BEDROCK_API_KEY$|^AWS_BEARER_TOKEN_BEDROCK$/], "required if selected by router"],
  ["DeepSeek", [/^DEEPSEEK_|^AWS_BEDROCK_DEEPSEEK_|^AWS_BEDROCK_API_KEY$|^AWS_BEARER_TOKEN_BEDROCK$/], "required if selected by router"], ["Exa", [/^EXA_/], "required for web discovery"],
  ["Firecrawl", [/^FIRECRAWL_/], "required for verified web facts"], ["Embeddings", [/EMBEDDINGS|EMBEDDING/], "optional unless semantic evidence is enabled"],
  ["Zep", [/^ZEP_/], "optional"], ["Stripe", [/^STRIPE_|^PAYMENTS_BINDING$/], "required when Stripe binding is selected"],
  ["QuickBooks", [/^QUICKBOOKS_|^ACCOUNTING_BINDING$/], "required when QuickBooks binding is selected"],
  ["DocuSign", [/^DOCUSIGN_|^ESIGN_BINDING$/], "required when DocuSign binding is selected"],
  ["Communications / SMS", [/^COMMUNICATIONS_BINDING$|^COMMS_MODE$|^RESEND_|^GMAIL_/], "required when external communications binding is selected"],
  ["Resend / email", [/^RESEND_/], "required when Resend is selected"], ["GoHighLevel", [/^GOHIGHLEVEL_|^GHL_|^CRM_BINDING$/], "required when GHL CRM binding is selected"],
  ["Meta Ads", [/^META_ADS_|^MARKETING_BINDING$/], "required when live marketing binding is selected"], ["Google Ads", [/^GOOGLE_ADS_/], "required when Google Ads is selected"],
  ["OSRM / routing", [/^OSRM_|^ROUT/], "required when external routing is selected"], ["Secrets provider", [/^SECRETS_PROVIDER$|^FINNOR_SECRET_IDS$|^AWS_/], "required when external secret provider is selected"],
] as const;

async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory)) {
    if (ignored.has(entry)) continue;
    const path = join(directory, entry); const metadata = await stat(path);
    if (metadata.isDirectory()) result.push(...await files(path));
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) result.push(path);
  }
  return result;
}
function namesFromText(text: string): string[] { return [...text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]!); }
async function configuredNames(): Promise<Set<string>> {
  const result = new Set<string>();
  for (const path of environmentFiles) {
    try {
      for (const line of (await readFile(join(repositoryRoot, path), "utf8")).split("\n")) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (match?.[2]?.trim()) result.add(match[1]!);
      }
    } catch { /* absent configuration file is truthful missing state */ }
  }
  for (const [name, value] of Object.entries(process.env)) if (value) result.add(name!);
  return result;
}
async function main(): Promise<void> {
  const references = new Set<string>();
  for (const path of await files(join(repositoryRoot, "finnor-os"))) for (const name of namesFromText(await readFile(path, "utf8"))) references.add(name);
  for (const path of await files(join(repositoryRoot, "src"))) for (const name of namesFromText(await readFile(path, "utf8"))) references.add(name);
  const configured = await configuredNames();
  const rows = systems.map(([system, patterns, requirement]) => {
    const names = [...references].filter((name) => patterns.some((pattern) => pattern.test(name))).sort();
    const present = names.filter((name) => configured.has(name));
    return `| ${system} | ${requirement} | ${names.map((name) => `\`${name}\``).join(", ") || "none referenced"} | ${present.length ? "configured" : "missing"} | ${present.filter((name) => /(_BINDING|_WRITE_ENABLED|COMMS_MODE)$/.test(name)).map((name) => `\`${name}\``).join(", ") || "not applicable / not configured"} |`;
  });
  await mkdir(generatedReleaseDirectory, { recursive: true });
  const target = join(generatedReleaseDirectory, "environment-contract.md");
  await writeFile(target, [
    "# Environment and Binding Contract", "", "Generated from source `process.env.*` references and local/deployment configuration presence. Values are never read into this document.", "",
    "`configured` means at least one named variable is non-empty in the inspected local/deployment configuration; it is not live-provider certification.", "",
    "| System / binding | Required / optional status | Referenced variable names | Environment presence | Binding / write-enable variable |", "| --- | --- | --- | --- | --- |", ...rows, "",
    "## Capability binding resolution", "", "Source: `finnor-os/packages/tools/src/binding-resolution.ts`. Finnor-owned capabilities default to `native`; external capabilities default to `emulator`. Tenant integration rows override environment/default resolution.", "",
    "| Capability | Environment variable | Default mode | Live mode |", "| --- | --- | --- | --- |",
    "| scheduling | `SCHEDULING_BINDING` | native | native / configured value |", "| documents | `DOCUMENTS_BINDING` | native | native / configured value |", "| inventory | `INVENTORY_BINDING` | native | native / configured value |", "| crm | `CRM_BINDING` | native | ghl / configured value |", "| communications | `COMMUNICATIONS_BINDING` | emulator | vapi |", "| esign | `ESIGN_BINDING` | emulator | docusign |", "| accounting | `ACCOUNTING_BINDING` | emulator | quickbooks |", "| payments | `PAYMENTS_BINDING` | emulator | stripe |", "| marketing | `MARKETING_BINDING` | emulator | dry_run / configured value |", "",
  ].join("\n"));
  console.log(`PASS: environment contract written to ${relative(repositoryRoot, target)}; ${references.size} source variable names scanned.`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
