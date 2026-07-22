-- A4.T1 (JARVIS MAESTRO PLAN §4/A4): shared-types' ErrorKind gained `needs_human` and
-- `config` alongside the original 6 kinds (retryable/terminal/conflict/auth/validation/
-- provider_down) — extends dead_letters.error_kind's CHECK constraint (0016) to match,
-- so a DLQ row can actually be classified into the new kinds instead of the insert
-- failing a constraint the app-level type no longer agrees with.

ALTER TABLE finnor_os.dead_letters DROP CONSTRAINT IF EXISTS dead_letters_error_kind_check;
ALTER TABLE finnor_os.dead_letters ADD CONSTRAINT dead_letters_error_kind_check
  CHECK (error_kind IN ('retryable','terminal','conflict','auth','validation','provider_down','needs_human','config'));
