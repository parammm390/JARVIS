"use client";

import { useGSAP } from "@gsap/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Command,
  Database,
  FileCheck2,
  Gauge,
  History,
  Layers3,
  MessageSquareText,
  PackageCheck,
  Pause,
  Play,
  RefreshCcw,
  Route,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wrench,
  Zap,
} from "lucide-react";

import { siteConfig } from "@/config/site";
import { ParticleScroll } from "@/components/canvasui/ParticleScroll";
import { FinnorMark } from "./FinnorMark";
import FinnorNavigation from "./FinnorNavigation";
import styles from "./FinnorHome.module.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const IndustrialExecutionWorld = dynamic(() => import("./IndustrialExecutionWorldLoader"), {
  ssr: false,
  loading: () => (
    <div className={styles.worldFallback} aria-hidden="true">
      <div className={styles.fallbackPipes} />
      <div className={styles.fallbackVessel}><i /><i /><i /><b /></div>
      <div className={styles.fallbackModules}>{Array.from({ length: 6 }, (_, index) => <span key={index}><i /></span>)}</div>
    </div>
  ),
});

const OperationsPulse = dynamic(() => import("./OperationsPulse"), {
  loading: () => <section className={styles.operationsPulseLoading} aria-hidden="true"><i /><i /><i /></section>,
});

const systemChapters = [
  {
    key: "complexity",
    eyebrow: "The operating reality",
    title: "A customer promise crosses the entire company.",
    body: "The Peterson installation is not a calendar item. It is a household, an open work root, a technician, a route, an equipment record, a stock position, a balance, a policy and a promise already made.",
    signal: "8 realities · 5 conflicts · 1 customer outcome",
  },
  {
    key: "instruction",
    eyebrow: "One instruction",
    title: "State the outcome. Leave the clicks behind.",
    body: "Tell JARVIS what must change by text, voice, webhook or worker. FINNOR fixes the objective to a durable trace before any record or provider is touched.",
    signal: "Objective fixed · trace WRK-81A2 opened",
  },
  {
    key: "context",
    eyebrow: "Context assembly",
    title: "The exact work gathers around the instruction.",
    body: "Customer history, equipment, open work, technician capacity, travel, inventory, money, memory and policy resolve into one source-bound picture. Missing facts stay visible.",
    signal: "7 records · 4 systems · 2 policies · citations attached",
  },
  {
    key: "plan",
    eyebrow: "Executable plan",
    title: "Reality decides the order of operations.",
    body: "Availability precedes rescheduling. Stock precedes commitment. Contact preference precedes outreach. Financial work remains downstream of authority.",
    signal: "5 bounded actions · dependencies locked",
  },
  {
    key: "authority",
    eyebrow: "Authority boundary",
    title: "The system stops where your judgment begins.",
    body: "Permitted preparation can proceed. Customer contact and money pause behind typed, scoped and versioned approval—with the consequence shown before consent.",
    signal: "3 actions permitted · 2 held for owner",
  },
  {
    key: "recovery",
    eyebrow: "Execution and recovery",
    title: "A failed provider is a state—not a mystery.",
    body: "Retries preserve the idempotency key. A blocked carrier hop can reroute, reconcile, compensate or escalate without losing the instruction, context or authority decision.",
    signal: "Delivery unknown · safe bypass active · trace intact",
  },
  {
    key: "evidence",
    eyebrow: "Verified change",
    title: "The run closes only when reality agrees.",
    body: "Customers, Work, Schedule and Money project the same new state. The receipt records what was proposed, approved, attempted, changed, recovered and left unresolved.",
    signal: "5 outcomes verified · receipt WRK-81A2 filed",
  },
] as const;

const stageNames = ["Instruction", "Context", "Plan", "Authority", "Execute", "Recovery", "Evidence"] as const;
const stageShortNames = ["IN", "CTX", "PLAN", "AUTH", "RUN", "FIX", "PROOF"] as const;
const stageIcons = [Command, Database, Route, ShieldCheck, Zap, RefreshCcw, FileCheck2] as const;

