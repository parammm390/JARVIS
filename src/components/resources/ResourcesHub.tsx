import Link from "next/link";
import { ArrowUpRight, BookOpenText } from "lucide-react";

import { ResourceFrame } from "./ResourceFrame";
import { ResourceHero } from "./ResourceHero";
import styles from "./PublicEditorial.module.css";

const resources = [
  {
    href: "/resources/dispatch-ai-glossary",
    title: "The FINNOR operating glossary",
    copy: "Plain-language definitions for work roots, action contracts, authority boundaries, receipts, compensation and the context graph.",
  },
  {
    href: "/resources/pilot-setup-checklist",
    title: "Governed deployment checklist",
    copy: "The decisions that must be explicit before one consequential workflow is allowed to run in production.",
  },
  {
    href: "/resources/missed-call-cost-calculator",
    title: "Operational drag estimator",
    copy: "Model the cost of work that stalls between systems, waits for reconciliation or depends on manual coordination.",
  },
  {
    href: "/trust-safety",
    title: "The authority and evidence model",
    copy: "How FINNOR grounds decisions, applies policy, holds consequential actions and records what actually happened.",
  },
];

function OperatingTrace() {
  return (
    <div className={styles.instrument}>
      <div className={styles.instrumentTop}><span>Operating trace</span><span>WRK-81A2</span></div>
      <div className={styles.instrumentBody}>
        <span>Current state</span>
        <strong>One instruction, fully inspectable.</strong>
        <p>The resources below explain the control model behind the product—not a collection of surface-level AI terms.</p>
        <div className={styles.instrumentRows}>
          <div><i /><span>Context sources resolved</span><small>7 records</small></div>
          <div><i /><span>Policy evaluated</span><small>v12</small></div>
          <div><i /><span>Receipt available</span><small>verified</small></div>
        </div>
      </div>
    </div>
  );
}

export function ResourcesHub() {
  return (
    <ResourceFrame>
      <ResourceHero
        kicker="FINNOR field notes"
        title="Understand the operation behind the interface."
        copy="A practical library for water treatment operators evaluating how FINNOR understands context, forms plans, applies authority, recovers from failure and proves the result."
        icon={BookOpenText}
        aside={<OperatingTrace />}
      />

      <section className={styles.content}>
        <span className={styles.sectionLabel}>Start with the control model</span>
        <h2 className={styles.sectionTitle}>The useful questions begin after “what can the AI do?”</h2>
        <p className={styles.sectionCopy}>Ask what data supported the decision, which contract authorizes the action, where approval enters, how failure recovers and what evidence closes the chain.</p>

        <div className={styles.indexList}>
          {resources.map((resource, index) => (
            <Link className={styles.indexItem} href={resource.href} key={resource.href}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{resource.title}</strong>
              <p>{resource.copy}</p>
              <ArrowUpRight size={19} />
            </Link>
          ))}
        </div>

        <div className={styles.splitStory}>
          <article>
            <span>Not an answering service</span>
            <h2>Conversation is only one way intent enters.</h2>
            <p>FINNOR is not defined by phone coverage, message taking or voice. Typed instructions, voice, webhooks and workers enter the same governed execution chain.</p>
          </article>
          <article>
            <span>Not generic automation</span>
            <h2>The operation stays causal and accountable.</h2>
            <p>Every step remains tied to source records, policy, approval, tool health, recovery state and an outcome receipt. “Done” is a verified operational state, not a sentence in a chat.</p>
          </article>
        </div>
      </section>
    </ResourceFrame>
  );
}
