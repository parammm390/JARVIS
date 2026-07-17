-- Phase 12 (docs/jarvis-99-phase-10-16-execution-plan.md, "PHASE 12"): scan_findings
-- gains a severity for risk-tiering and a link to the action it caused to be drafted
-- (when a scan's config-gated drafting path fires), so the loop from "scan noticed
-- something" to "a gated action exists for it" is auditable end-to-end instead of a
-- one-way staging table.

ALTER TABLE finnor_os.scan_findings
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical')),
  ADD COLUMN IF NOT EXISTS drafted_action_id uuid REFERENCES finnor_os.domain_actions(id);

CREATE INDEX IF NOT EXISTS scan_findings_open_idx
  ON finnor_os.scan_findings (tenant_id, scan_type) WHERE digested_at IS NULL;
