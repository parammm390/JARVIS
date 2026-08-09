"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Box,
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
  Menu,
  MessageSquareText,
  Mic,
  PackageCheck,
  Play,
  RefreshCcw,
  Route,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wrench,
  X,
  Zap,
} from "lucide-react";

import { siteConfig } from "@/config/site";
import styles from "./FinnorHome.module.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const CinematicOperationsWorld = dynamic(() => import("./CinematicOperationsWorld"), {
  ssr: false,
  loading: () => <div className={styles.worldLoading} />,
});

const MarketingOrb = dynamic(
  () => import("@/components/sections/jarvis-proof/MarketingOrb").then((module) => module.MarketingOrb),
  { ssr: false, loading: () => <div className={styles.orbFallback} /> },
);

function DeferredWorld({ phase, rootMargin = "700px 0px" }: { phase: number; rootMargin?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = mountRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setReady(true);
        observer.disconnect();
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return <div ref={mountRef} className={styles.deferredWorld}>{ready ? <CinematicOperationsWorld phase={phase} /> : <div className={styles.worldLoading} />}</div>;
}

const operatingChapters = [
  {
    number: "01",
    kicker: "A promise enters the business",
    title: "One customer request touches seven operating realities.",
    body: "A reschedule is never only a calendar change. It reaches the household, work case, technician, travel window, installed equipment, stock, money, policy and the promise already made.",
    signal: "8 systems · 5 conflicts · no shared truth",
  },
  {
    number: "02",
    kicker: "One instruction",
    title: "The operator states the outcome—not the clicks.",
    body: "Tell JARVIS what must change by text, voice, webhook or worker. FINNOR gives the instruction a durable identity before any system is touched.",
    signal: "Intent fixed · trace WRK-81A2 opened",
  },
  {
    number: "03",
    kicker: "Context assembles",
    title: "The exact operating picture gathers around the work.",
    body: "Customer history, open work, technician capacity, travel, inventory, price book, memory and current policy resolve into one source-bound context. Unknowns remain visible.",
    signal: "7 records · 4 systems · 2 policies",
  },
  {
    number: "04",
    kicker: "A plan forms",
    title: "Dependencies settle before the operation moves.",
    body: "Availability before rescheduling. Stock before commitment. Contact preference before outreach. Money after authority. JARVIS composes bounded actions in the order reality requires.",
    signal: "5 actions · 3 executable · 2 held",
  },
  {
    number: "05",
    kicker: "Authority becomes visible",
    title: "The system stops exactly where your judgment begins.",
    body: "Low-risk internal changes can proceed. Customer communication and money wait behind a typed, scoped, versioned approval boundary—with the consequence shown before consent.",
    signal: "Owner approval · contact + $2,480 invoice",
  },
  {
    number: "06",
    kicker: "The operation changes",
    title: "Systems and agents activate. Evidence closes the loop.",
    body: "FINNOR executes, retries safely, projects the new state into every surface and verifies expected against actual. The answer is not “done.” The answer is a receipt.",
    signal: "5 outcomes verified · 0 unresolved conflicts",
  },
] as const;

const commandStages = [
  { name: "Instruction", detail: "Outcome understood", icon: MessageSquareText },
  { name: "Context", detail: "7 records grounded", icon: Database },
  { name: "Plan", detail: "5 actions ordered", icon: Route },
  { name: "Authority", detail: "2 actions held", icon: ShieldCheck },
  { name: "Execute", detail: "Systems activating", icon: Zap },
  { name: "Evidence", detail: "Receipt filed", icon: FileCheck2 },
] as const;

const planSteps = [
  { surface: "Work", action: "Move W-2187 into a ready state", icon: Wrench, held: false },
  { surface: "Schedule", action: "Reserve Thursday · 10:30–12:30", icon: CalendarClock, held: false },
  { surface: "Inventory", action: "Reserve softener system WS-48", icon: PackageCheck, held: false },
  { surface: "Customer", action: "Send confirmed reschedule message", icon: UsersRound, held: true },
  { surface: "Money", action: "Create remaining invoice · $2,480", icon: CircleDollarSign, held: true },
] as const;

const operationalSurfaces = [
  {
    key: "customers",
    label: "Customers",
    icon: UsersRound,
    accent: "teal",
    metric: "1 household resolved",
    headline: "The Peterson history becomes part of the decision.",
    before: "Contact preference, equipment history and open work live in separate records.",
    rows: [["Household", "Peterson · 3 linked records"], ["System", "WS-48 softener · installed 2022"], ["Preference", "SMS permitted · after 8 AM"]],
  },
  {
    key: "work",
    label: "Work",
    icon: Wrench,
    accent: "blue",
    metric: "Blocked → Ready",
    headline: "The installation gains one accountable next state.",
    before: "W-2187 is stalled between a calendar opening and unreserved inventory.",
    rows: [["Work case", "W-2187 · installation"], ["Owner", "Marcus · field technician"], ["State", "Ready · dependencies satisfied"]],
  },
  {
    key: "schedule",
    label: "Schedule",
    icon: Clock3,
    accent: "orange",
    metric: "Thu · 10:30 AM",
    headline: "A real field window replaces a calendar guess.",
    before: "An opening alone cannot prove skill, travel time, inventory or conflict clearance.",
    rows: [["Window", "Thursday · 10:30–12:30"], ["Travel", "27 min · route validated"], ["Conflict", "Clear across active dispatch"]],
  },
  {
    key: "money",
    label: "Money",
    icon: CircleDollarSign,
    accent: "gold",
    metric: "$2,480 prepared",
    headline: "Revenue advances without outrunning authority.",
    before: "The balance is known, but creating a customer-facing artifact is consequential.",
    rows: [["Balance", "$2,480 remaining"], ["Artifact", "Invoice INV-2480 drafted"], ["Control", "Owner approval recorded"]],
  },
] as const;

const agentEvents = [
  ["Context agent", "Resolved household + work root", "0.8s"],
  ["Dispatch agent", "Validated Marcus + travel window", "1.3s"],
  ["Inventory agent", "Reserved WS-48 with idempotency key", "0.6s"],
  ["Policy agent", "Held contact + invoice", "0.2s"],
  ["Verification agent", "Compared expected / actual", "1.1s"],
] as const;

function Navigation() {
  const [open, setOpen] = useState(false);

  return (
    <header className={styles.navWrap}>
      <Link className={styles.wordmark} href="/" aria-label="FINNOR home">
        <span className={styles.logoCell}>F</span>
        <span>FINNOR</span>
      </Link>
      <nav className={styles.desktopNav} aria-label="Primary navigation">
        <a href="#operation">The operation</a>
        <a href="#jarvis">JARVIS</a>
        <a href="#surfaces">Surfaces</a>
        <a href="#evidence">Evidence</a>
        <Link href="/resources">Field notes</Link>
      </nav>
      <div className={styles.navActions}>
        <Link href="/jarvis/login">Sign in</Link>
        <a className={styles.navCta} href={siteConfig.calendlyLink} target="_blank" rel="noreferrer">
          See your operation <ArrowUpRight size={14} />
        </a>
      </div>
      <button
        className={styles.menuButton}
        type="button"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X /> : <Menu />}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.nav
            className={styles.mobileNav}
            aria-label="Mobile navigation"
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
          >
            <a href="#operation" onClick={() => setOpen(false)}>The operation</a>
            <a href="#jarvis" onClick={() => setOpen(false)}>JARVIS</a>
            <a href="#surfaces" onClick={() => setOpen(false)}>Surfaces</a>
            <a href="#evidence" onClick={() => setOpen(false)}>Evidence</a>
            <Link href="/resources">Field notes</Link>
            <a href={siteConfig.calendlyLink}>See your operation</a>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

function HeroCommandWorld() {
  const [runStage, setRunStage] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRunStage((current) => {
        if (current >= commandStages.length - 1) {
          window.clearInterval(timer);
          setRunning(false);
          return current;
        }
        return current + 1;
      });
    }, 1050);
    return () => window.clearInterval(timer);
  }, [running]);

  const runInstruction = () => {
    setRunStage(0);
    setRunning(true);
  };

  return (
    <div className={styles.heroWorld} data-cursor="invert">
      <div className={styles.heroWorldGrid} aria-hidden="true" />
      <div className={styles.heroWorldBeam} aria-hidden="true" />
      <div className={styles.heroWorldTop}>
        <span>JARVIS / LIVE OPERATING MODEL</span>
        <span className={styles.liveState}><i /> {running ? "EXECUTING" : runStage === 5 ? "VERIFIED" : "READY"}</span>
      </div>

      <div className={styles.heroOrbWrap}>
        <div className={styles.orbRings} aria-hidden="true"><i /><i /><i /></div>
        <MarketingOrb className={styles.marketingOrb} />
        <div className={`${styles.orbNode} ${styles.orbNodeCustomer}`}><UsersRound size={13} /> Customer <b>{runStage >= 1 ? "RESOLVED" : "LISTENING"}</b></div>
        <div className={`${styles.orbNode} ${styles.orbNodeWork}`}><Wrench size={13} /> Work <b>{runStage >= 2 ? "READY" : "BLOCKED"}</b></div>
        <div className={`${styles.orbNode} ${styles.orbNodeSchedule}`}><Clock3 size={13} /> Schedule <b>{runStage >= 3 ? "HELD" : "CHECKING"}</b></div>
        <div className={`${styles.orbNode} ${styles.orbNodeMoney}`}><CircleDollarSign size={13} /> Money <b>{runStage >= 4 ? "APPROVED" : "GUARDED"}</b></div>
      </div>

      <div className={styles.commandStages}>
        {commandStages.map((stage, index) => {
          const Icon = stage.icon;
          return (
            <div key={stage.name} className={index <= runStage ? styles.commandStageActive : undefined}>
              <span><Icon size={13} /></span>
              <div><b>{stage.name}</b><small>{index <= runStage ? stage.detail : "Waiting"}</small></div>
            </div>
          );
        })}
      </div>

      <button className={styles.heroInstruction} type="button" onClick={runInstruction} disabled={running}>
        <span><Command size={15} /> Peterson installation · Thursday</span>
        <strong>{running ? "Running instruction" : runStage === 5 ? "Run again" : "Run this instruction"}<Play size={13} /></strong>
      </button>
    </div>
  );
}

