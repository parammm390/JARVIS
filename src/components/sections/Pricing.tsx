"use client";

import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { siteConfig } from "@/config/site";
import { Magnetic } from "@/components/ui/magnetic";

const tiers = [
  {
    id: "deployment",
    kicker: "JARVIS DEPLOYMENT",
    title: "One JARVIS, configured around your operation.",
    subtitle: "Contact for pricing",
    description:
      "Every deployment is scoped around your locations, team, workflow volume, integrations and operating rules. You receive the complete JARVIS platform, not a stripped-down feature tier.",
    features: [
      "Voice and typed JARVIS command centre",
      "Inbound and outbound calling",
      "CRM and customer workflows",
      "Scheduling and dispatch",
      "Quotes, proposals and signatures",
      "Invoices, collections and payments",
      "Inventory and technician operations",
      "SMS, email and approved bulk campaigns",
      "Operational analytics and intelligence",
      "Business memory and customer history",
      "Risk-based approvals and permissions",
      "Verified execution receipts",
      "Workflow configuration and required integrations",
      "Team onboarding, deployment testing and launch support",
      "Multi-location support when scoped",
    ],
    cta: "Contact for Pricing",
    highlight: true,
  },
];

export function Pricing() {
  return (
    <section
      id="pricing"
      className="healthcare-section relative overflow-hidden py-20 md:py-28"
    >
      <div className="pointer-events-none absolute left-[-12%] top-0 h-[34rem] w-[34rem] rounded-full bg-sky-200/35 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-[-10%] h-[34rem] w-[34rem] rounded-full bg-teal-100/55 blur-[130px]" />

      <div className="container relative z-10 px-4 md:px-6">
        <div className="mx-auto mb-12 max-w-4xl text-center md:mb-16">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-5 inline-flex items-center rounded-full border border-slate-200 bg-white/75 px-4 py-1.5 text-xs font-black uppercase tracking-[0.22em] text-slate-600 shadow-sm backdrop-blur"
          >
            JARVIS deployment
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
          >
            Your highest-value workflows, deployed around your business.
          </motion.h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg font-medium leading-relaxed text-slate-600">
            We connect JARVIS to your operation, configure your permissions and
            policies, build the first production workflows, test failure and
            approval paths with your team, and launch only after the agreed
            scenarios pass.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className="relative mx-auto max-w-6xl"
        >
          <div className="grid gap-6 lg:grid-cols-3">
            {tiers.map((tier) => (
              <article
                key={tier.id}
                className={`relative overflow-hidden rounded-[2.25rem] border text-white shadow-[0_42px_130px_rgba(15,38,62,0.28)] ${
                  tier.highlight
                    ? "border-slate-800 bg-slate-950"
                    : "border-slate-700 bg-slate-900"
                }`}
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(56,189,248,0.22),transparent_34%),radial-gradient(circle_at_92%_18%,rgba(45,212,191,0.16),transparent_30%)]" />
                <div className="pointer-events-none absolute inset-0 command-grid opacity-40" />
                <div className="relative p-6 sm:p-8 lg:p-9">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="rounded-full border border-teal-200/25 bg-teal-200/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-teal-100">
                        {tier.kicker}
                      </span>
                      <h3 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">
                        {tier.title}
                      </h3>
                      <p className="mt-2 text-base font-bold text-slate-300">
                        {tier.subtitle}
                      </p>
                    </div>
                  </div>

                  <p className="mt-5 text-sm font-semibold leading-relaxed text-slate-200">
                    {tier.description}
                  </p>

                  <div className="mt-7 space-y-3">
                    {tier.features.map((feature) => (
                      <div key={feature} className="flex gap-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" />
                        <span
                          className={`text-sm leading-relaxed ${
                            feature.startsWith("Everything") ||
                            feature.startsWith("All")
                              ? "font-bold text-slate-100"
                              : "font-semibold text-slate-200"
                          }`}
                        >
                          {feature}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-8">
                    <Magnetic strength={0.14}>
                      <a
                        href={siteConfig.calendlyLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex min-h-[3rem] w-full items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-black transition hover:-translate-y-0.5 ${
                          tier.highlight
                            ? "bg-white text-slate-950 hover:bg-sky-50"
                            : "border border-white/15 bg-white/[0.06] text-white hover:bg-white/10"
                        }`}
                      >
                        {tier.cta}
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </Magnetic>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
