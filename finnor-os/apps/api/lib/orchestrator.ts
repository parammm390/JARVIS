// One orchestrator instance per server process — plugins and tools register at startup.
import { FinnorOrchestrator } from "@finnor/orchestration";

let instance: FinnorOrchestrator | null = null;
export function getOrchestrator(): FinnorOrchestrator {
  if (!instance) instance = new FinnorOrchestrator();
  return instance;
}
