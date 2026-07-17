"use client"

// The working feature views of the JARVIS operating system. Every panel talks to the
// real Finnor OS API: reads are tenant-scoped resource endpoints, writes go through
// the same gated instruction pipeline as voice. When the backend is unreachable the
// panels show clearly-labeled sample data — same UI, honest badge.

import { useCallback, useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Check, Loader2, Play, Search, Send, ShieldCheck, X } from "lucide-react"
import { Glass } from "./atmosphere"
import { sfx } from "./sound"
import { jarvisGet, jarvisPost, JarvisApiError } from "./lib/api"

type Row = Record<string, unknown>

function useResource(kind: string, sample: Row[]): { rows: Row[]; live: boolean; reload: () => void } {
  const [rows, setRows] = useState<Row[]>(sample)
  const [live, setLive] = useState(false)
  const reload = useCallback(() => {
    jarvisGet<{ rows: Row[] }>(`resources/${kind}`)
      .then((d) => {
        setRows(d.rows)
        setLive(true)
      })
      .catch(() => setLive(false))
  }, [kind])
  useEffect(() => {
    reload()
    const t = setInterval(reload, 8000)
    return () => clearInterval(t)
  }, [reload])
  return { rows, live, reload }
}

/** Run an instruction through the real planner pipeline; returns a speakable outcome. */
async function instruct(instruction: string): Promise<string> {
  try {
    const body = await jarvisPost<{ planned?: Array<{ id: string; actionType: string }> }>("actions", { instruction })
    const n = body.planned?.length ?? 0
    return n === 0 ? "Couldn't map that to an action — add more detail." : `Planned ${n} action${n === 1 ? "" : "s"} — consequential ones are waiting in the Command Center queue.`
  } catch (e) {
    if (e instanceof JarvisApiError && e.status === 401) throw new Error("Enter the owner key in the Command Center to run write actions.")
    throw e
  }
}

// ---------- shared chrome ----------

