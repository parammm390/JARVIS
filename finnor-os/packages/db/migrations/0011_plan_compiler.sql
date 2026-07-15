-- Typed plan compiler (Phase 6, docs/jarvis-90-execution-blueprint.md §6). Augments
-- the existing domain_actions row lifecycle rather than introducing a parallel table —
-- these are populated once, right after the Planner's LLM output is validated, before
-- the row is ever gated or executed.

ALTER TABLE finnor_os.domain_actions ADD COLUMN IF NOT EXISTS grounded_payload jsonb;
ALTER TABLE finnor_os.domain_actions ADD COLUMN IF NOT EXISTS compiled_graph jsonb;
