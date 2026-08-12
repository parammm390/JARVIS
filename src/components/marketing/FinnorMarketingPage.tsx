"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDot,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useReducedMotion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { siteConfig } from "@/config/site";
import { FinnorMark } from "@/components/rebuild/FinnorMark";
import FinnorNavigation from "@/components/rebuild/FinnorNavigation";

import styles from "./FinnorMarketingPage.module.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const MarketingLiveSystem = dynamic(() => import("./MarketingLiveSystems"), {
  loading: () => <div className={styles.liveSystemLoading} aria-hidden="true"><i /><i /><i /></div>,
});

export type FinnorMarketingRoute = "product" | "capabilities" | "how-it-works" | "pricing" | "faq";

type PageTone = "light" | "dark";

type ActionLinkProps = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet";
  external?: boolean;
};

const surfaceItems = [
  {
    name: "Customers",
    verb: "Keep the promise attached",
    copy: "Identity, conversation, history and the next commitment stay connected to the same work root.",
    accent: "electric",
  },
  {
    name: "Work",
    verb: "Turn intent into a job",
    copy: "Requests become bounded work with owners, dependencies, status and a clear definition of done.",
    accent: "blue",
  },
  {
    name: "Schedule",
    verb: "Make the day executable",
    copy: "Availability, route, technician and customer timing are planned together instead of reconciled later.",
    accent: "violet",
  },
  {
    name: "Money",
    verb: "Close the commercial loop",
    copy: "Quotes, invoices, payments and collections remain downstream of the work and its authority boundary.",
    accent: "orange",
  },
] as const;

const productTrace = [
  ["Context", "Customer, work, schedule, equipment and policy resolved", "grounded"],
  ["Plan", "Dependencies and bounded actions assembled", "ready"],
  ["Authority", "Allowed, held and escalated actions separated", "checked"],
  ["Execution", "Systems activated with an attached work root", "running"],
  ["Evidence", "Actual state reconciled and receipt preserved", "closed"],
] as const;

const capabilities = [
  {
    key: "ground",
    title: "Ground the operation",
    short: "Resolve the facts",
    copy: "FINNOR assembles the customer, work root, appointment, equipment, inventory, money and policy context that a consequential decision depends on. Contradictions and unknowns stay visible.",
    proof: "Sources, freshness, confidence and unresolved questions travel with the plan.",
    accent: "electric",
  },
  {
    key: "plan",
    title: "Plan the change",
    short: "Order the work",
    copy: "JARVIS turns an outcome into a causal sequence of bounded actions. Dependencies are explicit, so a customer promise does not outrun the records it relies on.",
    proof: "The proposed plan shows expected changes before any live system is touched.",
    accent: "blue",
  },
  {
    key: "authority",
    title: "Check authority",
    short: "Know what may run",
    copy: "Risk tier, tenant policy, effective version and confirmation requirements are evaluated before execution. Missing authority resolves to a hold, not silent permission.",
    proof: "Allowed, held, denied and escalated actions are distinct states in the trace.",
    accent: "violet",
  },
  {
    key: "execute",
    title: "Activate the work",
    short: "Change the right records",
    copy: "Configured agents and systems act through typed contracts with an attached work root, idempotency controls and the least-necessary scope.",
    proof: "Tool acknowledgement is only an intermediate event; actual operating state still has to agree.",
    accent: "orange",
  },
  {
    key: "recover",
    title: "Recover safely",
    short: "Keep failure controllable",
    copy: "Timeouts, partial responses and provider failures become durable recovery states. Retry, pause, escalation, dead-letter and supported compensation preserve causality.",
    proof: "An uncertain delivery never turns into an imaginary success.",
    accent: "electric",
  },
  {
    key: "prove",
    title: "Leave evidence",
    short: "Close the chain",
    copy: "The result is reconciled against the source systems that define truth. A decision receipt keeps the objective, plan, policy, approval and actual outcome together.",
    proof: "Operators can inspect what changed, why it was allowed and what really happened.",
    accent: "blue",
  },
] as const;

