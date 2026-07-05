import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { publicEnv, serverEnv } from "@/lib/env"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await checkSupabase()
  const services = {
    gemini_profile_generation: Boolean(serverEnv.geminiApiKey),
    supabase_persistence: supabase.reachable,
    supabase_configured: supabase.configured,
    vapi_browser_calling: Boolean(publicEnv.vapiPublicKey && publicEnv.vapiAssistantId),
    vapi_server_webhook_secret: Boolean(serverEnv.vapiWebhookSecret),
    contact_email_notification: Boolean(serverEnv.gmailUser && serverEnv.gmailAppPassword),
    demo_mock_mode: publicEnv.demoMockMode,
  }

  const readyForProduction =
    services.gemini_profile_generation &&
    services.supabase_persistence &&
    services.vapi_browser_calling

  return NextResponse.json({
    ok: true,
    readyForProduction,
    services,
    supabase,
    checkedAt: new Date().toISOString(),
  })
}

async function checkSupabase() {
  const configured = Boolean(serverEnv.supabaseUrl && serverEnv.supabaseServiceRoleKey)
  if (!configured) {
    return { configured: false, reachable: false }
  }

  try {
    const client = createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
    const { error } = await client.from("demo_leads").select("id").limit(1)

    if (error) {
      return {
        configured: true,
        reachable: false,
        error_code: error.code || "supabase_error",
        error_message: sanitizeSupabaseHealthMessage(error.message),
      }
    }

    return { configured: true, reachable: true }
  } catch {
    return { configured: true, reachable: false, error_code: "connection_failed" }
  }
}

function sanitizeSupabaseHealthMessage(message?: string) {
  return typeof message === "string"
    ? message.replace(/\s+/g, " ").trim().slice(0, 220)
    : ""
}
