// DESIGN SYSTEM EXTRACTED:
// Primary background: #f8faf9 with healthcare-page radial sky/teal gradients and operational-grid at 44px
// Card background: rgba(255, 255, 255, 0.96) via .ops-card; live command surfaces use rgba(2, 5, 7, 0.84)
// Accent color: #0f766e (teal-700) with #1e5b8d / sky-700 secondary accents
// Border style: 1px solid rgba(15, 38, 62, 0.14), rounded-2xl/rounded-3xl; live surfaces use 1px solid rgba(255,255,255,0.10)
// Font stack: Inter from next/font/google with system sans fallback; ui-monospace for timers and response times
// Badge pattern for status: inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest
// Animation for call waveform: 24 Framer Motion bars; scaleY [0.35 + (index % 5) * 0.12, 0.92 + (index % 6) * 0.08], duration 0.52s, repeat Infinity, repeatType reverse, delay index * 0.025
// Transition timing used across components: duration 0.7s, ease [0.16, 1, 0.3, 1]; state color changes use duration-500
// Icon system in use: lucide-react named imports, for example import { PhoneCall } from "lucide-react" and <PhoneCall className="h-5 w-5" />

"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import Vapi from "@vapi-ai/web"
import {
  Activity,
  Bell,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  Gauge,
  Headphones,
  LayoutDashboard,
  Mail,
  MessageSquare,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  PhoneMissed,
  Play,
  Radio,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  UserRound,
  UsersRound,
  Waves,
  X,
  Zap,
} from "lucide-react"

// VAPI CONFIG: browser-safe identifiers are supplied through Vercel environment variables.
const VAPI_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY || ""
const INBOUND_ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID || ""
const OUTBOUND_ASSISTANT_ID =
  process.env.NEXT_PUBLIC_VAPI_OUTBOUND_ASSISTANT_ID || "4b5fb86f-157e-4bf0-a6ac-6d33e96c879a"

const SERVICES = [
  "Water softener / conditioner",
  "Whole-house filtration",
  "RO / drinking water systems",
  "Well pump service",
  "Water quality testing",
  "Salt delivery and maintenance",
  "Iron / sulfur treatment",
  "UV disinfection",
]

const LEAD_SOURCES = [
  "Inbound phone calls",
  "Website contact form",
  "Google / LSA",
  "Meta / Facebook ads",
  "Word of mouth / referral",
]

const PAIN_POINTS = [
  "Missed calls after hours",
  "Slow follow-up on web leads",
  "No-water emergencies going unanswered",
  "General call overflow during business hours",
]

const TEAM_SIZES = ["Solo operator", "2–5 people", "5–15 people", "15+ people"]
const JOB_VALUES = ["Under $500", "$500–$1,500", "$1,500–$3,500", "$3,500+"]
const EASE = [0.16, 1, 0.3, 1]
const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
const STATIC_WAVEFORM = [18, 34, 26, 48, 30, 54, 22, 42, 58, 28, 46, 36, 52, 24, 44, 32, 56, 38, 20, 50, 30, 42, 26, 36]
const COMPANY_PLACEHOLDER = ["Clean Water", " of Virginia"].join("")
const WEBSITE_PLACEHOLDER = ["cleanwater", "va.com"].join("")

const NEARBY_LOCALITIES = {
  richmond: ["Henrico", "Midlothian", "Mechanicsville"],
  harrisonburg: ["Bridgewater", "Dayton", "Massanutten"],
  roanoke: ["Salem", "Vinton", "Cave Spring"],
  norfolk: ["Chesapeake", "Portsmouth", "Virginia Beach"],
  austin: ["Round Rock", "Cedar Park", "Pflugerville"],
  dallas: ["Plano", "Irving", "Richardson"],
  houston: ["Katy", "Sugar Land", "Pearland"],
  tampa: ["Brandon", "Riverview", "Temple Terrace"],
  orlando: ["Winter Park", "Altamonte Springs", "Maitland"],
  denver: ["Lakewood", "Aurora", "Arvada"],
  charlotte: ["Matthews", "Pineville", "Huntersville"],
  atlanta: ["Decatur", "Sandy Springs", "Marietta"],
}

const EMPTY_DRAFT = {
  companyName: "",
  website: "",
  city: "",
  services: [],
  emergency: null,
  teamSize: TEAM_SIZES[1],
  contactName: "",
  avgJobValue: JOB_VALUES[1],
  painPoint: PAIN_POINTS[0],
  leadSources: [],
}

function hashText(value) {
  return Array.from(value).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 2166136261)
}

function pick(items, index) {
  return items[index % items.length]
}

