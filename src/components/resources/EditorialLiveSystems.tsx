"use client";

import { useGSAP } from "@gsap/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowUpRight,
  BookOpenText,
  Calculator,
  Check,
  ClipboardCheck,
  Database,
  FileCheck2,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "./EditorialLiveSystems.module.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function EditorialMotion() {
  useGSAP(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.utils.toArray<HTMLElement>("[data-editorial-reveal]").forEach((element) => {
      gsap.fromTo(element, { opacity: 0, y: 38 }, { opacity: 1, y: 0, duration: .9, ease: "power3.out", scrollTrigger: { trigger: element, start: "top 88%", once: true } });
    });
    gsap.utils.toArray<HTMLElement>("[data-editorial-stack]").forEach((element, index) => {
      gsap.fromTo(element, { opacity: .4, y: 28 + index * 4, scale: .98 }, { opacity: 1, y: 0, scale: 1, ease: "none", scrollTrigger: { trigger: element, start: "top 92%", end: "top 62%", scrub: .7 } });
    });
  }, []);
  return null;
}

const resourceSignals = [
  { title: "Operating glossary", detail: "Understand work roots, action contracts and decision receipts.", proof: "18 product terms", href: "/resources/dispatch-ai-glossary", icon: BookOpenText },
  { title: "Deployment checklist", detail: "Make authority, recovery and source truth explicit before activation.", proof: "12 boundary decisions", href: "/resources/pilot-setup-checklist", icon: ClipboardCheck },
  { title: "Operational drag", detail: "Model the cost of work that waits between disconnected systems.", proof: "live estimator", href: "/resources/missed-call-cost-calculator", icon: Calculator },
  { title: "Trust model", detail: "Inspect how grounding, policy, recovery and evidence stay together.", proof: "8 control layers", href: "/trust-safety", icon: ShieldCheck },
] as const;

export function ResourcesLiveLibrary() {
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || reducedMotion) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % resourceSignals.length), 1900);
    return () => window.clearInterval(timer);
  }, [paused, reducedMotion]);

  const resource = resourceSignals[active];
  const Icon = resource.icon;

  return (
    <section className={`${styles.liveSection} ${styles.librarySection}`} id="resources-live" aria-labelledby="resource-library-live-title" data-editorial-reveal>
      <div className={styles.liveHeading}><span>FIELD LIBRARY / SIGNAL INDEX</span><h2 id="resource-library-live-title">Follow the question until it reaches the product.</h2><p>Each resource is connected to the same operating trace. Select a question to see the control surface it helps an operator inspect.</p></div>
      <div className={styles.libraryConsole}>
        <div className={styles.resourcePicker}>
          {resourceSignals.map((item, index) => <button type="button" key={item.title} data-active={active === index} onClick={() => { setActive(index); setPaused(true); }}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.title}</strong><i /></button>)}
        </div>
        <div className={styles.librarySignal} aria-hidden="true"><i /><i /><i /><b data-active={active} /></div>
        <div className={styles.resourceOutput} aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div key={resource.title} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -9 }}>
              <Icon size={25} /><span>RESOURCE OUTPUT</span><strong>{resource.title}</strong><p>{resource.detail}</p><b><i />{resource.proof}</b><Link href={resource.href}>Open field note <ArrowUpRight size={14} /></Link>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

const trustScenarios = [
  { action: "Reserve Thursday capacity", verdict: "Allowed", detail: "Skill, route and availability agree. The scheduling contract is inside tenant policy.", accent: "green", states: ["Context grounded", "Risk low", "Contract may run"], icon: Check },
  { action: "Send customer reschedule", verdict: "Held for owner", detail: "The message changes a customer commitment. Its exact consequence is shown before scoped approval.", accent: "amber", states: ["Message prepared", "Policy v12 applied", "Confirmation required"], icon: ShieldCheck },
  { action: "Create remaining invoice", verdict: "Held for owner", detail: "Financial work remains downstream of completion and explicit authority, even when the amount is already known.", accent: "violet", states: ["Balance resolved", "Work state checked", "Confirmation required"], icon: FileCheck2 },
  { action: "Accept provider acknowledgement", verdict: "Recovery open", detail: "An uncertain response is not success. The run keeps its identity while retry, escalation or reconciliation proceeds.", accent: "blue", states: ["Outcome unknown", "Idempotency preserved", "Safe paths available"], icon: RefreshCcw },
] as const;

export function TrustControlLab() {
  const [active, setActive] = useState(1);
  const scenario = trustScenarios[active];
  const Icon = scenario.icon;

  return (
    <section className={`${styles.liveSection} ${styles.trustSection}`} id="trust-live" aria-labelledby="trust-control-live-title" data-editorial-reveal>
      <div className={styles.liveHeading} data-dark="true"><span>POLICY RUNTIME / INTERACTIVE</span><h2 id="trust-control-live-title">Put the boundary under pressure.</h2><p>Select a proposed action. FINNOR exposes the records, policy decision and next safe state instead of hiding risk behind a generic confirmation dialog.</p></div>
      <div className={styles.trustConsole}>
        <div className={styles.actionPicker}><span>PROPOSED ACTION</span>{trustScenarios.map((item, index) => <button type="button" key={item.action} data-active={active === index} onClick={() => setActive(index)}><span>{item.action}</span><i>{String(index + 1).padStart(2, "0")}</i></button>)}</div>
        <div className={styles.policyCore} data-accent={scenario.accent}>
          <div className={styles.policyRings} aria-hidden="true"><i /><i /><i /></div>
          <AnimatePresence mode="wait"><motion.div key={scenario.action} initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.03 }}><Icon size={27} /><span>POLICY v12</span><strong>{scenario.verdict}</strong><p>{scenario.detail}</p></motion.div></AnimatePresence>
        </div>
        <aside className={styles.policyEvidence}><header><Database size={14} /><span>DECISION EVIDENCE</span></header><ul>{scenario.states.map((state) => <li key={state}><Check size={13} />{state}</li>)}</ul><footer><i />Receipt remains attached</footer></aside>
      </div>
    </section>
  );
}
