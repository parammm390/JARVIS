"use client";

// Mission Control (Phase 10): real panels over real data, 4s poll, driven live —
// in-flight workflow steps animate as they progress, fresh events sweep in, stat
// tiles tween to their new values, and the two genuinely real-time panels (in-flight
// workflows, event timeline) carry a live indicator so "this polls in real time" is
// visible, not just true. Each panel fetches independently and shows a quiet
// placeholder on its own failure — never blanks the whole page.

import { useCallback, useRef, useState } from "react";
import { api } from "../lib/api";
import { usePoll } from "../lib/use-poll";
import { useCountUp } from "../lib/use-count-up";
import Timeline, { relativeTime, type BusinessEvent } from "../components/Timeline";

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

/** Live indicator for a genuinely polling panel: a radiating dot next to the
 *  heading, plus a thin scan-line sweep beneath it. */
function LiveHeading({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <h3 className="live-heading" style={{ color: "var(--text-muted)", marginBottom: 0 }}>
        <span className="live-dot" />
        {children}
      </h3>
      <div className="live-scanbar" />
    </div>
  );
}

/** A workflow's step tracker: dots connected by lines, where the connector leading
 *  INTO a still-active ("leased") step animates a moving light — the pipeline
 *  visibly has something flowing through it, not just colored dots. */
function StepFlow({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div className="step-tracker">
      {steps.map((s, i) => (
        <span key={s.id} className="step-node">
          {i > 0 && (
            <span
              className={`step-connector${s.status === "leased" ? " flowing" : ""}${s.status === "completed" ? " done" : ""}`}
            />
          )}
          <span className={`step-dot ${s.status}`} title={`${s.stepType}: ${s.status}`} />
        </span>
      ))}
    </div>
  );
}

/** Animated stat tile: the displayed number tweens smoothly toward its new value on
 *  every poll (useCountUp), and the tile itself briefly rings + its number pops once
 *  when the underlying value actually changed — a single clean beat, not a re-trigger
 *  on every intermediate tween frame. */
