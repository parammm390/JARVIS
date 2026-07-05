import { createClient } from "@supabase/supabase-js"
import type { CompanyProfile, DemoLeadInsert, DemoLeadUpdate, VoiceDemoProfile } from "@/lib/demo/types"
import { DEMO_LIMIT_PER_DOMAIN } from "@/lib/demo/limits"
import { hashValue } from "@/lib/demo/identity"
import { serverEnv } from "@/lib/env"

export type DemoIdentity = {
  accountId?: string
  normalizedDomain: string
  normalizedCompanyName: string
  browserFingerprintHash?: string
  ipHash?: string
}

export type DemoDuplicateResult = {
  found: boolean
  available: boolean
  count?: number
  source?: "demo_generation_locks" | "demo_leads"
}

export type GenerationLockResult =
  | { status: "created"; lockId: string | null }
  | { status: "duplicate" }
  | { status: "unavailable"; reason: string }

type SupabaseErrorLike = {
  code?: string
  message?: string
}

type DemoLeadRow = {
  id?: string
  normalized_domain: string
  normalized_company_name: string
  website_url: string
  company_name: string
  profile_json: {
    companyProfile: CompanyProfile
    voiceProfile: VoiceDemoProfile
  }
  confidence_score: number
  status: string
  error_message?: string | null
  call_started?: boolean
  call_ended?: boolean
  vapi_call_id?: string | null
  source_path?: string
  referrer?: string | null
  user_agent?: string | null
  ip_hash?: string | null
  user_agent_hash?: string | null
  notes?: Record<string, unknown> | null
}

export function getSupabaseServiceClient() {
  if (!serverEnv.supabaseUrl || !serverEnv.supabaseServiceRoleKey) {
    console.info("FINNOR demo leads: Supabase env vars are not configured; skipping persistence.")
    return null
  }

  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

const getSupabaseClient = getSupabaseServiceClient

export async function countDemosForDomain(
  normalizedDomain: string
): Promise<{ count: number; available: boolean }> {
  const supabase = getSupabaseClient()
  if (!supabase) return { count: 0, available: false }

  const leadCount = await safeCount(
    supabase
      .from("demo_leads")
      .select("id", { count: "exact", head: true })
      .eq("normalized_domain", normalizedDomain)
  )

  let totalLeads = leadCount.count
  if (totalLeads === 0 && leadCount.available) {
    const legacyLeadCount = await safeCount(
      supabase
        .from("demo_leads")
        .select("id", { count: "exact", head: true })
        .ilike("website_url", `%${normalizedDomain}%`)
    )
    totalLeads = legacyLeadCount.count
  }

  const generatingCount = await safeCount(
    supabase
      .from("demo_generation_locks")
      .select("id", { count: "exact", head: true })
      .eq("normalized_domain", normalizedDomain)
      .eq("status", "generating")
  )

  return {
    count: totalLeads + generatingCount.count,
    available: leadCount.available && generatingCount.available,
  }
}

export async function findExistingDemo(identity: DemoIdentity): Promise<DemoDuplicateResult> {
  const { count, available } = await countDemosForDomain(identity.normalizedDomain)

  if (count >= DEMO_LIMIT_PER_DOMAIN) {
    return {
      found: true,
      available,
      count,
      source: "demo_leads",
    }
  }

  return {
    found: false,
    available,
    count,
  }
}

export async function createGenerationLock({
  identity,
  companyName,
  websiteUrl,
  request,
}: {
  identity: DemoIdentity
  companyName: string
  websiteUrl: string
  request: Request
}): Promise<GenerationLockResult> {
  const supabase = getSupabaseClient()
  if (!supabase) return { status: "unavailable", reason: "Supabase is not configured." }

  const usage = await countDemosForDomain(identity.normalizedDomain)
  if (usage.count >= DEMO_LIMIT_PER_DOMAIN) {
    return { status: "duplicate" }
  }

  const { data, error } = await supabase
    .from("demo_generation_locks")
    .insert({
      account_id: identity.accountId || null,
      normalized_domain: identity.normalizedDomain,
      normalized_company_name: identity.normalizedCompanyName,
      website_url: websiteUrl,
      company_name: companyName,
      status: "generating",
      ip_hash: identity.ipHash || null,
      user_agent_hash: userAgentHash(request),
      browser_fingerprint_hash: identity.browserFingerprintHash || null,
    })
    .select("id")
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const afterConflict = await countDemosForDomain(identity.normalizedDomain)
      if (afterConflict.count >= DEMO_LIMIT_PER_DOMAIN) {
        return { status: "duplicate" }
      }
      console.info(
        "FINNOR demo dedupe: legacy unique domain lock detected; continuing without a generation lock row."
      )
      return { status: "created", lockId: null }
    }
    console.info("FINNOR demo dedupe: generation lock insert unavailable.")
    return { status: "unavailable", reason: "Generation lock insert failed." }
  }

  const lockId = typeof data?.id === "string" ? data.id : null
  if (!lockId) {
    return { status: "unavailable", reason: "Generation lock did not return an id." }
  }

  const afterInsert = await countDemosForDomain(identity.normalizedDomain)
  if (afterInsert.count > DEMO_LIMIT_PER_DOMAIN) {
    await supabase.from("demo_generation_locks").delete().eq("id", lockId)
    return { status: "duplicate" }
  }

  return { status: "created", lockId }
}