const flowStages = [
  {
    key: "instruction",
    title: "Instruction",
    prompt: "Restore the Peterson installation to a Thursday-ready state.",
    copy: "An outcome enters by text, voice, webhook or worker. The input is captured as an objective before it is treated as a task list.",
    output: "Objective fixed to a durable work trace",
    color: "electric",
  },
  {
    key: "context",
    title: "Context",
    prompt: "Customer, work root, route, stock and policy are resolved.",
    copy: "JARVIS gathers the records and memory that give the instruction operational meaning. Unknown information stays unknown instead of being filled with confident prose.",
    output: "Sources resolved and contradictions surfaced",
    color: "blue",
  },
  {
    key: "plan",
    title: "Plan",
    prompt: "Set dependencies before changing the day.",
    copy: "The planner proposes a causal sequence: what must be true first, which contracts can run, and what expected change would close each step.",
    output: "Executable plan with bounded actions",
    color: "violet",
  },
  {
    key: "authority",
    title: "Authority",
    prompt: "Policy determines what runs, waits or escalates.",
    copy: "Risk, tenant policy, role and confirmation boundaries are evaluated against the plan. A missing approval is a first-class hold.",
    output: "Allowed, held and escalated actions separated",
    color: "orange",
  },
  {
    key: "execution",
    title: "Execution",
    prompt: "Activate the configured systems in dependency order.",
    copy: "Agents and system adapters make the approved changes with typed inputs, idempotency controls and an attached work root.",
    output: "Observed tool outcomes and changed records",
    color: "electric",
  },
  {
    key: "recovery",
    title: "Recovery",
    prompt: "A provider disagrees. The work remains controllable.",
    copy: "Retries, backoff, pause, escalation, dead-letter and supported compensation preserve the original instruction while the system reconciles reality.",
    output: "Recovery state, not silent success",
    color: "blue",
  },
  {
    key: "evidence",
    title: "Evidence",
    prompt: "Actual state matches the expected outcome.",
    copy: "The chain closes only when source records show the intended operating state. The receipt keeps the reasoning, authority and result inspectable.",
    output: "Decision receipt attached to the work root",
    color: "violet",
  },
] as const;

const deliverableGroups = [
  {
    title: "Operating surfaces",
    copy: "The business objects that need to agree for a customer promise to be real.",
    items: [
      "Customer / CRM and communication",
      "Quotes and proposals",
      "Scheduling",
      "Dispatch",
      "Work orders",
      "Field / service",
      "Inventory",
      "Invoices, payments and collections",
    ],
  },
  {
    title: "Governed execution",
    copy: "The control layer that decides what can happen and proves what did.",
    items: ["Agents", "Policy and approval control", "Recovery", "Evidence"],
  },
  {
    title: "Deployment support",
    copy: "The work required to make one consequential workflow trustworthy in production.",
    items: ["Onboarding", "Configured integrations", "Deployment support"],
  },
] as const;

const faqItems = [
  {
    question: "What is FINNOR?",
    answer:
      "FINNOR is the governed execution layer for water-treatment companies. It turns an instruction into grounded context, an executable plan, an authority decision, controlled action, recovery when reality resists and evidence of the actual result.",
  },
  {
    question: "What is JARVIS?",
    answer:
      "JARVIS is FINNOR’s command surface. It is where operators can state an outcome, inspect the context and proposed plan, see what policy allows, authorize held actions and follow the work through execution and evidence. It is not a chatbot pasted over disconnected software.",
  },
  {
    question: "Is FINNOR a CRM, ERP or field-service replacement?",
    answer:
      "No. FINNOR coordinates the operating state across the configured records and systems that a water-treatment company already relies on. The exact source of truth for customers, work, schedule, inventory and money is defined during deployment; FINNOR does not invent an integration list or assume every system is authoritative.",
  },
  {
    question: "How does an instruction become a real action?",
    answer:
      "The execution chain is Instruction → Context → Plan → Authority → Execution → Recovery → Evidence. The instruction is fixed to a work trace, relevant records are resolved, a causal plan is proposed, policy and approval are checked, typed actions run, failures remain recoverable and the final state is reconciled against evidence.",
  },
  {
    question: "Can FINNOR contact customers or move money automatically?",
    answer:
      "Only when the deployment’s authority policy permits the specific action. Customer contact, invoices, payments and collections can cross a confirmation boundary. Missing authority resolves to a hold or escalation; the interface does not turn a prompt into unlimited permission.",
  },
  {
    question: "What happens when a connected system fails?",
    answer:
      "A tool acknowledgement is not treated as success. FINNOR preserves the original instruction and recovery state while it handles retry, backoff, pause, escalation, dead-letter or supported compensation. The workflow stays open until the actual operating state is known.",
  },
  {
    question: "How does FINNOR handle unknown or conflicting information?",
    answer:
      "Unknown information remains unknown, and contradictions are surfaced as part of context and planning. The system can hold the work for an operator or require a source decision rather than quietly guessing and turning that guess into a customer or financial action.",
  },
  {
    question: "What does the evidence record contain?",
    answer:
      "A decision receipt can connect the objective, source records, proposed plan, policy version, risk, approval, tool outcomes, recovery state, exact identifiers and actual result. The important test is whether the source systems show the expected change—not whether a message says ‘done.’",
  },
  {
    question: "How is pricing determined?",
    answer:
      "FINNOR does not publish a numeric price because deployment scope changes with the workflow, source data, authority boundaries, configured systems, recovery requirements, onboarding and support. Contact us for a scoped deployment conversation and a quote tied to the operation you want to govern.",
  },
] as const;