function StoryHud({ phase }: { phase: number }) {
  const chapter = operatingChapters[phase] ?? operatingChapters[0];
  const complete = phase === operatingChapters.length - 1;
  return (
    <>
      <div className={styles.worldTopline}>
        <span>OPERATION / PETERSON / W-2187</span>
        <span><i /> {complete ? "VERIFIED" : "TRACE LIVE"}</span>
      </div>
      <div className={styles.worldTelemetry}>
        <span>{chapter.number} / 06</span>
        <strong>{chapter.kicker}</strong>
        <p>{chapter.signal}</p>
        <div>{operatingChapters.map((item, index) => <i key={item.number} data-active={index <= phase} />)}</div>
      </div>
      <div className={styles.worldLabels} aria-hidden="true">
        {operationalSurfaces.map((surface, index) => (
          <span key={surface.key} data-active={phase >= 2 || (phase === 0 && index % 2 === 0)}>{surface.label}</span>
        ))}
        <span data-active={phase >= 3}>Policy</span>
        <span data-active={phase >= 5}>Evidence</span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={phase}
          className={styles.worldEvent}
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.36 }}
        >
          {phase === 0 ? <><Layers3 size={16} /><span><b>Conflict detected</b>Calendar opening is not yet a valid promise.</span></> : null}
          {phase === 1 ? <><Mic size={16} /><span><b>Instruction understood</b>“Get Peterson unstuck for Thursday.”</span></> : null}
          {phase === 2 ? <><Database size={16} /><span><b>Context grounded</b>Exact household, work, stock and policy linked.</span></> : null}
          {phase === 3 ? <><Route size={16} /><span><b>Plan composed</b>Five actions ordered by dependency.</span></> : null}
          {phase === 4 ? <><ShieldCheck size={16} /><span><b>Authority boundary</b>Contact and money held for owner.</span></> : null}
          {phase === 5 ? <><FileCheck2 size={16} /><span><b>Receipt filed</b>Expected and actual state agree.</span></> : null}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

