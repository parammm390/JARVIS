"use client";

// Customer 360 (Phase 11): household list -> full traversal detail. Additive to
// Phase 10's mission control — reuses its tokens and the extracted Timeline
// component. No new poll surface beyond the household list itself; the detail view
// is fetched on selection, not polled (a traversal read-model, not a live feed).

import { useCallback, useState } from "react";
import { api } from "../../lib/api";
import { usePoll } from "../../lib/use-poll";
import Timeline, { type BusinessEvent } from "../../components/Timeline";

interface HouseholdRow {
  id: string;
  address: string;
  contactInfo: Record<string, unknown>;
  marketingConsent: boolean;
  createdAt: string;
}

interface Household360 {
  household: { id: string; address: string; contactInfo: Record<string, unknown>; marketingConsent: boolean; createdAt: string };
  contacts: Array<{ id: string; name: string; role: string | null; methods: Array<{ methodType: string; value: string; consent: boolean }> }>;
  leads: Array<{ id: string; name: string; status: string; source: string | null; createdAt: string }>;
  quotes: Array<{ id: string; status: string; totalUsd: number | null; createdAt: string }>;
  invoices: Array<{ id: string; status: string; amountUsd: number; dueDate: string | null }>;
  workOrders: Array<{ id: string; type: string; status: string; scheduledAt: string | null; completedAt: string | null }>;
  timeline: BusinessEvent[];
  queryMs: number;
}

export default function CustomersPage() {
  const [households, setHouseholds] = useState<HouseholdRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Household360 | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadHouseholds = useCallback(async () => {
    try {
      const res = await api<{ rows: HouseholdRow[] }>("/api/resources/households");
      setHouseholds(res.rows);
    } catch {
      setHouseholds((prev) => prev ?? []);
    }
  }, []);
  usePoll(loadHouseholds, 30000, []);

  async function selectHousehold(id: string) {
    setSelectedId(id);
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const res = await api<{ data: Household360 }>(`/api/read-models/household-360?householdId=${id}`);
      setDetail(res.data);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to load household");
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  const openLeads = detail?.leads.filter((l) => l.status !== "converted" && l.status !== "disqualified").length ?? 0;
  const openQuotes = detail?.quotes.filter((q) => q.status === "sent").length ?? 0;
  const unpaidUsd = detail?.invoices.filter((i) => i.status === "sent" || i.status === "overdue").reduce((s, i) => s + i.amountUsd, 0) ?? 0;
  const openWorkOrders = detail?.workOrders.filter((w) => w.status !== "completed" && w.status !== "canceled").length ?? 0;

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Customers</h1>
      <p style={{ color: "var(--text-muted)", marginTop: 0 }}>Everything Finnor knows about a household, in one place.</p>

      <div className="grid" style={{ marginTop: 18, gridTemplateColumns: "0.9fr 1.6fr", alignItems: "start" }}>
        <section>
          <h3 style={{ color: "var(--text-muted)", marginTop: 0 }}>Households</h3>
          {households === null && <p className="pulse" style={{ color: "var(--text-faint)" }}>Loading…</p>}
          {households?.length === 0 && <div className="card" style={{ color: "var(--text-faint)" }}>No households yet.</div>}
          {households?.map((h, i) => (
            <div
              key={h.id}
              className="card stagger-item"
              style={{
                "--i": Math.min(i, 12),
                cursor: "pointer",
                borderColor: selectedId === h.id ? "var(--accent)" : undefined,
              } as React.CSSProperties}
              onClick={() => selectHousehold(h.id)}
            >
              <strong>{h.address}</strong>
              <div style={{ marginTop: 6 }}>
                {h.marketingConsent ? <span className="badge badge-success">consent</span> : <span className="badge badge-muted">no consent</span>}
              </div>
            </div>
          ))}
        </section>

        <section>
          {!selectedId && (
            <div className="card" style={{ color: "var(--text-faint)", textAlign: "center" }}>
              Select a household to see its full history.
            </div>
          )}
          {selectedId && loadingDetail && <p className="pulse" style={{ color: "var(--text-faint)" }}>Loading household…</p>}
          {selectedId && detailError && <div className="card" style={{ color: "var(--danger)" }}>{detailError}</div>}

          {detail && !loadingDetail && (
            <>
              <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <strong style={{ fontSize: "var(--font-size-lg)" }}>{detail.household.address}</strong>
                    <div style={{ marginTop: 6 }}>
                      {detail.household.marketingConsent ? (
                        <span className="badge badge-success">marketing consent</span>
                      ) : (
                        <span className="badge badge-danger">no marketing consent</span>
                      )}
                    </div>
                  </div>
                  <span style={{ color: "var(--text-faint)", fontSize: 12 }}>{detail.queryMs.toFixed(1)}ms</span>
                </div>
                {detail.contacts.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    {detail.contacts.map((c) => (
                      <div key={c.id} style={{ fontSize: "var(--font-size-sm)", marginBottom: 6 }}>
                        <strong>{c.name}</strong>
                        {c.role ? <span style={{ color: "var(--text-faint)" }}> · {c.role}</span> : null}
                        {c.methods.map((m, i) => (
                          <span key={i} style={{ marginLeft: 10, color: "var(--text-muted)" }}>
                            {m.value}
                            {m.consent ? null : <span className="badge badge-muted" style={{ marginLeft: 4 }}>no consent</span>}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid" style={{ marginTop: 14 }}>
                <div className="card tile">
                  <div className="tile-value">{openLeads}</div>
                  <div className="tile-label">open leads</div>
                </div>
                <div className="card tile">
                  <div className="tile-value">{openQuotes}</div>
                  <div className="tile-label">open quotes</div>
                </div>
                <div className="card tile">
                  <div className="tile-value">${unpaidUsd.toLocaleString()}</div>
                  <div className="tile-label">unpaid</div>
                </div>
                <div className="card tile">
                  <div className="tile-value">{openWorkOrders}</div>
                  <div className="tile-label">open work orders</div>
                </div>
              </div>

              <h3 style={{ marginTop: 20, color: "var(--text-muted)" }}>Timeline</h3>
              <Timeline events={detail.timeline} emptyLabel="No recorded activity for this household yet." />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