function StatTile({ label, value, href, accent, flash }: { label: string; value: number | null; href: string; accent: string; flash: boolean }) {
  const animated = useCountUp(value);
  return (
    <a href={href} style={{ textDecoration: "none", color: "inherit" }}>
      <div className={`card tile${flash ? " item-fresh" : ""}`}>
        <div className={`tile-value${flash ? " value-pop" : ""}`} style={{ color: accent }}>
          {animated ?? "–"}
        </div>
        <div className="tile-label">{label}</div>
      </div>
    </a>
  );
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
  const [flashTiles, setFlashTiles] = useState<Set<string>>(new Set());
  const [freshEventIds, setFreshEventIds] = useState<Set<string>>(new Set());

  const prevStats = useRef<Stats | null>(null);
  const seenEventIds = useRef<Set<string> | null>(null);

  const markError = (key: string, failed: boolean) =>
    setPanelErrors((prev) => (prev[key] === failed ? prev : { ...prev, [key]: failed }));

  function flashTile(key: string) {
    setFlashTiles((prev) => new Set(prev).add(key));
    setTimeout(() => setFlashTiles((prev) => { const next = new Set(prev); next.delete(key); return next; }), 1400);
  }

  const loadStats = useCallback(async () => {
    try {
      const [pending, blocked, comms, audit, sla] = await Promise.all([
        api<{ actions: unknown[] }>("/api/actions/pending"),
        api<{ actions: unknown[] }>("/api/actions/pending?filter=blocked"),
        api<{ outbox: unknown[] }>("/api/comms"),
        api<{ entries: Array<{ step: string; actionType: string; timestamp: string }> }>("/api/audit?limit=6"),
        api<{ view: string; data: { stuckWorkflowRuns: number; openReconciliationCases: number } }>("/api/read-models/sla-breaches").catch(() => null),
      ]);
      const next: Stats = {
        pending: pending.actions.length,
        blocked: blocked.actions.length,
        sentComms: comms.outbox.length,
        stuckWorkflowRuns: sla?.data.stuckWorkflowRuns ?? null,
        openReconciliationCases: sla?.data.openReconciliationCases ?? null,
        recentSteps: audit.entries,
      };
      const prev = prevStats.current;
      if (prev) {
        (["pending", "blocked", "sentComms", "stuckWorkflowRuns", "openReconciliationCases"] as const).forEach((k) => {
          if (prev[k] !== next[k]) flashTile(k);
        });
      }
      prevStats.current = next;
      setStats(next);
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
      const res = await api<{ events: Array<BusinessEvent & { id: string }> }>("/api/events");
      const latest = res.events.slice(0, 20);
      const seen = seenEventIds.current;
      if (seen) {
        const fresh = new Set(latest.filter((e) => !seen.has(e.id)).map((e) => e.id));
        if (fresh.size > 0) {
          setFreshEventIds(fresh);
          setTimeout(() => setFreshEventIds(new Set()), 1500);
        }
      }
      seenEventIds.current = new Set(latest.map((e) => e.id));
      setEvents(latest);
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

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Finnor is on duty.</h1>
      <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
        Speak to it on the <a href="/talk">Talk page</a>, or manage the queue below.
      </p>

      <div className="grid" style={{ marginTop: 18 }}>
        <StatTile label="awaiting your approval" value={stats?.pending ?? null} href="/confirm" accent="var(--warn)" flash={flashTiles.has("pending")} />
        <StatTile label="blocked / needs review" value={stats?.blocked ?? null} href="/confirm" accent="var(--danger)" flash={flashTiles.has("blocked")} />
        <StatTile label="messages produced" value={stats?.sentComms ?? null} href="/comms" accent="var(--success)" flash={flashTiles.has("sentComms")} />
        <StatTile label="stuck workflow runs" value={stats?.stuckWorkflowRuns ?? null} href="/" accent="var(--danger)" flash={flashTiles.has("stuckWorkflowRuns")} />
        <StatTile label="open reconciliation cases" value={stats?.openReconciliationCases ?? null} href="/" accent="var(--warn)" flash={flashTiles.has("openReconciliationCases")} />
      </div>

      <div className="grid" style={{ marginTop: 28, gridTemplateColumns: "1.3fr 1fr" }}>
        <section>
          <LiveHeading>In-flight workflows</LiveHeading>
          {runs === null && panelErrors.runs && <p className="card" style={{ color: "var(--text-faint)" }}>Workflow runs are momentarily unavailable.</p>}
          {runs !== null && runs.length === 0 && (
            <div className="card" style={{ color: "var(--text-faint)", textAlign: "center" }}>No workflows running right now.</div>
          )}
          {runs === null && !panelErrors.runs && <p className="pulse" style={{ color: "var(--text-faint)" }}>Loading…</p>}
          {runs?.map((r, i) => (
            <div
              key={r.id}
              className={`card stagger-item${r.status === "running" ? " workflow-card running" : ""}`}
              style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <strong style={{ color: "var(--accent)" }}>{r.workflowType.replaceAll("_", " ")}</strong>
                <span style={{ color: "var(--text-faint)", fontSize: 12 }}>{relativeTime(r.createdAt)}</span>
              </div>
              <StepFlow steps={r.steps} />
            </div>
          ))}
        </section>

        <section>
          <LiveHeading>Event timeline</LiveHeading>
          {panelErrors.events ? (
            <p className="card" style={{ color: "var(--text-faint)" }}>Timeline is momentarily unavailable.</p>
          ) : (
            <Timeline events={events} freshEventIds={freshEventIds} />
          )}
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
        <div key={i} className="card stagger-item" style={{ "--i": Math.min(i, 12), padding: "10px 16px", display: "flex", justifyContent: "space-between" } as React.CSSProperties}>
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
