"use client";

// Shared event-timeline rendering (Phase 10's mission-control event panel, Phase 11:
// extracted here per docs/jarvis-99-phase-10-16-execution-plan.md's PHASE 11 step 4
// so the Customers page can reuse it instead of re-implementing the card/icon/
// relative-time logic).

export interface BusinessEvent {
  // Present on /api/events rows; absent on household360's timeline (the read-model's
  // own interface has no `id` — see docs/jarvis-99-phase-10-16-execution-plan.md's
  // PHASE 11 Household360 spec). React keys fall back to a composite of the other
  // fields when it's missing.
  id?: string;
  entityType: string;
  entityId: string;
  eventType: string;
  occurredAt: string;
  source?: string | null;
}

function keyFor(e: BusinessEvent, i: number): string {
  return e.id ?? `${e.entityType}-${e.entityId}-${e.eventType}-${e.occurredAt}-${i}`;
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function eventIcon(eventType: string): string {
  if (eventType.startsWith("quote_")) return "📄";
  if (eventType.startsWith("appointment_")) return "📅";
  if (eventType.startsWith("work_order_")) return "🔧";
  if (eventType.startsWith("contact_")) return "👤";
  if (eventType.startsWith("payment") || eventType.startsWith("invoice_")) return "💵";
  return "•";
}

export default function Timeline({
  events,
  freshEventIds,
  emptyLabel,
}: {
  events: BusinessEvent[] | null;
  freshEventIds?: Set<string>;
  emptyLabel?: string;
}) {
  if (events === null) {
    return <p className="pulse" style={{ color: "var(--text-faint)" }}>Loading…</p>;
  }
  if (events.length === 0) {
    return (
      <div className="card" style={{ color: "var(--text-faint)", textAlign: "center" }}>
        {emptyLabel ?? "No events yet."}
      </div>
    );
  }
  return (
    <>
      {events.map((e, i) => (
        <div
          key={keyFor(e, i)}
          className={`card stagger-item${e.id && freshEventIds?.has(e.id) ? " item-fresh" : ""}`}
          style={{ "--i": Math.min(i, 12), padding: "10px 16px", display: "flex", justifyContent: "space-between" } as React.CSSProperties}
        >
          <span>
            {eventIcon(e.eventType)}{" "}
            <strong style={{ color: "var(--accent)" }}>{e.eventType.replaceAll("_", " ")}</strong>
          </span>
          <span style={{ color: "var(--text-faint)", fontSize: 12 }}>{relativeTime(e.occurredAt)}</span>
        </div>
      ))}
    </>
  );
}
