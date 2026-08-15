"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight,
  Boxes,
  BrainCircuit,
  Building2,
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
  Radio,
  RefreshCcw,
  Route,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Waypoints,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";

import { siteConfig } from "@/config/site";
import {
  advancedIntelligenceNote,
  intelligencePolicies,
  interactionModes,
  operatingAreas,
  type IntelligencePolicy,
  type InteractionMode,
} from "@/content/commercial-truth";
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
      <LabHeading id="product-live-title" eyebrow="JARVIS / COMMAND AND WORK SURFACE" title="One operating layer, presented for the work at hand." copy="This representative chain shows four JARVIS views. A company deployment can include the broader FINNOR operating scope described on this page." dark />
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

const coverageIcons = [UsersRound, Wrench, CalendarClock, PackageCheck, FileCheck2, Command, CircleDollarSign, Sparkles, Waypoints] as const;

type ScopeChoice = {
  label: string;
  detail: string;
  uplift: readonly [number, number];
};

const scopeLevers = {
  workflows: {
    label: "Workflow boundary",
    icon: Route,
    choices: {
      core: { label: "1 core workflow", detail: "One certified operating chain", uplift: [0, 0] },
      connected: { label: "Several connected workflows", detail: "Shared state and handoffs", uplift: [8, 14] },
      portfolio: { label: "Company-wide workflow portfolio", detail: "Multiple teams and dependencies", uplift: [18, 30] },
    },
  },
  integrations: {
    label: "Systems and sources",
    icon: Database,
    choices: {
      standard: { label: "1–2 source systems", detail: "Focused source mapping", uplift: [0, 0] },
      connected: { label: "3–5 connected systems", detail: "More adapters and reconciliation", uplift: [6, 11] },
      estate: { label: "6+ or complex system estate", detail: "Broader integration engineering", uplift: [14, 24] },
    },
  },
  locations: {
    label: "Operating entities",
    icon: Building2,
    choices: {
      one: { label: "One location / entity", detail: "One operating boundary", uplift: [0, 0] },
      multi: { label: "Several locations", detail: "Location-specific roles and rules", uplift: [5, 9] },
      group: { label: "Multi-entity group", detail: "Shared and separate operating policy", uplift: [10, 17] },
    },
  },
  authority: {
    label: "Approval and authority",
    icon: ShieldCheck,
    choices: {
      standard: { label: "Standard owner approvals", detail: "Clear prepare / approve boundary", uplift: [0, 0] },
      layered: { label: "Layered role approvals", detail: "Several roles or risk tiers", uplift: [4, 8] },
      complex: { label: "Complex policy requirements", detail: "Detailed limits and escalations", uplift: [8, 14] },
    },
  },
  agents: {
    label: "Agent channels",
    icon: Radio,
    choices: {
      none: { label: "No separate agent channels", detail: "JARVIS and system channels only", uplift: [0, 0] },
      one: { label: "One bounded agent channel", detail: "One role, channel and escalation path", uplift: [5, 9] },
      multi: { label: "Multiple agent channels", detail: "Several roles, tools and channels", uplift: [11, 18] },
    },
  },
  workspace: {
    label: "Workspace engineering",
    icon: Boxes,
    choices: {
      configured: { label: "Configured FINNOR workspace", detail: "Adaptive workspaces for included scope", uplift: [0, 0] },
      custom: { label: "Custom workflow / UI design", detail: "Company-specific interaction design", uplift: [9, 16] },
      multi: { label: "Multiple custom role surfaces", detail: "Distinct tools for several teams", uplift: [16, 28] },
    },
  },
  support: {
    label: "Reliability and support",
    icon: RefreshCcw,
    choices: {
      standard: { label: "Production activation support", detail: "Recovery testing and launch support", uplift: [0, 0] },
      assured: { label: "Enhanced operating assurance", detail: "Tighter support and reliability needs", uplift: [6, 10] },
      critical: { label: "Business-critical coverage", detail: "Stronger response and resilience scope", uplift: [12, 20] },
    },
  },
} as const;

type LeverKey = keyof typeof scopeLevers;
type LeverSelection = { [K in LeverKey]: keyof (typeof scopeLevers)[K]["choices"] };

