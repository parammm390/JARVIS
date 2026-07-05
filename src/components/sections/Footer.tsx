"use client"

import { motion } from "framer-motion"
import { siteConfig } from "@/config/site"

const footerLinks = [
  { href: "/demo", label: "Live Call Demo" },
  { href: "/dashboard-demo", label: "Dashboard Demo" },
  { href: "/#problem", label: "Problem" },
  { href: "/#workflow", label: "Workflow" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: siteConfig.calendlyLink, label: "Apply for Founding Pilot" },
]

export function Footer() {
  return (
    <footer className="relative z-20 overflow-hidden border-t border-slate-200 bg-[#f3eee3] py-14">
      <div className="pointer-events-none absolute inset-x-0 -bottom-16 flex select-none items-center justify-center">
        <span className="text-[18vw] font-black leading-none tracking-tight text-slate-900/[0.035]">
          FINNOR
        </span>
      </div>

      <div className="container relative z-10 mx-auto px-4 md:px-6">
        <div className="flex flex-col justify-between gap-10 pb-10 md:flex-row md:items-start">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-md"
          >
            <span className="text-3xl font-black tracking-tight text-slate-950">{siteConfig.name}</span>
            <p className="mt-3 text-base font-medium leading-relaxed text-slate-600">
              AI booking and lead recovery for water treatment leads, well pump service calls,
              after-hours inquiries, and slow web leads.
            </p>
            <p className="mt-5 text-sm font-bold text-slate-600">
              Founder contact:{" "}
              <a className="text-slate-950 underline decoration-slate-300 underline-offset-4" href={`mailto:${siteConfig.contactEmail}`}>
                {siteConfig.contactEmail}
              </a>
            </p>
          </motion.div>

          <motion.nav
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
            className="flex max-w-xl flex-wrap gap-x-7 gap-y-4 text-sm font-black uppercase tracking-[0.18em] text-slate-500"
          >
            {footerLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                className="transition hover:text-slate-950"
              >
                {link.label}
              </a>
            ))}
            <a
              href={siteConfig.links.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-slate-950"
            >
              LinkedIn
            </a>
          </motion.nav>
        </div>

        <div className="flex flex-col justify-between gap-5 border-t border-slate-200 pt-7 text-sm font-medium text-slate-500 md:flex-row md:items-center">
          <p>{new Date().getFullYear()} {siteConfig.name} Systems. All rights reserved.</p>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <span>Booked next steps, urgent routes, SMS/email alerts, and scoped CRM/webhook workflows.</span>
            <a href="/privacy" className="transition hover:text-slate-950">
              Privacy
            </a>
            <a href="/terms" className="transition hover:text-slate-950">
              Terms
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
