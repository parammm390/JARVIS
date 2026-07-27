"use client";

import { motion } from "framer-motion";
import {
  BellRing,
  BookOpenCheck,
  CalendarClock,
  ClipboardCheck,
  FileText,
  GitBranch,
  LayoutDashboard,
  PhoneIncoming,
  Radar,
  Route,
  ShieldCheck,
  ScrollText,
  BarChart3,
  Rocket,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const capabilities: Array<{ icon: LucideIcon; title: string; copy: string }> = [
  {
    icon: PhoneIncoming,
    title: "Voice, Calls and Campaigns",
    copy: "Natural voice and typed business commands. Inbound and outbound calling. Lead qualification and follow-up. Approved bulk campaigns with limits and compliance rules.",
  },
  {
    icon: LayoutDashboard,
    title: "CRM and Customer Operations",
    copy: "Create and update contacts, leads and opportunities. Search complete customer history. Move leads through defined workflows. Track conversations and next actions.",
  },
  {
    icon: CalendarClock,
    title: "Scheduling, Dispatch and Field Operations",
    copy: "Schedule and reschedule appointments. Detect scheduling conflicts. Assign technicians and optimise routes. Send confirmations and track workload.",
  },
  {
    icon: FileText,
    title: "Quotes, Proposals and Sales",
    copy: "Draft quotes from approved company data. Generate proposals and request signatures. Follow up on pending approvals. Move approved work into workflows.",
  },
  {
    icon: ScrollText,
    title: "Finance and Collections",
    copy: "Create and send invoices. Run invoice-to-cash workflows. Follow up on overdue balances. Record and verify payment outcomes.",
  },
  {
    icon: Radar,
    title: "Inventory and Service",
    copy: "Check stock and reserve required inventory. Identify reorder risk. Create service reminders. Manage maintenance agreements and equipment history.",
  },
  {
    icon: BarChart3,
    title: "Marketing and Intelligence",
    copy: "Run approved customer campaigns. Review performance. Detect pipeline and data-quality problems. Generate operational briefings and forecasts.",
  },
  {
    icon: ShieldCheck,
    title: "Control and Reliability",
    copy: "Role-based permissions and risk-based approval rules. Grounded business-data verification. Durable workflows with failure recovery. Complete audit receipts.",
  },
];

export function Solution() {
  return (
    <section id="capabilities" className="healthcare-section">
      <div className="absolute left-[-14rem] top-24 h-[32rem] w-[32rem] rounded-full bg-teal-100/60 blur-3xl" />
      <div className="container relative z-10 px-4 md:px-6">
        <div className="mx-auto mb-14 max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-5 inline-flex rounded-full border border-teal-200 bg-teal-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-teal-700"
          >
            One command layer
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
          >
            Across your entire company.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
            className="mx-auto mt-6 max-w-2xl text-lg font-medium leading-relaxed text-slate-600"
          >
            Voice or typed commands control calls, CRM, scheduling, proposals, invoices, inventory, technicians, campaigns and operational intelligence.
          </motion.p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {capabilities.map((capability, index) => (
            <motion.div
              key={capability.title}
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: index * 0.035 }}
              className="ops-card ops-card-hover rounded-2xl p-6"
              data-cursor="hover"
            >
              <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-800">
                <capability.icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-black tracking-tight text-slate-950">
                {capability.title}
              </h3>
              <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600">
                {capability.copy}
              </p>
            </motion.div>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-sm font-bold leading-relaxed text-slate-600">
          Each capability connects to the others. Voice commands trigger workflows, approvals, external system updates, verification and audit records—all in one execution layer above your existing tools.
        </p>
      </div>
    </section>
  );
}