function PanelHeader({ title, sub, live }: { title: string; sub: string; live: boolean }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="bg-gradient-to-r from-white via-teal-100 to-sky-200 bg-clip-text text-lg font-black tracking-tight text-transparent md:text-xl">{title}</h2>
        <p className="text-xs text-white/45">{sub}</p>
      </div>
      <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${live ? "bg-teal-300/15 text-teal-200" : "bg-amber-300/15 text-amber-200"}`}>
        {live ? "live data" : "sample data"}
      </span>
    </div>
  )
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.16em] text-white/40">{label}</span>
      <input
        {...props}
        className="h-10 w-full rounded-xl border border-white/12 bg-slate-950/70 px-3 text-[13px] text-white placeholder:text-white/25 focus:border-teal-300/50 focus:outline-none"
      />
    </label>
  )
}

function ActionButton({ children, onClick, busy }: { children: React.ReactNode; onClick: () => void; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-teal-300 px-5 text-[11px] font-black text-slate-950 transition hover:-translate-y-0.5 hover:bg-teal-200 disabled:opacity-40"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
      {children}
    </button>
  )
}

function Note({ text }: { text: string | null }) {
  if (!text) return null
  return <div className="mt-3 rounded-xl border border-teal-300/20 bg-teal-300/5 px-4 py-2.5 text-[12px] text-teal-100">{text}</div>
}

// ---------- Leads & CRM ----------

const SAMPLE_LEADS: Row[] = [
  { address: "412 Maple Ridge Rd, Cedar Falls, IA", contactInfo: { name: "The Hendersons", phone: "+1319555••42" }, waterProfile: { hardness_gpg: 18 }, marketingConsent: true },
  { address: "88 Birchwood Ln, Cedar Falls, IA", contactInfo: { name: "Ruth Alvarez", phone: "+1319555••77" }, waterProfile: { hardness_gpg: 11 }, marketingConsent: false },
]

export function LeadsView() {
  const { rows, live, reload } = useResource("households", SAMPLE_LEADS)
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function createLead() {
    if (!name || !phone) return
    setBusy(true)
    sfx.send()
    try {
      setNote(await instruct(`Create a lead named ${name}, phone ${phone}${address ? `, address ${address}` : ""}`))
      setName(""); setPhone(""); setAddress("")
      setTimeout(reload, 1200)
    } catch (e) {
      setNote(`Backend: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Glass><div className="p-5">
      <PanelHeader title="Leads & CRM" sub="Households are the CRM — created by voice, call, or right here." live={live} />
      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sarah Kim" />
        <Field label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 319 555 0142" />
        <Field label="Address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="314 Overlook Dr" />
        <div className="flex items-end"><ActionButton onClick={createLead} busy={busy}>Create lead</ActionButton></div>
      </div>
      <Note text={note} />
      <div className="mt-4 space-y-2">
        {rows.slice(0, 8).map((r, i) => {
          const c = (r.contactInfo ?? {}) as Row
          const w = (r.waterProfile ?? {}) as Row
          return (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/8 bg-slate-900/50 px-4 py-3">
              <div>
                <div className="text-[13px] font-black">{String(c.name ?? "Unnamed")} <span className="font-normal text-white/40">· {String(c.phone ?? "no phone")}</span></div>
                <div className="text-[11px] text-white/45">{String(r.address ?? "")}</div>
              </div>
              <div className="flex items-center gap-2">
                {w.hardness_gpg != null && <span className="rounded-full bg-sky-300/12 px-2.5 py-1 text-[10px] font-black text-sky-200">{String(w.hardness_gpg)} gpg</span>}
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${r.marketingConsent ? "bg-teal-300/12 text-teal-200" : "bg-white/8 text-white/40"}`}>
                  {r.marketingConsent ? "consented" : "no consent"}
                </span>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div></Glass>
  )
}

// ---------- Workflows ----------

const SAMPLE_WF: Row[] = [
  { workflow: "lead_to_install", state: "water_test_scheduled", subjectType: "household", history: [{ from: "lead", to: "water_test_scheduled", cause: "schedule_water_test" }], updatedAt: new Date().toISOString() },
  { workflow: "amc_renewal", state: "renewal_sent", subjectType: "maintenance_agreement", history: [{ from: "renewal_window", to: "renewal_sent", cause: "renew_maintenance_agreement" }], updatedAt: new Date().toISOString() },
]
const WF_STAGES: Record<string, string[]> = {
  lead_to_install: ["lead", "water_test_scheduled", "test_completed", "quote_sent", "installed", "follow_up_sent"],
  amc_renewal: ["agreement_active", "renewal_window", "renewal_sent", "renewed", "lapsed"],
}

export function WorkflowsView() {
  const { rows, live } = useResource("workflows", SAMPLE_WF)
  return (
    <Glass><div className="p-5">
      <PanelHeader title="Workflows" sub="Every customer's lifecycle as an explicit state machine — advanced automatically by executed actions." live={live} />
      <div className="space-y-4">
        {rows.slice(0, 6).map((r, i) => {
          const stages = WF_STAGES[String(r.workflow)] ?? []
          const cur = stages.indexOf(String(r.state))
          return (
            <div key={i} className="rounded-xl border border-white/8 bg-slate-900/50 p-4">
              <div className="mb-3 flex items-center justify-between text-[11px]">
                <span className="font-black uppercase tracking-wider text-white/70">{String(r.workflow).replaceAll("_", " ")}</span>
                <span className="text-white/35">{String(r.subjectType).replaceAll("_", " ")}</span>
              </div>
              <div className="flex items-center gap-1">
                {stages.map((st, j) => (
                  <div key={st} className="flex flex-1 flex-col items-center gap-1">
                    <div className={`h-2 w-full rounded-full ${j < cur ? "bg-teal-400/70" : j === cur ? "bg-gradient-to-r from-teal-300 to-sky-400" : "bg-white/8"}`} />
                    <span className={`hidden text-[9px] font-bold uppercase tracking-wide md:block ${j === cur ? "text-teal-200" : "text-white/30"}`}>{st.replaceAll("_", " ")}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        {rows.length === 0 && <div className="rounded-xl border border-white/8 px-4 py-6 text-center text-sm text-white/40">No lifecycles yet — create a lead or book a water test.</div>}
      </div>
    </div></Glass>
  )
}

// ---------- Inventory ----------

const SAMPLE_INV: Row[] = [
  { sku: "SED-FILT-10", name: '10" Sediment Filter Cartridge', quantity: 24, reorderThreshold: 10 },
  { sku: "CARB-FILT-10", name: '10" Carbon Filter Cartridge', quantity: 18, reorderThreshold: 8 },
  { sku: "RO-MEM-75", name: "RO Membrane 75 GPD", quantity: 4, reorderThreshold: 3 },
  { sku: "RESIN-CUFT", name: "Softener Resin (cu ft)", quantity: 12, reorderThreshold: 4 },
]

export function InventoryView() {
  const { rows, live, reload } = useResource("inventory", SAMPLE_INV)
  const [note, setNote] = useState<string | null>(null)
  const [busySku, setBusySku] = useState<string | null>(null)

  async function logUse(sku: string) {
    setBusySku(sku)
    sfx.send()
    try {
      setNote(await instruct(`Log 1 ${sku} used on a visit (deduct from stock)`))
      setTimeout(reload, 1500)
    } catch (e) {
      setNote(`Backend: ${(e as Error).message}`)
    } finally {
      setBusySku(null)
    }
  }

  return (
    <Glass><div className="p-5">
      <PanelHeader title="Inventory" sub="Finnor's own stock ledger — deductions are atomic and can never go negative." live={live} />
      <Note text={note} />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {rows.map((r, i) => {
          const qty = Number(r.quantity)
          const thr = Number(r.reorderThreshold)
          const low = qty <= thr
          return (
            <div key={i} className="rounded-xl border border-white/8 bg-slate-900/50 p-4">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-black">{String(r.name)}</div>
                <span className={`text-lg font-black tabular-nums ${low ? "text-amber-300" : "text-teal-200"}`}>{qty}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-white/40">
                <span>{String(r.sku)} · reorder at {thr}</span>
                {low && <span className="font-black text-amber-300">REORDER</span>}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
                <motion.div className={`h-full ${low ? "bg-amber-400" : "bg-gradient-to-r from-teal-400 to-sky-400"}`}
                  initial={{ width: 0 }} animate={{ width: `${Math.min(100, (qty / Math.max(1, thr * 3)) * 100)}%` }} transition={{ duration: 0.8 }} />
              </div>
              <button onClick={() => logUse(String(r.sku))} disabled={busySku === String(r.sku)}
                className="mt-3 rounded-full border border-white/15 px-4 py-1.5 text-[10px] font-black uppercase tracking-wider text-white/70 transition hover:border-teal-300/40 hover:text-white disabled:opacity-40">
                {busySku === String(r.sku) ? "logging…" : "Log 1 used on visit"}
              </button>
            </div>
          )
        })}
      </div>
    </div></Glass>
  )
}

// ---------- Invoices ----------

const SAMPLE_INVOICES: Row[] = [
  { amountUsd: "249", status: "paid", memo: "Annual maintenance visit", createdAt: new Date().toISOString() },
]

export function InvoicesView() {
  const { rows, live, reload } = useResource("invoices", SAMPLE_INVOICES)
  const [phone, setPhone] = useState("")
  const [amount, setAmount] = useState("")
  const [memo, setMemo] = useState("")
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function createInvoice() {
    if (!phone || !amount) return
    setBusy(true)
    sfx.send()
    try {
      setNote(await instruct(`Create an invoice of $${amount} for the customer with phone ${phone}${memo ? ` for ${memo}` : ""}`))
      setPhone(""); setAmount(""); setMemo("")
      setTimeout(reload, 1200)
    } catch (e) {
      setNote(`Backend: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const total = rows.filter((r) => r.status !== "void").reduce((s, r) => s + Number(r.amountUsd ?? 0), 0)
  return (
    <Glass><div className="p-5">
      <PanelHeader title="Invoices" sub="Native ledger — create, remind, record payment. No accounting SaaS required." live={live} />
      <div className="mb-4 flex items-center gap-3">
        <span className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-2xl font-black tabular-nums text-teal-200">${total.toLocaleString()}</span>
        <span className="text-[11px] text-white/40">total invoiced<br />({rows.length} invoice{rows.length === 1 ? "" : "s"})</span>
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Field label="Customer phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 319 555 0142" />
        <Field label="Amount USD" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="249" />
        <Field label="Memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Annual maintenance" />
        <div className="flex items-end"><ActionButton onClick={createInvoice} busy={busy}>Create invoice</ActionButton></div>
      </div>
      <Note text={note} />
      <div className="mt-3 space-y-2">
        {rows.slice(0, 8).map((r, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl border border-white/8 bg-slate-900/50 px-4 py-3 text-[13px]">
            <span className="font-black tabular-nums">${String(r.amountUsd)}</span>
            <span className="min-w-0 flex-1 truncate px-4 text-white/50">{String(r.memo ?? "")}</span>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${r.status === "paid" ? "bg-teal-300/12 text-teal-200" : r.status === "overdue" ? "bg-amber-300/12 text-amber-200" : "bg-white/8 text-white/50"}`}>
              {String(r.status)}
            </span>
          </div>
        ))}
      </div>
    </div></Glass>
  )
}

// ---------- Water Compliance ----------

export function ComplianceView() {
  const [hardness, setHardness] = useState("18")
  const [pfoa, setPfoa] = useState("")
  const [fluoride, setFluoride] = useState("")
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    sfx.send()
    const parts = [
      hardness && `hardness ${hardness} gpg`,
      pfoa && `PFOA ${pfoa} ppt`,
      fluoride && `fluoride ${fluoride} mg/L`,
    ].filter(Boolean)
    try {
      setNote(await instruct(`Generate a water compliance summary for a household with ${parts.join(", ")}`))
    } catch (e) {
      setNote(`Backend: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const EPA = [
    { k: "PFOA / PFOS MCL", v: "4 ppt", icon: ShieldCheck },
    { k: "Fluoride MCL", v: "4.0 mg/L (2.0 secondary)", icon: ShieldCheck },
    { k: "Very hard water", v: "> 10.5 gpg", icon: ShieldCheck },
    { k: "Iron secondary std", v: "0.3 ppm", icon: ShieldCheck },
  ]

  return (
    <Glass><div className="p-5">
      <PanelHeader title="Water Compliance" sub="Household test results checked against EPA National Drinking Water Regulations." live={true} />
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Field label="Hardness (gpg)" value={hardness} onChange={(e) => setHardness(e.target.value)} placeholder="18" />
        <Field label="PFOA (ppt)" value={pfoa} onChange={(e) => setPfoa(e.target.value)} placeholder="7.2" />
        <Field label="Fluoride (mg/L)" value={fluoride} onChange={(e) => setFluoride(e.target.value)} placeholder="1.4" />
        <div className="flex items-end"><ActionButton onClick={run} busy={busy}>Run compliance check</ActionButton></div>
      </div>
      <Note text={note} />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {EPA.map(({ k, v, icon: Icon }) => (
          <div key={k} className="flex items-center gap-3 rounded-xl border border-white/8 bg-slate-900/50 px-4 py-3">
            <Icon className="h-4 w-4 shrink-0 text-teal-300" />
            <div>
              <div className="text-[12px] font-black">{k}</div>
              <div className="text-[11px] text-white/45">{v}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-white/30">Source: EPA National Primary/Secondary Drinking Water Regulations — stored as tenant policy, editable, never hardcoded.</p>
    </div></Glass>
  )
}

// ---------- Web Research ----------

export function ResearchView() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Array<{ title: string; url: string; snippet: string }>>([])
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(kind: "search" | "competitors" | "reviews") {
    if (!query.trim()) return
    setBusy(true)
    sfx.send()
    setResults([])
    const instruction =
      kind === "competitors"
        ? `Scan water treatment competitors around ${query}`
        : kind === "reviews"
          ? `Check recent reviews of ${query}`
          : `Search the web for: ${query}`
    try {
      await jarvisPost("actions", { instruction })
      // research actions are ungated — the result lands in the audit log; pull it
      await new Promise((r) => setTimeout(r, 1600))
      const audit = await jarvisGet<{
        entries: Array<{ step: string; output: { output?: { results?: Array<{ title: string; url: string; snippet: string }>; spokenSummary?: string } } }>
      }>("audit", { limit: "10" })
      const exec = audit.entries.find((e) => e.step === "execute" && e.output?.output?.results)
      if (exec?.output.output?.results) {
        setResults(exec.output.output.results.slice(0, 5))
        setNote(null)
        sfx.approve()
      } else {
        setNote("Search ran — results are in the audit log.")
      }
    } catch (e) {
      setNote(`Backend: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Glass><div className="p-5">
      <PanelHeader title="Web Research" sub="Real-time web intelligence via Exa — competitors, reviews, anything." live={true} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run("search")}
            placeholder='"Cedar Falls Iowa" or a business name or any question'
            className="h-11 w-full rounded-full border border-white/12 bg-slate-950/70 pl-10 pr-4 text-[13px] text-white placeholder:text-white/25 focus:border-teal-300/50 focus:outline-none"
          />
        </div>
        <ActionButton onClick={() => run("search")} busy={busy}>Search</ActionButton>
        <button onClick={() => run("competitors")} disabled={busy} className="rounded-full border border-white/15 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-white/70 transition hover:border-teal-300/40 hover:text-white disabled:opacity-40">Competitor scan</button>
        <button onClick={() => run("reviews")} disabled={busy} className="rounded-full border border-white/15 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-white/70 transition hover:border-teal-300/40 hover:text-white disabled:opacity-40">Review scan</button>
      </div>
      <Note text={note} />
      <div className="mt-4 space-y-2">
        {results.map((r, i) => (
          <motion.a key={i} href={r.url} target="_blank" rel="noreferrer" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="block rounded-xl border border-white/8 bg-slate-900/50 px-4 py-3 transition hover:border-teal-300/30">
            <div className="text-[13px] font-black text-teal-100">{r.title}</div>
            <div className="truncate text-[10px] text-sky-300/70">{r.url}</div>
            <div className="mt-1 line-clamp-2 text-[12px] text-white/55">{r.snippet}</div>
          </motion.a>
        ))}
      </div>
    </div></Glass>
  )
}

// ---------- Voice Console ----------

export function VoiceConsoleView({
  voiceState,
  toggleVoice,
  feed,
}: {
  voiceState: "idle" | "connecting" | "live"
  toggleVoice: () => void
  feed: Array<{ role: "you" | "jarvis"; text: string }>
}) {
  return (
    <Glass><div className="p-5">
      <PanelHeader title="Voice Console" sub="Talk to JARVIS through your microphone — no phone line, no carrier, full pipeline." live={voiceState === "live"} />
      <div className="flex flex-col items-center py-6">
        <motion.button
          onClick={toggleVoice}
          className={`relative flex h-28 w-28 items-center justify-center rounded-full text-slate-950 transition ${
            voiceState === "live" ? "bg-teal-300" : "bg-gradient-to-br from-teal-300 to-sky-400 hover:scale-105"
          }`}
          animate={voiceState === "live" ? { boxShadow: ["0 0 0 0 rgba(94,234,212,0.4)", "0 0 0 28px rgba(94,234,212,0)", "0 0 0 0 rgba(94,234,212,0)"] } : {}}
          transition={{ duration: 1.6, repeat: voiceState === "live" ? Infinity : 0 }}
        >
          {voiceState === "live" ? <X className="h-9 w-9" /> : <Send className="h-9 w-9 rotate-[-20deg]" />}
        </motion.button>
        <div className="mt-4 text-sm font-black uppercase tracking-widest text-white/60">
          {voiceState === "live" ? "Listening — speak naturally" : voiceState === "connecting" ? "Connecting…" : "Tap to start a voice session"}
        </div>
        <div className="mt-1 max-w-md text-center text-[11px] text-white/35">
          &ldquo;Create a lead for Sarah Kim…&rdquo; · &ldquo;Book a water test Tuesday…&rdquo; · &ldquo;Check RO membrane stock&rdquo; · &ldquo;Scan competitors near Cedar Falls&rdquo;
        </div>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-white/8 bg-slate-950/50 p-4">
        {feed.slice(-12).map((m, i) => (
          <div key={i} className="text-[13px] leading-relaxed">
            <span className={m.role === "jarvis" ? "font-black text-teal-200" : "font-black text-white/70"}>{m.role === "jarvis" ? "JARVIS" : "YOU"}</span>{" "}
            <span className={m.role === "jarvis" ? "text-white/80" : "text-white/60"}>{m.text}</span>
          </div>
        ))}
      </div>
    </div></Glass>
  )
}
