import { ClipboardCheck } from "lucide-react";

import { ResourceFrame } from "./ResourceFrame";
import { ResourceHero } from "./ResourceHero";
import styles from "./PublicEditorial.module.css";

const checklist = [
  ["Choose one consequential workflow", "Name the business outcome, trigger, current failure mode and why this workflow is valuable enough to certify end to end."],
  ["Define the exact work root", "Identify the customer, work case, appointment, invoice or other object every action and receipt must reference."],
  ["Name authoritative sources", "List the records and systems that constitute truth for identity, schedule, inventory, price, money and status."],
  ["Map required context", "Separate facts that must be present from context that is merely helpful. Define how contradictions and unknowns are handled."],
  ["Select action contracts", "Approve the exact bounded actions the planner may propose for this workflow. Anything outside the manifest remains unavailable."],
  ["Order dependencies", "Write the causal sequence and preconditions. A later customer promise cannot run before the facts it depends on are valid."],
  ["Encode authority", "Set what can run automatically, what requires typed confirmation, which role may approve and what must escalate or deny."],
  ["Test policy simulation", "Run representative low-, medium- and high-risk proposals against versioned tenant policy before connecting live tools."],
  ["Certify tool health", "Verify credentials, scopes, PII handling, rate limits, timeouts and error semantics for every native or external adapter."],
  ["Prove idempotency", "Replay requests and retries without creating duplicate jobs, messages, reservations, invoices or payments."],
  ["Exercise recovery", "Force timeouts, malformed responses, partial failure and provider unavailability. Confirm pause, retry, escalation, dead-letter and supported compensation paths."],
  ["Define actual-outcome checks", "Specify which source-system states prove success and which mismatches keep the workflow open."],
  ["Review the receipt", "Confirm the evidence artifact contains objective, proposal, policy, approval, expected result, actual result, exact IDs and source evidence."],
  ["Set expansion gates", "Agree which reliability, quality and operator-trust evidence is required before adding more workflows, roles or automatic authority."],
] as const;

function PilotInstrument() {
  return (
    <div className={styles.instrument}>
      <div className={styles.instrumentTop}><span>Certification run</span><span>1 workflow</span></div>
      <div className={styles.instrumentBody}>
        <span>Expansion rule</span>
        <strong>Earn authority one chain at a time.</strong>
        <p>Connect, govern, break, recover and verify one workflow before increasing scope.</p>
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
        kicker="Governed deployment checklist"
        title="Certify the chain before you widen it."
        copy="A production checklist for moving one water treatment workflow from intent to verified change—with its sources, contracts, policies, failures and evidence made explicit."
        icon={ClipboardCheck}
        aside={<PilotInstrument />}
      />
      <section className={styles.content}>
        <span className={styles.sectionLabel}>Fourteen deployment decisions</span>
        <h2 className={styles.sectionTitle}>A pilot is an operating-system test, not a feature tour.</h2>
        <p className={styles.sectionCopy}>The goal is not to see a clean demo. It is to prove that one real workflow remains grounded, governed, recoverable and verifiable when reality becomes inconvenient.</p>
        <div className={styles.checklist}>
          {checklist.map(([title, copy]) => (
            <div className={styles.checkItem} key={title}><strong>{title}</strong><p>{copy}</p></div>
          ))}
        </div>
      </section>
    </ResourceFrame>
  );
}
