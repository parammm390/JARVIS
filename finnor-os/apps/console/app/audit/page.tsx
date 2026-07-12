// Audit view (§6): read-only, filterable list over action_log.
"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

interface AuditEntry {
  id: string;
  domainActionId: string;
  step: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  timestamp: string;
  actionType: string;
  status: string;
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [actionType, setActionType] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = actionType ? `&actionType=${encodeURIComponent(actionType)}` : "";
      const res = await api<{ entries: AuditEntry[] }>(`/api/audit?limit=100${qs}`);
      setEntries(res.entries);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [actionType]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <h1>Audit Log</h1>
      <p style={{ color: "#9fb0cc" }}>Every step Finnor takes, immutable, newest first.</p>
      <input
        placeholder="Filter by action type (e.g. schedule_water_test)"
        value={actionType}
        onChange={(e) => setActionType(e.target.value)}
        style={{ width: "100%", padding: 8, marginBottom: 16, background: "#101a30", color: "#e7ecf5", border: "1px solid #2b3d63", borderRadius: 6 }}
      />
      {error && <p style={{ color: "#ff9d9d" }}>{error}</p>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#7f92b5" }}>
            <th style={cell}>When</th>
            <th style={cell}>Action</th>
            <th style={cell}>Step</th>
            <th style={cell}>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} style={{ borderTop: "1px solid #1e2a44" }}>
              <td style={cell}>{new Date(e.timestamp).toLocaleString()}</td>
              <td style={cell}>{e.actionType}<br /><span style={{ color: "#7f92b5" }}>{e.status}</span></td>
              <td style={cell}>{e.step}</td>
              <td style={cell}><pre style={{ margin: 0, whiteSpace: "pre-wrap", maxWidth: 380, overflowX: "auto" }}>{JSON.stringify(e.output)}</pre></td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && !error && <p>No audit entries yet.</p>}
    </div>
  );
}

const cell: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
