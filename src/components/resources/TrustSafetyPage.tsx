"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  ClipboardList,
  FileQuestion,
  LockKeyhole,
  Route,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { ResourceFrame } from "./ResourceFrame";
import { ResourceHero } from "./ResourceHero";

const trustSections = [
  {
    icon: UserRoundCheck,
    title: "Grounded in real company data",
    copy: "JARVIS checks the company data, policies and permissions available to the deployment before it acts.",
  },
  {
    icon: ShieldCheck,
    title: "Risk-based approval boundaries",
    copy: "What was proposed, what was approved, what happened, what it cost. Every time. That record is what the rest of your business runs on, not a log file nobody reads.",
  },
  {
    icon: FileQuestion,
    title: "Role-based permissions",
    copy: "Quotes and proposals come only from your configured pricing and business data. JARVIS does not invent numbers, guarantee impossible outcomes, or make promises your team didn't authorize.",
  },
  {
    icon: AlertTriangle,
    title: "No silent success states",
    copy: "You define the escalation path for urgent or concerning language. JARVIS flags that language and routes it according to the approved process — it does not decide who responds.",
  },
  {
    icon: ClipboardList,
    title: "Independent outcome verification",
    copy: "Approval rules, booking questions, and knowledge boundaries are set and agreed before launch, so JARVIS stays within your operating model, not a generic default.",
  },
  {
    icon: Route,
    title: "Durable workflows and recovery",
    copy: "If a caller does not provide a field, the record shows it as unknown rather than JARVIS inventing or assuming an answer.",
  },
  {
    icon: LockKeyhole,
    title: "Complete audit history",
    copy: "Pilots use only the information needed to test drafted plans, approval routing, escalation, and follow-up workflow.",
  },
  {
    icon: ShieldCheck,
    title: "Tenant-isolated data",
    copy: "JARVIS starts with a defined approval scope, reviewed rules, test scenarios, and clear human ownership before broader use.",
  },
];

const boundaries = [
  "Your team's judgment and authorization",
  "Business decisions requiring human approval",
  "Operational risk assessment",
  "Final pricing and customer commitments — JARVIS drafts from your configured rules, never invents",
  "Safety and compliance policies",
  "Company operating procedures",
  "The approval on every plan JARVIS drafts",
];

export function TrustSafetyPage() {
  return (
    <ResourceFrame>
      <ResourceHero
        kicker="Trust & safety"
        title="Autonomy with permissions, verification and control."
        copy="JARVIS is designed to execute real business work without giving an AI unlimited authority. Every deployment defines what it may do automatically, what requires approval and what it must never do."
        icon={ShieldCheck}
        aside={<TrustCommandCard />}
      />

      <section className="healthcare-section pt-0">
        <div className="container relative z-10 px-4 md:px-6">
          <div className="grid gap-4 md:grid-cols-2">
            {trustSections.map((section, index) => (
              <motion.div
                key={section.title}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-70px" }}
                transition={{ delay: index * 0.04 }}
                className="ops-card ops-card-hover rounded-2xl p-6"
                data-cursor="hover"
              >
                <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
                  <section.icon className="h-5 w-5 text-teal-200" />
                </div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                  Boundary {String(index + 1).padStart(2, "0")}
                </p>
                <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">
                  {section.title}
                </h2>
                <p className="mt-4 text-sm font-medium leading-relaxed text-slate-600">
                  {section.copy}
                </p>
              </motion.div>
            ))}
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
            <motion.div
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              className="ops-card rounded-[2rem] p-6 md:p-7"
            >
              <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-700">
                What JARVIS does not replace
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                The company remains the decision-maker.
              </h2>
              <div className="mt-6 grid gap-3">
                {boundaries.map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-3 rounded-2xl border border-slate-900/8 bg-white/72 p-4"
                  >
                    <UserRoundCheck className="h-4 w-4 text-teal-700" />
                    <span className="text-sm font-black text-slate-700">
                      {item}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              className="ops-card relative overflow-hidden rounded-[2rem] p-6 md:p-7"
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-slate-950 via-sky-700 to-teal-600" />
              <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-800">
                Deployment note
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                Production scope depends on the final routing, systems, and
                agreements.
              </h2>
              <p className="mt-5 text-base font-semibold leading-relaxed text-slate-700">
                Production readiness depends on final routing, data handling,
                vendor agreements, access controls, retention settings,
                escalation procedures, and the company&apos;s own policies.
                JARVIS scopes those decisions before launch.
              </p>
              <div className="mt-7 rounded-2xl border border-teal-200 bg-teal-50 p-5">
                <p className="text-sm font-black text-slate-950">
                  Conservative operating principle
                </p>
                <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-700">
                  Draft only from configured pricing and measured water data,
                  hold every plan for approval, route urgent language, and leave
                  final figures, dispatch decisions, repair judgment, ETAs, and
                  promises to the human team.
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </ResourceFrame>
  );
}

function TrustCommandCard() {
  return (
    <div className="relative mx-auto max-w-[620px]">
      <div className="absolute -inset-6 rounded-[2.25rem] bg-gradient-to-br from-sky-200/52 via-white/40 to-teal-100/45 blur-2xl" />
      <div className="relative overflow-hidden rounded-[2rem] border border-slate-900 bg-slate-950 p-5 text-white shadow-[0_34px_110px_rgba(8,24,39,0.28)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_0%,rgba(125,211,252,0.22),transparent_34%),linear-gradient(135deg,rgba(45,212,191,0.11),transparent_46%)]" />
        <div className="absolute inset-0 command-grid opacity-50" />
        <div className="relative">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-100">
            Operating boundary
          </p>
          <h2 className="mt-2 text-2xl font-black tracking-tight">
            Human team owns next steps
          </h2>
          <div className="mt-5 grid gap-3">
            {[
              "Plan drafted",
              "Held for approval",
              "Urgency routed",
              "Receipt filed",
            ].map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4"
              >
                <ShieldCheck className="h-4 w-4 text-teal-200" />
                <span className="text-sm font-black text-white">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