function JarvisWorkSurface() {
  const [approved, setApproved] = useState(false);
  const [activity, setActivity] = useState(0);

  useEffect(() => {
    if (!approved) return;
    const timer = window.setInterval(() => {
      setActivity((value) => Math.min(value + 1, planSteps.length));
    }, 700);
    return () => window.clearInterval(timer);
  }, [approved]);

  return (
    <div className={styles.jarvisProduct} data-cursor="invert">
      <aside className={styles.productRail}>
        <span className={styles.productLogo}>F</span>
        <nav aria-label="Representative product surfaces">
          <button className={styles.productRailActive} aria-label="JARVIS"><Sparkles size={17} /></button>
          <button aria-label="Customers"><UsersRound size={17} /></button>
          <button aria-label="Work"><Wrench size={17} /></button>
          <button aria-label="Schedule"><Clock3 size={17} /></button>
          <button aria-label="Money"><CircleDollarSign size={17} /></button>
          <button aria-label="History"><History size={17} /></button>
        </nav>
        <span className={styles.railOnline}><i /></span>
      </aside>

      <div className={styles.productMain}>
        <header className={styles.productHeader}>
          <div><span>COMMAND SURFACE</span><strong>JARVIS</strong></div>
          <div className={styles.productHeaderMeta}><span>Policy set 12</span><span><i /> Live environment</span></div>
        </header>

        <div className={styles.productWorkspace}>
          <section className={styles.productThread}>
            <div className={styles.operatorMessage}>
              <span>OWNER · 08:42:19</span>
              <p>Get the Peterson installation unstuck. Move it to Thursday, assign Marcus, reserve the system, notify the customer, and prepare the remaining invoice. Hold contact and money for approval.</p>
            </div>
            <div className={styles.jarvisAnswer}>
              <div className={styles.answerIdentity}>
                <div className={styles.miniOrb}><i /><i /><i /></div>
                <span><b>JARVIS</b>Context assembled · exact work root</span>
              </div>
              <p>Thursday at 10:30 AM is the earliest policy-valid slot. Marcus has the required skill, the drive window is clear and WS-48 is in stock.</p>
              <div className={styles.sourcePills}>
                <span>Peterson household</span><span>W-2187</span><span>Marcus availability</span><span>WS-48 inventory</span>
              </div>
            </div>
            <div className={styles.liveActivity}>
              <div><span>LIVE EXECUTION</span><b>{approved ? `${Math.min(activity, 5)} / 5 actions` : "Waiting for authority"}</b></div>
              <div className={styles.activityTrack}><i style={{ width: approved ? `${Math.max(8, activity * 20)}%` : "8%" }} /></div>
              <AnimatePresence mode="wait">
                <motion.p key={activity + Number(approved)} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
                  {!approved ? "Internal changes are ready. Customer contact and invoice remain held." : activity < 5 ? agentEvents[Math.min(activity, 4)][1] : "Execution verified. Decision receipt WRK-81A2 filed."}
                </motion.p>
              </AnimatePresence>
            </div>
          </section>

          <aside className={styles.productPlan}>
            <div className={styles.planTitle}>
              <span><Route size={15} /> EXECUTION PLAN</span>
              <b>{approved ? "Authority granted" : "5 actions · 2 held"}</b>
            </div>
            <div className={styles.planList}>
              {planSteps.map((step, index) => {
                const Icon = step.icon;
                const complete = approved ? activity > index : !step.held;
                return (
                  <div key={step.surface} data-held={!approved && step.held} data-complete={complete}>
                    <span className={styles.planIcon}><Icon size={15} /></span>
                    <span><b>{step.surface}</b><small>{step.action}</small></span>
                    {complete ? <Check size={14} /> : <i />}
                  </div>
                );
              })}
            </div>
            <div className={styles.approvalCard} data-approved={approved}>
              <div><ShieldCheck size={18} /><span><b>{approved ? "Authority recorded" : "YOUR AUTHORITY"}</b>{approved ? "Scoped consent attached to this trace." : "Send customer message + create $2,480 invoice."}</span></div>
              <button type="button" onClick={() => { setApproved(true); setActivity(0); }} disabled={approved}>
                {approved ? "Approved · executing" : "Review consequence & approve"}<ChevronRight size={14} />
              </button>
            </div>
          </aside>
        </div>
        <footer className={styles.productFooter}><span>Representative product walkthrough · current FINNOR action contracts</span><Link href="/jarvis/login">Open JARVIS <ArrowUpRight size={13} /></Link></footer>
      </div>
    </div>
  );
}

