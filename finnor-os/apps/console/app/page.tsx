"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

interface Stats {
  pending: number;
  blocked: number;
  sentComms: number;
  recentSteps: Array<{ step: string; actionType: string; timestamp: string }>;
}

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(async () => {
    try {
      const [pending, blocked, comms, audit] = await Promise.all([
        api<{ actions: unknown[] }>("/api/actions/pending"),
        api<{ actions: unknown[] }>("/api/actions/pending?filter=blocked"),
        api<{ outbox: unknown[] }>("/api/comms"),
        api<{ entries: Array<{ step: string; actionType: string; timestamp: string }> }>("/api/audit?limit=6"),
      ]);
      setStats({
        pending: pending.actions.length,
        blocked: blocked.actions.length,
        sentComms: comms.outbox.length,
        recentSteps: audit.entries,
      });
    } catch {
      /* stats are cosmetic — keep the page calm on transient errors */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  const tile = (label: string, value: number | string, href: string, accent: string) => (
    <a href={href} style={{ textDecoration: "none", color: "inherit", flex: 1 }}>
      <div className="card" style={{ textAlign: "center", cursor: "pointer" }}>
        <div style={{ fontSize: 34, fontWeight: 800, color: accent }}>{value}</div>
        <div style={{ color: "#9fb0cc", fontSize: 13, marginTop: 4 }}>{label}</div>
      </div>
    </a>
  );

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Finnor is on duty.</h1>
      <p style={{ color: "#9fb0cc", marginTop: 0 }}>
        Speak to it on the <a href="/talk" style={{ color: "#9dffb0" }}>Talk page</a>, or manage the queue below.
      </p>
      <div style={{ display: "flex", gap: 14, marginTop: 18 }}>
        {tile("awaiting your approval", stats?.pending ?? "–", "/confirm", "#ffd479")}
        {tile("blocked / needs review", stats?.blocked ?? "–", "/confirm", "#ff9d9d")}
        {tile("messages produced", stats?.sentComms ?? "–", "/comms", "#9dffb0")}
      </div>
      <h3 style={{ marginTop: 28, color: "#9fb0cc" }}>Latest activity</h3>
      {(stats?.recentSteps ?? []).map((e, i) => (
        <div key={i} className="card" style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between" }}>
          <span>
            <strong style={{ color: "#8fb4ff" }}>{e.actionType}</strong>{" "}
            <span style={{ color: "#9fb0cc" }}>· {e.step}</span>
          </span>
          <span style={{ color: "#7f92b5", fontSize: 12 }}>{new Date(e.timestamp).toLocaleTimeString()}</span>
        </div>
      ))}
      {!stats && <p className="pulse" style={{ color: "#7f92b5" }}>Connecting…</p>}
    </div>
  );
}
