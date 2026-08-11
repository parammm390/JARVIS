"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight,
  Boxes,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Command,
  Database,
  FileCheck2,
  Gauge,
  PackageCheck,
  Pause,
  Play,
  RefreshCcw,
  Route,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Waypoints,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type CSSProperties } from "react";

import { siteConfig } from "@/config/site";
import styles from "./MarketingLiveSystems.module.css";

type RouteName = "product" | "capabilities" | "how-it-works" | "pricing" | "faq";

function useCycle(length: number, duration = 1700) {
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || reducedMotion) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % length), duration);
    return () => window.clearInterval(timer);
  }, [duration, length, paused, reducedMotion]);

  return { active, setActive, paused, setPaused };
}

function LabHeading({ id, eyebrow, title, copy, dark = false }: { id: string; eyebrow: string; title: string; copy: string; dark?: boolean }) {
  return (
    <div className={styles.heading} data-dark={dark} data-reveal>
      <span>{eyebrow}</span><h2 id={id}>{title}</h2><p>{copy}</p>
    </div>
  );
}

const productSurfaces = [
  { name: "Customers", state: "Household resolved", detail: "Peterson history, WS-48 equipment and SMS preference attached.", icon: UsersRound },
  { name: "Work", state: "Blocked → Ready", detail: "W-2187 now has an owner, dependencies and a verified next state.", icon: Wrench },
  { name: "Schedule", state: "Thursday held", detail: "Marcus, route time and customer window agree at 10:30 AM.", icon: CalendarClock },
  { name: "Money", state: "Prepared · held", detail: "The remaining invoice is ready but remains behind owner authority.", icon: CircleDollarSign },
] as const;

function ProductLab() {
  const { active, setActive, paused, setPaused } = useCycle(productSurfaces.length, 1850);
  const surface = productSurfaces[active];
  const SurfaceIcon = surface.icon;

  return (
    <section className={`${styles.lab} ${styles.productLab}`} id="product-live" aria-labelledby="product-live-title">
      <LabHeading id="product-live-title" eyebrow="ONE WORK ROOT / FOUR SURFACES" title="The interface changes shape around the work." copy="Choose a surface and watch the same instruction resolve into the exact record, state and authority an operator needs next." dark />
      <div className={styles.productConsole} data-scale-reveal>
        <aside className={styles.productRail}>
          <div><Sparkles size={17} /><span>JARVIS</span></div>
          {productSurfaces.map((item, index) => {
            const Icon = item.icon;
            return <button type="button" key={item.name} aria-label={`${item.name} surface`} data-active={active === index} onClick={() => { setActive(index); setPaused(true); }}><Icon size={15} /><span>{item.name}</span><i /></button>;
          })}
        </aside>
        <div className={styles.productCommand}>
          <header><span>COMMAND / WRK-81A2</span><button type="button" onClick={() => setPaused((value) => !value)}>{paused ? <Play size={13} /> : <Pause size={13} />}{paused ? "Resume" : "Live"}</button></header>
          <div className={styles.instruction}><Command size={16} /><p>Restore Peterson to a Thursday-ready state. Keep contact and money behind approval.</p></div>
          <div className={styles.signal}><i style={{ width: `${((active + 1) / productSurfaces.length) * 100}%` }} /><b /></div>
          <AnimatePresence mode="wait">
            <motion.div className={styles.productAnswer} key={surface.name} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <span><SurfaceIcon size={17} />{surface.name} surface</span><strong>{surface.state}</strong><p>{surface.detail}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <aside className={styles.productReceipt}>
          <header><FileCheck2 size={15} /><span>STATE RECEIPT</span></header>
          <div><span>Work root</span><b>WRK-81A2</b></div><div><span>Authority</span><b>{active === 3 ? "owner hold" : "policy valid"}</b></div><div><span>Evidence</span><b>{active + 3} records</b></div>
          <footer><i />Same causal chain</footer>
        </aside>
      </div>
    </section>
  );
}

const capabilitySignals = [
  { title: "Ground", detail: "Resolve exact records", output: "7 sources cited", icon: Database },
  { title: "Plan", detail: "Order dependencies", output: "5 bounded actions", icon: Route },
  { title: "Authority", detail: "Separate allowed and held", output: "2 owner decisions", icon: ShieldCheck },
  { title: "Execute", detail: "Activate typed contracts", output: "3 systems changed", icon: Zap },
  { title: "Recover", detail: "Preserve causality", output: "safe route ready", icon: RefreshCcw },
  { title: "Prove", detail: "Reconcile actual state", output: "receipt attached", icon: FileCheck2 },
] as const;

