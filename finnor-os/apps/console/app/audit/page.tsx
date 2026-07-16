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
      <p style={{ color: "var(--text-muted)" }}>Every step Finnor takes, immutable, newest first.</p>
      <input
        placeholder="Filter by action type (e.g. schedule_water_test)"
        value={actionType}
        onChange={(e) => setActionType(e.target.value)}
        style={{ width: "100%", padding: 8, marginBottom: 16 }}
      />
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Step</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.timestamp).toLocaleString()}</td>
                <td>{e.actionType}<br /><span style={{ color: "var(--text-faint)" }}>{e.status}</span></td>
                <td>{e.step}</td>
                <td><pre style={{ margin: 0, whiteSpace: "pre-wrap", maxWidth: 380, overflowX: "auto" }}>{JSON.stringify(e.output)}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length === 0 && !error && <p>No audit entries yet.</p>}
    </div>
  );
}