function formatDuration(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

function normalizeRole(role) {
  if (["user", "human", "customer"].includes(role)) return "user"
  if (["assistant", "bot", "ai"].includes(role)) return "assistant"
  return null
}

function transcriptEventsFromMessage(message) {
  if (!message || typeof message !== "object") return []
  if (
    (message.type === "transcript" || message.type === "transcript[transcriptType='final']") &&
    message.transcript &&
    message.transcriptType !== "partial"
  ) {
    const role = normalizeRole(message.role)
    return role ? [{ role, text: message.transcript }] : []
  }
  if (message.message?.content && message.message.role !== "system") {
    const role = normalizeRole(message.message.role)
    return role ? [{ role, text: message.message.content }] : []
  }
  if (message.type === "conversation-update") {
    const messages = message.messages?.length
      ? message.messages.map((item) => ({ role: item.role, text: item.message || item.content || "" }))
      : (message.messagesOpenAIFormatted || []).map((item) => ({
          role: item.role,
          text: typeof item.content === "string"
            ? item.content
            : Array.isArray(item.content)
              ? item.content.map((part) => part?.text || "").join(" ")
              : "",
        }))
    const latest = messages.filter((item) => item.role !== "system" && item.text.trim()).at(-1)
    const role = normalizeRole(latest?.role)
    return latest && role ? [{ role, text: latest.text }] : []
  }
  return []
}

function citySet(city) {
  const [base, region = ""] = city.split(",").map((part) => part.trim())
  const nearby = NEARBY_LOCALITIES[base.toLowerCase()] || [`North ${base}`, `${base} metro`, `${base} service area`]
  return [city, ...nearby.map((locality) => `${locality}${region ? `, ${region}` : ""}`)]
}

function regionalNames(city) {
  const lower = city.toLowerCase()
  if (lower.includes("texas") || /,\s*tx\b/.test(lower)) {
    return ["Mateo Garcia", "Avery Johnson", "Elena Ramirez", "Caleb Williams", "Sofia Martinez", "Ethan Brooks", "Mia Thompson", "Lucas Hernandez"]
  }
  if (lower.includes("virginia") || /,\s*va\b/.test(lower)) {
    return ["James Carter", "Olivia Bennett", "William Harris", "Amelia Foster", "Henry Collins", "Charlotte Reed", "Noah Turner", "Grace Morgan"]
  }
  if (lower.includes("florida") || /,\s*fl\b/.test(lower)) {
    return ["Daniel Rivera", "Isabella Cruz", "Jackson Reed", "Camila Torres", "Liam Parker", "Sofia Morales", "Ethan Hayes", "Maya Collins"]
  }
  return ["Alex Morgan", "Jordan Lee", "Taylor Brooks", "Casey Bennett", "Morgan Reed", "Riley Carter", "Cameron Hayes", "Avery Collins"]
}

function phoneFor(seed, index) {
  const suffix = String((seed + index * 7919) % 10000000).padStart(7, "0")
  return `(555) ${suffix.slice(0, 3)}-${suffix.slice(3)}`
}

function serviceIssue(service) {
  if (/softener|conditioner/i.test(service)) return "hard-water scale and spotting"
  if (/filtration/i.test(service)) return "taste and odor concerns"
  if (/RO|drinking/i.test(service)) return "drinking-water quality concerns"
  if (/pump/i.test(service)) return "loss of pressure at the property"
  if (/testing/i.test(service)) return "a request for a complete water-quality assessment"
  if (/salt|maintenance/i.test(service)) return "an existing system maintenance request"
  if (/iron|sulfur/i.test(service)) return "iron staining and sulfur odor"
  return "a water safety and treatment question"
}

function typeDistribution(emergency) {
  return emergency
    ? [...Array(3).fill("EMERGENCY"), ...Array(8).fill("QUOTE"), ...Array(6).fill("SERVICE"), ...Array(3).fill("INFO")]
    : [...Array(10).fill("QUOTE"), ...Array(7).fill("SERVICE"), ...Array(3).fill("INFO")]
}

function buildSummary(profile, type, service, city) {
  const issue = serviceIssue(service)
  if (type === "EMERGENCY") return `${service} request with urgent ${issue}. Customer flagged for immediate response. ${profile.contactName} contacted via SMS; dispatch route acknowledged.`
  if (type === "QUOTE") return `Homeowner in the ${city} area reports ${issue}. Interested in ${service}; expected job range ${profile.avgJobValue}. Timeline: ${profile.avgJobValue === JOB_VALUES[0] ? "this week" : "within the next few weeks"}. Non-urgent. Callback captured. Lead quality: High.`
  if (type === "SERVICE") return `Existing ${service} customer reports ${issue}. Service history requested; appointment needs scheduling by ${profile.contactName}.`
  return `Caller asked about ${service} availability in ${city}. Information provided; no immediate appointment requested.`
}

function generateDashboardData(profile) {
  const seed = hashText(`${profile.companyName}-${profile.city}`)
  const names = regionalNames(profile.city)
  const cities = citySet(profile.city)
  const types = typeDistribution(profile.emergency)
  const callLog = types.map((type, index) => {
    const urgentServices = profile.services.filter((service) => /pump|pressure/i.test(service))
    const service = type === "EMERGENCY" && urgentServices.length
      ? pick(urgentServices, seed + index)
      : pick(profile.services, seed + index)
    const city = pick(cities, seed + index * 3)
    const name = pick(names, seed + index * 5)
    return {
      id: `call-${seed}-${index}`,
      time: `${String(8 + (index % 10)).padStart(2, "0")}:${String((seed + index * 7) % 60).padStart(2, "0")}`,
      caller: name,
      phone: phoneFor(seed, index),
      city,
      type,
      service,
      duration: formatDuration(74 + ((seed + index * 29) % 310)),
      status: type === "INFO" ? "Resolved" : index % 4 === 0 ? "Follow-up" : "Captured",
      summary: buildSummary(profile, type, service, city),
    }
  })

  const speedStatuses = ["reached", "reached", "voicemail", "reached", "no-answer", "reached", "voicemail", "reached"]
  const responseTimes = [29, 34, 41, 47, 52, 55, 57, 38]
  const speedFeed = speedStatuses.map((status, index) => ({
    id: `speed-${seed}-${index}`,
    time: `${Math.max(1, index + 1)}h ago`,
    name: pick(names, seed + index * 2),
    city: pick(cities, seed + index),
    service: pick(profile.services, seed + index * 3),
    responseTime: `00:${responseTimes[index]}`,
    status,
  }))

  const queueStatuses = ["reached", "voicemail", "calling", "queued", "no-answer", "reached", "voicemail", "reached"]
  const missedQueue = queueStatuses.map((status, index) => {
    const service = pick(profile.services, seed + index * 2)
    return {
      id: `queue-${seed}-${index}`,
      phone: phoneFor(seed + 4000, index),
      city: pick(cities, seed + index),
      status,
      addedTime: `${index + 1}d ago`,
      attempts: status === "queued" ? 0 : status === "calling" ? 1 : 1 + (index % 2),
      note: `${service} recovery follow-up for the ${pick(cities, seed + index)} service area.`,
    }
  })

  const missedByTeam = { "Solo operator": 34, "2–5 people": 67, "5–15 people": 112, "15+ people": 89 }
  const callsByTeam = { "Solo operator": 8, "2–5 people": 12, "5–15 people": 18, "15+ people": 16 }
  const missed = missedByTeam[profile.teamSize]
  const recoveryRate = 100
  return {
    callLog,
    speedFeed,
    missedQueue,
    stats: { missed, recoveryRate, recovered: missed, callsToday: callsByTeam[profile.teamSize] },
  }
}

export default function PersonalizedDashboardPage() {
  const [profile, setProfile] = useState(null)
  return (
    <AnimatePresence mode="wait">
      {profile ? (
        <Dashboard key="dashboard" profile={profile} />
      ) : (
        <Intake key="intake" onComplete={setProfile} />
      )}
    </AnimatePresence>
  )
}

function Intake({ onComplete }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [error, setError] = useState("")

  function toggleList(key, value) {
    setDraft((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value],
    }))
  }

  function submit(event) {
    event.preventDefault()
    if (!draft.companyName.trim() || !draft.city.trim() || !draft.services.length || draft.emergency === null || !draft.leadSources.length) {
      setError("Add the company, service region, at least one service, coverage choice, and at least one lead source.")
      return
    }
    onComplete({
      ...draft,
      companyName: draft.companyName.trim(),
      website: draft.website.trim() || `${draft.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24)}.com`,
      city: draft.city.trim(),
      contactName: draft.contactName.trim() || `${draft.companyName.trim()} team`,
    })
  }

  const inputClass = "h-14 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 placeholder:text-slate-400"
  const labelClass = "text-[10px] font-black uppercase tracking-[0.2em] text-slate-500"

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.7, ease: EASE }}
      className="healthcare-page operational-grid min-h-screen px-4 py-12 selection:bg-teal-200/40"
    >
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-[520px] items-center">
        <form onSubmit={submit} className="ops-card relative w-full overflow-hidden rounded-[1.6rem] bg-white/88 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.1)] md:p-8">
          <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-sky-100/80 blur-[92px]" />
          <div className="relative z-10">
            <div className="mb-5 inline-flex items-center rounded-full border border-sky-100 bg-sky-50 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-sky-800">
              <span className="mr-2 h-1.5 w-1.5 rounded-full bg-teal-500 shadow-[0_0_0_4px_rgba(20,184,166,0.12)]" />
              FINNOR, Personalized Demo Builder
            </div>
            <h1 className="text-4xl font-black leading-[1.02] tracking-tight text-slate-950 md:text-5xl">Build your account dashboard.</h1>
            <p className="mt-4 text-base font-semibold leading-relaxed text-slate-600">We generate a live preview of FINNOR running for your company. All data is built from the details you enter here.</p>

            <div className="mt-8 space-y-6">
              <Field label="Company Name" labelClass={labelClass}>
                <input required value={draft.companyName} onChange={(event) => setDraft({ ...draft, companyName: event.target.value })} placeholder={COMPANY_PLACEHOLDER} className={inputClass} />
              </Field>
              <Field label="Website URL" labelClass={labelClass}>
                <input value={draft.website} onChange={(event) => setDraft({ ...draft, website: event.target.value })} placeholder={WEBSITE_PLACEHOLDER} className={inputClass} />
              </Field>
              <Field label="Primary Service City / Region" labelClass={labelClass}>
                <input required value={draft.city} onChange={(event) => setDraft({ ...draft, city: event.target.value })} placeholder="Richmond, VA" className={inputClass} />
              </Field>
              <Field label="Services you offer" labelClass={labelClass}>
                <PillGrid items={SERVICES} selected={draft.services} onToggle={(item) => toggleList("services", item)} />
              </Field>
              <Field label="After-hours / emergency coverage?" labelClass={labelClass}>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[[true, "Yes, we cover emergencies"], [false, "Quote and service only"]].map(([value, label]) => (
                    <ChoiceButton key={label} selected={draft.emergency === value} onClick={() => setDraft({ ...draft, emergency: value })}>{label}</ChoiceButton>
                  ))}
                </div>
              </Field>
              <Field label="Team size" labelClass={labelClass}>
                <select value={draft.teamSize} onChange={(event) => setDraft({ ...draft, teamSize: event.target.value })} className={inputClass}>{TEAM_SIZES.map((item) => <option key={item}>{item}</option>)}</select>
              </Field>
              <Field label="Primary contact name" labelClass={labelClass}>
                <input value={draft.contactName} onChange={(event) => setDraft({ ...draft, contactName: event.target.value })} placeholder="Mike or Sarah" className={inputClass} />
              </Field>
              <Field label="Approximate average job value" labelClass={labelClass}>
                <select value={draft.avgJobValue} onChange={(event) => setDraft({ ...draft, avgJobValue: event.target.value })} className={inputClass}>{JOB_VALUES.map((item) => <option key={item}>{item}</option>)}</select>
              </Field>
              <Field label="Biggest current gap" labelClass={labelClass}>
                <div className="grid gap-3">{PAIN_POINTS.map((item) => <ChoiceButton key={item} selected={draft.painPoint === item} onClick={() => setDraft({ ...draft, painPoint: item })}>{item}</ChoiceButton>)}</div>
              </Field>
              <Field label="How leads come in" labelClass={labelClass}>
                <PillGrid items={LEAD_SOURCES} selected={draft.leadSources} onToggle={(item) => toggleList("leadSources", item)} />
              </Field>
            </div>

            {error ? <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">{error}</div> : null}
            <button type="submit" className="cta-primary mt-7 inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-8 text-base font-black text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)] transition hover:bg-slate-800">
              Build my dashboard <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </form>
      </div>
    </motion.main>
  )
}