function CapabilitiesLab() {
  const { active, setActive, paused, setPaused } = useCycle(capabilitySignals.length, 1550);
  const current = capabilitySignals[active];

  return (
    <section className={`${styles.lab} ${styles.capabilitiesLab}`} id="capabilities-live" aria-labelledby="capabilities-live-title">
      <LabHeading id="capabilities-live-title" eyebrow="CAPABILITY NETWORK / SIGNAL LIVE" title="No capability operates alone." copy="The work root passes through six control functions. Select any node to inspect what it receives and what it must prove before the next can move." />
      <div className={styles.network} data-scale-reveal>
        <div className={styles.networkGrid} aria-hidden="true" />
        <div className={styles.workRoot}><Waypoints size={26} /><strong>WRK-81A2</strong><span>Peterson installation</span><i /></div>
        <div className={styles.nodes}>
          {capabilitySignals.map((item, index) => {
            const Icon = item.icon;
            return <button type="button" key={item.title} data-active={index <= active} data-current={index === active} onClick={() => { setActive(index); setPaused(true); }}><span><Icon size={16} /></span><b>{item.title}</b><small>{item.detail}</small></button>;
          })}
        </div>
        <aside className={styles.networkOutput} aria-live="polite">
          <header><span>CAPABILITY OUTPUT</span><button type="button" aria-label={paused ? "Resume capability network" : "Pause capability network"} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={13} /> : <Pause size={13} />}</button></header>
          <AnimatePresence mode="wait"><motion.div key={current.title} initial={{ opacity: 0, x: 15 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}><span>{current.title}</span><strong>{current.output}</strong><p>{current.detail} while instruction and authority remain attached.</p></motion.div></AnimatePresence>
          <footer>{capabilitySignals.map((item, index) => <i key={item.title} data-active={index <= active} />)}</footer>
        </aside>
      </div>
    </section>
  );
}

const executionEvents = [
  ["Instruction fixed", "Objective captured before action", "08:42:03"],
  ["Context grounded", "Seven source records resolved", "08:42:04"],
  ["Plan compiled", "Five dependencies locked", "08:42:05"],
  ["Authority checked", "Two actions held for owner", "08:42:06"],
  ["Execution acknowledged", "Three allowed changes observed", "08:42:09"],
  ["Provider timeout", "Delivery moved to recovery", "08:42:11"],
  ["Alternate route verified", "Actual customer state reconciled", "08:42:16"],
] as const;

function HowLab() {
  const { active, setActive, paused, setPaused } = useCycle(executionEvents.length, 1250);
  const event = executionEvents[active];
  return (
    <section className={`${styles.lab} ${styles.howLab}`} id="how-live" aria-labelledby="how-live-title">
      <LabHeading id="how-live-title" eyebrow="EXECUTION TELEMETRY / FORWARD ONLY" title="See every state transition—not just the happy path." copy="This live trace includes the failure, recovery and reconciliation events that ordinary workflow diagrams erase." dark />
      <div className={styles.telemetry} data-scale-reveal>
        <header><span><Gauge size={14} />TRACE WRK-81A2</span><button type="button" onClick={() => setPaused((value) => !value)}>{paused ? <Play size={13} /> : <Pause size={13} />}{paused ? "Resume" : "Trace live"}</button></header>
        <div className={styles.telemetryBody}>
          <div className={styles.eventList}>{executionEvents.map((item, index) => <button type="button" key={item[0]} data-active={index <= active} data-current={index === active} onClick={() => { setActive(index); setPaused(true); }}><span>{item[2]}</span><i /><p><b>{item[0]}</b><small>{item[1]}</small></p></button>)}</div>
          <div className={styles.telemetryStage} data-fault={active === 5}>
            <div className={styles.orbit} aria-hidden="true"><i /><i /><i /><b /></div>
            <AnimatePresence mode="wait"><motion.div key={event[0]} initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.03 }}>{active === 5 ? <RefreshCcw size={25} /> : active === 6 ? <CheckCircle2 size={25} /> : <Zap size={25} />}<span>{active === 5 ? "RECOVERY OPEN" : active === 6 ? "CHAIN CLOSED" : "TRACE ADVANCING"}</span><strong>{event[0]}</strong><p>{event[1]}</p></motion.div></AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

const scopeItems = [
  { key: "crm", label: "Customer / CRM", group: "Operating surfaces", icon: UsersRound },
  { key: "quotes", label: "Quotes & proposals", group: "Operating surfaces", icon: FileCheck2 },
  { key: "schedule", label: "Scheduling & dispatch", group: "Operating surfaces", icon: CalendarClock },
  { key: "work", label: "Work & field service", group: "Operating surfaces", icon: Wrench },
  { key: "inventory", label: "Inventory", group: "Operating surfaces", icon: PackageCheck },
  { key: "money", label: "Invoices & collections", group: "Operating surfaces", icon: CircleDollarSign },
  { key: "authority", label: "Agents, policy & approval", group: "Control layer", icon: ShieldCheck },
  { key: "recovery", label: "Recovery & evidence", group: "Control layer", icon: RefreshCcw },
  { key: "onboarding", label: "Onboarding & integrations", group: "Deployment", icon: Boxes },
] as const;

