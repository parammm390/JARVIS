"use client"

import { motion, useReducedMotion } from "framer-motion"
import { ArrowRight, Brain } from "lucide-react"
import {
  formatLtv,
  MEMORY_GROUP_ORDER,
  type CustomerRecord,
  type LifecycleScenario,
} from "@/lib/lifecycle/scenario"

const EASE = [0.16, 1, 0.3, 1]
const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

export function RecordPanel({
  scenario,
  record,
  stageIndex,
}: {
  scenario: LifecycleScenario
  record: CustomerRecord
  stageIndex: number
}) {
  const reduceMotion = useReducedMotion()
  const groups = MEMORY_GROUP_ORDER.map((group) => ({
    group,
    fields: record.fields.filter((field) => field.group === group),
  })).filter((entry) => entry.fields.length > 0)

  return (
    <div className="ops-card soft-edge overflow-hidden rounded-[2rem]">
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 p-5">
        <div className="flex items-center gap-3.5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-950 text-sm font-black text-white">
            {scenario.customer.initials}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-teal-700">
              <Brain className="h-3 w-3" />
              Customer memory
            </p>
            <p className="mt-0.5 truncate text-lg font-black tracking-tight text-slate-950">
              {scenario.customer.name}
            </p>
            <p className="truncate text-xs font-semibold text-slate-500">
              {scenario.customer.address}
            </p>
          </div>
        </div>
        {record.tag ? (
          <motion.span
            key={record.tag}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="shrink-0 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-teal-800"
          >
            {record.tag}
          </motion.span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200">
        <div className="p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Fields on file
          </p>
          <motion.p
            key={record.fieldsKnown}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="mt-1 text-2xl font-black tracking-tight text-slate-950"
            style={{ fontFamily: MONO }}
          >
            {record.fieldsKnown}
          </motion.p>
        </div>
        <div className="p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Lifetime value
          </p>
          <motion.p
            key={record.ltv ?? "none"}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className={`mt-1 text-2xl font-black tracking-tight ${
              record.ltv ? "text-teal-800" : "text-slate-300"
            }`}
            style={{ fontFamily: MONO }}
          >
            {formatLtv(record.ltv)}
          </motion.p>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-sky-50/75 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-sky-800">Next action</p>
        <motion.p
          key={record.nextAction}
          initial={reduceMotion ? false : { opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mt-1.5 flex items-start gap-2 text-sm font-black text-slate-950"
        >
          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
          {record.nextAction}
        </motion.p>
      </div>

      <div className="space-y-5 p-5">
        {groups.map(({ group, fields }) => (
          <div key={group}>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              {group}
            </p>
            <div className="mt-2 space-y-1">
              {fields.map((field) => {
                const isFresh = field.updatedAtStage === stageIndex
                return (
                  <motion.div
                    key={`${field.group}:${field.label}:${field.updatedAtStage}`}
                    initial={
                      reduceMotion || !isFresh
                        ? false
                        : { backgroundColor: "rgba(45, 212, 191, 0.18)", opacity: 0, y: 6 }
                    }
                    animate={{ backgroundColor: "rgba(255, 255, 255, 0)", opacity: 1, y: 0 }}
                    transition={{ duration: 1.5, ease: "easeOut" }}
                    className="flex items-baseline justify-between gap-3 rounded-xl px-2.5 py-1.5"
                  >
                    <p className="shrink-0 text-[11px] font-black uppercase tracking-widest text-slate-500">
                      {field.label}
                    </p>
                    <p className="text-right text-sm font-bold leading-snug text-slate-800">
                      {isFresh ? (
                        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-teal-500 align-middle" />
                      ) : null}
                      {field.value}
                    </p>
                  </motion.div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-200 p-5">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
          Memory log
        </p>
        <div
          data-lenis-prevent
          className="mt-3 max-h-[220px] space-y-2.5 overflow-y-auto pr-1"
        >
          {record.events.map((event) => {
            const isFresh = event.stage === stageIndex
            return (
              <motion.div
                key={`${event.stage}-${event.text}`}
                initial={reduceMotion || !isFresh ? false : { opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: EASE }}
                className="flex gap-3"
              >
                <p
                  className={`w-[64px] shrink-0 whitespace-nowrap pt-0.5 text-[10px] font-bold ${
                    isFresh ? "text-teal-700" : "text-slate-400"
                  }`}
                  style={{ fontFamily: MONO }}
                >
                  {event.time}
                </p>
                <p
                  className={`text-xs font-semibold leading-relaxed ${
                    isFresh ? "text-slate-900" : "text-slate-500"
                  }`}
                >
                  {event.text}
                </p>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
