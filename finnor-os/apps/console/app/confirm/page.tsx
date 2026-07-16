// Confirmation Queue (§6): the safety mechanism, now with an experience to match —
// optimistic decisions (card slides out instantly, server confirms behind it),
// quiet background refresh (no flicker), toast feedback.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";

interface PendingAction {
  id: string;
  actionType: string;
  summary: string | null;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
  groundedPayload?: Array<{ field: string; status: "verified" | "not_found" | "unverifiable" }> | null;
}

export default function ConfirmPage() {
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"pending" | "blocked">("pending");
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await api<{ actions: PendingAction[] }>(`/api/actions/pending?filter=${filter}`);
      // Quiet merge: never re-render cards the user is mid-decision on.
      setActions(res.actions.filter((a) => !inflight.current.has(a.id)));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  async function decide(id: string, verb: "confirm" | "reject") {
    // Optimistic: slide the card out immediately; the server call rides behind it.
    inflight.current.add(id);
    setLeaving((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setActions((prev) => prev.filter((a) => a.id !== id));
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 350);
    try {
      const res = await api<{ result?: { status?: string; error?: string } }>(
        `/api/actions/${id}/${verb}`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (verb === "reject") showToast("Rejected — nothing will be sent.");
      else if (res.result?.status === "success") showToast("Approved and executed ✓");
      else showToast(`Approved — ${res.result?.error ?? "execution had an issue; see Blocked."}`);
    } catch (e) {
      showToast(`Problem: ${(e as Error).message}`);
      load(); // bring the card back if the server disagreed
    } finally {
      inflight.current.delete(id);
    }
  }

  const filterBtn = (key: "pending" | "blocked", label: string) => (
    <button onClick={() => setFilter(key)} className={`btn-toggle${filter === key ? " active" : ""}`}>
      {label}
    </button>
  );

  const groundedBadgeClass: Record<"verified" | "not_found" | "unverifiable", string> = {
    verified: "badge badge-success",
    not_found: "badge badge-danger",
    unverifiable: "badge badge-muted",
  };

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Confirmation Queue</h1>
      <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
        Nothing here has happened yet. Finnor only acts after you approve — here or by voice.
      </p>
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        {filterBtn("pending", "Awaiting approval")}
        {filterBtn("blocked", "Blocked / needs review")}
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {actions.length === 0 && !error && (
        <div className="card" style={{ textAlign: "center", color: "var(--text-faint)" }}>
          Nothing waiting on you right now. 🎉
        </div>
      )}
      {actions.map((a) => (
        <div key={a.id} className={`card${leaving.has(a.id) ? " leaving" : ""}`}>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 8 }}>
            {a.actionType} · {new Date(a.createdAt).toLocaleString()} · {a.status.replaceAll("_", " ")}
          </div>
          {a.groundedPayload && a.groundedPayload.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {a.groundedPayload.map((g) => (
                <span key={g.field} className={groundedBadgeClass[g.status]}>
                  {g.field}: {g.status.replaceAll("_", " ")}
                </span>
              ))}
            </div>
          )}
          <div style={{ fontSize: 16, marginBottom: 14, lineHeight: 1.5 }}>{a.summary ?? "No summary drafted."}</div>
          <details style={{ marginBottom: 14 }}>
            <summary style={{ cursor: "pointer", color: "var(--accent)", fontSize: 13 }}>Details</summary>
            <pre style={{ fontSize: 12, overflowX: "auto", background: "var(--bg-sunken)", padding: 12, borderRadius: 8 }}>
              {JSON.stringify(a.payload, null, 2)}
            </pre>
          </details>
          <button onClick={() => decide(a.id, "confirm")} className="btn-approve">Approve</button>{" "}
          <button onClick={() => decide(a.id, "reject")} className="btn-danger">Reject</button>
        </div>
      ))}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
