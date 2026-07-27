"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  FileLock2,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";

const scopeItems = [
  {
    icon: CheckCircle2,
    title: "Understands your operation",
    copy: "JARVIS checks your actual customers, schedules, policies, pricing and permissions before it acts. It doesn't guess or apply defaults.",
  },
  {
    icon: UserRoundCheck,
    title: "Executes across connected systems",
    copy: "One voice command can trigger work across your calls, CRM, scheduling, proposals, invoices, inventory and campaigns. Everything updates in real systems.",
  },
  {
    icon: ShieldCheck,
    title: "Works within defined authority",
    copy: "Approved low-risk work runs automatically. High-risk, financial, and irreversible actions wait for the person authorized to approve them.",
  },
  {
    icon: AlertTriangle,
    title: "Verifies every consequential outcome",
    copy: "JARVIS doesn't silently report success. It checks the external system, records what happened, and surfaces anything incomplete or failed.",
  },
];

export function Outcome() {
  return (
    <section id="boundaries" className="healthcare-section bg-white/42">
      <div className="absolute inset-0 operational-grid opacity-45" />
      <div className="container relative z-10 px-4 md:px-6">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-5 inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-sky-800"
            >
              Built to execute business work
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
            >
              ChatGPT-quality interaction. Built to execute business work.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.08 }}
              className="mt-6 max-w-2xl text-lg font-medium leading-relaxed text-slate-600"
            >
              A normal AI assistant answers questions. JARVIS operates against your real business data, policies and permissions. It coordinates multi-step work, pauses for approvals, survives failures, verifies external outcomes and shows exactly what happened.
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 22 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            className="ops-card rounded-[2rem] p-6 md:p-7"
          >
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-800">
                  Execution model
                </p>
                <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                  What makes it different.
                </h3>
              </div>
              <FileLock2 className="h-6 w-6 text-slate-700" />
            </div>
            <div className="grid gap-4">
              {scopeItems.map((item) => (
                <div
                  key={item.title}
                  className="flex gap-4 rounded-2xl border border-slate-900/8 bg-white p-4"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-800">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h4 className="font-black tracking-tight text-slate-950">
                      {item.title}
                    </h4>
                    <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-600">
                      {item.copy}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-5 text-sm font-semibold leading-relaxed text-orange-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            This isn&apos;t a fit for every shop. If you want a system that acts
            without asking, or need a full CRM replacement, JARVIS isn&apos;t
            that. And this page does not claim full operational data handling
            compliance, that depends on the deployed stack, vendor agreements,
            access controls, and signed terms.
          </p>
        </div>
      </div>
    </section>
  );
}
