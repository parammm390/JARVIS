"use client"

import { useEffect, useState } from "react"
import { CalendarDays, Play } from "lucide-react"
import { siteConfig } from "@/config/site"

const navItems = [
  { href: "/resources", label: "Resources" },
  { href: "/trust-safety", label: "Trust" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
]

export function ResourceNav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <nav
      className={`fixed left-0 right-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-slate-900/10 bg-white/88 shadow-[0_12px_42px_rgba(15,38,62,0.08)] backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="container flex h-20 items-center justify-between px-4 md:px-6">
        <a href="/" className="flex items-center gap-3 text-xl font-black tracking-tight text-slate-950">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white shadow-lg">
            F
          </span>
          {siteConfig.name}
        </a>
        <div className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-xs font-black uppercase tracking-[0.18em] text-slate-600 transition hover:text-slate-950"
            >
              {item.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={siteConfig.demoLink}
            className="cta-secondary hidden h-11 items-center justify-center gap-2 rounded-full border border-slate-900/12 bg-white px-4 text-xs font-black text-slate-800 transition hover:-translate-y-0.5 hover:border-slate-900/22 md:inline-flex"
          >
            <Play className="h-3.5 w-3.5" />
            Build Your Company Demo
          </a>
          <a
            href={siteConfig.calendlyLink}
            target="_blank"
            rel="noopener noreferrer"
            className="cta-primary inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-slate-950 px-3 text-[10px] font-black text-white transition hover:-translate-y-0.5 hover:bg-slate-800 sm:px-5 sm:text-xs"
          >
            <CalendarDays className="hidden h-3.5 w-3.5 sm:block" />
            <span className="sm:hidden">Apply</span>
            <span className="hidden sm:inline">Apply for Founding Pilot</span>
          </a>
        </div>
      </div>
    </nav>
  )
}
