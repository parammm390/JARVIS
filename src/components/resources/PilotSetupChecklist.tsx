import { ClipboardCheck } from "lucide-react";

import { ResourceFrame } from "./ResourceFrame";
import { ResourceHero } from "./ResourceHero";
import styles from "./PublicEditorial.module.css";

const checklist = [
  ["Complete the operating review", "Map how the company runs today: locations, roles, operating surfaces, recurring handoffs, failure points and the outcomes that matter."],
  ["Define the broader deployment", "Name the workflows, systems, sources, channels, agent scopes and workspaces that belong in the company roadmap, even if they will activate in stages."],
  ["Choose the first certified chain", "Select one consequential workflow as the first end-to-end proof inside that broader deployment—not as the whole FINNOR product."],
  ["Name authoritative sources", "List the records and systems that constitute truth for identity, schedule, inventory, price, communication, money and status."],
  ["Map integrations and workspaces", "Define native records, configured external adapters, credentials, roles, access scopes and the JARVIS work surfaces the team needs."],
  ["Select action contracts", "Approve the bounded actions the planner may propose for the first chain. Anything outside the configured manifest remains unavailable."],
  ["Encode authority and approvals", "Set what can run automatically, what requires confirmation, which role may approve and what must escalate or deny."],
  ["Set AI and channel policy", "Choose model/provider routes where configured, plus text-only or voice-enabled scope, latency needs, cost controls and fallback behavior."],
  ["Certify tool health", "Verify credentials, scopes, PII handling, rate limits, timeouts and error semantics for every activated adapter."],
  ["Prove idempotency", "Replay requests and retries without creating duplicate jobs, messages, reservations, invoices or payments."],
  ["Exercise recovery", "Force timeouts, malformed responses, partial failure and provider unavailability. Confirm pause, retry, escalation, dead-letter and supported compensation paths."],
  ["Define actual-outcome checks", "Specify which source-system states prove success and which mismatches keep the workflow open."],
  ["Onboard and activate production", "Train the team on JARVIS, approvals, recovery and evidence; complete activation checks and establish the operating-support path."],
  ["Set expansion gates", "Agree which reliability, quality and operator-trust evidence is required before adding workflows, locations, roles, agents or automatic authority."],
] as const;

function PilotInstrument() {
  return (
    <div className={styles.instrument}>
      <div className={styles.instrumentTop}><span>Company deployment</span><span>first chain</span></div>
      <div className={styles.instrumentBody}>
        <span>Expansion rule</span>
        <strong>Configure broadly. Certify deliberately.</strong>
        <p>Map the company deployment, then connect, govern, break, recover and verify the first operating chain before expansion.</p>
        <div className={styles.instrumentRows}>
          <div><i /><span>Happy path</span><small>passed</small></div>
          <div><i /><span>Failure path</span><small>passed</small></div>
          <div><i style={{ background: "#d86e35" }} /><span>Expansion</span><small>review</small></div>
        </div>
      </div>
    </div>
  );
}

export function PilotSetupChecklist() {
  return (
    <ResourceFrame>
      <ResourceHero
        kicker="FINNOR deployment readiness checklist"
        title="Map the company. Certify the first chain."
        copy="A production checklist for configuring FINNOR around a water treatment company, activating the required systems and proving the first operating chain before expansion."
        icon={ClipboardCheck}
        aside={<PilotInstrument />}
      />
      <section className={styles.content}>
        <span className={styles.sectionLabel}>Fourteen deployment decisions</span>
        <h2 className={styles.sectionTitle}>The first chain proves the deployment model.</h2>
        <p className={styles.sectionCopy}>The goal is to configure the company boundary, then prove that one real workflow remains grounded, governed, recoverable and verifiable when reality becomes inconvenient.</p>
        <div className={styles.checklist}>
          {checklist.map(([title, copy]) => (
            <div className={styles.checkItem} key={title}><strong>{title}</strong><p>{copy}</p></div>
          ))}
        </div>
      </section>
    </ResourceFrame>
  );
}
