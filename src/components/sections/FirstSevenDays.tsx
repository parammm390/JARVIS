"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  BellRing,
  ClipboardList,
  FileCheck2,
  FlaskConical,
  GitBranch,
  PhoneForwarded,
  Route,
} from "lucide-react";

const steps = [
  {
    day: "Map the operation",
    title:
      "Understand your locations, team, workflow volume, lead sources and operational priorities",
    icon: PhoneForwarded,
  },
  {
    day: "Connect the systems",
    title:
      "Integrate your existing calls, CRM, scheduling, accounting, payment and field systems",
    icon: ClipboardList,
  },
  {
    day: "Configure and test the workflows",
    title:
      "Define approval rules, permission boundaries, escalation paths and run failure and approval scenarios with your team",
    icon: GitBranch,
  },
  {
    day: "Build the first production workflows",
    title:
      "Configure your highest-priority workflows: lead follow-up, quote generation, scheduling, collections or field operations",
    icon: BellRing,
  },
  {
    day: "Test failure and approval paths",
    title:
      "Run test scenarios: approvals, rejections, system failures and verify audit records",
    icon: FlaskConical,
  },
  {
    day: "Review with your team",
    title:
      "Review every test result: what was drafted, what was approved, what the audit record shows",
    icon: FileCheck2,
  },
  {
    day: "Launch with defined authority",
    title:
      "Go live. Every instruction operates within your approved boundaries and generates a complete audit record",
    icon: Route,
  },
];

export function FirstSevenDays() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: timelineRef,
    offset: ["start 70%", "end 35%"],
  });
  const lineScale = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <section
      id="rollout"
      className="healthcare-section relative overflow-hidden py-20 md:py-28"
    >
      <div className="absolute left-0 top-1/2 h-[32rem] w-[32rem] -translate-y-1/2 rounded-full bg-sky-200/25 blur-[120px]" />
      <div className="container relative z-10 px-4 md:px-6">
        <div className="mb-12 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-5 inline-flex items-center rounded-full border border-slate-200 bg-white/72 px-4 py-1.5 text-xs font-black uppercase tracking-[0.22em] text-slate-500 shadow-sm backdrop-blur"
          >
            DEPLOYMENT ROADMAP
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.05, duration: 0.6 }}
            className="text-4xl font-black tracking-tight text-slate-950 md:text-5xl"
          >
            Your highest-value workflows, deployed around your business.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="mt-5 max-w-2xl text-lg font-medium leading-relaxed text-slate-600"
          >
            We connect JARVIS to your operation, configure your permissions and policies, build the first production workflows, test failure and approval paths with your team, and launch only after the agreed scenarios pass.
          </motion.p>
        </div>

        <div
          ref={timelineRef}
          className="relative mx-auto max-w-5xl pl-9 md:pl-16"
        >
          <div className="absolute bottom-0 left-4 top-0 w-px bg-slate-200 md:left-7" />
          <motion.div
            style={{ scaleY: lineScale, transformOrigin: "top" }}
            className="absolute bottom-0 left-4 top-0 w-px bg-gradient-to-b from-sky-500 via-teal-500 to-teal-500/0 shadow-[0_0_20px_rgba(14,165,233,0.28)] md:left-7"
          />
          <div className="space-y-4 md:space-y-5">
            {steps.map((step, index) => (
              <motion.article
                key={step.day}
                initial={{ opacity: 0, x: -18 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{
                  delay: index * 0.045,
                  duration: 0.5,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="ops-card ops-card-hover group relative overflow-hidden rounded-[1.35rem] bg-white/82 p-5 md:p-6"
                data-cursor="hover"
              >
                <motion.div
                  className="pointer-events-none absolute -left-[2.05rem] top-7 h-4 w-4 rounded-full border border-sky-300 bg-white shadow-[0_0_18px_rgba(14,165,233,0.22)] md:-left-[3.05rem]"
                  whileInView={{ scale: [1, 1.35, 1] }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.72, delay: index * 0.08 }}
                />
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-sky-100 bg-sky-50 text-sky-700 transition group-hover:border-teal-200 group-hover:bg-teal-50 group-hover:text-teal-700">
                    <step.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-teal-700">
                      {step.day}
                    </p>
                    <h3 className="mt-2 text-xl font-black leading-tight tracking-tight text-slate-950">
                      {step.title}
                    </h3>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
