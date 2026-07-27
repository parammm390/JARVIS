"use client";

import { motion } from "framer-motion";
import { ArrowRight, FileX, History, Shuffle, UserRoundX } from "lucide-react";

const problemCards = [
  {
    icon: History,
    title: "Work falls between systems",
    copy: "Customer information, appointments, quotes and follow-ups stop moving when somebody forgets the next step.",
  },
  {
    icon: FileX,
    title: "Managers discover problems too late",
    copy: "Scheduling conflicts, overdue invoices, untouched leads and stock risks stay hidden until they cost money.",
  },
  {
    icon: Shuffle,
    title: "Repetitive work consumes the team",
    copy: "Staff spend hours calling customers, updating records, sending reminders and moving information between systems.",
  },
  {
    icon: UserRoundX,
    title: "Existing software stores work",
    copy: "JARVIS actively plans, executes, verifies and reports the work across the systems you already use.",
  },
];

export function RevenueLeak() {
  return (
    <section id="product" className="healthcare-section">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
      <div className="container relative z-10 px-4 md:px-6">
        <div className="grid gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-end">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-5 inline-flex rounded-full border border-orange-200 bg-orange-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-orange-700"
            >
              YOUR BUSINESS IS RUNNING ACROSS TOO MANY SYSTEMS
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.05 }}
              className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
            >
              Your team should not have to operate the software. JARVIS should.
            </motion.h2>
          </div>
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="max-w-2xl text-lg font-medium leading-relaxed text-slate-600 md:text-xl"
          >
            Calls live in one place. Customers in another. Scheduling,
            proposals, invoices, inventory and follow-ups are scattered across
            separate tools and people. JARVIS gives your team one voice-native
            command layer across the entire operation.
          </motion.p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {problemCards.map((card, index) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-70px" }}
              transition={{ delay: index * 0.06 }}
              className="ops-card ops-card-hover rounded-2xl p-6"
              data-cursor="hover"
            >
              <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-700">
                <card.icon className="h-5 w-5" />
              </div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-600">
                0{index + 1}
              </p>
              <h3 className="mt-3 text-xl font-black tracking-tight text-slate-950">
                {card.title}
              </h3>
              <p className="mt-4 text-sm font-medium leading-relaxed text-slate-600">
                {card.copy}
              </p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className="ops-card mt-8 overflow-hidden rounded-[2rem] p-4 md:p-6"
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
            <BeforeAfterPanel
              tone="risk"
              title="The memoryless path"
              label="Same decision, no record"
              items={[
                "Quote given, never logged",
                "Price drifted rep to rep",
                "Invoice sent, no approval trail",
                "Never followed up",
              ]}
            />
            <div className="hidden items-center justify-center px-2 lg:flex">
              <ArrowRight className="h-6 w-6 text-slate-500" />
            </div>
            <BeforeAfterPanel
              tone="safe"
              title="The JARVIS record"
              label="One record, every time"
              items={[
                "Quote drafted from your price book",
                "Held for your approval",
                "Every action has a receipt",
                "Follow-up scheduled automatically",
              ]}
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function BeforeAfterPanel({
  tone,
  title,
  label,
  items,
}: {
  tone: "risk" | "safe";
  title: string;
  label: string;
  items: string[];
}) {
  const safe = tone === "safe";
  return (
    <div
      className={`rounded-[1.5rem] border p-6 ${
        safe
          ? "border-teal-200 bg-gradient-to-br from-teal-50 to-white"
          : "border-orange-200 bg-gradient-to-br from-orange-50 to-white"
      }`}
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p
            className={`text-xs font-black uppercase tracking-[0.2em] ${safe ? "text-teal-700" : "text-orange-700"}`}
          >
            {label}
          </p>
          <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
            {title}
          </h3>
        </div>
        {safe ? (
          <span className="status-pulse rounded-full bg-teal-600 px-3 py-1.5 text-xs font-black text-white">
            Receipt filed
          </span>
        ) : (
          <span className="rounded-full bg-orange-100 px-3 py-1.5 text-xs font-black text-orange-800">
            No record
          </span>
        )}
      </div>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div
            key={item}
            className="flex items-center gap-3 rounded-2xl border border-slate-900/8 bg-white/78 p-4"
          >
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${safe ? "bg-teal-600" : "bg-orange-500"}`}
              aria-hidden
            />
            <span className="text-sm font-black text-slate-700">{item}</span>
            <span className="ml-auto text-xs font-black text-slate-500">
              0{index + 1}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
