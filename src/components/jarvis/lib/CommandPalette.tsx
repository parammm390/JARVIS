"use client"

// §7.12 — ⌘K / ctrl+K palette. Fuzzy filter over view navigations, "Approve queue",
// and 6 canned instructions that PREFILL the command bar (never auto-submit).

import { useEffect, useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Search } from "lucide-react"
import { sfx } from "../sound"

export interface PaletteItem {
  id: string
  label: string
  kind: "view" | "action" | "instruction"
  payload: string
}

const VIEWS = ["Command Center", "Voice Console", "Leads & CRM", "Workflows", "Inventory", "Invoices", "Water Compliance", "Web Research"]
const CANNED_INSTRUCTIONS = [
  "Book a water test for …",
  "Create an invoice for …",
  "What is our overdue total?",
  "Show me stuck workflows",
  "Send the proposal to …",
  "Give me the business overview",
]

function buildItems(): PaletteItem[] {
  const items: PaletteItem[] = VIEWS.map((v) => ({ id: `view:${v}`, label: v, kind: "view", payload: v }))
  items.push({ id: "action:approve", label: "Approve queue", kind: "view", payload: "Command Center" })
  for (const instr of CANNED_INSTRUCTIONS) items.push({ id: `instr:${instr}`, label: instr, kind: "instruction", payload: instr })
  return items
}

function fuzzyMatch(query: string, label: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return label.toLowerCase().includes(q)
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => {
          if (!o) sfx.tick()
          return !o
        })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return { open, setOpen }
}

export function CommandPalette({
  onClose,
  onSelectView,
  onPrefillInstruction,
}: {
  onClose: () => void
  onSelectView: (view: string) => void
  onPrefillInstruction: (text: string) => void
}) {
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const items = useMemo(() => buildItems().filter((i) => fuzzyMatch(query, i.label)), [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function select(item: PaletteItem) {
    if (item.kind === "view") onSelectView(item.payload)
    else onPrefillInstruction(item.payload)
    onClose()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose()
    else if (e.key === "ArrowDown") {
      e.preventDefault()
      setIndex((i) => Math.min(items.length - 1, i + 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === "Enter" && items[index]) {
      select(items[index])
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 pt-32"
        initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
        animate={{ opacity: 1, backdropFilter: "blur(6px)" }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          initial={{ scale: 0.96, opacity: 0, y: -8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
          className="w-full max-w-lg overflow-hidden rounded-2xl border border-[color:var(--j-border-hot)] bg-slate-950 shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
            <Search className="h-4 w-4 text-white/40" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setIndex(0)
              }}
              placeholder="Jump to a view or draft an instruction…"
              className="h-6 flex-1 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {items.map((item, i) => (
              <button
                key={item.id}
                onClick={() => select(item)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${i === index ? "bg-cyan-300/12 text-teal-100" : "text-white/70 hover:bg-cyan-300/12"}`}
              >
                {item.label}
                <span className="text-[9px] uppercase tracking-widest text-white/30">{item.kind}</span>
              </button>
            ))}
            {items.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-white/30">No matches.</div>}
          </div>
          <div className="border-t border-white/8 px-4 py-2 text-[9.5px] uppercase tracking-widest text-white/25">enter select · esc close</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