const initialLeverSelection: LeverSelection = {
  workflows: "core",
  integrations: "standard",
  locations: "one",
  authority: "standard",
  agents: "none",
  workspace: "configured",
  support: "standard",
};

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US")}`;
}

function PricingLab() {
  const [interaction, setInteraction] = useState<InteractionMode>("text");
  const [intelligence, setIntelligence] = useState<IntelligencePolicy>("balanced");
  const [coverage, setCoverage] = useState<Set<string>>(() => new Set(operatingAreas.slice(0, 6).map((item) => item.name)));
  const [levers, setLevers] = useState<LeverSelection>(initialLeverSelection);

  const estimate = useMemo(() => {
    let low = 30;
    let high = 38;
    if (interaction === "voice") { low += 6; high += 10; }
    if (intelligence === "frontier") { low += 5; high += 10; }
    if (intelligence === "efficient") high -= 2;
    const additionalAreas = Math.max(0, coverage.size - 4);
    low += additionalAreas * 2;
    high += additionalAreas * 3;
    (Object.keys(scopeLevers) as LeverKey[]).forEach((key) => {
      const choice = scopeLevers[key].choices[levers[key] as never] as ScopeChoice;
      low += choice.uplift[0];
      high += choice.uplift[1];
    });
    return { low: low * 1000, high: high * 1000 };
  }, [coverage.size, intelligence, interaction, levers]);

  const includedAreas = operatingAreas.filter((item) => coverage.has(item.name));
  const excludedAreas = operatingAreas.filter((item) => !coverage.has(item.name));
  const band = estimate.high <= 50_000 ? "Focused production" : estimate.high <= 75_000 ? "Connected operations" : "Extended deployment";
  const selectedIntelligence = intelligencePolicies.find((policy) => policy.key === intelligence) ?? intelligencePolicies[1];
  const selectedInteraction = interactionModes.find((mode) => mode.key === interaction) ?? interactionModes[0];
  const scopeSummary = `${selectedInteraction.name}; ${selectedIntelligence.name} intelligence; ${includedAreas.map((item) => item.name).join(", ")}; indicative implementation ${formatUsd(estimate.low)}–${formatUsd(estimate.high)}.`;
  const mailHref = `mailto:${siteConfig.contactEmail}?subject=${encodeURIComponent("FINNOR deployment scope")}&body=${encodeURIComponent(`I would like to review this indicative FINNOR scope:\n\n${scopeSummary}\n\nThis is an indicative planning range, not a quote.`)}`;

  const toggleCoverage = (name: string) => setCoverage((current) => {
    const next = new Set(current);
    if (next.has(name)) {
      if (next.size > 1) next.delete(name);
    } else {
      next.add(name);
    }
    return next;
  });

  const updateLever = (key: LeverKey, value: string) => {
    setLevers((current) => ({ ...current, [key]: value } as LeverSelection));
  };

  return (
    <section className={`${styles.lab} ${styles.pricingLab}`} id="pricing-live" aria-labelledby="pricing-live-title">
      <LabHeading id="pricing-live-title" eyebrow="DEPLOYMENT CONFIGURATOR / PRODUCTION FROM $30,000" title="Shape the boundary. See what moves the quote." copy="Choose the interaction, intelligence and operational scope the company actually needs. The range is directional; the operating review turns it into a deployment quote." dark />
      <div className={styles.deploymentComposer} data-scale-reveal>
        <div className={styles.composerMain}>
          <section className={styles.composerSection} aria-labelledby="interaction-heading">
            <header><span>01</span><div><h3 id="interaction-heading">How should the team interact?</h3><p>Voice is an added operating channel, not a different product.</p></div></header>
            <div className={styles.choiceCards}>
              {interactionModes.map((mode) => <button type="button" key={mode.key} data-selected={interaction === mode.key} onClick={() => setInteraction(mode.key)} aria-pressed={interaction === mode.key}><span>{mode.key === "voice" ? <Radio size={17} /> : <Command size={17} />}</span><strong>{mode.name}</strong><p>{mode.summary}</p><small>{mode.scopeEffect}</small></button>)}
            </div>
          </section>

          <section className={styles.composerSection} aria-labelledby="intelligence-heading">
            <header><span>02</span><div><h3 id="intelligence-heading">How much reasoning should the work use?</h3><p>Choose a policy in business language. FINNOR handles task-level routing behind it.</p></div></header>
            <div className={`${styles.choiceCards} ${styles.intelligenceCards}`}>
              {intelligencePolicies.map((policy) => <button type="button" key={policy.key} data-selected={intelligence === policy.key} onClick={() => setIntelligence(policy.key)} aria-pressed={intelligence === policy.key}><span><BrainCircuit size={17} /></span><strong>{policy.name}</strong><p>{policy.summary}</p><small>{policy.bestFor}</small></button>)}
            </div>
            <details className={styles.advancedPolicy}><summary>Advanced provider preferences</summary><p>{advancedIntelligenceNote}</p></details>
          </section>

          <section className={styles.composerSection} aria-labelledby="coverage-heading">
            <header><span>03</span><div><h3 id="coverage-heading">Where should FINNOR operate?</h3><p>Include only the areas that need to share live operating state. Excluding an area reduces scope.</p></div></header>
            <div className={styles.coverageGrid}>
              {operatingAreas.map((area, index) => { const Icon = coverageIcons[index]; const selected = coverage.has(area.name); return <button type="button" key={area.name} data-selected={selected} onClick={() => toggleCoverage(area.name)} aria-pressed={selected}><span><Icon size={15} /></span><strong>{area.name}</strong><i>{selected ? <Check size={12} /> : null}</i></button>; })}
            </div>
          </section>

          <section className={styles.composerSection} aria-labelledby="implementation-heading">
            <header><span>04</span><div><h3 id="implementation-heading">What makes the implementation more complex?</h3><p>These decisions define the engineering, policy, reliability and support boundary.</p></div></header>
            <div className={styles.leverGrid}>
              {(Object.keys(scopeLevers) as LeverKey[]).map((key) => { const lever = scopeLevers[key]; const Icon = lever.icon; return <label key={key}><span><Icon size={14} />{lever.label}</span><select value={String(levers[key])} onChange={(event) => updateLever(key, event.target.value)}>{Object.entries(lever.choices).map(([value, choice]) => <option value={value} key={value}>{choice.label}</option>)}</select><small>{(lever.choices[levers[key] as never] as ScopeChoice).detail}</small></label>; })}
            </div>
          </section>
        </div>

        <aside className={styles.deploymentSummary} aria-live="polite">
          <header><span>INDICATIVE IMPLEMENTATION</span><b><i />{band}</b></header>
          <div className={styles.priceRange}><small>Planning range</small><strong>{formatUsd(estimate.low)}–{formatUsd(estimate.high)}</strong><p>Production deployments start around $30,000. Final pricing follows the operating review and confirmed implementation boundary.</p></div>
          <div className={styles.summaryBlock}><span>Included foundation</span><ul><li><Check size={12} />Operating and source review</li><li><Check size={12} />Work Kernel and live operational projections</li><li><Check size={12} />Action contracts, policy and approvals</li><li><Check size={12} />Workflow runtime, recovery and evidence</li><li><Check size={12} />First certified production chain</li></ul></div>
          <div className={styles.summaryBlock}><span>Your configured boundary</span><dl><div><dt>Interaction</dt><dd>{selectedInteraction.name}</dd></div><div><dt>Intelligence</dt><dd>{selectedIntelligence.name}</dd></div><div><dt>Coverage</dt><dd>{includedAreas.length} of {operatingAreas.length} areas</dd></div></dl></div>
          <div className={styles.summaryBlock}><span>Excluded to reduce scope</span><p>{excludedAreas.length ? excludedAreas.map((item) => item.name).join(" · ") : "No operating areas excluded"}{interaction === "text" ? " · Live voice" : ""}{levers.agents === "none" ? " · Separate agent channels" : ""}</p></div>
          <div className={styles.scopeExplanation}><strong>Why the range moves</strong><p>Voice adds channel engineering and testing. Frontier intelligence adds stronger reasoning capacity. More workflows, systems, locations, approval layers, agents, custom workspace design and reliability requirements add implementation work.</p></div>
          <a href={mailHref}><span>Review this scope with FINNOR</span><ArrowUpRight size={15} /></a>
          <small className={styles.estimateNote}>Indicative planning range, not a quote. Ongoing operating and support requirements are confirmed separately.</small>
        </aside>
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
