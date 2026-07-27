"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenText,
  Calculator,
  ClipboardCheck,
  Clock3,
  Headset,
  PhoneOff,
  Route,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { ResourceFrame } from "./ResourceFrame";
import { ResourceHero } from "./ResourceHero";

const resourceCards = [
  {
    href: "/resources/missed-call-cost-calculator",
    icon: Calculator,
    kicker: "Business impact calculator",
    title: "Operations Impact Estimator",
    copy: "Estimate the business value at risk from unexecuted workflows, delayed approvals, and stalled customer actions.",
  },
  {
    href: "/resources/dispatch-ai-glossary",
    icon: BookOpenText,
    kicker: "Operations glossary",
    title: "JARVIS Operations Glossary",
    copy: "Plain-English definitions for voice commands, execution workflows, approval rules, and operational boundaries.",
  },
  {
    href: "/resources/pilot-setup-checklist",
    icon: ClipboardCheck,
    kicker: "Deployment planning",
    title: "JARVIS Deployment Checklist",
    copy: "Define your approval rules, integration scope, user permissions, operational boundaries, and success criteria before launch.",
  },
  {
    href: "/trust-safety",
    icon: ShieldCheck,
    kicker: "Control model",
    title: "Trust & Safety",
    copy: "How JARVIS operates within defined authority, executes approved workflows, asks for approval when required, and maintains complete audit records.",
  },
  {
    href: "/resources#answering-service",
    icon: Headset,
    kicker: "Comparison",
    title: "JARVIS vs Answering Services",
    copy: "Why AI-executed business workflows are different from voice message taking and follow-up routing.",
  },
  {
    href: "/resources#generic-ai",
    icon: Route,
    kicker: "Comparison",
    title: "JARVIS vs Generic AI",
    copy: "How JARVIS operates within your business rules and connected systems instead of generic automation.",
  },
];

const operatorProblems = [
  {
    icon: PhoneOff,
    title: "Work falls between systems",
    copy: "Customer requests, proposals, invoices and follow-ups stop moving when information doesn't connect across tools.",
  },
  {
    icon: Truck,
    title: "Operations visibility gaps",
    copy: "Scheduling conflicts, overdue invoices, unanswered leads and inventory risks stay hidden until they cost money.",
  },
  {
    icon: AlertTriangle,
    title: "Approval and control risk",
    copy: "Without defined authority boundaries, AI either does nothing or acts without guardrails.",
  },
  {
    icon: Clock3,
    title: "Repetitive work consumes the team",
    copy: "Manual routing, data entry, reminders and status updates consume hours that should go to decisions requiring human judgment.",
  },
];

const comparisonRows = [
  {
    id: "answering-service",
    label: "JARVIS vs Answering Services",
    points: [
      "Extracts the information needed to decide and act: customer details, request type, context, urgency and business data.",
      "Routes approved workflows to the right person or system instead of leaving a message on a queue.",
      "Executes business logic from your policies and pricing automatically. Holds decisions requiring judgment with your team.",
    ],
  },
  {
    id: "generic-ai",
    label: "JARVIS vs Generic AI",
    points: [
      "Operates within your defined approval scope and permissions, not generic defaults.",
      "Marks unknown information as unknown instead of confidently inventing answers.",
      "Verifies outcomes against real business systems instead of silently reporting success.",
    ],
  },
];

export function ResourcesHub() {
  return (
    <ResourceFrame>
      <ResourceHero
        kicker="Resource hub"
        title="Tools for understanding JARVIS operations."
        copy="For water-treatment companies evaluating how JARVIS operates, what requires approval, how it verifies outcomes, and what boundaries protect your business."
        icon={BookOpenText}
        aside={<HubSignalCard />}
      />

      <section className="healthcare-section pt-0">
        <div className="container relative z-10 px-4 md:px-6">
          <div className="mb-12">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-700">
              The operating challenge
            </p>
            <h2 className="mt-3 max-w-4xl text-3xl font-black tracking-tight text-slate-950 md:text-5xl">
              Your team should not operate the software. JARVIS should.
            </h2>
            <div className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {operatorProblems.map((problem) => (
                <div key={problem.title} className="ops-card rounded-2xl p-5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-700">
                    <problem.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-black tracking-tight text-slate-950">
                    {problem.title}
                  </h3>
                  <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600">
                    {problem.copy}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {resourceCards.map((card, index) => (
              <motion.a
                key={card.title}
                href={card.href}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-70px" }}
                transition={{ delay: index * 0.05 }}
                className="ops-card ops-card-hover group flex min-h-[19rem] flex-col justify-between rounded-2xl p-6"
                data-cursor="hover"
              >
                <div>
                  <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
                    <card.icon className="h-5 w-5 text-teal-200" />
                  </div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-600">
                    {card.kicker}
                  </p>
                  <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">
                    {card.title}
                  </h2>
                  <p className="mt-4 text-sm font-medium leading-relaxed text-slate-600">
                    {card.copy}
                  </p>
                </div>
                <span className="mt-8 inline-flex items-center gap-2 text-sm font-black text-slate-950">
                  Open resource
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </span>
              </motion.a>
            ))}
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {comparisonRows.map((row, index) => (
              <motion.div
                key={row.id}
                id={row.id}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ delay: index * 0.07 }}
                className="ops-card rounded-[2rem] p-6 md:p-7"
              >
                <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-700">
                  Comparison note
                </p>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                  {row.label}
                </h2>
                <div className="mt-6 space-y-3">
                  {row.points.map((point) => (
                    <div
                      key={point}
                      className="flex gap-3 rounded-2xl border border-slate-900/8 bg-white/72 p-4"
                    >
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
                      <p className="text-sm font-semibold leading-relaxed text-slate-700">
                        {point}
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </ResourceFrame>
  );
}

function HubSignalCard() {
  return (
    <div className="ops-card relative overflow-hidden rounded-[2rem] p-5 md:p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-slate-950 via-sky-700 to-teal-600" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(14,165,233,0.12),transparent_36%),linear-gradient(135deg,rgba(45,212,191,0.08),transparent_50%)]" />
      <div className="relative">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-600">
          The JARVIS loop
        </p>
        <div className="signal-thread mt-5 flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3">
          {["Instruction", "Plan", "Approve", "Receipt"].map((item) => (
            <span
              key={item}
              className="relative z-10 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-sm"
            >
              {item}
            </span>
          ))}
        </div>
        <p className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm font-semibold leading-relaxed text-slate-700">
          Use these resources to map how JARVIS handles your leads: draft the
          next step, hold it for approval, route urgency fast, and keep quotes,
          ETAs, and service promises with your team.
        </p>
      </div>
    </div>
  );
}
