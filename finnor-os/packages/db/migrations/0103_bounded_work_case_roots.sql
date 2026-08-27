-- PC-018: the 15-second Work Cases projection pages active Work first, followed by
-- recent terminal history. Keep that root selection index-backed so query cost does
-- not grow into a tenant-wide sort as historical Work accumulates.
CREATE INDEX IF NOT EXISTS works_tenant_activity_updated_id_idx
  ON finnor_os.works (
    tenant_id,
    (CASE WHEN status IN ('completed','failed','cancelled') THEN 1 ELSE 0 END),
    updated_at DESC,
    id DESC
  );

-- The bounded child traversal resolves voice/action and provider-call edges from
-- canonical action ids. These indexes keep those exact predicates from degrading
-- into tenant-wide JSON scans.
CREATE INDEX IF NOT EXISTS voice_turns_resolved_action_ids_gin_idx
  ON finnor_os.voice_turns USING gin (resolved_action_ids);

CREATE INDEX IF NOT EXISTS calls_tenant_domain_action_idx
  ON finnor_os.calls (tenant_id, (raw->>'domainActionId'))
  WHERE raw ? 'domainActionId';
