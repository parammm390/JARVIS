"use client"

import { useEffect, useRef } from "react"
import { motion } from "framer-motion"
import type { LifecycleStage } from "@/lib/lifecycle/scenario"

const EASE = [0.16, 1, 0.3, 1]

export function TimelineScrubber({
  stages,
  index,
  onSelect,
}: {
  stages: LifecycleStage[]
  index: number
  onSelect: (index: number) => void
}) {
  const insetPercent = 100 / (stages.length * 2)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (!container || container.scrollWidth <= container.clientWidth) return
    const active = container.querySelector<HTMLElement>('[aria-current="step"]')
    if (!active) return
    container.scrollTo({
      left: active.offsetLeft - container.clientWidth / 2 + active.clientWidth / 2,
      behavior: "smooth",
    })
  }, [index])

  return (
    <div ref={scrollRef} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
      <div className="relative min-w-[680px] pb-1 md:min-w-0">
        <div
          className="absolute top-[7px] h-px bg-slate-200"
          style={{ left: `${insetPercent}%`, right: `${insetPercent}%` }}
        />
        <div
          className="absolute top-[6px] h-[3px] overflow-hidden rounded-full"
          style={{ left: `${insetPercent}%`, right: `${insetPercent}%` }}
        >
          <motion.div
            initial={false}
            animate={{ width: `${(index / (stages.length - 1)) * 100}%` }}
            transition={{ duration: 0.65, ease: EASE }}
            className="h-full rounded-full bg-gradient-to-r from-sky-500 to-teal-500 shadow-[0_0_14px_rgba(20,184,166,0.35)]"
          />
        </div>

        <div
          className="relative grid"
          style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
        >
          {stages.map((stage, stageIndex) => {
            const isActive = stageIndex === index
            const isComplete = stageIndex < index
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => onSelect(stageIndex)}
                aria-label={`Stage ${stageIndex + 1}: ${stage.timeLabel}, ${stage.title}`}
                aria-current={isActive ? "step" : undefined}
                data-cursor="hover"
                className="group flex flex-col items-center gap-2.5 pb-1 pt-0"
              >
                <span
                  className={`relative z-10 h-[15px] w-[15px] rounded-full border-2 transition-all duration-500 ${
                    isActive
                      ? "scale-110 border-sky-600 bg-white shadow-[0_0_0_5px_rgba(14,165,233,0.14)]"
                      : isComplete
                        ? "border-teal-500 bg-teal-500"
                        : "border-slate-300 bg-white group-hover:border-sky-400"
                  }`}
                >
                  {isActive ? (
                    <span className="absolute inset-[2.5px] rounded-full bg-sky-600" />
                  ) : null}
                </span>
                <span
                  className={`whitespace-nowrap text-[10px] font-black uppercase tracking-widest transition-colors ${
                    isActive
                      ? "text-slate-950"
                      : isComplete
                        ? "text-teal-700"
                        : "text-slate-400 group-hover:text-slate-600"
                  }`}
                >
                  {stage.railLabel}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
