"use client";

import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  ShieldCheck,
  UsersRound,
  Wrench,
} from "lucide-react";
import { useState } from "react";

import styles from "./FinnorHome.module.css";

const planSteps = [
  ["Work", "Move installation W-2187 to Thursday"],
  ["Schedule", "Assign Marcus; validate travel window"],
  ["Inventory", "Reserve softener system WS-48"],
  ["Customer", "Prepare reschedule message"],
  ["Money", "Prepare remaining invoice for $2,480"],
] as const;

export function JarvisCommandSurface() {
  const [approved, setApproved] = useState(false);

  return (
    <div className={styles.jarvisShell} aria-label="Representative JARVIS command surface">
      <aside className={styles.jarvisRail}>
        <div className={styles.jarvisMark}>F</div>
        <nav aria-label="JARVIS product surfaces">
          <a className={styles.railActive} aria-label="JARVIS command" href="/jarvis">
            <span>J</span>
          </a>
          <a aria-label="Customers" href="/jarvis/customers"><UsersRound size={16} /></a>
          <a aria-label="Work" href="/jarvis/work"><Wrench size={16} /></a>
          <a aria-label="Schedule" href="/jarvis/schedule"><Clock3 size={16} /></a>
          <a aria-label="Money" href="/jarvis/money"><CircleDollarSign size={16} /></a>
        </nav>
        <span className={styles.railStatus} />
      </aside>

      <div className={styles.jarvisMain}>
        <header className={styles.jarvisTopbar}>
          <div>
            <span className={styles.jarvisEyebrow}>Command surface</span>
            <strong>JARVIS</strong>
          </div>
          <div className={styles.environmentStatus}>
            <span /> Policy set 12 · live
          </div>
        </header>

        <div className={styles.jarvisWorkspace}>
          <section className={styles.commandThread}>
            <div className={styles.operatorMessage}>
              <span>Owner</span>
              <p>
                Get the Peterson installation unstuck. Rebook it for Thursday,
                assign Marcus, reserve the system, notify the customer, and
                prepare the remaining invoice. Hold customer contact and money
                for approval.
              </p>
            </div>

            <div className={styles.jarvisResponse}>
              <div className={styles.responseHeader}>
                <span className={styles.responsePulse} />
                <div>
                  <strong>Context assembled</strong>
                  <span>7 records · 4 systems · exact work root</span>
                </div>
              </div>
              <div className={styles.contextSources}>
                <span>Peterson household</span>
                <span>W-2187</span>
                <span>Marcus availability</span>
                <span>WS-48 inventory</span>
              </div>
              <p>
                Thursday at 10:30 AM is the earliest policy-valid slot. Marcus
                is available, the system is in stock, and the drive window is
                clear.
              </p>
            </div>
          </section>

          <aside className={styles.planPanel}>
            <div className={styles.planHeader}>
              <div>
                <span>Execution plan</span>
                <strong>{approved ? "5 actions · authority granted" : "5 actions · 2 approvals"}</strong>
              </div>
              <ShieldCheck size={20} />
            </div>

            <div className={styles.planSteps}>
              {planSteps.map(([surface, instruction], index) => (
                <div className={styles.planStep} key={surface}>
                  <span className={styles.planIndex}>{index + 1}</span>
                  <div>
                    <span>{surface}</span>
                    <p>{instruction}</p>
                  </div>
                  {index < 3 || approved ? <Check size={15} /> : <span className={styles.heldDot} />}
                </div>
              ))}
            </div>

            <div className={styles.approvalBoundary} data-approved={approved}>
              <div>
                <FileCheck2 size={18} />
                <span aria-live="polite">
                  <strong>{approved ? "Authority recorded" : "Authority boundary"}</strong>
                  {approved
                    ? "Customer contact and invoice are queued on the same trace."
                    : "Customer contact and invoice stay held."}
                </span>
              </div>
              <button type="button" disabled={approved} onClick={() => setApproved(true)}>
                {approved ? "Approved · activation queued" : "Review & approve"} <ChevronRight size={15} />
              </button>
            </div>
          </aside>
        </div>

        <footer className={styles.jarvisFooter}>
          <span>Representative walkthrough · source-bound action contracts</span>
          <a href="/jarvis/login">
            Open JARVIS <ArrowUpRight size={14} />
          </a>
        </footer>
      </div>
    </div>
  );
}

export function StoryInstrument({ phase }: { phase: number }) {
  const states = [
    {
      kicker: "Fragmented operation",
      title: "Customer, work, schedule and money disagree.",
      detail: "No action is safe until the operating context resolves.",
    },
    {
      kicker: "One instruction",
      title: "Intent enters through JARVIS.",
      detail: "Typed, spoken, webhook and worker instructions share one trace.",
    },
    {
      kicker: "Context graph",
      title: "The exact work root assembles.",
      detail: "Records, policies, memory and source citations become one picture.",
    },
    {
      kicker: "Executable plan",
      title: "Dependencies form before anything runs.",
      detail: "Availability precedes rescheduling; inventory precedes commitment.",
    },
    {
      kicker: "Authority boundary",
      title: "The operation decides what AI may do.",
      detail: "Low-risk work proceeds. Contact and money wait for approval.",
    },
    {
      kicker: "Verified change",
      title: "Every surface moves—and the chain survives.",
      detail: "Execution, recovery and evidence remain tied to the instruction.",
    },
  ];
  const state = states[phase] ?? states[0];

  return (
    <div className={styles.storyInstrument}>
      <div className={styles.instrumentHeader}>
        <span>JARVIS / operational trace</span>
        <span className={styles.instrumentLive}>01:47:12</span>
      </div>
      <div className={styles.instrumentBody}>
        <span className={styles.instrumentKicker}>{state.kicker}</span>
        <strong>{state.title}</strong>
        <p>{state.detail}</p>
      </div>
      <div className={styles.instrumentTimeline}>
        {states.map((item, index) => (
          <span
            key={item.kicker}
            className={index <= phase ? styles.timelineActive : undefined}
          />
        ))}
      </div>
    </div>
  );
}