export async function insertDemoLead(
  input: DemoLeadInsert,
  request: Request,
  identity?: DemoIdentity
) {
  const supabase = getSupabaseClient()
  if (!supabase) return localLeadId(input)

  const normalizedDomain =
    identity?.normalizedDomain || input.notes?.normalized_domain?.toString() || ""
  const normalizedCompanyName =
    identity?.normalizedCompanyName || input.notes?.normalized_company_name?.toString() || ""

  const row: DemoLeadRow = {
    normalized_domain: normalizedDomain,
    normalized_company_name: normalizedCompanyName,
    website_url: input.website_url,
    company_name: input.company_name,
    profile_json: {
      companyProfile: input.generated_profile,
      voiceProfile: input.voice_profile,
    },
    confidence_score: Math.round(input.confidence_score),
    status: "generated",
    error_message: null,
    call_started: false,
    call_ended: false,
    source_path: input.source_path || "/demo",
    referrer: request.headers.get("referer"),
    user_agent: request.headers.get("user-agent"),
    ip_hash: identity?.ipHash || null,
    user_agent_hash: userAgentHash(request),
    notes: input.notes || null,
  }

  const { data, error } = await supabase.from("demo_leads").insert(row).select("id").single()
  if (error) {
    console.info("FINNOR demo leads: demo_leads insert unavailable; trying legacy fallback.")
    return (await insertFallbackLead(input)) || localLeadId(input)
  }

  const leadId = typeof data?.id === "string" ? data.id : null
  if (leadId) {
    await notifyDemoGenerated({
      leadId,
      companyName: input.company_name,
      websiteUrl: input.website_url,
      confidenceScore: input.confidence_score,
    })
  }

  return leadId
}