function SurfaceRail() {
  const [active, setActive] = useState(0);
  const surface = operationalSurfaces[active];
  const Icon = surface.icon;

  return (
    <div className={styles.surfaceSystem} data-tone={surface.accent}>
      <div className={styles.surfaceRail}>
        {operationalSurfaces.map((item, index) => {
          const ItemIcon = item.icon;
          return (
            <button key={item.key} type="button" aria-pressed={active === index} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)}>
              <span>0{index + 1}</span><ItemIcon size={19} /><b>{item.label}</b><small>{item.metric}</small><ArrowUpRight size={15} />
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait">
        <motion.article key={surface.key} className={styles.surfaceDetail} initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.32 }}>
          <header><span><Icon size={18} /> {surface.label.toUpperCase()} / PROJECTED STATE</span><b><i /> VERIFIED</b></header>
          <div className={styles.surfaceMetric}><strong>{surface.metric}</strong><span>After the instruction</span></div>
          <h3>{surface.headline}</h3>
          <p><span>BEFORE</span>{surface.before}</p>
          <div className={styles.surfaceRows}>{surface.rows.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b><CheckCircle2 size={14} /></div>)}</div>
        </motion.article>
      </AnimatePresence>
    </div>
  );
}

function AgentFleet() {
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setFocus((value) => (value + 1) % agentEvents.length), 2100);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={styles.agentFleet}>
      <div className={styles.agentCore}><Bot size={20} /><i /><i /><i /></div>
      <div className={styles.agentOrbit} aria-hidden="true"><i /><i /><i /></div>
      <div className={styles.agentEvents}>
        {agentEvents.map(([agent, event, latency], index) => (
          <button key={agent} type="button" data-active={focus === index} onMouseEnter={() => setFocus(index)} onFocus={() => setFocus(index)}>
            <span><i />{agent}</span><b>{event}</b><small>{latency}</small>
          </button>
        ))}
      </div>
      <div className={styles.agentTicker}><span>EVENT STREAM</span><div><i />{agentEvents[focus][0]} → {agentEvents[focus][1]}</div></div>
    </div>
  );
}

