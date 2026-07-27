"use client";

import { motion } from "framer-motion";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { HelpCircle } from "lucide-react";

const faqs = [
  {
    question: "What is JARVIS?",
    answer:
      "JARVIS is a voice-native AI operations platform for water-treatment companies. It plans and executes business workflows across connected systems.",
  },
  {
    question: "Is this another answering service?",
    answer:
      "No. Calling is one capability. JARVIS also works across CRM, scheduling, proposals, invoices, payments, inventory, technicians, campaigns and operational intelligence.",
  },
  {
    question: "Does JARVIS replace Jobber, ServiceTitan or our CRM?",
    answer:
      "No. JARVIS can work above existing systems as the command and execution layer. The final integration scope depends on the systems you use.",
  },
  {
    question: "Can JARVIS make outbound calls and run campaigns?",
    answer:
      "Yes, when the required calling or messaging provider is connected. Campaign limits, calling windows, permissions and compliance rules are configured before launch.",
  },
  {
    question: "Is JARVIS fully autonomous?",
    answer:
      "JARVIS uses bounded autonomy. Approved low-risk actions can run automatically. Higher-risk actions wait for the authorised person.",
  },
  {
    question: "What happens when an integration fails?",
    answer:
      "JARVIS records the failure, retries when safe, verifies the final state and escalates anything unresolved instead of silently reporting success.",
  },
  {
    question: "What can we control by voice?",
    answer:
      "Customers, calls, follow-ups, appointments, schedules, proposals, invoices, payments, campaigns, inventory, technicians, reports and supported connected workflows.",
  },
  {
    question: "How is pricing determined?",
    answer:
      "Pricing depends on locations, usage, integrations and workflow complexity. Contact us for a deployment scope and price.",
  },
  {
    question: "Who is JARVIS for?",
    answer:
      "Established water-treatment companies that have multiple employees, meaningful operational volume and disconnected business workflows.",
  },
  {
    question: "Can it support multiple locations?",
    answer:
      "Yes. Location-specific permissions, workflows, reporting, lead sources and operating rules can be scoped during deployment.",
  },
];

export function FAQ() {
  return (
    <section
      id="faq"
      className="healthcare-section relative overflow-hidden py-20 md:py-28"
    >
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
            What JARVIS actually does, where the water data comes from, what
            stays human, and exactly who should not buy this.
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
  );
}
