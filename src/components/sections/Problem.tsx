"use client"

import { useEffect, useRef } from "react"
import { motion } from "framer-motion"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import SplitType from "split-type"
import { AlertCircle, PhoneOff, Hourglass, RouteOff } from "lucide-react"
import { TiltCard } from "@/components/ui/tilt-card"

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger)
}

const problems = [
  {
    title: "Missed calls mean missed dispatch",
    description:
      "When a homeowner with no water calls after hours and reaches voicemail, the emergency repair job can disappear before your team hears the message.",
    icon: PhoneOff,
  },
  {
    title: "After-hours inquiries go cold",
    description:
      "Families and individuals seeking help do not follow business hours. Calls made at 11 PM need a response path before the next business day.",
    icon: Hourglass,
  },
  {
    title: "Intake staff is overwhelmed",
    description:
      "Human teams spend time gathering the same caller, address, pump type, well depth, pressure reading, issue, urgency, contamination risk, and callback details before they can prioritize follow-up.",
    icon: RouteOff,
  },
  {
    title: "Urgent callers need a human path",
    description:
      "Urgent language should route to a designated human path instead of being treated like a general inquiry.",
    icon: AlertCircle,
  },
]

export function Problem() {
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    const split = new SplitType(el, { types: "words,chars" })
    if (split.chars) {
      gsap.set(split.chars, { y: "100%", opacity: 0, rotateX: -45 })
      ScrollTrigger.create({
        trigger: el,
        start: "top 85%",
        once: true,
        onEnter: () => {
          gsap.to(split.chars!, {
            y: 0,
            opacity: 1,
            rotateX: 0,
            duration: 1.1,
            ease: "expo.out",
            stagger: 0.015,
          })
        },
      })
    }
    return () => {
      split.revert()
    }
  }, [])

  return (
    <section id="problem" className="py-24 md:py-32 relative overflow-hidden">
      <div className="container px-4 md:px-6 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-24 items-start border-t border-white/5 pt-16">
          <div className="lg:sticky lg:top-32 space-y-8">
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-black tracking-widest text-white/70 uppercase backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400 mr-2 animate-pulse" />
              The Problem
            </div>
            <h2
              ref={titleRef}
              className="text-4xl md:text-5xl lg:text-7xl font-black tracking-tighter leading-[1.05]"
              style={{ perspective: "1000px" }}
            >
              You are losing dispatch <br />
              <span className="text-white/40">when the phone rings out.</span>
            </h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, delay: 0.4 }}
              className="text-lg md:text-xl text-white/60 max-w-md leading-relaxed font-medium"
            >
              Well pump and water well service companies depend on answering urgent no-water calls. Relying entirely
              on manual coverage creates missed jobs, slow follow-up, and avoidable voicemail gaps.
            </motion.p>
          </div>

          <div className="space-y-6 pt-8 lg:pt-0">
            {problems.map((problem, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 60 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.7, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              >
                <TiltCard intensity={5} className="rounded-3xl">
                  <div className="glass-card border-gradient p-6 md:p-10 rounded-3xl relative overflow-hidden group hover:border-white/30 transition-all duration-500">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full blur-[50px] group-hover:bg-white/15 transition-colors duration-700" />

                    <div className="flex items-start gap-4 lg:gap-6 relative z-10">
                      <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10 group-hover:border-white/40 group-hover:bg-white/10 group-hover:scale-110 transition-all duration-500">
                        <problem.icon className="w-7 h-7 text-white" />
                      </div>
                      <div>
                        <h3 className="text-xl md:text-2xl font-bold mb-3 text-white tracking-tight">
                          {problem.title}
                        </h3>
                        <p className="text-white/55 leading-relaxed font-medium">
                          {problem.description}
                        </p>
                      </div>
                    </div>
                  </div>
                </TiltCard>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
