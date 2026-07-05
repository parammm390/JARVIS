import { NextResponse } from "next/server"
import type { CompanyProfile } from "@/lib/demo/types"
import { getSupabaseServiceClient } from "@/lib/leads/supabase"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type TranscriptLine = { role: "assistant" | "user"; text: string }
type CallType = "EMERGENCY" | "QUOTE" | "SERVICE" | "INFO"
type CallStatus = "AI Answered" | "Missed" | "Transferred"

export type CallLogEntry = {
  id: number
  time: string
  caller: string
  city: string
  type: CallType
  duration: string
  status: CallStatus
  summary: string
  transcript: TranscriptLine[]
}

export type SpeedEntry = {
  name: string
  city: string
  service: string
  responseTime: string
  status: "reached" | "voicemail"
  time: string
}

export type MissedEntry = {
  phone: string
  status: "reached" | "voicemail" | "queued" | "calling" | "no-answer"
  addedTime: string
  attempts: number
  note: string
}

export type DemoData = {
  companyName: string
  companyWebsite: string
  serviceCity: string
  serviceState: string
  services: string[]
  callLog: CallLogEntry[]
  speedFeed: SpeedEntry[]
  missedQueue: MissedEntry[]
}

type DemoProfile = {
  companyName: string
  companyWebsite: string
  serviceCity: string
  serviceState: string
  services: string[]
}

type DemoLeadProfileRow = {
  company_name?: string | null
  website_url?: string | null
  profile_json?: {
    companyProfile?: Partial<CompanyProfile>
  } | null
}

const DEFAULT_PROFILE: DemoProfile = {
  companyName: "Clean Water of Virginia",
  companyWebsite: "cleanwaterva.com",
  serviceCity: "Harrisonburg",
  serviceState: "VA",
  services: [
    "Water softener",
    "Whole-house filtration",
    "Reverse osmosis",
    "Water testing",
    "Well pump service",
  ],
}

const CALLERS_BY_REGION: Record<string, string[]> = {
  VA: ["Emily Carter", "James Robinson", "Olivia Bennett", "Marcus Green", "Sophia Nguyen", "Daniel Brooks", "Ava Thompson", "Noah Williams", "Maya Patel", "Ethan Clark"],
  AZ: ["Elena Garcia", "David Kim", "Carla Mendoza", "Michael Yazzie", "Priya Shah", "Tom Ruiz", "Sandra Lopez", "James Park", "Lisa Okonkwo", "Omar Hassan"],
  TX: ["Maria Hernandez", "Evan Walker", "Alicia Flores", "Caleb Johnson", "Nina Patel", "Luis Ramirez", "Brooke Davis", "Isaiah Moore", "Grace Lee", "Andre Wilson"],
  FL: ["Camila Rivera", "Jordan Miller", "Natalie Cruz", "Anthony Reed", "Jasmine Lewis", "Carlos Diaz", "Hannah White", "Malik Brown", "Sofia Martin", "Ryan Taylor"],
}

