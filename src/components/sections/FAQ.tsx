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
    question: "Does Finnor replace my dispatcher?",
    answer: "No. Finnor helps recover missed, overflow, after-hours, and slow web leads, then routes the booked next step or urgent issue to your human team.",
  },
  {
    question: "Is this only for after-hours?",
    answer: "No. Finnor can cover missed calls, overflow, after-hours calls, quote forms, inbound website requests, and paid lead follow-up during the windows you choose.",
  },
  {
    question: "Does outbound mean cold calling?",
    answer: "No. Outbound means speed-to-lead follow-up for inbound website forms, Google/Facebook leads, quote requests, paid leads, and old inquiries. It is not cold calling.",
  },
  {
    question: "Can it handle urgent well pump calls?",
    answer: "Yes, within approved escalation paths. Finnor can identify no-water or urgent pump language and route it to your configured owner, dispatcher, or on-call contact.",
  },
  {
    question: "Does Finnor quote jobs or promise arrival times?",
    answer: "No. Finnor does not quote jobs, guarantee ETAs, diagnose repairs, or make service promises. Your team controls those decisions.",
  },
  {
    question: "What is the founding pilot?",
    answer: "It is a scoped launch for one booking and lead recovery workflow: missed calls, after-hours, overflow, web/form leads, or urgent well pump routing. Pricing is reviewed on the pilot call.",
  },
  {
    question: "What are the guarantees?",
    answer: "If an eligible call reaches Finnor and we miss it, your next month is free. If we do not launch your scoped workflow within 7 days after receiving required access, we refund your initial payment.",
  },
  {
    question: "What does Finnor avoid?",
    answer: "Finnor does not diagnose repairs, quote jobs, guarantee ETAs, replace dispatch judgment, or make final customer promises. Humans stay in control.",
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
            Direct answers for water businesses.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
            className="mx-auto mt-5 max-w-2xl text-lg font-medium leading-relaxed text-slate-600"
          >
            Scope, booking boundaries, urgent routing, and usage limits are made explicit before
            the system goes live.
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
