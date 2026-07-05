"use client"

import { useEffect, useRef } from "react"
import { motion, useScroll, useTransform } from "framer-motion"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import SplitType from "split-type"

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger)
}

const steps = [
  {
    number: "01",
    title: "Intake Flow Mapping",
    description:
      "Map the no-water emergency call path, booking questions, callback needs, and escalation rules.",
  },
  {
    number: "02",
    title: "Systems Integration",
    description:
      "Connect phone routing, alerts, booking fields, calendars, sheets, or scoped webhooks where needed.",
  },
  {
    number: "03",
    title: "Program & Protocol Training",
    description:
      "Load verified public company information, approved scripting, unknown-field behavior, and human escalation boundaries.",
  },
  {
    number: "04",
    title: "Scenario Testing",
    description:
      "Test no-water emergency, low pressure, pump failure, pressure tank fault, contamination risk, and callback scenarios before launch.",
  },
  {
    number: "05",
    title: "Deployment & Optimization",
    description:
      "Launch with clear monitoring, review early calls, and refine prompts, alerts, and booking routes.",
  },
]

export function HowItWorks() {
  const sectionRef = useRef<HTMLElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  const { scrollYProgress } = useScroll({
    target: timelineRef,
    offset: ["start 70%", "end 30%"],
  })
  const lineScale = useTransform(scrollYProgress, [0, 1], [0, 1])

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
            stagger: 0.02,
          })
        },
      })
    }
    return () => {
      split.revert()
    }
  }, [])

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      className="py-24 md:py-32 relative border-t border-white/5 overflow-hidden"
    >
      <div className="absolute right-0 top-[20%] w-[500px] h-[800px] bg-white/[0.04] blur-[150px] rounded-[100%] pointer-events-none" />

      <div className="container px-4 md:px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-black tracking-widest text-white/70 uppercase backdrop-blur-md mb-8"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-white mr-2 animate-pulse" />
          The Process
        </motion.div>

        <div className="max-w-3xl mb-24">
          <h2
            ref={titleRef}
            className="text-4xl md:text-5xl lg:text-7xl font-black tracking-tighter mb-6 text-white"
            style={{ perspective: "1000px" }}
          >
            Engineered deployment.
          </h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4 }}
            className="text-xl text-white/50 leading-relaxed font-medium"
          >
            We don&apos;t hand you login credentials to a generic software tool. We architect,
            build, and deploy a managed booking and urgent-route workflow tailored to your company&apos;s call
            routing rules.
          </motion.p>
        </div>

        <div ref={timelineRef} className="relative space-y-8 pl-12 md:space-y-24 md:pl-24">
          {/* Background line */}
          <div className="absolute left-5 top-0 bottom-0 w-px bg-white/10 md:left-8" />
          {/* Animated draw line */}
          <motion.div
            style={{ scaleY: lineScale, transformOrigin: "top" }}
            className="absolute left-5 top-0 bottom-0 hidden w-px bg-gradient-to-b from-white via-cyan-100 to-white/0 shadow-[0_0_10px_rgba(103,232,249,0.55)] md:block md:left-8"
          />

          {steps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="group relative cursor-default rounded-3xl border border-white/10 bg-white/[0.025] p-5 md:border-0 md:bg-transparent md:p-0"
            >
              {/* Number node */}
              <div className="absolute -left-[48px] top-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black text-sm font-black text-white/80 shadow-xl transition-all duration-500 group-hover:scale-105 group-hover:border-cyan-200/45 group-hover:text-cyan-50 group-hover:shadow-[0_0_30px_rgba(103,232,249,0.22)] md:-left-[88px] md:top-0 md:h-14 md:w-14 md:rounded-2xl md:text-xl">
                <span className="relative z-10">{step.number}</span>
              </div>

              {/* Pulse ring */}
              <div className="pointer-events-none absolute -left-[48px] top-5 h-10 w-10 rounded-full border border-white/0 opacity-0 transition-all duration-700 group-hover:scale-150 group-hover:border-cyan-200/25 group-hover:opacity-100 md:-left-[88px] md:top-0 md:h-14 md:w-14 md:rounded-2xl" />

              <h3 className="text-2xl md:text-4xl font-black mb-4 text-white/85 group-hover:text-white transition-colors duration-500 tracking-tight">
                {step.title}
              </h3>
              <p className="text-lg text-white/50 max-w-2xl leading-relaxed font-medium group-hover:text-white/70 transition-colors duration-500">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
