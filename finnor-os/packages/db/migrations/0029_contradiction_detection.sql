-- Phase 5 (§5.4 — JARVIS 95% MAESTRO PACK): contradiction detection — conflicting
-- phone numbers on the same entity, duplicate equipment per household, overlapping
-- appointments. Distinct in shape from duplicate_candidate (two DIFFERENT entities
-- that might be the same underlying record): a contradiction is one entity's own data
-- disagreeing with itself.
ALTER TABLE finnor_os.data_quality_findings DROP CONSTRAINT IF EXISTS data_quality_findings_finding_type_check;
ALTER TABLE finnor_os.data_quality_findings ADD CONSTRAINT data_quality_findings_finding_type_check
  CHECK (finding_type IN ('duplicate_candidate','missing_critical_field','stale_data','ambiguous_match','contradiction'));
