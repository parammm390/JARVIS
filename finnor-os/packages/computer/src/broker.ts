import type { ComputerProviderCapability } from "@finnor/shared-types";
import type { ComputerProvider } from "./contracts";
import { ComputerProviderError } from "./contracts";

export class ComputerBroker {
  private readonly providers = new Map<string, ComputerProvider>();

  register(provider: ComputerProvider): void {
    if (this.providers.has(provider.name)) throw new Error(`Computer provider ${provider.name} is already registered`);
    this.providers.set(provider.name, provider);
  }

  negotiate(providerName: string, required: readonly ComputerProviderCapability[]): ComputerProvider {
    const provider = this.providers.get(providerName);
    if (!provider) throw new ComputerProviderError("provider_unavailable", `Computer provider ${providerName} is unavailable`);
    const missing = required.filter((capability) => !provider.capabilities.has(capability));
    if (missing.length > 0) {
      throw new ComputerProviderError("capability_unavailable", `Computer provider ${providerName} lacks required capabilities: ${missing.join(", ")}`);
    }
    return provider;
  }
}
