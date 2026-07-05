// Server-side persistence for household memory records. Every write is
// best-effort: a missing table or unconfigured Supabase must never break a
// demo, so failures resolve to null and the demos run on the in-flight copy.

import { getSupabaseServiceClient } from "@/lib/leads/supabase"
import type { HouseholdRecord } from "@/lib/memory/household"

export async function saveHouseholdRecord(record: HouseholdRecord): Promise<string | null> {
  try {
    const supabase = getSupabaseServiceClient()
    if (!supabase) return null

    const { data, error } = await supabase
      .from("household_records")
      .insert(toRow(record))
      .select("id")
      .single()

    if (error || !data?.id) return null
    return String(data.id)
  } catch {
    return null
  }
}

export async function updateHouseholdRecord(id: string, record: HouseholdRecord): Promise<boolean> {
  try {
    const supabase = getSupabaseServiceClient()
    if (!supabase || !id) return false

    const { error } = await supabase
      .from("household_records")
      .update({ ...toRow(record), updated_at: new Date().toISOString() })
      .eq("id", id)

    return !error
  } catch {
    return false
  }
}

function toRow(record: HouseholdRecord) {
  return {
    source: record.source,
    dealer_name: record.dealer.name,
    service_zip: record.dealer.zip,
    pricing_tier: record.dealer.tier,
    stage: record.stage,
    ltv: record.ltv,
    next_action: record.nextAction,
    record,
  }
}
