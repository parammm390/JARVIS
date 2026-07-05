"use client"

import { motion } from "framer-motion"
import { BellRing, Bot, Database, PhoneCall, PlugZap, Users } from "lucide-react"
import type { DemoWorkflowType } from "@/lib/demo/workflows"

type WorkflowModuleProps = {
  activeStep: number
  workflowType: DemoWorkflowType
}

const integrations = ["Call tracking", "Calendar", "Sheets", "Scoped webhook", "Email alert", "SMS alert"]

export function WorkflowModule({ activeStep, workflowType }: WorkflowModuleProps) {
  const workflowSteps =
    workflowType === "water_treatment"
      ? [
          {
            icon: PhoneCall,
            label: "Lead source",
            description: "Website form, missed call, paid lead, quote request, or water test inquiry.",
          },
          {
            icon: Bot,
            label: "Booking path",
            description: "Water source, concern, system interest, timeline, and callback preference.",
          },
          {
            icon: BellRing,
            label: "Booked next step",
            description: "Booking context, qualification signal, and callback task for the front office.",
          },
          {
            icon: Database,
            label: "Systems",
            description: "CRM, call tracking, email, SMS, sheets, or scoped webhook.",
          },
          {
            icon: Users,
            label: "Human team",
            description: "CSR or sales owner confirms the appointment, quote path, or callback.",
          },
        ]
      : [
          {
            icon: PhoneCall,
            label: "Emergency call",
            description: "No-water, low-pressure, pump, or pressure tank issue reaches FINNOR.",
          },
          {
            icon: Bot,
            label: "Urgent route",
            description: "Scope, start time, address, callback, people affected, and safety screen.",
          },
          {
            icon: BellRing,
            label: "Dispatch alert",
            description: "Urgency-tagged summary routes to the configured on-call path.",
          },
          {
            icon: Database,
            label: "Systems",
            description: "Call tracking, email, SMS, CRM, sheets, or scoped webhook.",
          },
          {
            icon: Users,
            label: "On-call team",
            description: "Dispatcher or technician receives the urgent route and owns the response.",
          },
        ]
  const pulseX = `${Math.max(0, Math.min(activeStep, 4)) * 103}%`

  return (
    <section className="relative overflow-hidden border-t border-slate-200 py-20 md:py-28">
      <div className="absolute left-1/2 top-16 h-[520px] w-[920px] -translate-x-1/2 rounded-full bg-sky-100/80 blur-[140px]" />
      <div className="container relative z-10 px-4 md:px-6">
        <div className="mb-12 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-6 inline-flex items-center rounded-full border border-slate-200 bg-white/72 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-slate-500"
          >
            <span className="mr-2 h-1.5 w-1.5 rounded-full bg-teal-500" />
            Phone agent, alerts, tracking, and booking routes
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 22 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl lg:text-7xl"
          >
            How FINNOR fits into the response stack
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-6 text-lg font-medium leading-relaxed text-slate-600 md:text-xl"
          >
            The demo shows the source, selected booking logic, routing rules, and human-owned path
            in one continuous flow.
          </motion.p>
        </div>

        <div className="ops-card relative overflow-hidden rounded-3xl bg-white/84 p-5 md:p-8">
          <div className="absolute inset-0 operational-grid opacity-45 [mask-image:radial-gradient(ellipse_80%_70%_at_50%_45%,#000_45%,transparent_100%)]" />

          <div className="relative z-10">
            <div className="relative grid gap-4 lg:grid-cols-5">
              <div className="pointer-events-none absolute left-[8%] right-[8%] top-16 hidden h-px bg-slate-200 lg:block" />
              <motion.div
                className="pointer-events-none absolute left-[4%] top-16 hidden h-px w-[18%] bg-gradient-to-r from-transparent via-sky-500 to-transparent shadow-[0_0_20px_rgba(14,165,233,0.24)] will-change-transform lg:block"
                animate={{ x: pulseX }}
                transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
              />

              {workflowSteps.map((step, index) => {
                const Icon = step.icon
                const isActive = activeStep === index
                const isComplete = activeStep > index

                return (
                  <motion.div
                    key={step.label}
                    initial={{ opacity: 0, y: 18 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-60px" }}
                    transition={{ delay: index * 0.06, duration: 0.55 }}
                    className={`relative rounded-2xl border p-5 transition-all duration-500 ${
                      isActive
                        ? "border-sky-200 bg-sky-50 shadow-[0_18px_44px_rgba(14,165,233,0.08)]"
                        : isComplete
                          ? "border-teal-100 bg-teal-50/60"
                          : "border-slate-200 bg-white/78"
                    }`}
                  >
                    <div
                      className={`mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border transition-all duration-500 ${
                        isActive
                          ? "border-sky-200 bg-sky-100 text-sky-800"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      <Icon className="h-6 w-6" />
                    </div>
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-600">
                      0{index + 1}
                    </p>
                    <h3 className="mt-3 text-lg font-black tracking-tight text-slate-950">
                      {step.label}
                    </h3>
                    <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-600">
                      {step.description}
                    </p>
                  </motion.div>
                )
              })}
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              {integrations.map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm"
                >
                  <PlugZap className="h-4 w-4 text-teal-700" />
                  {item}
                </span>
              ))}
            </div>

            <div className="mt-8 rounded-2xl border border-sky-100 bg-sky-50/75 p-5 md:p-6">
              <p className="text-lg font-black tracking-tight text-slate-950 md:text-xl">
                The value is not just the voice. The value is faster response, booked next steps,
                and urgent routes your human team controls.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
