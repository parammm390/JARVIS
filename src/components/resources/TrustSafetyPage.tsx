import { ShieldCheck } from "lucide-react";

import { ResourceFrame } from "./ResourceFrame";
import { ResourceHero } from "./ResourceHero";
import styles from "./PublicEditorial.module.css";
import { TrustControlLab } from "./EditorialLiveSystems";

const controls = [
  ["Company configuration", "Workflows, sources, systems, locations, roles, channels, agent scopes and workspaces are explicit deployment data. Capability is never treated as activated merely because code exists."],
  ["Grounding", "The planner resolves the exact customer, work root, source records, policy and relevant memory before proposing action. Unknown information remains unknown, and citations and confidence can travel with the plan."],
  ["Bounded contracts", "JARVIS selects from a fixed action manifest with typed inputs and domain ownership. It does not invent a new production capability because a prompt asked for one."],
  ["Default-deny policy", "Risk tier, tenant policy, effective version and confirmation requirements are evaluated before execution. Missing authority resolves to a hold—not silent permission."],
  ["Typed approval", "A confirmation is scoped to the proposed action, actor and policy decision. Approval, rejection and escalation are durable events rather than UI decoration."],
  ["Least-necessary tools", "Execution uses native business data or configured external adapters with health checks, idempotency controls and PII minimization appropriate to the task."],
  ["AI routing policy", "Where configured, model and provider routes can differ by task purpose, channel, latency, cost, reasoning need and availability. An unavailable safe route fails visibly rather than selecting an unnamed model."],
  ["No silent success", "Actual outcomes are reconciled against expected changes. Tool acknowledgements alone do not make the workflow complete."],
  ["Durable recovery", "Retries, backoff, dead-letter handling, pause, resume, cancel, escalation and supported compensation preserve the original instruction and causal trace."],
  ["Permanent evidence", "Decision receipts record the objective, proposal, policy, risk, approval, evidence and actual result. Exact identifiers project the change back into the operational surfaces."],
] as const;

function AuthorityInstrument() {
  return (
    <div className={styles.instrument}>
      <div className={styles.instrumentTop}><span>Authority evaluation</span><span>Policy v12</span></div>
      <div className={styles.instrumentBody}>
        <span>Proposed plan</span>
        <strong>3 actions may run. 2 remain held.</strong>
        <p>Schedule and inventory are within policy. Customer contact and money cross the owner’s confirmation boundary.</p>
        <div className={styles.instrumentRows}>
          <div><i /><span>Reschedule work</span><small>allowed</small></div>
          <div><i /><span>Reserve inventory</span><small>allowed</small></div>
          <div><i style={{ background: "#d86e35" }} /><span>Send invoice</span><small>approval</small></div>
        </div>
      </div>
    </div>
  );
}

export function TrustSafetyPage() {
  return (
    <ResourceFrame>
      <ResourceHero
        kicker="Company configuration, authority and recovery"
        title="Execution authority belongs to the company."
        copy="FINNOR is configured around a specific company before production. The company defines the sources, systems, roles, AI policy, channels and actions that may run, what must wait and what must never happen."
        icon={ShieldCheck}
        aside={<AuthorityInstrument />}
      />

      <TrustControlLab />

      <section className={styles.content} data-editorial-reveal>
        <span className={styles.sectionLabel}>Ten parts of one control system</span>
        <h2 className={styles.sectionTitle}>Safety starts with deployment scope and continues through execution.</h2>
        <p className={styles.sectionCopy}>A warning banner cannot govern an operation. Company configuration, grounding, contracts, policy, approval, AI routing, tool control, verification, recovery and evidence have to agree.</p>

        <div className={styles.controlList}>
          {controls.map(([title, copy], index) => (
            <div className={styles.controlRow} key={title} data-editorial-stack>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{title}</strong>
              <p>{copy}</p>
            </div>
          ))}
        </div>

        <div className={styles.notePanel}>
          <div>
            <span className={styles.sectionLabel}>The company remains the principal</span>
            <h2>JARVIS does not replace operating judgment.</h2>
            <p>People still own business policy, final authority, safety procedures, exceptional judgment and the decision to widen or narrow automation.</p>
          </div>
          <div>
            <span className={styles.sectionLabel} style={{ color: "#7ac9df" }}>Deployment truth</span>
            <h2>Capability is not the same as activation.</h2>
            <p>Production readiness depends on configured credentials, vendor agreements, source-data quality, access controls, retention, escalation paths, tested recovery, workspace setup, onboarding and the policies of the specific company. FINNOR certifies the first operating chain inside that broader deployment before scope expands.</p>
          </div>
        </div>
      </section>
    </ResourceFrame>
  );
}