function Eyebrow({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "dark" }) {
  return (
    <span className={`${styles.eyebrow} ${tone === "dark" ? styles.eyebrowDark : ""}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

function ActionLink({ href, children, variant = "primary", external = false }: ActionLinkProps) {
  const className = `${styles.actionLink} ${styles[`actionLink${variant[0].toUpperCase()}${variant.slice(1)}`]}`;
  const content = (
    <>
      <span>{children}</span>
      <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden="true" />
    </>
  );

  if (external || href.startsWith("mailto:")) {
    return (
      <a className={className} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
        {content}
      </a>
    );
  }

  return (
    <Link className={className} href={href}>
      {content}
    </Link>
  );
}

function CommandSurface() {
  return (
    <div className={styles.commandSurface} data-reveal>
      <div className={styles.commandSurfaceHeader}>
        <span><CircleDot size={12} />JARVIS / COMMAND SURFACE</span>
        <b><i />READY</b>
      </div>
      <div className={styles.commandPrompt}>
        <small>INSTRUCTION</small>
        <strong>Restore the Peterson installation to a Thursday-ready state.</strong>
      </div>
      <div className={styles.commandTrace}>
        {productTrace.map(([title, copy, state], index) => (
          <div className={styles.commandTraceRow} key={title} data-state={state}>
            <span className={styles.commandTraceDot} aria-hidden="true"><Check size={11} /></span>
            <div><b>{title}</b><p>{copy}</p></div>
            <small>{index === productTrace.length - 1 ? "verified" : state}</small>
          </div>
        ))}
      </div>
      <div className={styles.commandSurfaceFooter}>
        <span><ShieldCheck size={13} />Policy checked</span>
        <span><Waypoints size={13} />Evidence follows</span>
      </div>
    </div>
  );
}

function MarketingFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerLead}>
          <Link href="/" className={styles.footerWordmark} aria-label="FINNOR home"><FinnorMark /><span>FINNOR</span></Link>
          <p>Governed execution for water-treatment companies.<br />The work behind clean water, made inspectable.</p>
        </div>
        <div className={styles.footerColumns}>
          <div>
            <span>Product</span>
            <Link href="/product">Product</Link>
            <Link href="/capabilities">Capabilities</Link>
            <Link href="/how-it-works">How it works</Link>
          </div>
          <div>
            <span>Explore</span>
            <Link href="/resources">Resources</Link>
            <Link href="/trust-safety">Trust &amp; safety</Link>
            <Link href="/faq">FAQ</Link>
          </div>
          <div>
            <span>Work with FINNOR</span>
            <Link href="/pricing">Pricing</Link>
            <a href={siteConfig.calendlyLink} target="_blank" rel="noreferrer">Plan your deployment</a>
            <Link href="/jarvis/login">JARVIS sign in</Link>
          </div>
          <div>
            <span>Contact</span>
            <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </div>
        <div className={styles.footerBase}>
          <span>© {new Date().getFullYear()} FINNOR</span>
          <span>One operating chain from instruction to verified change.</span>
        </div>
      </div>
    </footer>
  );
}

function ProductPage() {
  return (
    <>
      <section className={`${styles.hero} ${styles.heroDark} ${styles.productHero}`}>
        <div className={styles.heroGrid} aria-hidden="true" />
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <Eyebrow tone="dark">The governed execution layer</Eyebrow>
            <h1>Run the outcome.<br /><em>Not the software.</em></h1>
            <p>FINNOR is built for water-treatment companies whose customer promise crosses people, field work, schedules, inventory, invoices and policy. JARVIS is the command surface that assembles the context, plans the change, checks authority, activates the work and leaves evidence.</p>
            <div className={styles.heroActions}>
              <ActionLink href={siteConfig.calendlyLink} external>Plan your deployment</ActionLink>
              <ActionLink href="/how-it-works" variant="secondary">See how it works</ActionLink>
            </div>
            <div className={styles.heroNote}><span />One instruction can stay attached to the whole operating chain.</div>
          </div>
          <div className={styles.heroVisual}><CommandSurface /></div>
        </div>
      </section>

      <MarketingLiveSystem route="product" />

      <section className={`${styles.section} ${styles.productSection}`}>
        <div className={styles.sectionHeader} data-reveal>
          <Eyebrow>The operating model</Eyebrow>
          <h2>One command surface.<br /><span>Four surfaces of work.</span></h2>
          <p>JARVIS keeps the customer promise, the work, the day and the commercial outcome in one causal context. FINNOR changes the state of the operation, not just the words around it.</p>
        </div>
        <div className={styles.surfaceRail} data-reveal>
          {surfaceItems.map((item, index) => (
            <article className={styles.surfaceRailItem} data-accent={item.accent} key={item.name}>
              <span className={styles.surfaceRailIndex}>0{index + 1}</span>
              <h3>{item.name}</h3>
              <strong>{item.verb}</strong>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.productTraceSection}`}>
        <div className={styles.splitSection}>
          <div className={styles.splitIntro} data-reveal>
            <Eyebrow>What FINNOR actually does</Eyebrow>
            <h2>Context becomes a plan before it becomes a click.</h2>
            <p>Each action remains tied to the records, policy and authority that make it legitimate. JARVIS is the place to understand the change before you authorize it.</p>
            <Link className={styles.textLink} href="/trust-safety">Read the authority model <ArrowRight size={15} /></Link>
          </div>
          <div className={styles.tracePanel} data-reveal>
            <div className={styles.tracePanelHeader}><span>Representative execution trace</span><b>WORK ROOT / PETERSON</b></div>
            <div className={styles.tracePanelBody}>
              {productTrace.map(([title, copy, state]) => (
                <div className={styles.tracePanelRow} key={title}>
                  <span className={styles.tracePanelMarker} data-state={state} />
                  <div><small>{title}</small><p>{copy}</p></div>
                  <ArrowRight size={14} aria-hidden="true" />
                </div>
              ))}
            </div>
            <div className={styles.tracePanelFoot}><span>Unknowns stay visible</span><span>Actual state closes the chain</span></div>
          </div>
        </div>
      </section>

      <section className={styles.statementBand} data-reveal>
        <div className={styles.statementBandInner}>
          <Sparkles size={23} aria-hidden="true" />
          <p>JARVIS is the command surface.<br /><strong>FINNOR is the governed execution layer.</strong></p>
          <Link href="/capabilities">Explore the capabilities <ArrowUpRight size={15} /></Link>
        </div>
      </section>

      <section className={`${styles.section} ${styles.productCtaSection}`} data-reveal>
        <div className={styles.ctaPanel}>
          <div>
            <Eyebrow tone="dark">Bring the consequential workflow</Eyebrow>
            <h2>Make the chain visible before you widen it.</h2>
          </div>
          <div>
            <p>Start with one customer promise that keeps crossing desks. We will trace its sources, actions, authority boundary, recovery path and proof of outcome.</p>
            <ActionLink href={siteConfig.calendlyLink} external>Plan your deployment</ActionLink>
          </div>
        </div>
      </section>
    </>
  );
}