function RecoveryLab() {
  const [state, setState] = useState<"paused" | "retry" | "escalate" | "resume">("paused");
  const copy = {
    paused: ["Provider timeout", "No success assumed · context preserved"],
    retry: ["Bounded retry queued", "Idempotency key WRK-81A2:03 preserved"],
    escalate: ["Operations owner notified", "Failure, context and safe options attached"],
    resume: ["Run resumed", "Verification agent is checking actual state"],
  } as const;
  return (
    <div className={styles.recoveryLab}>
      <div className={styles.recoverySignal}><span><RefreshCcw size={20} /></span><div><small>RUN WRK-81A2 / STEP 03</small><strong>{copy[state][0]}</strong><p>{copy[state][1]}</p></div><b data-state={state}><i />{state.toUpperCase()}</b></div>
      <div className={styles.recoveryTrace}>
        {["Instruction preserved", "Context preserved", "Approval preserved", "Same receipt chain"].map((item, index) => <span key={item}><i data-live={state !== "paused" || index < 2} />{item}</span>)}
      </div>
      <div className={styles.recoveryActions}>
        <button type="button" onClick={() => setState("retry")} aria-pressed={state === "retry"}>Retry step</button>
        <button type="button" onClick={() => setState("escalate")} aria-pressed={state === "escalate"}>Escalate with context</button>
        <button type="button" onClick={() => setState("resume")} aria-pressed={state === "resume"}>Resume run</button>
      </div>
    </div>
  );
}

