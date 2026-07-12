// LLM provider abstraction (§9): Groq is the default, injected — never hardcoded at
// call sites. A stronger model can be swapped per action_type via domain_policies
// (model_provider column), a config change, not a code change.

import Groq from "groq-sdk";

export interface LLMProvider {
  name: string;
  complete(opts: { system: string; user: string; json?: boolean }): Promise<string>;
}

export class GroqProvider implements LLMProvider {
  name = "groq";
  private client: Groq;
  private models: string[];

  constructor(apiKey = process.env.GROQ_API_KEY, model = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile") {
    if (!apiKey) throw new Error("GROQ_API_KEY is not set");
    // No SDK-level retries: a throttled call fails in milliseconds and we fail over
    // to the next model, whose rate-limit bucket is separate — instead of sitting
    // out a 20-40s retry-after on the free tier.
    this.client = new Groq({ apiKey, timeout: 8_000, maxRetries: 0 });
    // 70B first: this model's whole job is precise structured-field extraction (which
    // action_type, which exact payload fields) — the 8B model is fast but was
    // regularly stuffing entire sentences into single fields and misrouting between
    // similarly-named actions. 8B stays as the fallback for when 70B is rate-limited,
    // not the default.
    const fallbacks = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
    this.models = [model, ...fallbacks.filter((m) => m !== model)];
  }

  async complete(opts: { system: string; user: string; json?: boolean }): Promise<string> {
    let lastError: Error | null = null;
    for (const model of this.models) {
      try {
        const res = await this.client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          temperature: 0.1,
          max_tokens: 700,
          ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
        });
        return res.choices[0]?.message?.content ?? "";
      } catch (err) {
        lastError = err as Error;
        // 429 / 5xx / timeout → next model, next bucket. Hard auth errors don't retry.
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) break;
      }
    }
    throw lastError ?? new Error("All Groq models failed");
  }
}

/** Resolve the provider for an action type. Registry is config-extensible. */
const providers = new Map<string, () => LLMProvider>();
providers.set("groq", () => new GroqProvider());

export function registerProvider(name: string, factory: () => LLMProvider): void {
  providers.set(name, factory);
}

export function resolveProvider(name?: string): LLMProvider {
  const factory = providers.get(name ?? "groq") ?? providers.get("groq")!;
  return factory();
}
