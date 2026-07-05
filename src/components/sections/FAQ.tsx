"use client"

import { motion } from "framer-motion"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { HelpCircle } from "lucide-react"

const faqs = [
  {
    question: "It actually quotes? On the call?",
    answer:
      "Yes. FINNOR pulls the real public water record for the caller's area (USGS well samples, EPA system data), runs the sizing math against household size, and quotes a range from your pricing tier, like $3,800 to $4,250 installed. It never invents a number. The final on-site figure stays with your team, and the demo shows the whole calculation line by line.",
  },
  {
    question: "What is a household memory record?",
    answer:
      "Every lead becomes one: the call, the water profile, the sizing math, the quote, the booked visit, the documented job, the review, the salt cadence, the referral it produced, and the next offer that actually makes sense. Every record carries a computed next revenue action, and every action is tracked to lifetime value. Nothing else in this market carries one memory across all of it.",
  },
  {
    question: "Where does the water data come from?",
    answer:
      "Public records, pulled live: measured well samples within 25 miles from USGS, plus your local system and its violation history from EPA SDWIS. Thin coverage falls back to state groundwater records and is labeled as an estimate. Unknowns stay marked, always.",
  },
  {
    question: "Does FINNOR replace my dispatcher or my sales team?",
    answer:
      "No. FINNOR captures the lead, quotes the range, books the visit, and keeps the relationship warm for years. Repairs, diagnosis, ETAs, and the final handshake stay with your people. It does the remembering, so they can do the closing.",
  },
  {
    question: "Can it handle urgent well pump calls?",
    answer:
      "Yes, within approved escalation paths. No-water and urgent pump language routes straight to your configured on-call contact with a structured handoff: scope, since when, people affected, safety screen, callback.",
  },
  {
    question: "Does outbound mean cold calling?",
    answer:
      "No. Outbound means speed-to-lead on inquiries you already earned: website forms, Google and Facebook leads, quote requests, plus the quarterly check-ins, review asks, and re-test reminders your household records fire on schedule.",
  },
  {
    question: "What are the guarantees?",
    answer:
      "If an eligible call reaches FINNOR and we miss it, your next month is free. If we do not launch your scoped workflow within 7 days of receiving required access, we refund your initial payment.",
  },
  {
    question: "Who is this NOT for?",
    answer:
      "If you are a one-truck shop that answers every call yourself and nothing you sell tops $1,500, keep your money. FINNOR earns it when calls die in voicemail while your crew is under a house, when quotes still come off a rate sheet instead of the water, and when customers vanish the day the invoice is paid.",
  },
]

export function FAQ() {
  return (
    <section id="faq" className="healthcare-section relative overflow-hidden py-20 md:py-28">
      <div className="pointer-events-none absolute right-[8%] top-0 h-[34rem] w-[34rem] rounded-full bg-teal-100/45 blur-[130px]" />
      <div className="container relative z-10 max-w-4xl px-4 md:px-6">
        <div className="mb-12 text-center md:mb-14">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-5 inline-flex items-center rounded-full border border-slate-200 bg-white/72 px-4 py-1.5 text-xs font-black uppercase tracking-[0.22em] text-slate-500 shadow-sm backdrop-blur"
          >
            <HelpCircle className="mr-2 h-3.5 w-3.5 text-teal-600" />
            FAQ
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="text-4xl font-black tracking-tight text-slate-950 md:text-5xl"
          >
            Direct answers. No hedging.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
            className="mx-auto mt-5 max-w-2xl text-lg font-medium leading-relaxed text-slate-600"
          >
            What the quoting agent does, where the water data comes from, what stays human, and
            exactly who should not buy this.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
          className="ops-card rounded-[1.6rem] bg-white/86 p-3 shadow-[0_28px_80px_rgba(15,23,42,0.08)] md:p-4"
        >
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={faq.question}
                value={`item-${index}`}
                className="group relative mb-2 overflow-hidden rounded-[1.15rem] border border-slate-200 bg-white px-4 transition-all duration-300 data-[state=open]:border-sky-200 data-[state=open]:bg-sky-50/45"
                data-cursor="hover"
              >
                <AccordionTrigger className="py-5 text-left text-base font-black text-slate-900 transition-colors hover:text-sky-800 hover:no-underline data-[state=open]:text-sky-900 md:text-lg">
                  <span className="flex flex-1 items-start gap-4">
                    <span className="pt-1 text-xs font-black tracking-widest text-slate-500 transition-colors group-hover:text-teal-700">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{faq.question}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-5 pl-10 text-sm font-semibold leading-relaxed text-slate-600 md:text-base">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  )
}
