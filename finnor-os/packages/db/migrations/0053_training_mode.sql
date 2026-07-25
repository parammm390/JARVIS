-- B4.T5: an explicit label on a practice tenant. Training mode never turns on the
-- continuous Dealer Zero simulator and never represents the tenant as production.
ALTER TABLE finnor_os.tenant_settings ADD COLUMN IF NOT EXISTS training_mode boolean NOT NULL DEFAULT false;
