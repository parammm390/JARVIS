-- Phase 4: evolve the existing tenant_settings.workspace_config into the bounded
-- Tenant Experience Manifest V2. Existing rows are intentionally not rewritten:
-- the application normalizer deterministically upgrades the legacy shape at the
-- read/manifest boundary, preserving old tenant values until an explicit save or
-- convergent manifest application persists V2.

ALTER TABLE finnor_os.tenant_settings
  ALTER COLUMN workspace_config SET DEFAULT $experience$
  {
    "version":2,
    "enabledSurfaces":["home","work","customers","schedule","money","agents"],
    "terminology":{"home":"Home","work":"Work","customers":"Customers","schedule":"Schedule","money":"Money","agents":"Agents"},
    "vocabulary":{"customer":"Customer","homeowner":"Homeowner","account":"Account","technician":"Technician","installer":"Installer","serviceVisit":"Service Visit","appointment":"Appointment","quote":"Quote","proposal":"Proposal","invoice":"Invoice","job":"Job","work":"Work"},
    "voiceEnabled":true,
    "navigationPriority":["home","work","customers","schedule","money","agents"],
    "brand":{"accent":"cyan","surfaceTone":"ink","radius":"soft","density":"balanced","typography":"system","motion":"standard","mark":"F","logoAssetKey":"finnor"},
    "visibility":{"policy":true,"authority":true},
    "roles":{
      "owner":{"startView":"command","visibleSurfaces":["home","work","customers","schedule","money","agents"],"ready":{"primaryFocus":"operational_attention","heroMetric":"pending_approvals","pulseMetrics":["pending_approvals","collected_usd","overdue_invoice_value","open_leads","runs_in_flight"],"attentionCategories":["recovery","approval","schedule","money","customer","work"],"quickActions":[{"key":"inspect_blocked_work"},{"key":"review_overdue_invoices"},{"key":"review_pending_approvals"}],"primaryProjection":"work"}},
      "dispatcher":{"startView":"schedule","visibleSurfaces":["home","work","customers","schedule","agents"],"ready":{"primaryFocus":"dispatch","heroMetric":"technician_load","pulseMetrics":["technician_load","pending_approvals","runs_in_flight","stuck_runs"],"attentionCategories":["recovery","approval","schedule","customer","work"],"quickActions":[{"key":"review_schedule"},{"key":"review_technician_load"},{"key":"inspect_blocked_work"}],"primaryProjection":"schedule"}},
      "technician":{"startView":"my-day","visibleSurfaces":["home","work","customers","schedule"],"ready":{"primaryFocus":"assigned_work","heroMetric":"assigned_work_today","pulseMetrics":["assigned_work_today"],"attentionCategories":["recovery","schedule","customer","work"],"quickActions":[{"key":"open_my_day"}],"primaryProjection":"assigned-day"}}
    },
    "scenes":{"ready":{"detail":"balanced","emphasis":"presence"},"listening":{"detail":"compact","emphasis":"presence"},"plan":{"detail":"balanced","emphasis":"context"},"approval":{"detail":"detailed","emphasis":"evidence"},"working":{"detail":"balanced","emphasis":"evidence"},"outcome":{"detail":"detailed","emphasis":"evidence"},"recovery":{"detail":"detailed","emphasis":"context"}},
    "extensions":{}
  }
  $experience$::jsonb;

ALTER TABLE finnor_os.tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_workspace_config_object_check;
ALTER TABLE finnor_os.tenant_settings ADD CONSTRAINT tenant_settings_workspace_config_object_check
  CHECK (jsonb_typeof(workspace_config)='object');

ALTER TABLE finnor_os.tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_workspace_config_no_secrets_check;
ALTER TABLE finnor_os.tenant_settings ADD CONSTRAINT tenant_settings_workspace_config_no_secrets_check CHECK (
  workspace_config::text !~* '"[^"]*(secret|password|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|api[ _-]?key|credential|cookie|session[ _-]?storage|local[ _-]?storage)[^"]*"[[:space:]]*:'
);

-- Reuse Phase 2's durable tenant-wide invalidation ledger. Only the presentation
-- tag is emitted; active Work/action/receipt state is neither copied nor reset.
DROP TRIGGER IF EXISTS tenant_settings_experience_operational_delta ON finnor_os.tenant_settings;
CREATE TRIGGER tenant_settings_experience_operational_delta
  AFTER INSERT OR UPDATE OF workspace_config ON finnor_os.tenant_settings
  FOR EACH ROW
  EXECUTE FUNCTION finnor_os.append_operational_delta('','preferences','','');
