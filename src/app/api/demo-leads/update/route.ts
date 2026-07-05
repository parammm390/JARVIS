import { NextResponse } from "next/server"
import type { DemoLeadUpdate } from "@/lib/demo/types"
import { updateDemoLead } from "@/lib/leads/supabase"
import { ApiRequestError, cleanString, readJsonBody } from "@/lib/api/request"
import { rateLimit } from "@/lib/api/rate-limit"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, { name: "demo-leads-update", limit: 80, windowMs: 10 * 60 * 1000 })
    if (limited) return limited

    const body = await readJsonBody<Partial<DemoLeadUpdate>>(request, 40_000)
    const leadId = cleanString(body.lead_id, 80)

    if (!leadId) {
      return NextResponse.json({ ok: true, skipped: true })
    }

    const ok = await updateDemoLead({
      lead_id: leadId,
      call_started: body.call_started,
      call_ended: body.call_ended,
      status: cleanString(body.status, 60),
      vapi_call_id:
        typeof body.vapi_call_id === "string" && body.vapi_call_id.trim()
          ? cleanString(body.vapi_call_id, 160)
          : body.vapi_call_id === null
            ? null
            : undefined,
      notes: body.notes || null,
    })

    return NextResponse.json({ ok })
  } catch (error) {
    console.error("Demo lead update error:", error)
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
