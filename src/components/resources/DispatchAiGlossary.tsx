import { BookOpenText } from "lucide-react";

import { ResourceFrame } from "./ResourceFrame";
import { ResourceHero } from "./ResourceHero";
import styles from "./PublicEditorial.module.css";

const terms = [
  ["Instruction trace", "The durable identity that connects the original intent to context retrieval, planning, policy, approval, execution, recovery and the final receipt—regardless of whether the instruction arrived by text, voice, webhook or worker."],
  ["Work root", "The exact operational object a workflow is allowed to change, such as a specific work case, household, appointment, invoice or campaign. Exact roots prevent evidence from drifting across lookalike records."],
  ["Context graph", "The assembled operating picture around a work root: source records, relationships, policies, availability, inventory, price-book data, memory and citations."],
  ["Structured memory", "Durable facts stored in explicit business fields and read models. FINNOR prefers structured truth before semantic recall when a decision can be grounded deterministically."],
  ["Semantic memory", "Retrieved narrative context that may help interpret a situation. It is supplementary evidence—not a substitute for authoritative records."],
  ["Action contract", "A typed, bounded capability the planner may propose, with defined inputs, domain ownership, risk posture and an execution path."],
  ["Action manifest", "The fixed catalog of action contracts available to the planner. FINNOR’s current product manifest contains 44 contracts across 24 operational domains."],
  ["Domain plugin", "The business-specific implementation behind a family of actions, such as scheduling, accounting, inventory, documents, communications or campaigns."],
  ["Executable plan", "An ordered set of action contracts whose dependencies, expected changes, risks and authority requirements are known before execution begins."],
  ["Dependency graph", "The causal order inside a plan. It ensures, for example, that availability is validated before rescheduling and inventory is reserved before a customer commitment."],
  ["Clarification step", "A deliberate stop when required context is missing or contradictory. The system asks for a specific answer instead of fabricating certainty."],
  ["Policy set", "Versioned tenant data that defines risk tiers, effective dates, role permissions, confirmation requirements and prohibited behavior."],
  ["Authority boundary", "The point where policy changes the execution path from allowed to held, escalated or denied."],
  ["Typed confirmation", "An approval attached to a specific actor, proposal, policy decision and scope. It cannot silently authorize a different action."],
  ["Durable workflow", "Execution state that survives process restarts and external delays while preserving step history, retry posture and the original instruction."],
  ["Idempotency", "Protection against performing the same consequential action twice when a request is retried or replayed."],
  ["Dead-letter queue", "The controlled holding area for work that exhausted its normal retry policy. Operators can inspect, replay or discard it through an audited path."],
  ["Compensation", "A supported reversal or counter-action used when later failure requires prior work to be undone or neutralized."],
  ["Reconciliation", "The comparison between the expected operational change and the actual state reported by source systems."],
  ["Decision receipt", "The evidence artifact that records the objective, proposed and actual outcomes, approval, policy, risk, correlation identifiers and source evidence."],
  ["Read model", "A purpose-built operational projection such as Customers, Work, Schedule, Money or Agents. Read models make one causal state visible without forcing people to reconstruct it from event logs."],
  ["Agent channel", "A bounded operating role—such as follow-up, service reminders, win-back or payment collection—whose work remains governed by the same policy and evidence chain."],
  ["Tool health", "The current availability and configuration posture of a native or external execution adapter. A configured capability is not treated as healthy merely because code exists for it."],
] as const;

function GlossaryInstrument() {
  return (
    <div className={styles.instrument}>
      <div className={styles.instrumentTop}><span>Contract lookup</span><span>manifest / 44</span></div>
      <div className={styles.instrumentBody}>
        <span>Selected term</span>
        <strong>Decision receipt</strong>
        <p>Evidence that closes the distance between “the agent said it ran” and “the operation actually changed.”</p>
        <div className={styles.instrumentRows}>
          <div><i /><span>Expected outcome</span><small>recorded</small></div>
          <div><i /><span>Actual outcome</span><small>verified</small></div>
          <div><i /><span>Exact work root</span><small>linked</small></div>
        </div>
      </div>
    </div>
  );
}

export function DispatchAiGlossary() {
  return (
    <ResourceFrame>
      <ResourceHero
        kicker="FINNOR operating glossary"
        title="Language for accountable execution."
        copy="The concepts behind FINNOR, written for operators. These definitions describe the actual product contract—not generic AI vocabulary."
        icon={BookOpenText}
        aside={<GlossaryInstrument />}
      />
      <section className={styles.content}>
        <span className={styles.sectionLabel}>From intent to verified change</span>
        <h2 className={styles.sectionTitle}>The words that make the chain inspectable.</h2>
        <dl className={styles.termList}>
          {terms.map(([term, definition]) => (
            <div className={styles.term} key={term}><dt>{term}</dt><dd>{definition}</dd></div>
          ))}
        </dl>
      </section>
    </ResourceFrame>
  );
}