function PricingLab() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(scopeItems.map((item) => item.key)));
  const groups = new Set(scopeItems.filter((item) => selected.has(item.key)).map((item) => item.group)).size;
  const toggle = (key: string) => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  return (
    <section className={`${styles.lab} ${styles.pricingLab}`} id="pricing-live" aria-labelledby="pricing-live-title">
      <LabHeading id="pricing-live-title" eyebrow="LIVE SCOPE COMPOSER / NO SEAT MATH" title="Shape the deployment around the operation." copy="Toggle the boundaries that belong in the first deployment. The output is a defensible scope for a conversation—not a pretend shelf price." dark />
      <div className={styles.scopeComposer} data-scale-reveal>
        <div className={styles.scopeOptions}><header><span>DEPLOYMENT BOUNDARY</span><b>{selected.size} included</b></header><div>{scopeItems.map((item) => { const Icon = item.icon; const checked = selected.has(item.key); return <button type="button" key={item.key} data-selected={checked} onClick={() => toggle(item.key)} aria-pressed={checked}><span><Icon size={15} /></span><p><b>{item.label}</b><small>{item.group}</small></p><i>{checked ? <Check size={13} /> : null}</i></button>; })}</div></div>
        <aside className={styles.scopeOutput} aria-live="polite"><header><span>SCOPED OUTCOME</span><b><i />READY FOR REVIEW</b></header><div className={styles.scopeDial} style={{ "--scope-progress": `${Math.max(8, (selected.size / scopeItems.length) * 100)}%` } as CSSProperties}><strong>{selected.size}</strong><span>boundaries</span></div><div className={styles.scopeSummary}><div><span>Coverage</span><b>{groups} operating layers</b></div><div><span>Commercial model</span><b>Contact for pricing</b></div><div><span>Next step</span><b>Operating review</b></div></div><a href={`mailto:${siteConfig.contactEmail}?subject=FINNOR deployment scope`}><span>Bring this scope to FINNOR</span><ArrowUpRight size={15} /></a></aside>
      </div>
    </section>
  );
}

const faqScenarios = [
  { question: "A connected system times out", result: "Recovery opens", detail: "FINNOR records uncertainty, preserves the idempotency key and offers retry, escalation or reconciliation without inventing success.", icon: RefreshCcw, states: ["Acknowledgement unknown", "Trace preserved", "Recovery selectable"] },
  { question: "An action crosses policy", result: "Authority holds", detail: "Allowed preparation can continue, but the consequential action pauses with its exact consequence and policy version visible.", icon: ShieldCheck, states: ["Risk classified", "Policy v12 applied", "Owner decision required"] },
  { question: "Two source records disagree", result: "Context stays unresolved", detail: "The planner surfaces the contradiction and withholds the dependent action instead of filling the gap with confident prose.", icon: Database, states: ["Conflict cited", "Dependent step blocked", "Operator context requested"] },
  { question: "The tool says success", result: "Evidence verifies", detail: "A tool acknowledgement is intermediate. FINNOR closes only after the source system shows the expected operating state.", icon: FileCheck2, states: ["Expected state fixed", "Actual state queried", "Receipt closes on agreement"] },
] as const;

function FaqLab() {
  const [active, setActive] = useState(0);
  const scenario = faqScenarios[active];
  const ScenarioIcon = scenario.icon;
  return (
    <section className={`${styles.lab} ${styles.faqLab}`} id="faq-live" aria-labelledby="faq-live-title">
      <LabHeading id="faq-live-title" eyebrow="ASK THE FAILURE PATH" title="Choose the uncomfortable question." copy="The useful answer is a visible product state. Select a real operating failure and inspect how FINNOR contains it." dark />
      <div className={styles.explorer} data-scale-reveal>
        <div className={styles.scenarios}><span>WHAT HAPPENS WHEN…</span>{faqScenarios.map((item, index) => <button type="button" key={item.question} data-active={active === index} onClick={() => setActive(index)}><span>{item.question}</span><i>{String(index + 1).padStart(2, "0")}</i></button>)}</div>
        <div className={styles.scenarioResult}><div className={styles.beacon}><ScenarioIcon size={23} /><i /></div><AnimatePresence mode="wait"><motion.div key={scenario.result} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}><span>FINNOR RESPONSE</span><strong>{scenario.result}</strong><p>{scenario.detail}</p><ul>{scenario.states.map((state) => <li key={state}><Check size={13} />{state}</li>)}</ul></motion.div></AnimatePresence></div>
      </div>
    </section>
  );
}

const modules: Record<RouteName, ComponentType> = { product: ProductLab, capabilities: CapabilitiesLab, "how-it-works": HowLab, pricing: PricingLab, faq: FaqLab };

export default function MarketingLiveSystem({ route }: { route: RouteName }) {
  const Module = modules[route];
  return <Module />;
}