const heroModules = [
  ["CUSTOMER", "Peterson household"],
  ["WORK", "W-2187 · blocked"],
  ["SCHEDULE", "Thursday window"],
  ["INVENTORY", "WS-48 · in stock"],
  ["MONEY", "$2,480 balance"],
  ["POLICY", "Owner boundary"],
] as const;

const planSteps = [
  { name: "Work", detail: "Move W-2187 to ready", icon: Wrench, held: false },
  { name: "Schedule", detail: "Reserve Thu · 10:30", icon: CalendarClock, held: false },
  { name: "Inventory", detail: "Reserve system WS-48", icon: PackageCheck, held: false },
  { name: "Customer", detail: "Send confirmed reschedule", icon: UsersRound, held: true },
  { name: "Money", detail: "Create remaining invoice", icon: CircleDollarSign, held: true },
] as const;

const outcomeSurfaces = [
  {
    key: "customers",
    name: "Customers",
    icon: UsersRound,
    metric: "1 household resolved",
    before: "History and contact preference were isolated from the work.",
    after: "Peterson household, equipment and open work now share one causal trace.",
    rows: ["3 linked records", "WS-48 installed 2022", "SMS after 8 AM"],
  },
  {
    key: "work",
    name: "Work",
    icon: Wrench,
    metric: "Blocked → Ready",
    before: "W-2187 was stalled between an opening and unreserved stock.",
    after: "Dependencies are satisfied, ownership is explicit and the next state is inspectable.",
    rows: ["W-2187 installation", "Owner · Marcus", "Ready · verified"],
  },
  {
    key: "schedule",
    name: "Schedule",
    icon: Clock3,
    metric: "Thu · 10:30 AM",
    before: "A calendar opening could not prove skill, travel or inventory.",
    after: "The window is grounded in technician capability, route and stock.",
    rows: ["10:30–12:30", "27 min route", "0 active conflicts"],
  },
  {
    key: "money",
    name: "Money",
    icon: CircleDollarSign,
    metric: "$2,480 prepared",
    before: "The balance was known, but no customer-facing artifact was authorized.",
    after: "The invoice is prepared and linked to the owner’s recorded approval.",
    rows: ["INV-2480 draft", "Policy set 12", "Owner approved"],
  },
] as const;

const agents = [
  {
    name: "JARVIS",
    channel: "Command surface",
    scope: "Understands the business, forms plans and keeps the operating trace coherent.",
    actions: ["Ground exact context", "Form bounded plans", "Hold the authority line"],
    event: "Instruction grounded to Peterson / W-2187",
    state: "PLANNING",
  },
  {
    name: "Follow-up",
    channel: "Customer continuity",
    scope: "Runs approved follow-up without losing the customer, work or conversation context.",
    actions: ["Recover open promises", "Prepare approved outreach", "Respect channel policy"],
    event: "Reschedule message held at owner boundary",
    state: "HELD",
  },
  {
    name: "Service reminder",
    channel: "Installed-base care",
    scope: "Finds service-due equipment and prepares policy-bound outreach from real records.",
    actions: ["Find service-due equipment", "Attach household history", "Prepare the reminder"],
    event: "WS-48 service clock linked to household",
    state: "READY",
  },
  {
    name: "Win-back",
    channel: "Dormant opportunity",
    scope: "Re-enters old work only when evidence, permissions and campaign policy agree.",
    actions: ["Resolve dormant work", "Check consent and policy", "Re-open with evidence"],
    event: "No action: Peterson has active installation work",
    state: "QUIET",
  },
  {
    name: "Payment collector",
    channel: "Invoice-to-cash",
    scope: "Advances approved collection work while preserving invoice state and customer history.",
    actions: ["Resolve invoice state", "Prepare bounded contact", "Record payment outcome"],
    event: "$2,480 invoice prepared; contact remains held",
    state: "GUARDED",
  },
] as const;

const capabilityMarquee = [
  "business overview",
  "water-test scheduling",
  "technician assignment",
  "inventory risk",
  "proposal to installation",
  "invoice to cash",
  "service reminders",
  "maintenance renewals",
  "customer communication",
  "approved campaigns",
  "recovery controls",
  "decision receipts",
] as const;

