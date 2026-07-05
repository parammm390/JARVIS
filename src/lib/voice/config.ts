export const voiceConfig = {
  vapiPublicKey: (process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY || "").trim(),
  vapiAssistantId: (process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID || "").trim(),
  mockMode: (process.env.NEXT_PUBLIC_DEMO_MOCK_MODE || "").trim().toLowerCase() === "true",
}
