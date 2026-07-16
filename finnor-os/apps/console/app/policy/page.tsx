// Policy editor (§6): raw form/JSON editor over domain_policies rows. No visual builder yet.
"use client";

import { useState } from "react";
import { api } from "../../lib/api";

const DEV_TENANT = process.env.NEXT_PUBLIC_DEV_TENANT_ID ?? "00000000-0000-4000-8000-000000000001";

export default function PolicyPage() {
  const [actionType, setActionType] = useState("schedule_water_test");
  const [policyJson, setPolicyJson] = useState("{}");
  const [requiresConfirmation, setRequiresConfirmation] = useState(true);
  const [template, setTemplate] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function load() {
    setStatus("Loading…");
    try {
      const res = await api<{ policy: { policy: Record<string, unknown>; requiresConfirmation: boolean; confirmationTemplate: string | null } }>(
        `/api/policies/${DEV_TENANT}/${encodeURIComponent(actionType)}`,
      );
      setPolicyJson(JSON.stringify(res.policy.policy, null, 2));
      setRequiresConfirmation(res.policy.requiresConfirmation);
      setTemplate(res.policy.confirmationTemplate ?? "");
      setStatus("Loaded.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function save() {
    setStatus("Saving…");
    try {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(policyJson);
      } catch {
        setStatus("Policy JSON is not valid JSON.");
        return;
      }
      await api(`/api/policies/${DEV_TENANT}/${encodeURIComponent(actionType)}`, {
        method: "PUT",
        body: JSON.stringify({
          policy: parsed,
          requiresConfirmation,
          confirmationTemplate: template || null,
        }),
      });
      setStatus("Saved.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  const input: React.CSSProperties = { width: "100%", padding: 8, marginBottom: 12, fontFamily: "inherit" };

  return (
    <div>
      <h1>Policy Editor</h1>
      <p style={{ color: "var(--text-muted)" }}>Business rules live here as configuration — pricing, cadences, confirmation wording. Never in code.</p>
      <label>Action type</label>
      <input style={input} value={actionType} onChange={(e) => setActionType(e.target.value)} />
      <button onClick={load} className="btn">Load current</button>
      <div style={{ height: 16 }} />
      <label>Policy JSON</label>
      <textarea style={{ ...input, minHeight: 200, fontFamily: "ui-monospace, monospace" }} value={policyJson} onChange={(e) => setPolicyJson(e.target.value)} />
      <label>
        <input type="checkbox" checked={requiresConfirmation} onChange={(e) => setRequiresConfirmation(e.target.checked)} />{" "}
        Require human confirmation before executing (recommended)
      </label>
      <div style={{ height: 12 }} />
      <label>Confirmation template (uses {"{{placeholders}}"})</label>
      <input style={input} value={template} onChange={(e) => setTemplate(e.target.value)} />
      <button onClick={save} className="btn btn-primary">Save policy</button>
      {status && <p style={{ color: "var(--text-muted)" }}>{status}</p>}
    </div>
  );
}