function HeroOperatingModel() {
  const [phase, setPhase] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const preview = window.setTimeout(() => setRunning(true), 1400);
    return () => window.clearTimeout(preview);
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setPhase((current) => {
        if (current >= stageNames.length - 1) {
          window.clearInterval(timer);
          setRunning(false);
          return current;
        }
        return current + 1;
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [running]);

  const run = () => {
    setPhase(0);
    setRunning(true);
  };

  return (
    <div className={styles.heroModel} data-cursor="invert">
      <div className={styles.modelCanvas}>
        <IndustrialExecutionWorld phase={phase} variant="hero" />
      </div>
      <div className={styles.modelGrid} aria-hidden="true" />
      <div className={styles.modelTopline}>
        <span>JARVIS / REPRESENTATIVE OPERATING MODEL</span>
        <b data-running={running}><i />{running ? "EXECUTING" : phase === 6 ? "VERIFIED" : "READY"}</b>
      </div>
      <div className={styles.modelModules} aria-hidden="true">
        {heroModules.map(([label, value], index) => (
          <div key={label} data-active={phase >= Math.min(index + 1, 4)}>
            <span>{label}</span><b>{value}</b>
          </div>
        ))}
      </div>
      <div className={styles.modelStages}>
        {stageNames.map((stage, index) => (
          <span key={stage} data-active={index <= phase} data-short={stageShortNames[index]}><i />{stage}</span>
        ))}
      </div>
      <button className={styles.modelCommand} type="button" onClick={run} disabled={running}>
        <span><Command size={15} />Get the Peterson installation unstuck for Thursday.</span>
        <b>{running ? stageNames[phase] : phase === 6 ? "Run again" : "Run instruction"}{running ? <Gauge size={15} /> : <Play size={14} />}</b>
      </button>
    </div>
  );
}

function LiveWorkflow() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % stageNames.length), 1500);
    return () => window.clearInterval(timer);
  }, [paused]);

  return (
    <div className={styles.liveWorkflow}>
      <div className={styles.workflowCommand}>
        <span>OWNER / 08:42</span>
        <p>Move Peterson to Thursday. Assign Marcus. Reserve WS-48. Hold contact and money for me.</p>
      </div>
      <div
        className={styles.workflowRoute}
        style={{ "--workflow-progress": `${(active / (stageNames.length - 1)) * 100}%` } as CSSProperties}
      >
        <div className={styles.workflowLine} aria-hidden="true"><i /></div>
        {stageNames.map((stage, index) => {
          const StageIcon = stageIcons[index];
          return (
            <button key={stage} type="button" onClick={() => { setActive(index); setPaused(true); }} data-active={index <= active} data-current={index === active}>
              <span>{index < active ? <Check size={13} /> : <StageIcon size={13} />}</span>
              <b>{stage}</b>
              <small>{index < active ? "Complete" : index === active ? "Live" : "Queued"}</small>
            </button>
          );
        })}
      </div>
      <div className={styles.workflowState}>
        <span><i />{stageNames[active].toUpperCase()} / WRK-81A2</span>
        <p>{systemChapters[active].signal}</p>
        <button type="button" onClick={() => setPaused((value) => !value)} aria-label={paused ? "Resume workflow animation" : "Pause workflow animation"}>
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
      </div>
    </div>
  );
}

function SystemStage({ phase }: { phase: number }) {
  const chapter = systemChapters[phase] ?? systemChapters[0];
  return (
    <div className={styles.systemStage} data-system-stage>
      <div className={styles.systemCanvas}><IndustrialExecutionWorld phase={phase} variant="story" /></div>
      <div className={styles.systemTopline}><span>FINNOR / EXECUTION ENGINE</span><b><i />{phase === 6 ? "CHAIN CLOSED" : "TRACE LIVE"}</b></div>
      <div className={styles.systemLabels} aria-hidden="true">
        {heroModules.map(([label], index) => <span key={label} data-active={phase >= 2 || phase === 0} data-module={index}>{label}</span>)}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          className={styles.systemTelemetry}
          key={chapter.key}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.42 }}
        >
          <span>{chapter.eyebrow}</span>
          <strong>{chapter.signal}</strong>
        </motion.div>
      </AnimatePresence>
      <div className={styles.systemProgress} aria-hidden="true">
        {systemChapters.map((item, index) => <i key={item.key} data-active={index <= phase} />)}
      </div>
    </div>
  );
}