export default function FinnorHome() {
  const root = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState(0);
  const phaseRef = useRef(0);
  const activeChapter = operatingChapters[phase];

  useGSAP(
    () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) return;

      gsap.from("[data-hero-line]", { yPercent: 115, stagger: 0.1, duration: 1.15, ease: "power4.out", delay: 0.1 });
      gsap.from("[data-hero-fade]", { opacity: 0, y: 22, stagger: 0.09, duration: 0.75, ease: "power3.out", delay: 0.45 });
      gsap.fromTo("[data-hero-world]", { opacity: 0, scale: 0.94, rotateY: -5 }, { opacity: 1, scale: 1, rotateY: 0, duration: 1.35, ease: "power4.out", delay: 0.24 });

      gsap.utils.toArray<HTMLElement>("[data-reveal-copy]").forEach((element) => {
        gsap.fromTo(element, { opacity: 0, y: 48 }, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out", scrollTrigger: { trigger: element, start: "top 84%" } });
      });

      gsap.utils.toArray<HTMLElement>("[data-operation-chapter]").forEach((chapter, index) => {
        ScrollTrigger.create({
          trigger: chapter,
          start: "top 58%",
          end: "bottom 42%",
          onEnter: () => { phaseRef.current = index; setPhase(index); },
          onEnterBack: () => { phaseRef.current = index; setPhase(index); },
        });
      });

      gsap.utils.toArray<HTMLElement>("[data-drift]").forEach((element, index) => {
        gsap.fromTo(element, { y: index % 2 ? 70 : -35 }, { y: index % 2 ? -40 : 45, ease: "none", scrollTrigger: { trigger: element, start: "top bottom", end: "bottom top", scrub: 1.2 } });
      });
    },
    { scope: root },
  );

  return (
    <main ref={root} className={styles.site}>
      <Navigation />

      <section className={styles.hero}>
        <div className={styles.heroAmbient} aria-hidden="true"><i /><i /><i /></div>
        <div className={styles.heroGrid} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <p className={styles.heroCategory} data-hero-fade><span />THE EXECUTION LAYER FOR WATER TREATMENT OPERATIONS</p>
          <h1>
            <span className={styles.heroLine}><span data-hero-line>Tell JARVIS what</span></span>
            <span className={styles.heroLine}><span data-hero-line>must change.</span></span>
            <span className={`${styles.heroLine} ${styles.heroLineAccent}`}><span data-hero-line>Watch the operation move.</span></span>
          </h1>
          <p className={styles.heroBody} data-hero-fade>
            FINNOR assembles the customer, work, schedule, inventory, money, memory and policy behind an outcome—then plans it, governs it, executes it, recovers it and proves it.
          </p>
          <div className={styles.heroActions} data-hero-fade>
            <a className={styles.primaryButton} href={siteConfig.calendlyLink} target="_blank" rel="noreferrer">See your operation in JARVIS <ArrowUpRight size={16} /></a>
            <a className={styles.secondaryButton} href="#operation">Follow one instruction <ArrowDown size={16} /></a>
          </div>
          <div className={styles.heroProof} data-hero-fade>
            <span><b>44</b> executable action contracts</span>
            <span><b>24</b> operational domains</span>
            <span><b>01</b> inspectable chain</span>
          </div>
        </div>
        <div className={styles.heroVisual} data-hero-world><HeroCommandWorld /></div>
        <div className={styles.heroChapterRail} aria-hidden="true"><span>01</span><i /><span>THE COMMAND</span></div>
      </section>

      <section className={styles.manifesto}>
        <div data-drift className={styles.manifestoIndex}><span>FINNOR / PRODUCT TRUTH</span><b>01—06</b></div>
        <p data-reveal-copy>Software keeps records. Assistants answer questions. <strong>FINNOR changes the operating state of the business</strong>—inside defined authority, with evidence attached.</p>
        <div className={styles.manifestoLoop} aria-label="FINNOR execution loop">
          {commandStages.map((stage, index) => <span key={stage.name}><b>0{index + 1}</b>{stage.name}<i /></span>)}
        </div>
      </section>

      <section className={styles.operationStory} id="operation">
        <div className={styles.operationStage}>
          <div className={styles.operationCanvas}><DeferredWorld phase={phase} /></div>
          <StoryHud phase={phase} />
          <div className={styles.activeChapterTitle} aria-hidden="true"><span>{activeChapter.kicker}</span></div>
        </div>
        <div className={styles.chapterCopyRail}>
          {operatingChapters.map((chapter) => (
            <article key={chapter.number} data-operation-chapter>
              <div><span>{chapter.number}</span><i /></div>
              <p>{chapter.kicker}</p>
              <h2>{chapter.title}</h2>
              <p>{chapter.body}</p>
              <span className={styles.chapterSignal}>{chapter.signal}</span>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.jarvisSection} id="jarvis">
        <div className={styles.sectionHeading} data-reveal-copy>
          <span>THE COMMAND SURFACE</span>
          <h2>JARVIS makes the work legible before it makes it happen.</h2>
          <p>Not a chatbot bolted onto business software. The live surface where intent, context, plans, authority, execution, recovery and proof stay connected.</p>
        </div>
        <div className={styles.jarvisFrame} data-drift><JarvisWorkSurface /></div>
      </section>

      <section className={styles.surfacesSection} id="surfaces">
        <div className={styles.sectionHeading} data-reveal-copy>
          <span>AFTER APPROVAL</span>
          <h2>The conversation disappears. The business is visibly different.</h2>
          <p>A command is complete only when Customers, Work, Schedule and Money show the right new state—and the change can be explained.</p>
        </div>
        <SurfaceRail />
      </section>

      <section className={styles.agentsSection}>
        <div className={styles.agentsCopy} data-reveal-copy>
          <span>THE AGENT FLEET</span>
          <h2>Specialists move in parallel. JARVIS keeps one chain of command.</h2>
          <p>Context, dispatch, inventory, policy and verification agents can work concurrently without turning the operation into five disconnected conversations.</p>
          <div className={styles.agentsStats}><span><b>5</b> active specialists</span><span><b>1</b> shared trace</span><span><b>0</b> silent handoffs</span></div>
        </div>
        <AgentFleet />
      </section>

      <section className={styles.resilienceSection}>
        <div className={styles.sectionHeading} data-reveal-copy>
          <span>WHEN REALITY RESISTS</span>
          <h2>The failure path is part of the product.</h2>
          <p>FINNOR never converts a timeout into imaginary success. The run pauses with its context, authority and safe recovery options intact.</p>
        </div>
        <RecoveryLab />
      </section>

      <section className={styles.evidenceSection} id="evidence">
        <div className={styles.evidenceBackdrop} aria-hidden="true"><i /><i /><i /></div>
        <div className={styles.evidenceCopy} data-reveal-copy>
          <span>EVIDENCE / WRK-81A2</span>
          <h2>“Done” is a claim.<br />A receipt is evidence.</h2>
          <p>Every consequential run closes with the instruction, supporting context, policy decision, action result and verified operational state on the same chain.</p>
        </div>
        <div className={styles.decisionReceipt} data-drift>
          <header><div><FileCheck2 size={19} /><span>DECISION RECEIPT</span></div><b><i /> VERIFIED</b></header>
          <div className={styles.receiptObjective}><span>OBJECTIVE</span><p>Restore the Peterson installation to an executable state for Thursday without contacting the customer or creating a financial artifact before owner approval.</p></div>
          <div className={styles.receiptMatrix}>
            <div><span>EXPECTED</span><b>5 bounded outcomes</b><p>Work, technician, inventory, customer and invoice agree.</p></div>
            <div><span>ACTUAL</span><b>5 / 5 verified</b><p>0 conflicts · 0 duplicate actions · 2 approvals recorded.</p></div>
            <div><span>POLICY</span><b>set 12 · owner</b><p>Customer contact + money confirmed at 08:43:02.</p></div>
            <div><span>EVIDENCE</span><b>9 immutable events</b><p>Source references, tool results and recovery state preserved.</p></div>
          </div>
          <footer><span><Database size={13} />7 sources</span><span><ShieldCheck size={13} />policy v12</span><span><CheckCircle2 size={13} />closed 08:43:06</span><button type="button">Inspect trace <ArrowRight size={13} /></button></footer>
        </div>
      </section>

      <section className={styles.capabilityBand} aria-label="Representative FINNOR executable capabilities">
        <div>
          {["customer.upsert", "work.create", "job.reschedule", "technician.assign", "inventory.reserve", "invoice.create", "payment.collect", "proposal.send", "campaign.launch", "workflow.pause", "receipt.file", "document.sign", "customer.upsert", "work.create", "job.reschedule", "technician.assign", "inventory.reserve"].map((item, index) => <span key={`${item}-${index}`}>{item}<i /></span>)}
        </div>
      </section>

      <section className={styles.finalCta}>
        <div className={styles.finalWorld} aria-hidden="true"><DeferredWorld phase={5} rootMargin="350px 0px" /></div>
        <div className={styles.finalCopy}>
          <span>YOUR OPERATION / INSIDE JARVIS</span>
          <h2>Bring the workflow that keeps crossing desks.</h2>
          <p>We’ll map the real context, authority, systems, recovery and proof behind it—then show you how FINNOR would move it from one instruction.</p>
          <div><a href={siteConfig.calendlyLink} target="_blank" rel="noreferrer">See your operation in JARVIS <ArrowUpRight size={16} /></a><Link href="/demo">Explore the current demo <ArrowRight size={16} /></Link></div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerLead}><Link href="/">FINNOR</Link><p>The execution layer for water treatment operations.</p></div>
        <div className={styles.footerLinks}>
          <div><span>Product</span><a href="#operation">The operation</a><a href="#jarvis">JARVIS</a><a href="#surfaces">Surfaces</a></div>
          <div><span>Explore</span><Link href="/resources">Field notes</Link><Link href="/demo">Demo</Link><Link href="/trust-safety">Trust &amp; safety</Link></div>
          <div><span>Company</span><a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a><a href={siteConfig.calendlyLink}>Book a review</a></div>
          <div><span>Legal</span><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
        </div>
        <div className={styles.footerBase}><span>© {new Date().getFullYear()} FINNOR</span><span>Built for the work behind clean water.</span></div>
      </footer>
    </main>
  );
}