function CapabilityAccordion() {
  const [active, setActive] = useState(0);

  return (
    <div className={styles.capabilityAccordion} aria-label="FINNOR capabilities">
      {capabilities.map((capability, index) => {
        const isActive = active === index;
        const panelId = `capability-panel-${capability.key}`;
        const tabId = `capability-tab-${capability.key}`;

        return (
          <article className={styles.capabilityPanel} data-active={isActive} data-accent={capability.accent} key={capability.key}>
            <button
              className={styles.capabilityTab}
              type="button"
              id={tabId}
              aria-expanded={isActive}
              aria-controls={panelId}
              onClick={() => setActive(index)}
            >
              <span className={styles.capabilityTabNumber}>0{index + 1}</span>
              <span className={styles.capabilityTabTitle}><strong>{capability.title}</strong><small>{capability.short}</small></span>
              <ChevronDown size={17} aria-hidden="true" />
            </button>
            <div className={styles.capabilityContent} role="region" id={panelId} aria-labelledby={tabId} hidden={!isActive}>
              <p>{capability.copy}</p>
              <div className={styles.capabilityProof}><Check size={14} /><span>{capability.proof}</span></div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function CapabilitiesPage() {
  return (
    <>
      <section className={`${styles.hero} ${styles.heroLight} ${styles.capabilitiesHero}`}>
        <div className={styles.paperGrid} aria-hidden="true" />
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <Eyebrow>Capabilities follow the operating chain</Eyebrow>
            <h1>Make the whole operation <em>executable.</em></h1>
            <p>FINNOR gives water-treatment companies a governed way to move from instruction to operating change. Each capability exists to keep the next decision grounded, authorized and recoverable.</p>
            <div className={styles.heroActions}>
              <ActionLink href="/how-it-works">Walk the execution chain</ActionLink>
              <ActionLink href="/pricing" variant="secondary">Scope a deployment</ActionLink>
            </div>
          </div>
          <div className={styles.capabilityHeroVisual} data-reveal>
            <div className={styles.capabilityHeroCore}><Waypoints size={28} /><span>JARVIS</span><b>command surface</b></div>
            <div className={`${styles.capabilityOrbit} ${styles.capabilityOrbitOne}`}><span>Context</span><i /></div>
            <div className={`${styles.capabilityOrbit} ${styles.capabilityOrbitTwo}`}><span>Authority</span><i /></div>
            <div className={`${styles.capabilityOrbit} ${styles.capabilityOrbitThree}`}><span>Evidence</span><i /></div>
            <div className={styles.capabilityHeroCaption}>Every action inherits the work root.</div>
          </div>
        </div>
      </section>

      <MarketingLiveSystem route="capabilities" />

      <section className={`${styles.section} ${styles.capabilitiesSection}`}>
        <div className={styles.sectionHeader} data-reveal>
          <Eyebrow>Where the control lives</Eyebrow>
          <h2>Six capabilities.<br /><span>One accountable chain.</span></h2>
          <p>Open a capability to see the operational promise and the proof that makes it more than an interface feature.</p>
        </div>
        <CapabilityAccordion />
      </section>

      <section className={`${styles.section} ${styles.surfaceMatrixSection}`}>
        <div className={styles.matrixHeader} data-reveal>
          <div><Eyebrow>The operating surfaces</Eyebrow><h2>Coordination stays attached to the thing that matters.</h2></div>
          <p>Customers, Work, Schedule and Money are not isolated modules in the execution model. They are different views of the same promise and its outcome.</p>
        </div>
        <div className={styles.surfaceMatrix} data-reveal>
          <div className={styles.surfaceMatrixHead}><span>Surface</span><span>FINNOR keeps aligned</span><span>Operator can inspect</span></div>
          {surfaceItems.map((item) => (
            <div className={styles.surfaceMatrixRow} key={item.name}>
              <strong>{item.name}</strong>
              <span>{item.verb}</span>
              <p>{item.copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.marqueeSection} aria-label="Ways to state an instruction" data-reveal>
        <div className={styles.marqueeIntro}><span>One chain, many entry points</span><p>Typed instructions, voice, webhooks and workers enter the same governed model.</p></div>
        <div className={styles.marquee}>
          <div className={styles.marqueeTrack}>
            {["Typed instruction", "Voice", "Webhook", "Worker", "Context", "Policy", "Recovery", "Evidence", "Typed instruction", "Voice", "Webhook", "Worker"].map((item, index) => <span key={`${item}-${index}`}>{item}<i /></span>)}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.capabilitiesCtaSection}`} data-reveal>
        <div className={styles.outlineCta}>
          <div><Eyebrow>Scope the right boundary</Eyebrow><h2>Start with the work that keeps escaping the system.</h2></div>
          <ActionLink href={siteConfig.calendlyLink} external>Plan your deployment</ActionLink>
        </div>
      </section>
    </>
  );
}

function FlowLab() {
  const [activeStage, setActiveStage] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const reducedMotion = useReducedMotion();
  const flowRoot = useRef<HTMLDivElement>(null);
  const active = flowStages[activeStage];

  useEffect(() => {
    if (isPaused || reducedMotion) return;
    const timer = window.setTimeout(() => setActiveStage((current) => (current + 1) % flowStages.length), 4200);
    return () => window.clearTimeout(timer);
  }, [activeStage, isPaused, reducedMotion]);

  useGSAP(() => {
    if (reducedMotion) return;
    const node = flowRoot.current?.querySelector<HTMLElement>(`[data-flow-node="${active.key}"]`);
    if (node) {
      gsap.fromTo(node, { scale: 0.94, opacity: 0.58 }, { scale: 1, opacity: 1, duration: 0.7, ease: "power3.out" });
    }
    const signal = flowRoot.current?.querySelector<HTMLElement>("[data-flow-signal]");
    if (signal) {
      gsap.fromTo(signal, { xPercent: -35, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 0.8, ease: "power2.out" });
    }
  }, { scope: flowRoot, dependencies: [activeStage, reducedMotion] });

  return (
    <div className={styles.flowLab} ref={flowRoot}>
      <div className={styles.flowLabHeader}>
        <div><span><CircleDot size={12} />Live execution trace</span><p>Tap a stage or let the chain advance.</p></div>
        <button className={styles.flowControl} type="button" onClick={() => setIsPaused((paused) => !paused)} aria-label={isPaused ? "Play flow animation" : "Pause flow animation"}>
          {isPaused ? <Play size={14} /> : <Pause size={14} />}
          <span>{isPaused ? "Play" : "Pause"}</span>
        </button>
      </div>
      <div className={styles.flowRail}>
        <div className={styles.flowRailLine} aria-hidden="true"><span style={{ width: `${(activeStage / (flowStages.length - 1)) * 100}%` }} /></div>
        {flowStages.map((stage, index) => (
          <button
            className={styles.flowStageButton}
            type="button"
            key={stage.key}
            data-active={activeStage === index}
            onClick={() => { setActiveStage(index); setIsPaused(true); }}
            aria-label={`Show ${stage.title} stage`}
            aria-pressed={activeStage === index}
          >
            <span className={styles.flowStageDot}><i /></span>
            <strong>{stage.title}</strong>
          </button>
        ))}
      </div>
      <div className={styles.flowBody} aria-live="polite">
        <div className={styles.flowNarrative}>
          <Eyebrow tone="dark">{active.title}</Eyebrow>
          <h3>{active.prompt}</h3>
          <p>{active.copy}</p>
          <div className={styles.flowOutput}><Check size={14} /><span>{active.output}</span></div>
        </div>
        <div className={styles.flowVisual}>
          <div className={styles.flowVisualGrid} aria-hidden="true" />
          <div className={styles.flowSignal} data-flow-signal aria-hidden="true" />
          <div className={styles.flowNodeField}>
            {flowStages.map((stage, index) => (
              <div className={styles.flowNode} data-flow-node={stage.key} data-active={activeStage === index} key={stage.key}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{stage.title}</strong>
              </div>
            ))}
          </div>
          <div className={styles.flowVisualFooter}><span>Instruction</span><span>Actual state</span></div>
        </div>
      </div>
    </div>
  );
}

function HowItWorksPage() {
  return (
    <>
      <section className={`${styles.hero} ${styles.heroDark} ${styles.howHero}`}>
        <div className={styles.heroGrid} aria-hidden="true" />
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <Eyebrow tone="dark">The execution chain</Eyebrow>
            <h1>Instruction <span>→</span> evidence.<br /><em>Authority in the middle.</em></h1>
            <p>FINNOR does not jump from a prompt to a side effect. It moves through a visible chain that keeps context, policy, recovery and proof attached to the work.</p>
            <div className={styles.heroActions}><ActionLink href="#flow-lab">Run the chain</ActionLink><ActionLink href="/trust-safety" variant="secondary">See the control model</ActionLink></div>
          </div>
          <div className={styles.heroStageLine} data-reveal>
            {flowStages.map((stage, index) => <span key={stage.key} data-accent={stage.color}><i>{String(index + 1).padStart(2, "0")}</i>{stage.title}</span>)}
          </div>
        </div>
      </section>

      <MarketingLiveSystem route="how-it-works" />

      <section className={`${styles.section} ${styles.howSection}`} id="flow-lab">
        <div className={styles.sectionHeader} data-reveal>
          <Eyebrow>Follow one consequential instruction</Eyebrow>
          <h2>Every stage earns the next one.</h2>
          <p>The live trace is illustrative, but the mechanics are the product truth: facts before plans, authority before action, actual state before completion.</p>
        </div>
        <FlowLab />
      </section>

      <section className={`${styles.section} ${styles.chainSection}`}>
        <div className={styles.chainSplit}>
          <div data-reveal><Eyebrow>Why the order matters</Eyebrow><h2 data-scrub-copy>Planning without authority is a suggestion. Execution without evidence is a guess.</h2></div>
          <div className={styles.chainNotes} data-reveal>
            <article data-stack-card><span>Between Plan and Authority</span><h3>Policy decides the boundary.</h3><p>JARVIS can show a useful plan without treating that plan as permission. Holds, approvals and escalations are part of the chain.</p></article>
            <article data-stack-card><span>Between Execution and Evidence</span><h3>Reality gets the final word.</h3><p>Provider acknowledgements do not close the work. FINNOR reconciles the source-system state and preserves the result as evidence.</p></article>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.howCtaSection}`} data-reveal>
        <div className={styles.darkCta}>
          <div><Eyebrow tone="dark">One workflow is enough to start</Eyebrow><h2>Trace the work before you automate more of it.</h2></div>
          <ActionLink href={siteConfig.calendlyLink} external>Plan your deployment</ActionLink>
        </div>
      </section>
    </>
  );
}

function DeploymentScopeBoard() {
  return (
    <div className={styles.scopeBoard} data-reveal>
      <div className={styles.scopeBoardHeader}><span>Deployment scope</span><b>QUOTE AFTER OPERATING REVIEW</b></div>
      <div className={styles.scopeBoardBody}>
        <div className={styles.scopeLine}><span>Outcome</span><strong>One consequential workflow, end to end</strong></div>
        <div className={styles.scopeLine}><span>Authority</span><strong>What may run, what must wait, what escalates</strong></div>
        <div className={styles.scopeLine}><span>Evidence</span><strong>Which source states prove the work is complete</strong></div>
        <div className={styles.scopeLine}><span>Support</span><strong>Onboarding, configured integrations and deployment guidance</strong></div>
      </div>
      <div className={styles.scopeBoardFooter}><ShieldCheck size={14} /><span>Pricing follows the boundary you want to govern.</span></div>
    </div>
  );
}

function PricingPage() {
  return (
    <>
      <section className={`${styles.hero} ${styles.heroLight} ${styles.pricingHero}`}>
        <div className={styles.paperGrid} aria-hidden="true" />
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <Eyebrow>Scoped deployment pricing</Eyebrow>
            <h1>Price the scope of the operation.<br /><em>Not a seat count.</em></h1>
            <p>FINNOR is deployed around a real water-treatment workflow, its source records, authority boundaries, recovery requirements and proof of outcome. Contact us for pricing tied to the chain you want to make executable.</p>
            <div className={styles.heroActions}>
              <ActionLink href={`mailto:${siteConfig.contactEmail}?subject=FINNOR deployment pricing`}>Contact for pricing</ActionLink>
              <ActionLink href={siteConfig.calendlyLink} external variant="secondary">Plan your deployment</ActionLink>
            </div>
          </div>
          <DeploymentScopeBoard />
        </div>
      </section>

      <MarketingLiveSystem route="pricing" />

      <section className={`${styles.section} ${styles.pricingSection}`}>
        <div className={styles.sectionHeader} data-reveal>
          <Eyebrow>What a deployment includes</Eyebrow>
          <h2>Make the deliverables explicit before the quote.</h2>
          <p>Pricing follows the work that must become trustworthy. The scope conversation names the operating surfaces, control layer and support required for the specific company.</p>
        </div>
        <div className={styles.deliverableGroups} data-reveal>
          {deliverableGroups.map((group) => (
            <article className={styles.deliverableGroup} key={group.title}>
              <div className={styles.deliverableGroupHeader}><span>{group.title}</span><ArrowUpRight size={16} aria-hidden="true" /></div>
              <p>{group.copy}</p>
              <ul>
                {group.items.map((item) => <li key={item}><Check size={14} /><span>{item}</span></li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.pricingStepsSection}`}>
        <div className={styles.pricingStepsHeader} data-reveal><Eyebrow>How the scope gets set</Eyebrow><h2>The quote follows decisions, not vague usage.</h2></div>
        <div className={styles.pricingSteps} data-reveal>
          <article><span>Operating review</span><h3>Choose the workflow.</h3><p>We trace the outcome, current failure mode, work root and business surfaces involved.</p></article>
          <article><span>Boundary design</span><h3>Define authority and proof.</h3><p>We identify what may run, where approval enters, how failure recovers and which source states prove completion.</p></article>
          <article><span>Deployment scope</span><h3>Support the change.</h3><p>Onboarding, configured integrations and deployment support are included in the scope that makes the chain production-ready.</p></article>
        </div>
      </section>

      <section className={`${styles.section} ${styles.pricingCtaSection}`} data-reveal>
        <div className={styles.outlineCta}>
          <div><Eyebrow>Contact for pricing</Eyebrow><h2>Bring one workflow. Leave with a boundary you can defend.</h2></div>
          <ActionLink href={`mailto:${siteConfig.contactEmail}?subject=FINNOR deployment pricing`}>Contact for pricing</ActionLink>
        </div>
      </section>
    </>
  );
}

function FaqList() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const idPrefix = useId().replace(/:/g, "");

  return (
    <div className={styles.faqList}>
      {faqItems.map((item, index) => {
        const isOpen = openIndex === index;
        const buttonId = `${idPrefix}-faq-button-${index}`;
        const panelId = `${idPrefix}-faq-panel-${index}`;

        return (
          <div className={styles.faqItem} data-open={isOpen} key={item.question}>
            <button className={styles.faqQuestion} type="button" id={buttonId} aria-expanded={isOpen} aria-controls={panelId} onClick={() => setOpenIndex(isOpen ? null : index)}>
              <span>{item.question}</span>
              <ChevronDown size={19} aria-hidden="true" />
            </button>
            <div className={styles.faqAnswer} id={panelId} role="region" aria-labelledby={buttonId} aria-hidden={!isOpen}>
              <div><p>{item.answer}</p></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FaqPage() {
  return (
    <>
      <section className={`${styles.hero} ${styles.heroLight} ${styles.faqHero}`}>
        <div className={styles.paperGrid} aria-hidden="true" />
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <Eyebrow>Questions worth answering before activation</Eyebrow>
            <h1>Direct answers for the work behind the interface.</h1>
            <p>FINNOR is designed for consequential operating work. These answers cover the product truth, authority model, recovery behavior, evidence and deployment scope that matter before a company widens automation.</p>
            <div className={styles.heroActions}><ActionLink href="/trust-safety">Read trust &amp; safety</ActionLink><ActionLink href={siteConfig.calendlyLink} external variant="secondary">Plan your deployment</ActionLink></div>
          </div>
          <div className={styles.faqHeroAside} data-reveal>
            <div className={styles.faqHeroAsideTop}><span>Decision receipt</span><b><i />INSPECTABLE</b></div>
            <div className={styles.faqHeroAsideBody}><CircleCheck size={32} /><strong>“Done” is not a chat response.</strong><p>It is an actual operating state with the authority and evidence to support it.</p></div>
            <div className={styles.faqHeroAsideBottom}><span>Objective</span><span>Policy</span><span>Outcome</span></div>
          </div>
        </div>
      </section>

      <MarketingLiveSystem route="faq" />

      <section className={`${styles.section} ${styles.faqSection}`}>
        <div className={styles.faqLayout}>
          <div className={styles.faqIntro} data-reveal><Eyebrow>FINNOR, plainly</Eyebrow><h2>Ask what happens when the work gets real.</h2><p>Use the answers below as a starting point for a deployment conversation. The exact source records, action contracts and policies are scoped with each company.</p><Link className={styles.textLink} href="/resources">Read the field notes <ArrowRight size={15} /></Link></div>
          <FaqList />
        </div>
      </section>

      <section className={`${styles.section} ${styles.faqCtaSection}`} data-reveal>
        <div className={styles.darkCta}>
          <div><Eyebrow tone="dark">Still have a consequential question?</Eyebrow><h2>Bring the workflow, not a hypothetical.</h2></div>
          <ActionLink href={`mailto:${siteConfig.contactEmail}?subject=FINNOR question`}>Contact FINNOR</ActionLink>
        </div>
      </section>
    </>
  );
}

const pageTones: Record<FinnorMarketingRoute, PageTone> = {
  product: "dark",
  capabilities: "light",
  "how-it-works": "dark",
  pricing: "light",
  faq: "light",
};

function renderPage(route: FinnorMarketingRoute) {
  switch (route) {
    case "product":
      return <ProductPage />;
    case "capabilities":
      return <CapabilitiesPage />;
    case "how-it-works":
      return <HowItWorksPage />;
    case "pricing":
      return <PricingPage />;
    case "faq":
      return <FaqPage />;
  }
}

export default function FinnorMarketingPage({ route }: { route: FinnorMarketingRoute }) {
  const pageRoot = useRef<HTMLElement>(null);

  useGSAP(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const revealElements = gsap.utils.toArray<HTMLElement>("[data-reveal]");
    revealElements.forEach((element) => {
      gsap.fromTo(element, { opacity: 0, y: 30 }, {
        opacity: 1,
        y: 0,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: { trigger: element, start: "top 86%", once: true },
      });
    });

    const scaleElements = gsap.utils.toArray<HTMLElement>("[data-scale-reveal]");
    scaleElements.forEach((element) => {
      gsap.fromTo(element, { opacity: 0.42, scale: 0.96 }, {
        opacity: 1,
        scale: 1,
        ease: "none",
        scrollTrigger: { trigger: element, start: "top 90%", end: "top 30%", scrub: 0.9 },
      });
    });

    gsap.utils.toArray<HTMLElement>("[data-scrub-copy]").forEach((element) => {
      gsap.fromTo(element, { opacity: 0.24 }, {
        opacity: 1,
        ease: "none",
        scrollTrigger: { trigger: element, start: "top 78%", end: "bottom 38%", scrub: 0.8 },
      });
    });

    gsap.utils.toArray<HTMLElement>("[data-stack-card]").forEach((element, index) => {
      gsap.fromTo(element, { opacity: 0.48, y: 26 + index * 9, scale: 0.97 }, {
        opacity: 1,
        y: 0,
        scale: 1,
        ease: "none",
        scrollTrigger: { trigger: element, start: "top 86%", end: "top 48%", scrub: 0.75 },
      });
    });
  }, { scope: pageRoot, dependencies: [route] });

  return (
    <main className={styles.marketingPage} data-page={route} ref={pageRoot} id="main-content">
      <a className={styles.skipLink} href="#page-content">Skip to content</a>
      <FinnorNavigation tone={pageTones[route]} />
      <div id="page-content">{renderPage(route)}</div>
      <MarketingFooter />
    </main>
  );
}
