"use client";

// Mission Control (Phase 10): real panels over real data, 4s poll. Each panel fetches
// independently and shows a quiet placeholder on its own failure — never blanks the
// whole page (the resilience page.tsx already practiced for its three stat tiles).

import { useCallback, useState } from "react";
import { api } from "../lib/api";
import { usePoll } from "../lib/use-poll";

interface Stats {
  pending: number;
  blocked: number;
  sentComms: number;
  stuckWorkflowRuns: number | null;
  openReconciliationCases: number | null;
  recentSteps: Array<{ step: string; actionType: string; timestamp: string }>;
}

interface WorkflowStep {
  id: string;
  stepType: string;
  sequence: number;
  status: string;
  attempts: number;
  terminalReason: string | null;
  updatedAt: string;
}

interface WorkflowRun {
  id: string;
  workflowType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStep[];
}

interface BusinessEvent {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  occurredAt: string;
  source: string | null;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function eventIcon(eventType: string): string {
  if (eventType.startsWith("quote_")) return "📄";
  if (eventType.startsWith("appointment_")) return "📅";
  if (eventType.startsWith("work_order_")) return "🔧";
  if (eventType.startsWith("contact_")) return "👤";
  if (eventType.startsWith("payment") || eventType.startsWith("invoice_")) return "💵";
  return "•";
}

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null);
  const [events, setEvents] = useState<BusinessEvent[] | null>(null);
  const [pipeline, setPipeline] = useState<{ view: string; data: { leadsByStatus: Array<{ status: string; count: number }>; quotesByStatus: Array<{ status: string; count: number }>; proposalsByStatus: Array<{ status: string; count: number }> } } | null>(null);
  const [stock, setStock] = useState<{ data: { belowThreshold: Array<{ sku: string; name: string | null; quantity: number; reorderThreshold: number }> } } | null>(null);
  const [cash, setCash] = useState<{ data: { totalCollected: number; invoicesByStatus: Array<{ status: string; count: number; totalUsd: number }> } } | null>(null);
  const [followUp, setFollowUp] = useState<{ data: Array<unknown> } | null>(null);
  const [dq, setDq] = useState<{ data: { totalUnresolved: number } } | null>(null);
  const [panelErrors, setPanelErrors] = useState<Record<string, boolean>>({});

  const markError = (key: string, failed: boolean) =>
    setPanelErrors((prev) => (prev[key] === failed ? prev : { ...prev, [key]: failed }));

  const loadStats = useCallback(async () => {
    try {
      const [pending, blocked, comms, audit, sla] = await Promise.all([
        api<{ actions: unknown[] }>("/api/actions/pending"),
        api<{ actions: unknown[] }>("/api/actions/pending?filter=blocked"),
        api<{ outbox: unknown[] }>("/api/comms"),
        api<{ entries: Array<{ step: string; actionType: string; timestamp: string }> }>("/api/audit?limit=6"),
        api<{ view: string; data: { stuckWorkflowRuns: number; openReconciliationCases: number } }>("/api/read-models/sla-breaches").catch(() => null),
      ]);
      setStats({
        pending: pending.actions.length,
        blocked: blocked.actions.length,
        sentComms: comms.outbox.length,
        stuckWorkflowRuns: sla?.data.stuckWorkflowRuns ?? null,
        openReconciliationCases: sla?.data.openReconciliationCases ?? null,
        recentSteps: audit.entries,
      });
      markError("stats", false);
    } catch {
      markError("stats", true);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const res = await api<{ runs: WorkflowRun[] }>("/api/workflows/runs?status=running");
      setRuns(res.runs);
      markError("runs", false);
    } catch {
      markError("runs", true);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const res = await api<{ events: BusinessEvent[] }>("/api/events");
      setEvents(res.events.slice(0, 20));
      markError("events", false);
    } catch {
      markError("events", true);
    }
  }, []);

  const loadStrip = useCallback(async () => {
    const [p, s, c, f, d] = await Promise.allSettled([
      api<{ view: string; data: { leadsByStatus: Array<{ status: string; count: number }>; quotesByStatus: Array<{ status: string; count: number }>; proposalsByStatus: Array<{ status: string; count: number }> } }>("/api/read-models/pipeline-health"),
      api<{ view: string; data: { belowThreshold: Array<{ sku: string; name: string | null; quantity: number; reorderThreshold: number }> } }>("/api/read-models/stock-risk"),
      api<{ view: string; data: { totalCollected: number; invoicesByStatus: Array<{ status: string; count: number; totalUsd: number }> } }>("/api/read-models/cash-collections"),
      api<{ view: string; data: Array<unknown> }>("/api/read-models/follow-up-debt"),
      api<{ view: string; data: { totalUnresolved: number } }>("/api/read-models/data-quality"),
    ]);
    if (p.status === "fulfilled") { setPipeline(p.value); markError("pipeline", false); } else markError("pipeline", true);
    if (s.status === "fulfilled") { setStock(s.value); markError("stock", false); } else markError("stock", true);
    if (c.status === "fulfilled") { setCash(c.value); markError("cash", false); } else markError("cash", true);
    if (f.status === "fulfilled") { setFollowUp(f.value); markError("followUp", false); } else markError("followUp", true);
    if (d.status === "fulfilled") { setDq(d.value); markError("dq", false); } else markError("dq", true);
  }, []);

  // The "live" panels (in-flight workflows, event timeline) poll at the Phase 10
  // spec's tightened 4s. Stats and the business-health strip are comparatively
  // cosmetic and fetch 5 endpoints each per tick — polling those at 4s too would push
  // this single page past the existing 120 req/min per-tenant rate limit
  // (apps/api/lib/rate-limit.ts) on its own. They poll at 12s instead.
  usePoll(loadStats, 12000, []);
  usePoll(loadRuns, 4000, []);
  usePoll(loadEvents, 4000, []);
  usePoll(loadStrip, 12000, []);

  const tile = (label: string, value: number | string, href: string, accent: string) => (
    <a href={href} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card tile">
        <div className="tile-value" style={{ color: accent }}>{value}</div>
        <div className="tile-label">{label}</div>
      </div>
    </a>
  );

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Finnor is on duty.</h1>
      <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
        Speak to it on the <a href="/talk">Talk page</a>, or manage the queue below.
      </p>

      <div className="grid" style={{ marginTop: 18 }}>
        {tile("awaiting your approval", stats?.pending ?? "–", "/confirm", "var(--warn)")}
        {tile("blocked / needs review", stats?.blocked ?? "–", "/confirm", "var(--danger)")}
        {tile("messages produced", stats?.sentComms ?? "–", "/comms", "var(--success)")}
        {tile("stuck workflow runs", stats?.stuckWorkflowRuns ?? "–", "/", "var(--danger)")}
        {tile("open reconciliation cases", stats?.openReconciliationCases ?? "–", "/", "var(--warn)")}
      </div>

      <div className="grid" style={{ marginTop: 28, gridTemplateColumns: "1.3fr 1fr" }}>
        <section>
          <h3 style={{ color: "var(--text-muted)" }}>In-flight workflows</h3>
          {runs === null && panelErrors.runs && <p className="card" style={{ color: "var(--text-faint)" }}>Workflow runs are momentarily unavailable.</p>}
          {runs !== null && runs.length === 0 && (
            <div className="card" style={{ color: "var(--text-faint)", textAlign: "center" }}>No workflows running right now.</div>
          )}
          {runs === null && !panelErrors.runs && <p className="pulse" style={{ color: "var(--text-faint)" }}>Loading…</p>}
          {runs?.map((r) => (
            <div key={r.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <strong style={{ color: "var(--accent)" }}>{r.workflowType.replaceAll("_", " ")}</strong>
                <span style={{ color: "var(--text-faint)", fontSize: 12 }}>{relativeTime(r.createdAt)}</span>
              </div>
              <div className="step-tracker">
                {r.steps.map((s) => (
                  <span key={s.id} className={`step-dot ${s.status}`} title={`${s.stepType}: ${s.status}`} />
                ))}
              </div>
            </div>
          ))}
        </section>

        <section>
          <h3 style={{ color: "var(--text-muted)" }}>Event timeline</h3>
          {events === null && panelErrors.events && <p className="card" style={{ color: "var(--text-faint)" }}>Timeline is momentarily unavailable.</p>}
          {events !== null && events.length === 0 && (
            <div className="card" style={{ color: "var(--text-faint)", textAlign: "center" }}>No events yet.</div>
          )}
          {events?.map((e) => (
            <div key={e.id} className="card" style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between" }}>
              <span>
                {eventIcon(e.eventType)}{" "}
                <strong style={{ color: "var(--accent)" }}>{e.eventType.replaceAll("_", " ")}</strong>
              </span>
              <span style={{ color: "var(--text-faint)", fontSize: 12 }}>{relativeTime(e.occurredAt)}</span>
            </div>
          ))}
        </section>
      </div>

      <h3 style={{ marginTop: 28, color: "var(--text-muted)" }}>Business health</h3>
      <div className="grid">
        <div className="card">
          <div style={{ color: "var(--text-faint)", fontSize: 12, marginBottom: 6 }}>PIPELINE</div>
          {!pipeline && !panelErrors.pipeline && <span className="pulse" style={{ color: "var(--text-faint)" }}>…</span>}
          {!pipeline && panelErrors.pipeline && <span style={{ color: "var(--text-faint)" }}>unavailable</span>}
          {pipeline && (
            <div style={{ fontSize: 13 }}>
              {pipeline.data.leadsByStatus.map((l) => (
                <div key={l.status} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{l.status}</span><span>{l.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div style={{ color: "var(--text-faint)", fontSize: 12, marginBottom: 6 }}>STOCK RISK</div>
          {!stock && !panelErrors.stock && <span className="pulse" style={{ color: "var(--text-faint)" }}>…</span>}
          {!stock && panelErrors.stock && <span style={{ color: "var(--text-faint)" }}>unavailable</span>}
          {stock && (
            <div style={{ fontSize: 13 }}>
              {stock.data.belowThreshold.length === 0 && <span style={{ color: "var(--text-faint)" }}>All stocked.</span>}
              {stock.data.belowThreshold.slice(0, 5).map((item) => (
                <div key={item.sku} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{item.name ?? item.sku}</span>
                  <span className="badge badge-warn">{item.quantity}/{item.reorderThreshold}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div style={{ color: "var(--text-faint)", fontSize: 12, marginBottom: 6 }}>CASH COLLECTIONS</div>
          {!cash && !panelErrors.cash && <span className="pulse" style={{ color: "var(--text-faint)" }}>…</span>}
          {!cash && panelErrors.cash && <span style={{ color: "var(--text-faint)" }}>unavailable</span>}
          {cash && <div style={{ fontSize: 22, fontWeight: 700, color: "var(--success)" }}>${cash.data.totalCollected.toLocaleString()}</div>}
        </div>
        <div className="card">
          <div style={{ color: "var(--text-faint)", fontSize: 12, marginBottom: 6 }}>FOLLOW-UP DEBT</div>
          {!followUp && !panelErrors.followUp && <span className="pulse" style={{ color: "var(--text-faint)" }}>…</span>}
          {!followUp && panelErrors.followUp && <span style={{ color: "var(--text-faint)" }}>unavailable</span>}
          {followUp && <div style={{ fontSize: 22, fontWeight: 700 }}>{followUp.data.length}</div>}
        </div>
        <div className="card">
          <div style={{ color: "var(--text-faint)", fontSize: 12, marginBottom: 6 }}>DATA QUALITY</div>
          {!dq && !panelErrors.dq && <span className="pulse" style={{ color: "var(--text-faint)" }}>…</span>}
          {!dq && panelErrors.dq && <span style={{ color: "var(--text-faint)" }}>unavailable</span>}
          {dq && <div style={{ fontSize: 22, fontWeight: 700, color: dq.data.totalUnresolved > 0 ? "var(--warn)" : "var(--success)" }}>{dq.data.totalUnresolved} unresolved</div>}
        </div>
      </div>

      <h3 style={{ marginTop: 28, color: "var(--text-muted)" }}>Latest activity</h3>
      {(stats?.recentSteps ?? []).map((e, i) => (
        <div key={i} className="card" style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between" }}>
          <span>
            <strong style={{ color: "var(--accent)" }}>{e.actionType}</strong>{" "}
            <span style={{ color: "var(--text-muted)" }}>· {e.step}</span>
          </span>
          <span style={{ color: "var(--text-faint)", fontSize: 12 }}>{new Date(e.timestamp).toLocaleTimeString()}</span>
        </div>
      ))}
      {!stats && <p className="pulse" style={{ color: "var(--text-faint)" }}>Connecting…</p>}
    </div>
  );
}
