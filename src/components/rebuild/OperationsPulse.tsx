"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CalendarClock,
  Check,
  CircleDollarSign,
  Command,
  FileCheck2,
  PackageCheck,
  Pause,
  Play,
  Route,
  ShieldCheck,
  UsersRound,
  Wrench,
} from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import styles from "./OperationsPulse.module.css";

const events = [
  { label: "Context", detail: "Peterson preference and work root resolved", state: "grounded", icon: UsersRound },
  { label: "Work", detail: "W-2187 moved from blocked to ready", state: "changed", icon: Wrench },
  { label: "Dispatch", detail: "Marcus routed into the Thursday window", state: "reserved", icon: Route },
  { label: "Inventory", detail: "WS-48 attached to the installation", state: "locked", icon: PackageCheck },
  { label: "Authority", detail: "Contact and money held for the owner", state: "checked", icon: ShieldCheck },
  { label: "Evidence", detail: "Actual state reconciled across four surfaces", state: "verified", icon: FileCheck2 },
] as const;

const handoffs = [
  ["JARVIS", "The work root is grounded. Five bounded changes are ready."],
  ["Work", "W-2187 has an owner, resolved dependencies and a verified ready state."],
  ["Dispatch", "Marcus clears the route and skill boundary for Thursday."],
  ["Inventory", "WS-48 is reserved against W-2187, not a loose calendar slot."],
  ["Owner boundary", "Customer contact and the invoice remain visibly held."],
  ["Evidence", "Expected and actual state agree. The decision receipt can close."],
] as const;

const commercialStages = ["Quote", "Approval", "Invoice", "Payment"] as const;

export default function OperationsPulse() {
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || reducedMotion) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % events.length), 1450);
    return () => window.clearInterval(timer);
  }, [paused, reducedMotion]);

  const activeEvent = events[active];
  const handoff = handoffs[Math.min(active, handoffs.length - 1)];
  const commercialActive = Math.min(Math.floor((active / (events.length - 1)) * commercialStages.length), commercialStages.length - 1);
  const progress = Math.round(((active + 1) / events.length) * 100);

  return (
    <section className={styles.section} id="operations-pulse" aria-labelledby="operations-pulse-title">
      <div className={styles.ambient} aria-hidden="true" />
      <div className={styles.heading} data-reveal>
        <span>LIVE OPERATION / WRK-81A2</span>
        <h2 id="operations-pulse-title">Watch the business answer in real time.</h2>
        <p>Not another feature list. One work root moves through dispatch, stock, authority, money and proof while every surface reports back to the same instruction.</p>
      </div>

      <div className={styles.board} data-scale-reveal>
        <article className={styles.commandCard} data-stack-card>
          <header>
            <div><Command size={15} /><span>LIVE COORDINATION</span></div>
            <button type="button" onClick={() => setPaused((value) => !value)} aria-label={paused ? "Resume live operations board" : "Pause live operations board"}>
              {paused ? <Play size={14} /> : <Pause size={14} />}{paused ? "Resume" : "Live"}
            </button>
          </header>
          <div className={styles.commandLine}>
            <span>OWNER INSTRUCTION</span>
            <strong>Restore Peterson to a Thursday-ready state. Keep contact and money behind me.</strong>
          </div>
          <div className={styles.eventRail} aria-label="Operating events">
            {events.map((event, index) => {
              const Icon = event.icon;
              return (
                <button
                  type="button"
                  key={event.label}
                  data-active={index <= active}
                  data-current={index === active}
                  onClick={() => { setActive(index); setPaused(true); }}
                  aria-pressed={index === active}
                >
                  <span>{index < active ? <Check size={13} /> : <Icon size={13} />}</span>
                  <b>{event.label}</b>
                  <small>{event.state}</small>
                </button>
              );
            })}
          </div>
          <div className={styles.feedback} aria-live="polite">
            <AnimatePresence mode="wait">
              <motion.div key={activeEvent.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
                <span>{handoff[0]}</span>
                <p>{handoff[1]}</p>
              </motion.div>
            </AnimatePresence>
            <div className={styles.progress}><i style={{ width: `${progress}%` }} /></div>
            <b>{String(active + 1).padStart(2, "0")} / {String(events.length).padStart(2, "0")}</b>
          </div>
        </article>

        <article className={styles.dispatchCard} data-stack-card>
          <header><span><CalendarClock size={14} />DISPATCH SIGNAL</span><b>THU · 10:30</b></header>
          <div className={styles.routeMap} aria-hidden="true">
            <i /><i /><i />
            <span data-node="customer"><UsersRound size={14} /></span>
            <span data-node="technician"><Wrench size={14} /></span>
            <span data-node="stock"><PackageCheck size={14} /></span>
            <b style={{ "--route-progress": `${Math.max(18, progress)}%` } as CSSProperties} />
          </div>
          <footer><span>Marcus · 27 minute route</span><strong><i />0 conflicts</strong></footer>
        </article>

        <article className={styles.commercialCard} data-stack-card>
          <header><CircleDollarSign size={15} /><span>COMMERCIAL CHAIN</span></header>
          <div className={styles.commercialFlow}>
            {commercialStages.map((stage, index) => <span key={stage} data-active={index <= commercialActive} data-current={index === commercialActive}><i />{stage}</span>)}
          </div>
          <p>Money stays downstream of completed work and recorded authority.</p>
        </article>

        <article className={styles.receiptCard} data-stack-card>
          <header><FileCheck2 size={15} /><span>PROOF</span></header>
          <div className={styles.receiptGauge} style={{ "--receipt-progress": `${progress * 3.6}deg` } as CSSProperties}>
            <strong>{active + 1}<small>/{events.length}</small></strong>
          </div>
          <footer><span>Receipt</span><b>{active === events.length - 1 ? "closed" : "forming"}</b></footer>
        </article>
      </div>
    </section>
  );
}
