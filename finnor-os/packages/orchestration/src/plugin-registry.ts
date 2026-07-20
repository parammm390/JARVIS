// Explicit plugin registration at startup (§13). Each domain engine registers its
// action_types here; the orchestrator routes by action_type, nothing else.

import type { DomainEnginePlugin } from "@finnor/plugins-shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import waterTestPlugin from "../../domain-plugins/water-test/index";
import maintenanceAgreementPlugin from "../../domain-plugins/maintenance-agreement/index";
import crmPlugin from "../../domain-plugins/crm/index";
import inventoryPlugin from "../../domain-plugins/inventory/index";
import schedulingPlugin from "../../domain-plugins/scheduling/index";
import quotationPlugin from "../../domain-plugins/quotation/index";
import accountingPlugin from "../../domain-plugins/accounting/index";
import marketingPlugin from "../../domain-plugins/marketing/index";
import customerCommPlugin from "../../domain-plugins/customer-comm/index";
import waterDomainKnowledgePlugin from "../../domain-plugins/water-domain-knowledge/index";
import proposalBatchPlugin from "../../domain-plugins/proposal-batch/index";
import bulkNotifyPlugin from "../../domain-plugins/bulk-notify/index";
import technicianReportsPlugin from "../../domain-plugins/technician-reports/index";
import serviceRemindersPlugin from "../../domain-plugins/service-reminders/index";
import complianceDocumentationPlugin from "../../domain-plugins/compliance-documentation/index";
import webResearchPlugin from "../../domain-plugins/web-research/index";
import opsOverviewPlugin from "../../domain-plugins/ops-overview/index";
import leadToWaterTestPlugin from "../../domain-plugins/lead-to-water-test/index";
import proposalSignaturePlugin from "../../domain-plugins/proposal-signature/index";
import proposalToInstallationPlugin from "../../domain-plugins/proposal-to-installation/index";
import invoiceToCashPlugin from "../../domain-plugins/invoice-to-cash/index";

export class PluginRegistry {
  private byActionType = new Map<string, DomainEnginePlugin>();

  register(plugin: DomainEnginePlugin): void {
    if (!Array.isArray(plugin.actionTypes)) {
      throw new Error(
        `plugin ${plugin?.name ?? "<unnamed>"}.actionTypes is not an array: ${JSON.stringify(plugin.actionTypes)} (plugin keys: ${plugin ? Object.keys(plugin).join(",") : "<no plugin>"})`,
      );
    }
    for (const t of plugin.actionTypes) {
      if (this.byActionType.has(t)) {
        throw new Error(`action_type ${t} already registered by ${this.byActionType.get(t)!.name}`);
      }
      this.byActionType.set(t, plugin);
    }
  }

  resolve(actionType: string): DomainEnginePlugin | undefined {
    return this.byActionType.get(actionType);
  }

  actionTypes(): string[] {
    return [...this.byActionType.keys()];
  }

  private specCache: string | null = null;

  /** Compact payload spec for the Planner prompt: one line per action type,
   *  `field*` = required, `field?` = optional, `field:enum(a|b)` for enums.
   *  ~10x fewer tokens than full JSON Schema — lower latency, no TPM stalls —
   *  while still telling the model exactly which field names to emit.
   *  Cached: plugins register once at startup, so this is stable per process. */
  payloadSpecJson(): string {
    if (this.specCache) return this.specCache;
    const lines: string[] = [];
    for (const [actionType, plugin] of this.byActionType) {
      const schema = plugin.payloadSchemas?.[actionType];
      if (!schema) {
        lines.push(`${actionType}: (free-form object)`);
        continue;
      }
      const json = zodToJsonSchema(schema, { $refStrategy: "none" }) as {
        properties?: Record<string, { type?: string; enum?: unknown[]; format?: string }>;
        required?: string[];
      };
      const required = new Set(json.required ?? []);
      const fields = Object.entries(json.properties ?? {}).map(([name, def]) => {
        const mark = required.has(name) ? "*" : "?";
        if (def.enum) return `${name}${mark}:enum(${def.enum.join("|")})`;
        const t = def.format === "uuid" ? "uuid" : (def.type ?? "any");
        return `${name}${mark}:${t}`;
      });
      lines.push(`${actionType}: ${fields.join(", ")}`);
    }
    this.specCache = lines.join("\n");
    return this.specCache;
  }
}

export function createDefaultPluginRegistry(): PluginRegistry {
  const registry = new PluginRegistry();
  for (const plugin of [
    waterTestPlugin,
    maintenanceAgreementPlugin,
    crmPlugin,
    inventoryPlugin,
    schedulingPlugin,
    quotationPlugin,
    accountingPlugin,
    marketingPlugin,
    customerCommPlugin,
    waterDomainKnowledgePlugin,
    proposalBatchPlugin,
    bulkNotifyPlugin,
    technicianReportsPlugin,
    serviceRemindersPlugin,
    complianceDocumentationPlugin,
    webResearchPlugin,
    opsOverviewPlugin,
    leadToWaterTestPlugin,
    proposalSignaturePlugin,
    proposalToInstallationPlugin,
    invoiceToCashPlugin,
  ]) {
    registry.register(plugin);
  }
  return registry;
}
