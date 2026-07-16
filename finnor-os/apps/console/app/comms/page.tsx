// Communications view: every message and call Finnor has produced. Items marked
// "simulated" completed the entire workflow — only the carrier delivery hop is
// pending real GHL/Vapi phone credentials.
"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

interface OutboxItem {
  id: string;
  channel: string;
  toNumber: string;
  content: string;
  simulated: boolean;
  createdAt: string;
}

export default function CommsPage() {
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ outbox: OutboxItem[] }>("/api/comms");
      setOutbox(res.outbox);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div>
      <h1>Communications</h1>
      <p style={{ color: "var(--text-muted)" }}>
        Every message and call Finnor produced. <strong>Simulated</strong> means the whole
        workflow completed — booking, records, audit — and only the carrier delivery is
        waiting on real phone credentials.
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {outbox.length === 0 && <p>Nothing sent yet.</p>}
      {outbox.map((o, i) => (
        <div key={o.id} className="card stagger-item" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 6 }}>
            {o.channel.toUpperCase()} → {o.toNumber} · {new Date(o.createdAt).toLocaleString()}{" "}
            {o.simulated && <span className="badge badge-warn" style={{ marginLeft: 6 }}>simulated delivery</span>}
          </div>
          <div style={{ fontSize: 14 }}>{o.content}</div>
        </div>
      ))}
    </div>
  );
}