export async function finalizeGenerationLock({
  lockId,
  leadId,
  profile,
}: {
  lockId: string | null
  leadId: string | null
  profile: CompanyProfile
}) {
  if (!lockId) return false
  const supabase = getSupabaseClient()
  if (!supabase) return false

  const { error } = await supabase
    .from("demo_generation_locks")
    .update({
      lead_id: leadId,
      profile_json: profile,
      status: "generated",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lockId)

  if (error) {
    console.info("FINNOR demo dedupe: generation lock finalization skipped after database error.")
    return false
  }

  return true
}

export async function markGenerationLockError(lockId: string | null, errorMessage: string) {
  if (!lockId) return false
  const supabase = getSupabaseClient()
  if (!supabase) return false

  const { error } = await supabase
    .from("demo_generation_locks")
    .update({
      status: "error",
      error_message: errorMessage.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", lockId)

  if (error) {
    console.info("FINNOR demo dedupe: generation lock error update skipped after database error.")
    return false
  }

  return true
}

export async function updateDemoLead(input: DemoLeadUpdate) {
  if (input.lead_id.startsWith("local:")) return true

  const supabase = getSupabaseClient()
  if (!supabase) return false

  if (input.lead_id.startsWith("leads:")) {
    const fallbackId = input.lead_id.replace("leads:", "")
    const status = input.status || (input.call_ended ? "demo_call_ended" : "demo_call_started")
    const { error } = await supabase.from("leads").update({ status }).eq("id", fallbackId)
    if (error) {
      console.info("FINNOR demo leads: leads fallback update skipped after database error.")
      return false
    }
    return true
  }

  const update = {
    ...(typeof input.call_started === "boolean" ? { call_started: input.call_started } : {}),
    ...(typeof input.call_ended === "boolean" ? { call_ended: input.call_ended } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.vapi_call_id !== undefined ? { vapi_call_id: input.vapi_call_id } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase.from("demo_leads").update(update).eq("id", input.lead_id)
  if (error) {
    console.info("FINNOR demo leads: Supabase update skipped after database error.")
    return false
  }

  return true
}

export async function updateDemoLeadByVapiCallId(
  vapiCallId: string,
  input: Omit<DemoLeadUpdate, "lead_id" | "vapi_call_id">
) {
  const supabase = getSupabaseClient()
  if (!supabase || !vapiCallId.trim()) return false

  const update = {
    ...(typeof input.call_started === "boolean" ? { call_started: input.call_started } : {}),
    ...(typeof input.call_ended === "boolean" ? { call_ended: input.call_ended } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from("demo_leads")
    .update(update)
    .eq("vapi_call_id", vapiCallId)

  if (error) {
    console.info("FINNOR voice webhook: Supabase update by Vapi call id skipped after database error.")
    return false
  }

  return true
}

async function safeCount(query: {
  then: PromiseLike<{ count: number | null; error: SupabaseErrorLike | null }>["then"]
}) {
  try {
    const { count, error } = await query
    if (error) {
      console.info("FINNOR demo dedupe: server count unavailable.")
      return { count: 0, available: false }
    }
    return { count: count || 0, available: true }
  } catch {
    console.info("FINNOR demo dedupe: server count skipped.")
    return { count: 0, available: false }
  }
}

async function safeMaybeSingle(query: { maybeSingle: () => unknown }) {
  try {
    const { data, error } = (await query.maybeSingle()) as {
      data: { id?: string } | null
      error: SupabaseErrorLike | null
    }
    if (error) {
      console.info("FINNOR demo dedupe: server lookup unavailable.")
      return { found: false, available: false }
    }
    return { found: Boolean(data?.id), available: true }
  } catch {
    console.info("FINNOR demo dedupe: server lookup skipped.")
    return { found: false, available: false }
  }
}

async function insertFallbackLead(input: DemoLeadInsert) {
  const supabase = getSupabaseClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from("leads")
    .insert({
      name: input.company_name,
      email: "demo@finnorai.com",
      company: input.company_name,
      website: input.website_url,
      message: JSON.stringify({
        source: "personalized_demo",
        confidence_score: Math.round(input.confidence_score),
        profile: input.voice_profile,
        notes: input.notes || null,
      }),
      status: "demo_generated",
    })
    .select("id")
    .single()

  if (error) {
    console.info("FINNOR demo leads: Supabase fallback insert skipped after database error.")
    return null
  }

  const id = typeof data?.id === "string" ? data.id : null
  return id ? `leads:${id}` : null
}

function localLeadId(input: DemoLeadInsert) {
  return `local:${hashValue(
    [
      input.company_name,
      input.website_url,
      input.generated_profile.workflowType,
      Date.now().toString(),
    ].join("|")
  ).slice(0, 24)}`
}

function isUniqueViolation(error: SupabaseErrorLike) {
  return error.code === "23505" || /duplicate key|unique/i.test(error.message || "")
}

function userAgentHash(request: Request) {
  const userAgent = request.headers.get("user-agent") || ""
  return userAgent ? hashValue(userAgent).slice(0, 32) : null
}

async function notifyDemoGenerated({
  leadId,
  companyName,
  websiteUrl,
  confidenceScore,
}: {
  leadId: string
  companyName: string
  websiteUrl: string
  confidenceScore: number
}) {
  if (!serverEnv.leadNotifyWebhookUrl) return

  try {
    await fetch(serverEnv.leadNotifyWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "New FINNOR demo generated",
        company: companyName,
        website: websiteUrl,
        confidence: Math.round(confidenceScore),
        time: new Date().toISOString(),
        lead_id: leadId,
      }),
    })
  } catch {
    console.info("FINNOR demo leads: notification webhook failed.")
  }
}
