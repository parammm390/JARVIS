-- A4.T3 (JARVIS MAESTRO PLAN §4/A4): rule-based DLQ auto-triage. Advisory only — the
-- owner-gated replay/discard routes (packages/workflow-runtime/src/dlq.ts) are
-- unchanged; this just pre-computes a suggestion so an owner reviewing the DLQ isn't
-- staring at a blank row deciding cold.

ALTER TABLE finnor_os.dead_letters ADD COLUMN IF NOT EXISTS suggested_disposition text
  CHECK (suggested_disposition IN ('replay', 'discard', 'escalate'));
ALTER TABLE finnor_os.dead_letters ADD COLUMN IF NOT EXISTS suggestion_reason text;