function Field({ label, labelClass, children }) {
  return <div className="block space-y-3"><p className={labelClass}>{label}</p>{children}</div>
}

function PillGrid({ items, selected, onToggle }) {
  return <div className="flex flex-wrap gap-2">{items.map((item) => {
    const active = selected.includes(item)
    return <button key={item} type="button" onClick={() => onToggle(item)} className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-black transition ${active ? "border-teal-200 bg-teal-50 text-teal-800 shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-sky-200"}`}>{active ? <Check className="h-3.5 w-3.5" /> : null}{item}</button>
  })}</div>
}

function ChoiceButton({ selected, onClick, children }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} className={`flex min-h-12 items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-black transition-all ${selected ? "border-sky-300 bg-[linear-gradient(135deg,#f0f9ff_0%,#ecfeff_100%)] text-slate-950 shadow-[0_16px_36px_rgba(14,165,233,0.1)]" : "border-slate-200 bg-white text-slate-600 hover:border-sky-200"}`}><span>{children}</span><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${selected ? "border-teal-500 bg-teal-500 text-white" : "border-slate-300 text-transparent"}`}><Check className="h-3 w-3" /></span></button>
}

function Dashboard({ profile }) {
  const generated = useMemo(() => generateDashboardData(profile), [profile])
  const [activeNav, setActiveNav] = useState("live-calls")
  const [toasts, setToasts] = useState([])
  const [callPhase, setCallPhase] = useState("idle")
  const [callDuration, setCallDuration] = useState(0)
  const [transcript, setTranscript] = useState([])
  const [captured, setCaptured] = useState({ name: "", location: "", service: "", urgency: "", phone: "" })
  const [flashing, setFlashing] = useState("")
  const [handoffSent, setHandoffSent] = useState(false)
  const [speedFeed, setSpeedFeed] = useState(generated.speedFeed)
  const [speedForm, setSpeedForm] = useState({ name: "", phone: "", city: profile.city, service: profile.services[0] })
  const [speedPhase, setSpeedPhase] = useState("form")
  const [countdown, setCountdown] = useState(3)
  const [missedInput, setMissedInput] = useState("")
  const [missedQueue, setMissedQueue] = useState(generated.missedQueue)
  const [filter, setFilter] = useState("ALL")
  const [selectedCall, setSelectedCall] = useState(null)
  const inboundRef = useRef(null)
  const outboundRef = useRef(null)
  const timerRef = useRef(null)
  const countdownRef = useRef(null)
  const queueTimersRef = useRef([])
  const transcriptEndRef = useRef(null)
  const lastQuestionRef = useRef("")
  const outboundStartedRef = useRef(0)
  const consumeTranscriptRef = useRef(null)
  const toastRef = useRef(null)

  function schedule(callback, delay) {
    const timer = window.setTimeout(callback, delay)
    queueTimersRef.current.push(timer)
    return timer
  }

  function toast(message, tone = "default") {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((current) => [...current, { id, message, tone }])
    schedule(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200)
  }
  toastRef.current = toast

  function captureField(key, value) {
    if (!value) return
    setFlashing(key)
    setCaptured((current) => ({ ...current, [key]: current[key] || value }))
    schedule(() => setFlashing(""), 900)
  }

  function consumeTranscript(message) {
    transcriptEventsFromMessage(message).forEach(({ role, text: rawText }) => {
      const text = rawText.trim()
      if (!text) return
      setTranscript((current) => {
        const previous = current.at(-1)
        if (previous?.role === role && previous.text === text) return current
        return [...current, { id: `${Date.now()}-${Math.random()}`, role, text }]
      })
      const lower = text.toLowerCase()
      if (role === "assistant") {
        if (/name|who am i speaking/.test(lower)) lastQuestionRef.current = "name"
        else if (/city|zip|location|service address/.test(lower)) lastQuestionRef.current = "location"
        else if (/service|water issue|help with/.test(lower)) lastQuestionRef.current = "service"
        else if (/urgent|emergency|how soon/.test(lower)) lastQuestionRef.current = "urgency"
        else if (/phone|number|callback|reach you/.test(lower)) lastQuestionRef.current = "phone"
        return
      }
      const phone = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0]
      const name = text.match(/\b(?:my name is|this is|i am|i'm)\s+([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)?)/i)?.[1]
      const service = profile.services.find((item) => item.toLowerCase().split(/[ /]/).some((word) => word.length > 3 && lower.includes(word)))
      if (name || lastQuestionRef.current === "name") captureField("name", name || text)
      if (phone || lastQuestionRef.current === "phone") captureField("phone", phone || text)
      if (lower.includes(profile.city.split(",")[0].toLowerCase()) || /\b\d{5}\b/.test(lower) || lastQuestionRef.current === "location") captureField("location", text)
      if (service || lastQuestionRef.current === "service") captureField("service", service || text)
      if (/urgent|emergency|today|no water|as soon as|not urgent/.test(lower) || lastQuestionRef.current === "urgency") captureField("urgency", text)
      lastQuestionRef.current = ""
    })
  }
  consumeTranscriptRef.current = consumeTranscript

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [transcript])

  useEffect(() => {
    if (VAPI_PUBLIC_KEY) {
      const inbound = new Vapi(VAPI_PUBLIC_KEY)
      inboundRef.current = inbound
      inbound.on("call-start", () => {
        setCallPhase("calling")
        setCallDuration(0)
        clearInterval(timerRef.current)
        timerRef.current = window.setInterval(() => setCallDuration((value) => value + 1), 1000)
      })
      inbound.on("call-end", () => {
        clearInterval(timerRef.current)
        setCallPhase("ended")
        schedule(() => setHandoffSent(true), 2000)
      })
      inbound.on("message", (message) => consumeTranscriptRef.current?.(message))
      inbound.on("call-start-failed", () => {
        setCallPhase("idle")
        toastRef.current?.("The live voice call could not start.", "error")
      })
      inbound.on("error", () => {
        clearInterval(timerRef.current)
        setCallPhase("idle")
        toastRef.current?.("The live voice call could not connect.", "error")
      })
    }
    const queueTimers = queueTimersRef.current
    return () => {
      clearInterval(timerRef.current)
      clearInterval(countdownRef.current)
      queueTimers.forEach(window.clearTimeout)
      inboundRef.current?.removeAllListeners()
      outboundRef.current?.removeAllListeners()
      void inboundRef.current?.stop()
      void outboundRef.current?.stop()
      inboundRef.current = null
      outboundRef.current = null
    }
  }, [])

  async function startInbound() {
    if (!inboundRef.current || !INBOUND_ASSISTANT_ID) {
      toast("Live voice configuration is unavailable.", "error")
      return
    }
    setTranscript([])
    setCaptured({ name: "", location: "", service: "", urgency: "", phone: "" })
    setHandoffSent(false)
    try {
      await inboundRef.current.start(INBOUND_ASSISTANT_ID, { variableValues: { company_name: profile.companyName, city: profile.city, services: profile.services.join(", "), contact_name: profile.contactName } })
    } catch {
      toast("Unable to start the demo call.", "error")
    }
  }

  async function endInbound() {
    await inboundRef.current?.stop()
  }

  function submitSpeed(event) {
    event.preventDefault()
    if (!speedForm.name.trim() || !speedForm.phone.trim()) {
      toast("Add the lead name and phone number.", "error")
      return
    }
    setCountdown(3)
    setSpeedPhase("countdown")
    let value = 3
    clearInterval(countdownRef.current)
    countdownRef.current = window.setInterval(() => {
      value -= 1
      if (value > 0) setCountdown(value)
      else {
        clearInterval(countdownRef.current)
        void startOutbound()
      }
    }, 1000)
  }

  async function startOutbound() {
    setSpeedPhase("calling")
    outboundStartedRef.current = Date.now()
    const pending = { id: `new-${Date.now()}`, time: "now", ...speedForm, responseTime: "00:00", status: "calling", isNew: true }
    setSpeedFeed((current) => [pending, ...current].slice(0, 8))
    if (!VAPI_PUBLIC_KEY || !OUTBOUND_ASSISTANT_ID) {
      setSpeedFeed((current) => current.map((item, index) => index === 0 ? { ...item, responseTime: "00:01", status: "no-answer" } : item))
      setSpeedPhase("ended")
      toast("Outbound voice configuration is unavailable.", "error")
      return
    }
    try {
      const outbound = new Vapi(VAPI_PUBLIC_KEY)
      outboundRef.current = outbound
      let finished = false
      const finish = (status = "reached") => {
        if (finished) return
        finished = true
        const elapsed = Math.min(59, Math.max(1, Math.round((Date.now() - outboundStartedRef.current) / 1000)))
        setSpeedFeed((current) => current.map((item, index) => index === 0 ? { ...item, responseTime: formatDuration(elapsed), status } : item))
        setSpeedPhase("ended")
      }
      outbound.on("call-end", () => finish("reached"))
      outbound.on("call-start-failed", () => {
        finish("no-answer")
        toast("The outbound demo call could not start.", "error")
      })
      outbound.on("error", () => {
        finish("no-answer")
        toast("The outbound demo call could not connect.", "error")
      })
      await outbound.start(OUTBOUND_ASSISTANT_ID, { variableValues: { company_name: profile.companyName, lead_name: speedForm.name, lead_service: speedForm.service, lead_city: speedForm.city } })
    } catch {
      const elapsed = Math.min(59, Math.max(1, Math.round((Date.now() - outboundStartedRef.current) / 1000)))
      setSpeedFeed((current) => current.map((item, index) => index === 0 ? { ...item, responseTime: formatDuration(elapsed), status: "no-answer" } : item))
      setSpeedPhase("ended")
      toast("The outbound demo call could not connect.", "error")
    }
  }

  function queueNumbers() {
    const numbers = missedInput.split(/[\n,]+/).map((item) => item.trim()).filter((item) => /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(item))
    if (!numbers.length) {
      toast("Enter at least one valid phone number.", "error")
      return
    }
    const additions = numbers.map((phone, index) => ({ id: `manual-${Date.now()}-${index}`, phone, city: profile.city, status: "queued", addedTime: "now", attempts: 0, note: `${pick(profile.services, index)} recovery follow-up for the ${profile.city} service area.` }))
    setMissedQueue((current) => [...additions, ...current])
    setMissedInput("")
    toast(`${numbers.length} ${numbers.length === 1 ? "number" : "numbers"} added to the recovery queue.`, "success")
    const firstId = additions[0].id
    schedule(() => setMissedQueue((current) => current.map((item) => item.id === firstId ? { ...item, status: "calling", attempts: 1 } : item)), 2000)
    schedule(() => setMissedQueue((current) => current.map((item) => item.id === firstId ? { ...item, status: "reached", note: `${item.note} Lead captured.` } : item)), 6000)
  }

  function navigate(id) {
    setActiveNav(id)
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const nav = [
    [LayoutDashboard, "Overview", "overview"],
    [PhoneIncoming, "Live Calls", "live-calls"],
    [Zap, "Speed to Lead", "speed-to-lead"],
    [PhoneMissed, "Missed Recovery", "missed-recovery"],
    [FileText, "Call Log", "call-log"],
  ]
  const filteredCalls = generated.callLog.filter((call) => filter === "ALL" || call.type === filter)
  const filters = ["ALL", ...(profile.emergency ? ["EMERGENCY"] : []), "QUOTE", "SERVICE", "INFO"]
  const painCopy = {
    "Missed calls after hours": `FINNOR is capturing every after-hours call for ${profile.companyName} and routing structured handoffs to ${profile.contactName}.`,
    "Slow follow-up on web leads": `FINNOR is responding to ${profile.companyName} web leads while intent is high and routing qualified opportunities to ${profile.contactName}.`,
    "No-water emergencies going unanswered": `FINNOR is screening urgent no-water requests in ${profile.city} and notifying ${profile.contactName} through the approved route.`,
    "General call overflow during business hours": `FINNOR is covering business-hour overflow for ${profile.companyName} and keeping ${profile.contactName} supplied with structured call context.`,
  }[profile.painPoint]

  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }} className="healthcare-page flex h-[100dvh] overflow-hidden text-slate-950">
      <aside className="hidden h-screen w-[220px] shrink-0 flex-col border-r border-slate-200 bg-white/92 backdrop-blur-xl lg:flex">
        <div className="border-b border-slate-200 p-5">
          <div className="flex items-center gap-3 text-xl font-black tracking-tight"><span className="grid h-8 w-8 place-items-center rounded-xl bg-slate-950 text-xs text-white">F</span>FINNOR</div>
          <p title={profile.companyName} className="mt-5 truncate text-sm font-black text-slate-900">{profile.companyName}</p>
          <p title={profile.website} className="mt-1 truncate text-xs font-semibold text-slate-500">{profile.website}</p>
        </div>
        <nav className="flex-1 space-y-1 p-3">{nav.map(([Icon, label, id]) => <button key={id} onClick={() => navigate(id)} className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-black transition ${activeNav === id ? "bg-sky-50 text-sky-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}><Icon className="h-4 w-4" />{label}</button>)}<button onClick={() => toast("Available in your production dashboard")} className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-black text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"><Settings className="h-4 w-4" />Settings</button></nav>
        <div className="border-t border-slate-200 p-4"><div className="rounded-2xl border border-teal-100 bg-teal-50 p-3"><div className="flex items-start gap-2 text-xs font-black text-teal-800"><span className="mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-teal-500" /><span>Sarah is live for {profile.companyName}</span></div></div></div>
      </aside>

      <div data-lenis-prevent className="min-w-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain scroll-smooth">
        <header className="sticky top-0 z-40 flex h-20 items-center justify-between border-b border-slate-200 bg-white/88 px-4 shadow-[0_12px_42px_rgba(15,38,62,0.06)] backdrop-blur-xl md:px-6">
          <div className="flex min-w-0 items-center gap-3"><span className="text-lg font-black tracking-tight">FINNOR</span><span className="text-slate-300">/</span><span className="truncate text-sm font-black text-slate-600">{profile.companyName}</span></div>
          <div className="flex items-center gap-3"><span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-black text-teal-800"><span className="mr-2 h-1.5 w-1.5 animate-pulse rounded-full bg-teal-500" />AI Agent Active</span><Bell className="h-5 w-5 text-slate-600" /></div>
        </header>

        <main className="container mx-auto p-4 md:p-6 lg:p-8">
          <section id="overview" className="scroll-mt-24">
            <div className="rounded-2xl border border-sky-100 bg-sky-50/75 p-4 text-sm font-semibold leading-relaxed text-sky-900"><div className="flex gap-3"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" /><p>{painCopy}</p></div></div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat icon={PhoneCall} label="Calls today" value={generated.stats.callsToday} />
              <Stat icon={PhoneMissed} label="Missed this month" value={generated.stats.missed} />
              <Stat icon={RefreshCw} label="Recovered" value={generated.stats.recovered} />
              <Stat icon={Gauge} label="Recovery rate" value={`${generated.stats.recoveryRate}%`} />
            </div>
          </section>

          <section id="live-calls" className="scroll-mt-24 pt-12">
            <SectionHeading eyebrow="Live call demo" title={`Sarah answers for ${profile.companyName}`} copy={`Call as a customer in ${profile.city}. The live agent uses only the services and handoff context supplied in your profile.`} />
            <div className="command-surface command-grid mt-7 overflow-hidden rounded-[2rem] p-4 text-white md:p-6">
              <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <CallConsole profile={profile} phase={callPhase} duration={callDuration} start={startInbound} end={endInbound} handoffSent={handoffSent} />
                <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <TranscriptPanel transcript={transcript} endRef={transcriptEndRef} />
                  <CapturePanel captured={captured} flashing={flashing} />
                </div>
              </div>
              <AnimatePresence>{handoffSent ? <Handoff profile={profile} duration={callDuration} /> : null}</AnimatePresence>
            </div>
          </section>

          <section id="speed-to-lead" className="scroll-mt-24 pt-16">
            <SectionHeading eyebrow="Outbound speed to lead" title="Respond while the lead is still looking." copy={`Every connected source below came directly from ${profile.companyName}'s intake profile.`} />
            <FlowDiagram />
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{profile.leadSources.map((source) => <SourceTile key={source} source={source} />)}</div>
            <div className="mt-6 grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
              <SpeedDemo profile={profile} form={speedForm} setForm={setSpeedForm} phase={speedPhase} countdown={countdown} submit={submitSpeed} feed={speedFeed} endCall={() => outboundRef.current?.stop()} />
              <SpeedTable rows={speedFeed} />
            </div>
          </section>

          <section id="missed-recovery" className="scroll-mt-24 pt-16">
            <SectionHeading eyebrow="Missed recovery" title="Turn the callback list into active conversations." copy={`Recovery notes stay specific to ${profile.services.join(", ")} across the ${profile.city} service area.`} />
            <div className="mt-6 grid gap-4 md:grid-cols-2"><NoticeBadge tone="warning" icon={PhoneMissed} text={`${generated.stats.missed} missed this month`} /><NoticeBadge tone="success" icon={CheckCircle2} text={`${generated.stats.recovered} recovered (${generated.stats.recoveryRate}%)`} /></div>
            <div className="ops-card mt-5 rounded-[2rem] p-5 md:p-6">
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end"><label className="space-y-3"><span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Paste phone numbers, one per line</span><textarea value={missedInput} onChange={(event) => setMissedInput(event.target.value)} rows={4} placeholder="(555) 000-0000" className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100" /></label><button onClick={queueNumbers} className="cta-secondary inline-flex h-12 items-center justify-center gap-2 rounded-full border border-slate-900/12 bg-white px-6 text-sm font-black text-slate-900 transition hover:-translate-y-0.5 hover:border-slate-900/24"><PhoneForwarded className="h-4 w-4" />Queue for AI callback</button></div>
              <QueueTable rows={missedQueue} />
            </div>
          </section>

          <section id="call-log" className="scroll-mt-24 pb-20 pt-16">
            <SectionHeading eyebrow="Call log" title="Every conversation, structured for follow-up." copy={`Twenty account-specific interactions generated from ${profile.companyName}'s service mix and operating profile.`} />
            <div className="mt-6 flex flex-wrap gap-2">{filters.map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-widest transition ${filter === item ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-sky-200"}`}>{item}</button>)}</div>
            <CallTable rows={filteredCalls} onSelect={setSelectedCall} />
          </section>
        </main>
      </div>

      <AnimatePresence>{selectedCall ? <CallDrawer call={selectedCall} profile={profile} close={() => setSelectedCall(null)} toast={toast} /> : null}</AnimatePresence>
      <ToastStack toasts={toasts} />
    </motion.div>
  )
}

function Stat({ icon: Icon, label, value }) {
  return <div className="ops-card rounded-2xl p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</p><p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p></div><span className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-50 text-sky-800"><Icon className="h-5 w-5" /></span></div></div>
}

function SectionHeading({ eyebrow, title, copy }) {
  return <div className="max-w-3xl"><div className="section-kicker">{eyebrow}</div><h2 className="mt-5 text-3xl font-black tracking-tight text-slate-950 md:text-5xl">{title}</h2><p className="mt-4 text-base font-semibold leading-relaxed text-slate-600 md:text-lg">{copy}</p></div>
}

function Waveform({ active = true, compact = false }) {
  return <div className={`flex items-end justify-center gap-1.5 ${compact ? "h-10" : "h-16"}`}>{Array.from({ length: 24 }).map((_, index) => <motion.span key={index} animate={{ scaleY: active ? [0.35 + (index % 5) * 0.12, 0.92 + (index % 6) * 0.08] : 0.25 }} transition={{ duration: active ? 0.52 : 0.82, repeat: active ? Infinity : 0, repeatType: "reverse", delay: index * 0.025 }} className={`${compact ? "h-8 w-1" : "h-16 w-1.5"} origin-bottom rounded-full bg-gradient-to-t from-cyan-200/20 via-cyan-100/65 to-white/90`} />)}</div>
}

function StaticWaveform() {
  return <div className="flex h-16 items-center justify-center gap-1.5" aria-hidden="true">{STATIC_WAVEFORM.map((height, index) => <span key={`${height}-${index}`} className="w-1.5 rounded-full bg-gradient-to-t from-cyan-200/20 via-cyan-100/65 to-white/90" style={{ height }} />)}</div>
}

function CallConsole({ profile, phase, duration, start, end, handoffSent }) {
  return <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/70 p-5 md:p-7"><div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(103,232,249,0.12),transparent_42%)]" /><div className="relative flex min-h-[430px] flex-col items-center justify-center text-center">
    {phase === "idle" ? <><p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100/65">You are the customer</p><button aria-label="Start the live call" onClick={start} className="status-pulse mt-8 grid h-24 w-24 place-items-center rounded-full border border-cyan-200/25 bg-cyan-200/10 text-cyan-50 shadow-[0_0_45px_rgba(103,232,249,0.14)] transition hover:scale-105 hover:bg-cyan-200/15"><PhoneCall className="h-9 w-9" /></button><h3 className="mt-7 text-2xl font-black">Start the live call</h3><p className="mt-3 max-w-md text-sm font-semibold leading-relaxed text-white/58">Sarah answers for {profile.companyName}. Ask about {profile.services[0]}.</p></> : null}
    {phase === "calling" ? <><span className="inline-flex items-center rounded-full border border-cyan-200/20 bg-cyan-200/[0.06] px-4 py-1.5 text-xs font-black uppercase tracking-widest text-cyan-50"><span className="mr-2 h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-200" />Connected</span><div className="mt-8 w-full"><Waveform /></div><p className="mt-6 text-4xl font-black text-cyan-100" style={{ fontFamily: MONO }}>{formatDuration(duration)}</p><button onClick={end} className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-full border border-red-200/20 bg-red-200/[0.06] px-6 text-sm font-black text-red-100 transition hover:bg-red-200/10"><PhoneCall className="h-4 w-4" />End call</button></> : null}
    {phase === "ended" ? <><span className="grid h-16 w-16 place-items-center rounded-2xl border border-teal-200/20 bg-teal-200/10 text-teal-100"><CheckCircle2 className="h-8 w-8" /></span><p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-teal-100">Call complete</p><h3 className="mt-3 text-3xl font-black">{formatDuration(duration)}</h3><p className="mt-3 text-sm font-semibold text-white/58">{handoffSent ? `Handoff sent to ${profile.contactName} at ${profile.companyName}` : "Preparing the structured handoff"}</p><button onClick={start} className="mt-7 inline-flex h-12 items-center gap-2 rounded-full border border-white/15 bg-white/[0.045] px-6 text-sm font-black text-white transition hover:bg-white/[0.075]"><RefreshCw className="h-4 w-4" />Run another call</button></> : null}
  </div></div>
}

function TranscriptPanel({ transcript, endRef }) {
  return <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-300">Live transcript</p><h3 className="mt-2 text-xl font-black">Conversation</h3></div><MessageSquare className="h-5 w-5 text-cyan-100" /></div><div className="mt-5 h-[330px] space-y-3 overflow-y-auto pr-1">{transcript.length ? transcript.map((item) => <motion.div key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`rounded-2xl border p-4 ${item.role === "assistant" ? "border-cyan-200/15 bg-cyan-200/[0.045]" : "border-white/10 bg-white/[0.035]"}`}><p className={`text-[10px] font-black uppercase tracking-widest ${item.role === "assistant" ? "text-cyan-100" : "text-slate-300"}`}>{item.role === "assistant" ? "Sarah" : "Customer"}</p><p className="mt-2 text-sm font-semibold leading-relaxed text-white/70">{item.text}</p></motion.div>) : <div className="grid h-full place-items-center text-center"><div><Waves className="mx-auto h-7 w-7 text-white/25" /><p className="mt-3 text-sm font-semibold text-white/38">Transcript lines appear here as the call progresses.</p></div></div>}<div ref={endRef} /></div></div>
}

function CapturePanel({ captured, flashing }) {
  const rows = [["name", "Caller Name"], ["location", "Location"], ["service", "Service Request"], ["urgency", "Urgency Level"], ["phone", "Phone Number"]]
  const count = Object.values(captured).filter(Boolean).length
  return <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-300">Lead capture</p><h3 className="mt-2 text-xl font-black">{count} of 5 fields</h3></div><FileText className="h-5 w-5 text-cyan-100" /></div><div className="mt-4 h-2 overflow-hidden rounded-full border border-white/10 bg-black/30"><motion.div animate={{ width: `${count * 20}%` }} transition={{ duration: 0.5, ease: EASE }} className="h-full rounded-full bg-gradient-to-r from-sky-400 to-teal-300" /></div><div className="mt-5 space-y-3">{rows.map(([key, label]) => <div key={key} className={`rounded-2xl border p-3 transition-all duration-500 ${flashing === key ? "border-cyan-200/45 bg-cyan-200/[0.09]" : captured[key] ? "border-teal-200/20 bg-teal-200/[0.055]" : "border-white/10 bg-black/20"}`}><div className="flex items-center justify-between"><p className="text-[10px] font-black uppercase tracking-widest text-slate-300">{label}</p>{captured[key] ? <CheckCircle2 className="h-3.5 w-3.5 text-teal-200" /> : null}</div>{captured[key] ? <p className="mt-2 line-clamp-2 text-sm font-bold text-white">{captured[key]}</p> : <div className="mt-3 h-2.5 w-2/3 animate-pulse rounded-full bg-white/[0.08]" />}</div>)}</div></div>
}

function Handoff({ profile, duration }) {
  return <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.75, ease: EASE }} className="mt-6 overflow-hidden rounded-[2rem] border border-teal-300/40 bg-gradient-to-br from-teal-200/18 via-cyan-200/8 to-transparent p-5 shadow-[0_24px_80px_rgba(20,184,166,0.12)]"><div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between"><div className="flex gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-teal-200/20 bg-teal-200/10"><Send className="h-5 w-5 text-teal-100" /></span><div><p className="text-xs font-black uppercase tracking-[0.22em] text-teal-100">Handoff delivered in {formatDuration(duration)}</p><h3 className="mt-2 text-xl font-black">Handoff sent to {profile.contactName}, {profile.companyName} team notified</h3></div></div><div className="flex gap-2"><Badge tone="info">SMS</Badge><Badge tone="info">Email</Badge></div></div></motion.div>
}

function FlowDiagram() {
  return <div className="ops-card mt-6 overflow-x-auto rounded-[2rem] p-5"><div className="mx-auto flex min-w-[620px] items-center justify-between gap-4">{[[FileText, "Form submitted"], [Activity, "FINNOR detects"], [PhoneCall, "AI calls customer"]].map(([Icon, label], index) => <div key={label} className="contents"><div className="flex min-w-[150px] flex-col items-center rounded-2xl border border-slate-200 bg-white p-4 text-center"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-teal-100"><Icon className="h-5 w-5" /></span><p className="mt-3 text-sm font-black text-slate-900">{label}</p></div>{index < 2 ? <div className="flex flex-1 items-center gap-2"><div className="h-px flex-1 bg-slate-200" /><span className="text-xs font-black text-teal-700" style={{ fontFamily: MONO }}>{index === 0 ? "<5 sec" : "<55 sec"}</span><ChevronRight className="h-4 w-4 text-slate-400" /><div className="h-px flex-1 bg-slate-200" /></div> : null}</div>)}</div></div>
}

function SourceTile({ source }) {
  return <div className="ops-card rounded-2xl p-4"><div className="flex items-center justify-between gap-4"><div><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-teal-500 shadow-[0_0_0_4px_rgba(20,184,166,0.12)]" /><span className="text-xs font-black uppercase tracking-widest text-teal-700">Connected</span></div><p className="mt-2 text-sm font-black text-slate-900">{source}</p></div><span className="flex h-7 w-12 items-center justify-end rounded-full bg-teal-600 p-1"><span className="h-5 w-5 rounded-full bg-white shadow-sm" /></span></div></div>
}

function SpeedDemo({ profile, form, setForm, phase, countdown, submit, feed, endCall }) {
  const inputClass = "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
  const newest = feed[0]
  return <div className="ops-card overflow-hidden rounded-[2rem] p-5 md:p-6"><AnimatePresence mode="wait">
    {phase === "form" ? <motion.form key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onSubmit={submit}><p className="text-xs font-black uppercase tracking-[0.2em] text-sky-800">Submit a test lead</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Lead name" className={inputClass} /><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Phone number" className={inputClass} /><input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} className={inputClass} /><select value={form.service} onChange={(event) => setForm({ ...form, service: event.target.value })} className={inputClass}>{profile.services.map((service) => <option key={service}>{service}</option>)}</select></div><button className="cta-primary mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-6 text-sm font-black text-white transition hover:bg-slate-800"><PhoneForwarded className="h-4 w-4" />Submit test lead, watch FINNOR call back</button></motion.form> : null}
    {phase === "countdown" ? <motion.div key="countdown" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.04 }} transition={{ duration: 0.6, ease: EASE }} className="grid min-h-[310px] place-items-center text-center"><div><motion.p key={countdown} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} className="text-8xl font-black text-teal-700 md:text-9xl">{countdown}</motion.p><p className="mt-5 text-lg font-black text-slate-900">FINNOR is calling {form.name} now</p></div></motion.div> : null}
    {phase === "calling" ? <motion.div key="calling" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="command-surface rounded-3xl p-6 text-center text-white"><span className="inline-flex rounded-full border border-cyan-200/20 bg-cyan-200/[0.06] px-4 py-1.5 text-xs font-black uppercase tracking-widest text-cyan-50"><span className="mr-2 h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-200" />Live call</span><div className="mt-8"><Waveform /></div><h3 className="mt-6 text-2xl font-black">FINNOR is live with {form.name}</h3><p className="mx-auto mt-3 max-w-md text-sm font-semibold leading-relaxed text-white/58">This is the same AI that handles your missed calls and web leads. Production version calls to the lead&apos;s actual phone.</p><button type="button" onClick={endCall} className="mt-6 inline-flex h-11 items-center gap-2 rounded-full border border-red-200/20 bg-red-200/[0.06] px-5 text-xs font-black text-red-100 transition hover:bg-red-200/10"><PhoneCall className="h-4 w-4" />End demo call</button></motion.div> : null}
    {phase === "ended" ? <motion.div key="ended" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-teal-200 bg-teal-50 p-6 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-teal-700" /><h3 className="mt-4 text-2xl font-black text-slate-950">Called {form.name} in {newest?.responseTime || "under one minute"}. Lead logged.</h3><p className="mt-3 text-sm font-semibold text-slate-600">The newest event is now highlighted in the speed feed.</p></motion.div> : null}
  </AnimatePresence></div>
}

function SpeedTable({ rows }) {
  return <TableShell><table className="w-full min-w-[760px] text-left"><thead><tr>{["Time", "Name", "City", "Service", "Response Time", "Status"].map((item) => <Th key={item}>{item}</Th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className={`border-t border-slate-200 transition hover:bg-sky-50/35 ${row.isNew ? "bg-teal-50/70" : ""}`}><Td>{row.time}</Td><Td strong>{row.name}</Td><Td>{row.city}</Td><Td>{row.service}</Td><Td mono>{row.responseTime}</Td><Td><Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge></Td></tr>)}</tbody></table></TableShell>
}

function NoticeBadge({ tone, icon: Icon, text }) {
  return <div className={`rounded-2xl border p-5 ${tone === "success" ? "border-teal-200 bg-teal-50" : "border-orange-200 bg-orange-50"}`}><div className="flex items-center gap-3"><Icon className={`h-5 w-5 ${tone === "success" ? "text-teal-700" : "text-orange-700"}`} /><p className="text-lg font-black text-slate-950">{text}</p></div></div>
}

function QueueTable({ rows }) {
  return <TableShell className="mt-6"><table className="w-full min-w-[800px] text-left"><thead><tr>{["Phone", "Status", "Added time", "Attempts", "Notes"].map((item) => <Th key={item}>{item}</Th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-slate-200 transition hover:bg-sky-50/35"><Td mono>{row.phone}</Td><Td><Badge tone={statusTone(row.status)} pulse={row.status === "calling"}>{statusLabel(row.status)}</Badge></Td><Td>{row.addedTime}</Td><Td mono>{row.attempts}</Td><Td>{row.note}</Td></tr>)}</tbody></table></TableShell>
}

function CallTable({ rows, onSelect }) {
  return <TableShell className="mt-5"><table className="w-full min-w-[1050px] text-left"><thead><tr>{["Time", "Caller", "City", "Type", "Duration", "Status", "Summary"].map((item) => <Th key={item}>{item}</Th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} onClick={() => onSelect(row)} className="cursor-pointer border-t border-slate-200 transition hover:bg-sky-50/45"><Td mono>{row.time}</Td><Td strong>{row.caller}</Td><Td>{row.city}</Td><Td><TypeBadge type={row.type} /></Td><Td mono>{row.duration}</Td><Td>{row.status}</Td><Td><span className="block max-w-[330px] truncate">{row.summary}</span></Td></tr>)}</tbody></table></TableShell>
}

function TableShell({ children, className = "" }) { return <div className={`ops-card overflow-x-auto rounded-[2rem] ${className}`}>{children}</div> }
function Th({ children }) { return <th className="bg-slate-50/80 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{children}</th> }
function Td({ children, strong, mono }) { return <td className={`px-4 py-3 text-sm ${strong ? "font-black text-slate-900" : "font-semibold text-slate-600"}`} style={mono ? { fontFamily: MONO } : undefined}>{children}</td> }

function Badge({ children, tone = "neutral", pulse = false }) {
  const styles = { success: "border-teal-200 bg-teal-50 text-teal-800", warning: "border-orange-200 bg-orange-50 text-orange-800", error: "border-red-200 bg-red-50 text-red-800", info: "border-cyan-200 bg-white text-cyan-800", neutral: "border-slate-200 bg-white text-slate-600" }
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${styles[tone]}`}>{pulse ? <span className="mr-2 h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> : null}{children}</span>
}

function TypeBadge({ type }) {
  const tone = type === "EMERGENCY" ? "error" : type === "QUOTE" ? "success" : type === "SERVICE" ? "info" : "neutral"
  return <Badge tone={tone}>{type}</Badge>
}

function statusTone(status) {
  if (status === "reached") return "success"
  if (status === "calling") return "info"
  if (status === "voicemail") return "warning"
  if (status === "no-answer") return "error"
  return "neutral"
}

function statusLabel(status) {
  return ({ reached: "Reached, lead captured", calling: "Calling", queued: "Queued", voicemail: "Voicemail", "no-answer": "No answer" })[status] || status
}

function CallDrawer({ call, profile, close, toast }) {
  const transcript = [
    ["Sarah", `Thank you for calling ${profile.companyName}. This is Sarah. How can I help?`],
    ["Customer", `I am calling from ${call.city} about ${call.service}.`],
    ["Sarah", `I can help capture that request. What water issue are you noticing?`],
    ["Customer", `We are seeing ${serviceIssue(call.service)} and want to understand the next step.`],
    ["Sarah", `Is this urgent, or are you planning for a quote or service visit?`],
    ["Customer", call.type === "EMERGENCY" ? "It is urgent and we need a response today." : "It is not urgent, but we would like a callback soon."],
    ["Sarah", `I have your location in ${call.city}. Is ${call.phone} the best callback number?`],
    ["Customer", "Yes, that is the best number."],
    ["Sarah", `Thank you. I will send this structured request to ${profile.contactName} and the ${profile.companyName} team.`],
    ["Customer", "That sounds good. Thank you."],
  ]
  return <><motion.button aria-label="Close call details" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-sm" /><motion.aside initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.5, ease: EASE }} className="fixed bottom-0 right-0 top-0 z-[71] w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-[#f8faf9] shadow-[-28px_0_90px_rgba(15,38,62,0.18)]"><header className="sticky top-0 z-10 flex h-20 items-center justify-between border-b border-slate-200 bg-white/90 px-5 backdrop-blur-xl"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-800">Call detail</p><h2 className="mt-1 text-xl font-black text-slate-950">{call.caller}</h2></div><button onClick={close} className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-sky-200"><X className="h-4 w-4" /></button></header><div className="space-y-5 p-5">
    <DrawerCard title="Caller details" icon={UserRound}><div className="grid gap-3 sm:grid-cols-2">{[["Caller", call.caller], ["Phone", call.phone], ["City", call.city], ["Service", call.service], ["Call time", call.time], ["Duration", call.duration]].map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p><p className="mt-2 text-sm font-black text-slate-900">{value}</p></div>)}</div></DrawerCard>
    <DrawerCard title="AI Summary" icon={FileText}><p className="text-sm font-semibold leading-relaxed text-slate-700">{call.summary}</p></DrawerCard>
    <DrawerCard title="Recording" icon={Headphones}><div className="command-surface rounded-2xl p-4 text-white"><StaticWaveform /><button onClick={() => toast("Recording available in your production dashboard")} className="mx-auto mt-4 flex h-10 items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-5 text-xs font-black"><Play className="h-4 w-4" />Play recording</button></div></DrawerCard>
    <DrawerCard title="Transcript" icon={MessageSquare}><div className="space-y-3">{transcript.map(([speaker, text], index) => <div key={`${speaker}-${index}`} className={`rounded-2xl border p-4 ${speaker === "Sarah" ? "border-sky-100 bg-sky-50" : "border-slate-200 bg-white"}`}><p className={`text-[10px] font-black uppercase tracking-widest ${speaker === "Sarah" ? "text-sky-800" : "text-slate-500"}`}>{speaker}</p><p className="mt-2 text-sm font-semibold leading-relaxed text-slate-700">{text}</p></div>)}</div></DrawerCard>
    <div className="grid gap-3 sm:grid-cols-3">{[[CalendarCheck, "Book appointment"], [Mail, "Send follow-up SMS"], [CheckCircle2, "Mark resolved"]].map(([Icon, label]) => <button key={label} onClick={() => toast(`${label} is available in your production dashboard`, "success")} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-slate-800"><Icon className="h-4 w-4" />{label}</button>)}</div>
  </div></motion.aside></>
}

function DrawerCard({ title, icon: Icon, children }) {
  return <section className="ops-card rounded-3xl p-5"><div className="mb-5 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-50 text-sky-800"><Icon className="h-5 w-5" /></span><h3 className="text-xl font-black text-slate-950">{title}</h3></div>{children}</section>
}

function ToastStack({ toasts }) {
  return <div className="fixed bottom-5 right-5 z-[100] grid w-[min(360px,calc(100vw-2.5rem))] gap-3">{toasts.map((toast) => <motion.div key={toast.id} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={`rounded-2xl border bg-white p-4 text-sm font-black shadow-[0_18px_48px_rgba(15,38,62,0.16)] ${toast.tone === "error" ? "border-red-200 text-red-900" : toast.tone === "success" ? "border-teal-200 text-teal-900" : "border-slate-200 text-slate-900"}`}>{toast.message}</motion.div>)}</div>
}