function JarvisSurface() {
  const [approved, setApproved] = useState(false);
  const [execution, setExecution] = useState(0);

  useEffect(() => {
    if (!approved || execution >= planSteps.length) return;
    const timer = window.setTimeout(() => setExecution((current) => current + 1), 620);
    return () => window.clearTimeout(timer);
  }, [approved, execution]);

  return (
    <div className={styles.jarvisSurface} id="jarvis-surface" data-scale-reveal>
      <aside className={styles.jarvisRail}>
        <span className={styles.jarvisMark}><FinnorMark /></span>
        <nav aria-label="Representative JARVIS product surfaces">
          <a className={styles.jarvisRailActive} href="/jarvis"><Sparkles size={16} /><span>JARVIS</span></a>
          <a href="/jarvis/customers"><UsersRound size={16} /><span>Customers</span></a>
          <a href="/jarvis/work"><Wrench size={16} /><span>Work</span></a>
          <a href="/jarvis/schedule"><Clock3 size={16} /><span>Schedule</span></a>
          <a href="/jarvis/money"><CircleDollarSign size={16} /><span>Money</span></a>
          <a href="/jarvis/agents"><Layers3 size={16} /><span>Agents</span></a>
        </nav>
        <span className={styles.jarvisRailState}><i />AVAILABLE</span>
      </aside>
      <div className={styles.jarvisMain}>
        <header className={styles.jarvisHeader}>
          <div><span>COMMAND SURFACE</span><strong>JARVIS</strong></div>
          <div><span>POLICY SET 12</span><b><i />REPRESENTATIVE WALKTHROUGH</b></div>
        </header>
        <div className={styles.jarvisWorkspace}>
          <section className={styles.jarvisThread}>
            <div className={styles.ownerMessage}>
              <span>OWNER · 08:42:19</span>
              <p>Get the Peterson installation unstuck. Move it to Thursday, assign Marcus, reserve the system, notify the customer, and prepare the remaining invoice. Hold contact and money for approval.</p>
            </div>
            <div className={styles.jarvisAnswer}>
              <div><span className={styles.answerCore}><i /><i /></span><p><b>JARVIS</b><small>Context assembled · exact work root</small></p></div>
              <p>Thursday at 10:30 AM is the earliest policy-valid slot. Marcus has the required skill, the drive window is clear and WS-48 is in stock.</p>
              <div className={styles.sourceStrip}><span>Peterson household</span><span>W-2187</span><span>Marcus availability</span><span>WS-48 inventory</span></div>
            </div>
            <div className={styles.executionStream}>
              <div><span>LIVE EXECUTION</span><b>{approved ? `${Math.min(execution, 5)} / 5 actions` : "WAITING FOR AUTHORITY"}</b></div>
              <div className={styles.executionTrack}><i style={{ width: approved ? `${Math.max(execution * 20, 4)}%` : "4%" }} /></div>
              <AnimatePresence mode="wait">
                <motion.p key={`${approved}-${execution}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  {!approved
                    ? "Permitted preparation is ready. Contact and money remain held."
                    : execution < 5
                      ? `${planSteps[Math.min(execution, 4)].name} is moving on trace WRK-81A2.`
                      : "Expected and actual state agree. Receipt WRK-81A2 is ready."}
                </motion.p>
              </AnimatePresence>
            </div>
          </section>
          <aside className={styles.jarvisPlan}>
            <div className={styles.planTitle}><span><Route size={15} />EXECUTION PLAN</span><b>{approved ? "AUTHORITY GRANTED" : "5 ACTIONS · 2 HELD"}</b></div>
            <div className={styles.planList}>
              {planSteps.map((step, index) => {
                const Icon = step.icon;
                const complete = approved ? execution > index : !step.held;
                return (
                  <div key={step.name} data-held={!approved && step.held} data-complete={complete}>
                    <span><Icon size={15} /></span><p><b>{step.name}</b><small>{step.detail}</small></p>{complete ? <Check size={14} /> : <i />}
                  </div>
                );
              })}
            </div>
            <div className={styles.authorityCard} data-approved={approved}>
              <div><ShieldCheck size={18} /><p><b>{approved ? "AUTHORITY RECORDED" : "YOUR AUTHORITY"}</b><span>{approved ? "Scoped consent is attached to this trace." : "Customer message + $2,480 invoice."}</span></p></div>
              <button type="button" onClick={() => { setApproved(true); setExecution(0); }} disabled={approved}>
                {approved ? "Approved · executing" : "Review consequence & approve"}<ChevronRight size={14} />
              </button>
            </div>
          </aside>
        </div>
        <footer className={styles.jarvisFooter}><span>Representative product walkthrough · current FINNOR action contracts</span><Link href="/jarvis/login">Open JARVIS <ArrowUpRight size={13} /></Link></footer>
      </div>
    </div>
  );
}

function OutcomeGrid() {
  const [focused, setFocused] = useState<string | null>(null);
  return (
    <div className={styles.outcomeGrid}>
      {outcomeSurfaces.map((surface) => {
        const Icon = surface.icon;
        return (
          <article
            key={surface.key}
            tabIndex={0}
            data-focused={focused === surface.key}
            onMouseEnter={() => setFocused(surface.key)}
            onMouseLeave={() => setFocused(null)}
            onFocus={() => setFocused(surface.key)}
            onBlur={() => setFocused(null)}
          >
            <header><span><Icon size={18} />{surface.name}</span><b><i />VERIFIED</b></header>
            <strong>{surface.metric}</strong>
            <div className={styles.outcomeState}><span>BEFORE</span><p>{surface.before}</p></div>
            <div className={styles.outcomeState}><span>AFTER</span><p>{surface.after}</p></div>
            <ul>{surface.rows.map((row) => <li key={row}><CheckCircle2 size={13} />{row}</li>)}</ul>
            <Link href={`/jarvis/${surface.key === "customers" ? "customers" : surface.key}`}>Inspect surface <ArrowUpRight size={13} /></Link>
          </article>
        );
      })}
    </div>
  );
}

function AgentAccordion() {
  const [active, setActive] = useState(0);
  return (
    <div className={styles.agentAccordion}>
      {agents.map((agent, index) => (
        <button
          type="button"
          key={agent.name}
          data-active={active === index}
          onClick={() => setActive(index)}
          onMouseEnter={() => setActive(index)}
          onFocus={() => setActive(index)}
        >
          <span className={styles.agentIndex}>{String(index + 1).padStart(2, "0")}</span>
          <div className={styles.agentVertical}><span>{agent.name}</span></div>
          <div className={styles.agentDetail}>
            <span>{agent.channel}</span>
            <h3>{agent.name}</h3>
            <p>{agent.scope}</p>
            <ul className={styles.agentScopes}>{agent.actions.map((action) => <li key={action}><Check size={12} /><span>{action}</span></li>)}</ul>
            <div><i /><span>{agent.event}</span><b>{agent.state}</b></div>
          </div>
        </button>
      ))}
    </div>
  );
}

function RecoveryConsole() {
  const [state, setState] = useState<"blocked" | "retry" | "escalate" | "recovered">("blocked");
  const states = {
    blocked: ["Provider delivery unknown", "No success assumed. The instruction and approval remain intact."],
    retry: ["Bounded retry running", "Idempotency key WRK-81A2:04 is preserved across the carrier hop."],
    escalate: ["Owner escalation opened", "Failure evidence, context and safe options are attached for review."],
    recovered: ["Alternate route verified", "The expected customer state now agrees with the source record."],
  } as const;
  return (
    <div className={styles.recoveryConsole}>
      <div className={styles.recoveryVisual}>
        <div className={styles.recoveryNode}><MessageSquareText size={17} /><span>Customer contact</span><b>STEP 04</b></div>
        <div className={styles.recoveryPaths} data-state={state}><i /><i /><i /><span /></div>
        <div className={styles.providerNode}><Database size={17} /><span>Provider binding</span><b>{state === "recovered" ? "VERIFIED" : "UNKNOWN"}</b></div>
        <div className={styles.recoveryBypass}><RefreshCcw size={15} /><span>Safe recovery lane</span></div>
      </div>
      <div className={styles.recoveryControl}>
        <span>RUN WRK-81A2 / RECOVERY CONTROL</span>
        <AnimatePresence mode="wait">
          <motion.div key={state} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <h3>{states[state][0]}</h3><p>{states[state][1]}</p>
          </motion.div>
        </AnimatePresence>
        <div>
          <button type="button" onClick={() => setState("retry")} aria-pressed={state === "retry"}>Retry safely</button>
          <button type="button" onClick={() => setState("escalate")} aria-pressed={state === "escalate"}>Escalate with context</button>
          <button type="button" onClick={() => setState("recovered")} aria-pressed={state === "recovered"}>Verify alternate route</button>
        </div>
        <ul><li><Check size={13} />Instruction preserved</li><li><Check size={13} />Policy preserved</li><li><Check size={13} />Same receipt chain</li></ul>
      </div>
    </div>
  );
}

function CapabilityMarquee() {
  const items = [...capabilityMarquee, ...capabilityMarquee];
  return (
    <div className={styles.capabilityMarquee} aria-label="Representative FINNOR action scope">
      <div>{items.map((item, index) => <span key={`${item}-${index}`}>{item}<i /></span>)}</div>
    </div>
  );
}

export default function FinnorHome() {
  const root = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState(0);

  useGSAP(
    () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) return;

      gsap.from("[data-hero-word]", { yPercent: 112, rotate: 1.2, stagger: 0.07, duration: 0.9, ease: "power4.out" });
      gsap.from("[data-hero-enter]", { opacity: 0, y: 20, stagger: 0.06, duration: 0.58, ease: "power3.out", delay: 0.08 });
      gsap.fromTo("[data-hero-model]", { opacity: 0, yPercent: 4, scale: 0.95 }, { opacity: 1, yPercent: 0, scale: 1, duration: 1.12, ease: "power4.out", delay: 0.08 });

      gsap.to("[data-hero-model]", {
        yPercent: 5,
        scale: 1.055,
        ease: "none",
        scrollTrigger: { trigger: "." + styles.hero, start: "top top", end: "bottom top", scrub: 1.1 },
      });
      gsap.to("[data-hero-copy]", {
        yPercent: -12,
        opacity: 0.16,
        ease: "none",
        scrollTrigger: { trigger: "." + styles.hero, start: "top top", end: "bottom 18%", scrub: 1 },
      });

      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((element) => {
        gsap.fromTo(element, { opacity: 0, y: 58 }, { opacity: 1, y: 0, duration: 1.05, ease: "power3.out", scrollTrigger: { trigger: element, start: "top 86%" } });
      });

      gsap.utils.toArray<HTMLElement>("[data-scale-reveal]").forEach((element) => {
        gsap.fromTo(
          element,
          { opacity: 0.24, scale: 0.86 },
          {
            opacity: 1,
            scale: 1,
            ease: "none",
            scrollTrigger: { trigger: element, start: "top 92%", end: "top 30%", scrub: 1.05 },
          },
        );
      });

      gsap.utils.toArray<HTMLElement>("[data-stack-card]").forEach((element, index) => {
        gsap.fromTo(
          element,
          { y: 34 + index * 9, scale: 0.965, opacity: 0.5 },
          {
            y: 0,
            scale: 1,
            opacity: 1,
            ease: "none",
            scrollTrigger: { trigger: element, start: "top 92%", end: "top 55%", scrub: 0.8 },
          },
        );
      });

      gsap.utils.toArray<HTMLElement>("[data-system-chapter]").forEach((chapter, index) => {
        ScrollTrigger.create({
          trigger: chapter,
          start: "top 56%",
          end: "bottom 44%",
          onEnter: () => setPhase(index),
          onEnterBack: () => setPhase(index),
        });
      });

      // The stage is already pinned by CSS sticky. A second GSAP pin races with
      // post-hydration layout changes and can make the scene lock before the
      // story reaches the viewport.
      const refresh = () => ScrollTrigger.refresh();
      const refreshFrame = window.requestAnimationFrame(refresh);
      let disposed = false;
      window.addEventListener("load", refresh, { once: true });
      document.fonts?.ready.then(() => {
        if (!disposed) refresh();
      });

      return () => {
        disposed = true;
        window.cancelAnimationFrame(refreshFrame);
        window.removeEventListener("load", refresh);
      };
    },
    { scope: root },
  );

  return (
    <main ref={root} className={styles.site}>
      <FinnorNavigation tone="dark" />

      <section className={styles.hero}>
        <div className={styles.heroGrid} aria-hidden="true" />
        <div className={styles.heroNoise} aria-hidden="true" />
        <div className={styles.heroCopy} data-hero-copy>
          <p className={styles.heroEyebrow} data-hero-enter><span />JARVIS / GOVERNED EXECUTION FOR WATER TREATMENT</p>
          <h1>
            <span><span data-hero-word>ONE INSTRUCTION.</span></span>
            <span className={styles.heroAccent}>
              <span className={styles.heroDesktopPhrase} data-hero-word>THE OPERATION MOVES.</span>
              <span className={styles.heroMobilePhrase} data-hero-word>OPERATION MOVES.</span>
            </span>
          </h1>
          <p className={styles.heroBody} data-hero-enter>
            JARVIS assembles customer, work, schedule, dispatch, inventory, proposals and money into one governed plan. FINNOR executes inside your authority, recovers when reality resists and proves the result.
          </p>
          <div className={styles.heroActions} data-hero-enter>
            <a className={styles.primaryCta} href={siteConfig.calendlyLink} target="_blank" rel="noreferrer">Plan your deployment <ArrowUpRight size={16} /></a>
            <a className={styles.secondaryCta} href="#system-story">Watch one instruction <ArrowDown size={16} /></a>
          </div>
        </div>
        <div className={styles.heroVisual} data-hero-model><HeroOperatingModel /></div>
      </section>

      <section className={styles.thesis}>
        <div className={styles.thesisTop} data-reveal>
          <p>Software keeps records. Assistants answer questions.</p>
          <h2>FINNOR changes the operating state of the business.</h2>
        </div>
        <div className={styles.inlineStatement} data-reveal>
          <span>One instruction enters.</span>
          <span className={styles.inlineInstrument} aria-label="Live JARVIS workflow preview"><i /><i /><i /><i /><b>LIVE</b></span>
          <span>The whole operation answers.</span>
        </div>
        <LiveWorkflow />
      </section>

      <OperationsPulse />

      <section className={styles.systemIntro} id="system">
        <div data-reveal>
          <span>THE OPERATING SYSTEM UNDER THE COMMAND</span>
          <ParticleScroll
            className={styles.contextParticle}
            point={0.72}
            band={340}
            density={3}
            spread={150}
            gravity={0.18}
            drift={0.42}
            swirl={34}
            fade={0.72}
          >
            <div className={styles.contextCopy}>
              <h2>Business complexity becomes executable structure.</h2>
              <p>One representative installation moves through the same product mechanics the source implements: grounded context, bounded plans, policy, approval, durable execution, recovery and evidence.</p>
            </div>
          </ParticleScroll>
        </div>
      </section>

      <section className={styles.systemStory} id="system-story" data-system-story>
        <SystemStage phase={phase} />
        <div className={styles.chapterRail}>
          {systemChapters.map((chapter, index) => (
            <article key={chapter.key} data-system-chapter data-current={phase === index}>
              <span>{chapter.eyebrow}</span>
              <h3>{chapter.title}</h3>
              <p>{chapter.body}</p>
              <b>{chapter.signal}</b>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.jarvisSection} id="jarvis">
        <div className={styles.sectionHeading} data-reveal>
          <span>JARVIS / THE COMMAND SURFACE</span>
          <h2>Understand the work before you authorize the change.</h2>
          <p>JARVIS keeps the instruction, supporting records, plan, authority, execution and proof in one causal surface. It is not a chatbot pasted over disconnected software.</p>
        </div>
        <JarvisSurface />
      </section>

      <section className={styles.outcomesSection} id="outcomes">
        <div className={styles.sectionHeading} data-reveal>
          <span>AFTER APPROVAL</span>
          <h2>The conversation disappears. Four operating surfaces agree.</h2>
          <p>The command is complete only when Customers, Work, Schedule and Money show the right new state—and every change points back to the same exact work root.</p>
        </div>
        <OutcomeGrid />
      </section>

      <section className={styles.agentsSection} id="agents">
        <div className={styles.agentsHeading} data-reveal>
          <span>THE BOUNDED AGENT FLEET</span>
          <h2>Five channels. One authority boundary.</h2>
          <p>Each channel has a defined operating scope. JARVIS keeps their work attached to shared records, policy and evidence instead of multiplying disconnected conversations.</p>
        </div>
        <AgentAccordion />
      </section>

      <section className={styles.recoverySection} id="recovery">
        <div className={styles.sectionHeading} data-reveal>
          <span>WHEN REALITY RESISTS</span>
          <h2>The failure path is product—not fine print.</h2>
          <p>Unknown delivery never becomes imaginary success. Retry, escalation, reconciliation and supported compensation keep the work controllable when a provider or record disagrees.</p>
        </div>
        <RecoveryConsole />
      </section>

      <section className={styles.evidenceSection} id="evidence">
        <div className={styles.evidenceCopy} data-reveal>
          <span>EVIDENCE / WRK-81A2</span>
          <h2>“Done” is a sentence.<br />A receipt is proof.</h2>
          <p>The complete causal record stays attached: objective, sources, plan, policy, approval, execution, recovery and actual operating state.</p>
        </div>
        <div className={styles.receipt} data-scale-reveal>
          <header><div><FileCheck2 size={19} /><span>DECISION RECEIPT</span></div><b><i />VERIFIED</b></header>
          <div className={styles.receiptHero}><span>OBJECTIVE</span><p>Restore the Peterson installation to an executable Thursday state without contacting the customer or creating a financial artifact before owner approval.</p></div>
          <div className={styles.receiptGrid}>
            <div><span>EXPECTED</span><b>5 bounded outcomes</b><p>Work, technician, inventory, customer and invoice agree.</p></div>
            <div><span>ACTUAL</span><b>5 / 5 verified</b><p>No duplicate actions. Two approvals recorded.</p></div>
            <div><span>AUTHORITY</span><b>Policy set 12</b><p>Customer contact and money confirmed by owner.</p></div>
            <div><span>EVIDENCE</span><b>9 durable events</b><p>Sources, tool outcomes and recovery state preserved.</p></div>
          </div>
          <footer><span><Database size={13} />7 sources</span><span><ShieldCheck size={13} />policy v12</span><span><CheckCircle2 size={13} />chain closed</span><button type="button">Inspect trace <ArrowRight size={13} /></button></footer>
        </div>
      </section>

      <CapabilityMarquee />

      <section className={styles.finalCta}>
        <div className={styles.finalWorld} aria-hidden="true"><IndustrialExecutionWorld phase={6} variant="final" /></div>
        <div className={styles.finalCopy} data-reveal>
          <span>YOUR OPERATION / INSIDE JARVIS</span>
          <h2>Bring the workflow that keeps crossing desks.</h2>
          <p>We’ll trace the real customer, work, schedule, equipment, money, authority, recovery and proof behind it—then show the whole chain inside JARVIS.</p>
          <div><a href={siteConfig.calendlyLink} target="_blank" rel="noreferrer">Plan your deployment <ArrowUpRight size={16} /></a><Link href="/demo">Open the public demo <ArrowRight size={16} /></Link></div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerLead}><Link href="/" aria-label="FINNOR home"><FinnorMark /><span>FINNOR</span></Link><p>Governed execution for water treatment companies.</p></div>
        <div className={styles.footerGrid}>
          <div><span>Product</span><Link href="/product">Product</Link><Link href="/capabilities">Capabilities</Link><Link href="/how-it-works">How it works</Link></div>
          <div><span>Explore</span><Link href="/resources">Resources</Link><Link href="/trust-safety">Trust &amp; safety</Link><Link href="/faq">FAQ</Link></div>
          <div><span>Work with FINNOR</span><Link href="/pricing">Pricing</Link><a href={siteConfig.calendlyLink} target="_blank" rel="noreferrer">Plan your deployment</a><Link href="/jarvis/login">JARVIS sign in</Link></div>
          <div><span>Contact</span><a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
        </div>
        <div className={styles.footerBase}><span>© {new Date().getFullYear()} FINNOR</span><span>Built for the work behind clean water.</span></div>
      </footer>
    </main>
  );
}
