import { NextResponse } from "next/server"
import { serverEnv } from "@/lib/env"
import { cleanString, readJsonBody } from "@/lib/api/request"
import { rateLimit } from "@/lib/api/rate-limit"
import { updateDemoLeadByVapiCallId } from "@/lib/leads/supabase"

export const runtime = "nodejs"
export const maxDuration = 20

type VoiceWebhookPayload = Record<string, unknown>

export async function POST(request: Request) {
  const unauthorized = verifyWebhook(request)
  if (unauthorized) return unauthorized

  const limited = rateLimit(request, { name: "voice-webhook", limit: 120, windowMs: 10 * 60 * 1000 })
  if (limited) return limited

  try {
    const body = await readJsonBody<VoiceWebhookPayload>(request, 120_000)
    const eventType = extractEventType(body)
    const callId = extractCallId(body)
    const transcript = extractTranscriptPreview(body)
    const status = mapVoiceEventStatus(eventType)

    let updated = false
    if (callId) {
      updated = await updateDemoLeadByVapiCallId(callId, {
        call_started: status === "call_started" ? true : undefined,
        call_ended: status === "call_ended" ? true : undefined,
        status,
        notes: {
          voice_webhook: {
            event_type: eventType,
            call_id: callId,
            transcript_preview: transcript,
            received_at: new Date().toISOString(),
          },
        },
      })
    }

    return NextResponse.json({
      ok: true,
      event_type: eventType,
      call_id_present: Boolean(callId),
      lead_updated: updated,
    })
  } catch (error) {
    console.error("Voice webhook error:", error)
    return NextResponse.json({ ok: false }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    webhook: "voice",
    secret_configured: Boolean(serverEnv.vapiWebhookSecret),
  })
}

function verifyWebhook(request: Request) {
  if (!serverEnv.vapiWebhookSecret) return null

  const authorization = request.headers.get("authorization") || ""
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : ""
  const headerSecret =
    request.headers.get("x-vapi-secret") ||
    request.headers.get("x-webhook-secret") ||
    request.headers.get("x-finnor-webhook-secret") ||
    ""

  if (bearer === serverEnv.vapiWebhookSecret || headerSecret === serverEnv.vapiWebhookSecret) {
    return null
  }

  return NextResponse.json({ ok: false, error: "Unauthorized webhook." }, { status: 401 })
}

function extractEventType(payload: VoiceWebhookPayload) {
  const message = asRecord(payload.message)
  const call = asRecord(payload.call)
  return (
    cleanString(payload.type, 80) ||
    cleanString(payload.event, 80) ||
    cleanString(payload.status, 80) ||
    cleanString(message.type, 80) ||
    cleanString(message.event, 80) ||
    cleanString(call.status, 80) ||
    "voice_event"
  )
}

function extractCallId(payload: VoiceWebhookPayload) {
  const message = asRecord(payload.message)
  const call = asRecord(payload.call) || asRecord(message.call)
  return (
    cleanString(payload.callId, 160) ||
    cleanString(payload.call_id, 160) ||
    cleanString(call.id, 160) ||
    cleanString(call.callId, 160) ||
    cleanString(message.callId, 160) ||
    cleanString(message.call_id, 160)
  )
}

function extractTranscriptPreview(payload: VoiceWebhookPayload) {
  const message = asRecord(payload.message)
  const artifact = asRecord(payload.artifact) || asRecord(message.artifact)
  const directTranscript = cleanString(payload.transcript, 5000) || cleanString(message.transcript, 5000)
  if (directTranscript) return directTranscript.slice(0, 1200)

  const messages = Array.isArray(artifact.messages)
    ? artifact.messages
    : Array.isArray(message.messages)
      ? message.messages
      : []

  return messages
    .map((item) => {
      const record = asRecord(item)
      const role = cleanString(record.role, 40) || "speaker"
      const content = cleanString(record.message, 500) || cleanString(record.content, 500)
      return content ? `${role}: ${content}` : ""
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 1200)
}

function mapVoiceEventStatus(eventType: string) {
  const normalized = eventType.toLowerCase()
  if (normalized.includes("end") || normalized.includes("completed")) return "call_ended"
  if (normalized.includes("fail") || normalized.includes("error")) return "call_error"
  if (normalized.includes("start") || normalized.includes("created")) return "call_started"
  return "voice_event"
}

function asRecord(value: unknown): VoiceWebhookPayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as VoiceWebhookPayload)
    : {}
}
