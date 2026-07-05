// Shared Groq client — the primary LLM provider for every generation on the
// site (demo company profiles, lifecycle narratives, concierge replies,
// intake extraction). OpenAI-compatible chat completions with JSON mode;
// every caller keeps its own deterministic fallback, so a Groq outage
// degrades quality, never availability.

import { serverEnv } from "@/lib/env"

const FALLBACK_GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "llama-3.1-8b-instant",
]

type GroqChatResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

export function groqConfigured() {
  return Boolean(serverEnv.groqApiKey)
}

export async function groqGenerateJson({
  prompt,
  system,
  maxTokens = 2048,
  temperature = 0.2,
  timeoutMs = 26_000,
}: {
  prompt: string
  system?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}): Promise<Record<string, unknown>> {
  const apiKey = serverEnv.groqApiKey
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured.")

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const models = [...new Set([serverEnv.groqModel, ...FALLBACK_GROQ_MODELS])].filter(Boolean)

  try {
    let lastError = "Groq request failed."
    for (const model of models) {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: prompt },
          ],
        }),
      })

      if (!response.ok) {
        lastError = `${model}: ${response.status}`
        // Retry the next model on rate limits, capacity errors, and
        // decommissioned-model 404s; bail immediately on auth failures.
        if ([400, 404, 429, 498, 499, 500, 502, 503].includes(response.status)) continue
        break
      }

      const payload = (await response.json()) as GroqChatResponse
      const rawText = payload.choices?.[0]?.message?.content || ""
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim()
      const parsed = JSON.parse(cleaned) as Record<string, unknown>
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Groq returned non-object JSON.")
      }
      return parsed
    }

    throw new Error(lastError)
  } finally {
    clearTimeout(timeout)
  }
}
