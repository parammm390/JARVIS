// Re-exported from @finnor/tools, where this now lives — domain-plugins needs the
// same LLMProvider abstraction (the grounded-QA action in ops-overview calls it),
// and domain-plugins -> orchestration would be a package cycle. @finnor/tools has no
// dependency on orchestration or domain-plugins, so it's the correct home. Kept as a
// named re-export here (not `export *`) so nothing inside orchestration (planner.ts,
// index.ts) had to change, without also re-exporting all of @finnor/tools' unrelated
// surface (ToolRegistry, registerBuiltinTools, etc.) through orchestration's API.
export {
  type LLMProvider,
  BedrockAnthropicProvider,
  BedrockOpenAICompatProvider,
  CompositeProvider,
  GroqProvider,
  registerProvider,
  resolveProvider,
} from "@finnor/tools";