const DEFAULT_CALLERS = ["Emma Wilson", "Liam Anderson", "Mia Thomas", "Noah Jackson", "Ava Harris", "Lucas Martin", "Isabella Lee", "Elijah Walker", "Amelia Hall", "Henry Young"]
const TIMES = ["3:41 PM", "3:24 PM", "3:02 PM", "2:47 PM", "2:31 PM", "2:12 PM", "1:56 PM", "1:38 PM", "1:14 PM", "12:49 PM", "12:20 PM", "11:58 AM", "11:32 AM", "11:06 AM", "10:44 AM", "10:21 AM", "9:55 AM", "9:27 AM", "8:53 AM", "8:19 AM"]
const DURATIONS = ["3:18", "2:46", "2:18", "1:54", "3:07", "2:22", "2:51", "2:04", "3:33", "2:35", "1:48", "3:11", "2:43", "1:57", "2:09", "2:58", "2:28", "1:51", "3:16", "2:37"]
const TYPES: CallType[] = ["EMERGENCY", "QUOTE", "SERVICE", "INFO", "QUOTE", "SERVICE", "EMERGENCY", "INFO", "QUOTE", "SERVICE", "INFO", "QUOTE", "SERVICE", "EMERGENCY", "INFO", "QUOTE", "SERVICE", "INFO", "QUOTE", "SERVICE"]

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } }
): Promise<NextResponse<DemoData>> {
  const slug = cleanSlug(params.slug)
  let profile = DEFAULT_PROFILE

  try {
    const supabase = getSupabaseServiceClient()
    if (supabase && slug) {
      const escaped = escapeIlike(slug)
      const { data, error } = await supabase
        .from("demo_leads")
        .select("company_name, website_url, profile_json")
        .or(`normalized_domain.ilike.%${escaped}%,company_name.ilike.%${escaped}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.info("FINNOR personalized demo lookup fell back to the default profile.")
      } else if (data) {
        profile = profileFromRow(data as DemoLeadProfileRow)
      }
    }
  } catch {
    console.info("FINNOR personalized demo lookup was unavailable; using default profile.")
  }

  return NextResponse.json(
    {
      ...profile,
      callLog: generateCallLog(profile),
      speedFeed: generateSpeedFeed(profile),
      missedQueue: generateMissedQueue(profile.serviceState),
    },
    { headers: { "cache-control": "no-store" } }
  )
}

function profileFromRow(row: DemoLeadProfileRow): DemoProfile {
  const stored = row.profile_json?.companyProfile || {}
  const location = cleanText(stored.location) || DEFAULT_PROFILE.serviceCity
  const { city, state } = parseLocation(location)
  const services = cleanServices(stored.services?.length ? stored.services : stored.detectedServices)

  return {
    companyName: cleanText(stored.company_name) || cleanText(row.company_name) || DEFAULT_PROFILE.companyName,
    companyWebsite: cleanText(stored.website) || cleanText(row.website_url) || DEFAULT_PROFILE.companyWebsite,
    serviceCity: city,
    serviceState: state,
    services: services.length ? services : DEFAULT_PROFILE.services,
  }
}

function generateCallLog(profile: DemoProfile): CallLogEntry[] {
  const names = CALLERS_BY_REGION[profile.serviceState] || DEFAULT_CALLERS
  const emergencySummaries = [
    "Well pump failure — no water since this morning. Customer flagged for immediate dispatch. Tech contacted.",
    "NO WATER emergency. Pump making grinding noise then stopped. Address logged for same-day service.",
    "Burst pipe near softener unit, water running. Transferred to emergency line immediately.",
  ]
  const serviceIssues = [
    "heavy mineral scale on fixtures and appliances",
    "reduced flow from the reverse-osmosis faucet",
    "sulfur odor and iron staining in well water",
    "softener salt alarm remaining active after refill",
    "pressure tank cycling with intermittent low pressure",
    "whole-house filter pressure loss after a cartridge change",
    "cloudy drinking water and chlorine taste",
    "pre-purchase well-water quality testing",
  ]
  let emergencyIndex = 0

  return TYPES.map((type, index) => {
    const caller = names[index % names.length]
    const service = profile.services[index % profile.services.length]
    const issue = serviceIssues[index % serviceIssues.length]
    const status: CallStatus = type === "EMERGENCY" ? "Transferred" : type === "SERVICE" && (index === 5 || index === 16) ? "Missed" : "AI Answered"
    const summary = type === "EMERGENCY"
      ? emergencySummaries[emergencyIndex++]
      : summaryFor(type, profile.serviceCity, service, issue, status)

    return {
      id: index + 1,
      time: TIMES[index],
      caller,
      city: `${profile.serviceCity} ${profile.serviceState}`,
      type,
      duration: DURATIONS[index],
      status,
      summary,
      transcript: generateTranscript(caller, profile, service, issue, type),
    }
  })
}

function generateTranscript(caller: string, profile: DemoProfile, service: string, issue: string, type: CallType): TranscriptLine[] {
  const urgency = type === "EMERGENCY" ? "It is urgent and affects the entire property." : "It is not dangerous, but I would like a callback this week."
  return [
    { role: "assistant", text: `Thanks for calling ${profile.companyName}. This is Sarah. May I get your name first?` },
    { role: "user", text: `This is ${caller}.` },
    { role: "assistant", text: "What city and service area are you calling from?" },
    { role: "user", text: `I am in ${profile.serviceCity}, ${profile.serviceState}.` },
    { role: "assistant", text: "What specific water issue or service can we help with?" },
    { role: "user", text: `I am calling about ${service.toLowerCase()} because we have ${issue}.` },
    { role: "assistant", text: "Is this affecting the whole property, and how urgent is the request?" },
    { role: "user", text: urgency },
    { role: "assistant", text: "I have captured the details and routed the handoff to the appropriate team." },
  ]
}

function summaryFor(type: CallType, city: string, service: string, issue: string, status: CallStatus): string {
  if (status === "Missed") return `${service} service request from ${city}. ${issue}. AI recovery callback queued. Manual follow-up retained as backup.`
  if (type === "QUOTE") return `Homeowner in ${city} requesting a ${service.toLowerCase()} quote after reporting ${issue}. Non-emergency. Preferred callback window captured. Lead quality: High.`
  if (type === "SERVICE") return `Existing system service request in ${city}: ${issue}. Equipment details and property impact captured. Technician follow-up requested.`
  return `${city} caller requesting information about ${service.toLowerCase()}. Water concern documented as ${issue}. Consultation route prepared.`
}

function generateSpeedFeed(profile: DemoProfile): SpeedEntry[] {
  const names = CALLERS_BY_REGION[profile.serviceState] || DEFAULT_CALLERS
  const responseTimes = [43, 51, 38, 47, 55, 29, 44, 37]
  const times = ["2:14 PM", "1:47 PM", "12:22 PM", "11:05 AM", "9:33 AM", "8:50 AM", "Yesterday 4:11 PM", "Yesterday 2:30 PM"]
  return responseTimes.map((seconds, index) => ({
    name: names[(index + 2) % names.length],
    city: `${profile.serviceCity} ${profile.serviceState}`,
    service: profile.services[index % profile.services.length],
    responseTime: `00:${String(seconds).padStart(2, "0")}`,
    status: index === 2 || index === 6 ? "voicemail" : "reached",
    time: times[index],
  }))
}

function generateMissedQueue(state: string): MissedEntry[] {
  const areaCode = areaCodeFor(state)
  const statuses: MissedEntry["status"][] = ["reached", "voicemail", "calling", "no-answer", "reached", "queued", "reached", "voicemail"]
  const notes = [
    "Whole-house softener quote — homeowner requested options review",
    "Left voicemail for reverse-osmosis service callback",
    "AI callback in progress for low-pressure well pump concern",
    "No answer after three attempts — manual water-service follow-up required",
    "Urgent pressure tank concern — technician visit booked",
    "New whole-house filtration inquiry from website form",
    "Iron filter media replacement — service window scheduled",
    "Sulfur odor complaint — private well-water assessment requested",
  ]
  return statuses.map((status, index) => ({
    phone: `(${areaCode}) 555-${String(1200 + index * 431).padStart(4, "0")}`,
    status,
    addedTime: index < 6 ? ["3:12 PM", "2:55 PM", "3:18 PM", "1:40 PM", "11:20 AM", "3:22 PM"][index] : index === 6 ? "10:05 AM" : "9:30 AM",
    attempts: status === "queued" ? 0 : status === "no-answer" ? 3 : status === "voicemail" ? 2 : 1,
    note: notes[index],
  }))
}

function parseLocation(value: string): { city: string; state: string } {
  const normalized = value.replace(/\s+/g, " ").trim()
  const match = normalized.match(/^(.+?)(?:,|\s)\s*([A-Z]{2})(?:\s+\d{5})?$/)
  if (match) return { city: match[1].trim(), state: match[2] }
  return { city: normalized && normalized.toLowerCase() !== "unknown" ? normalized : DEFAULT_PROFILE.serviceCity, state: DEFAULT_PROFILE.serviceState }
}

function areaCodeFor(state: string): string {
  return ({ VA: "540", AZ: "602", TX: "512", FL: "407", CA: "916", NY: "518" } as Record<string, string>)[state] || "555"
}

function cleanServices(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(cleanText).filter((item) => item && item.toLowerCase() !== "unknown"))).slice(0, 8)
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 240) : ""
}

function cleanSlug(value: string): string {
  try {
    return decodeURIComponent(value).replace(/[^a-zA-Z0-9 ._-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
  } catch {
    return ""
  }
}

function escapeIlike(value: string): string {
  return value.replace(/[%,()]/g, "").trim()
}
