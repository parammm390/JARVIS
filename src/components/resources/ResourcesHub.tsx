import Link from "next/link";
import { ArrowUpRight, BookOpenText } from "lucide-react";

import { ResourceFrame } from "./ResourceFrame";
import { ResourceHero } from "./ResourceHero";
import styles from "./PublicEditorial.module.css";
import { ResourcesLiveLibrary } from "./EditorialLiveSystems";

const resources = [
  {
    href: "/resources/operating-glossary",
    title: "The FINNOR operating glossary",
    copy: "Plain-language definitions for work roots, action contracts, authority boundaries, receipts, compensation and the context graph.",
  },
  {
    href: "/resources/deployment-readiness-checklist",
    title: "Deployment readiness checklist",
    copy: "The company mapping, configuration, testing, activation and support decisions that must be explicit before production.",
  },
  {
    href: "/resources/operational-drag-estimator",
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
        title="Understand the company deployment behind the interface."
        copy="A practical library for water treatment operators evaluating what FINNOR coordinates, what gets configured, how production is activated and how execution remains governed."
        icon={BookOpenText}
        aside={<OperatingTrace />}
      />

      <ResourcesLiveLibrary />

      <section className={styles.content} data-editorial-reveal>
        <span className={styles.sectionLabel}>Start with the company operating model</span>
        <h2 className={styles.sectionTitle}>The useful questions begin with “how will this fit our company?”</h2>
        <p className={styles.sectionCopy}>Ask which workflows, sources, systems, roles, channels and workspaces are included—then ask how authority, failure recovery and evidence work inside that scope.</p>

        <div className={styles.indexList}>
          {resources.map((resource, index) => (
            <Link className={styles.indexItem} href={resource.href} key={resource.href} data-editorial-stack>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{resource.title}</strong>
              <p>{resource.copy}</p>
              <ArrowUpRight size={19} />
            </Link>
          ))}
        </div>

        <div className={styles.splitStory}>
          <article>
            <span>Channels follow the deployment</span>
            <h2>Conversation is an input, not the product.</h2>
            <p>A deployment can be text-only or voice-enabled. Typed instructions, text, voice, webhooks and workers enter the same configured operating and execution layer.</p>
          </article>
          <article>
            <span>The operating layer remains accountable</span>
            <h2>Execution stays tied to company truth.</h2>
            <p>Every step remains tied to source records, policy, approval, tool health, recovery state and an outcome receipt. Completion means the configured operating state actually changed.</p>
          </article>
        </div>
      </section>
    </ResourceFrame>
  );
}
