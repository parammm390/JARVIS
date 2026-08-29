-- Operating Product Closure: preserve tenant customization while converging the
-- untouched default shell onto the six canonical surfaces and product language.
-- This changes presentation configuration only; no Work or business fact moves.

UPDATE finnor_os.tenant_settings
SET workspace_config=jsonb_set(
  workspace_config,
  '{navigationPriority}',
  '["home","customers","schedule","money","work","agents"]'::jsonb,
  true
)
WHERE workspace_config->'navigationPriority' =
  '["home","work","customers","schedule","money","agents"]'::jsonb;

UPDATE finnor_os.tenant_settings
SET workspace_config=jsonb_set(
  workspace_config,
  '{enabledSurfaces}',
  '["home","customers","schedule","money","work","agents"]'::jsonb,
  true
)
WHERE workspace_config->'enabledSurfaces' =
  '["home","work","customers","schedule","money","agents"]'::jsonb;

UPDATE finnor_os.tenant_settings
SET workspace_config=jsonb_set(workspace_config,'{terminology,agents}','"AI Team"'::jsonb,true)
WHERE workspace_config->'terminology'->>'agents'='Agents';

ALTER TABLE finnor_os.tenant_settings
  ALTER COLUMN workspace_config SET DEFAULT $experience$
  {
    "version":2,
    "enabledSurfaces":["home","customers","schedule","money","work","agents"],
    "terminology":{"home":"Home","work":"Work","customers":"Customers","schedule":"Schedule","money":"Money","agents":"AI Team"},
    "vocabulary":{"customer":"Customer","homeowner":"Homeowner","account":"Account","technician":"Technician","installer":"Installer","serviceVisit":"Service Visit","appointment":"Appointment","quote":"Quote","proposal":"Proposal","invoice":"Invoice","job":"Job","work":"Work"},
    "voiceEnabled":true,
    "navigationPriority":["home","customers","schedule","money","work","agents"],
    "brand":{"accent":"cyan","surfaceTone":"ink","radius":"soft","density":"balanced","typography":"system","motion":"standard","mark":"F","logoAssetKey":"finnor"},
    "visibility":{"policy":true,"authority":true},
    "roles":{
      "owner":{"startView":"command","visibleSurfaces":["home","customers","schedule","money","work","agents"],"ready":{"primaryFocus":"operational_attention","heroMetric":"pending_approvals","pulseMetrics":["pending_approvals","collected_usd","overdue_invoice_value","open_leads","runs_in_flight"],"attentionCategories":["recovery","approval","schedule","money","customer","work"],"quickActions":[{"key":"inspect_blocked_work"},{"key":"review_overdue_invoices"},{"key":"review_pending_approvals"}],"primaryProjection":"work"}},
      "dispatcher":{"startView":"schedule","visibleSurfaces":["home","customers","schedule","work","agents"],"ready":{"primaryFocus":"dispatch","heroMetric":"technician_load","pulseMetrics":["technician_load","pending_approvals","runs_in_flight","stuck_runs"],"attentionCategories":["recovery","approval","schedule","customer","work"],"quickActions":[{"key":"review_schedule"},{"key":"review_technician_load"},{"key":"inspect_blocked_work"}],"primaryProjection":"schedule"}},
      "technician":{"startView":"my-day","visibleSurfaces":["home","customers","schedule","work"],"ready":{"primaryFocus":"assigned_work","heroMetric":"assigned_work_today","pulseMetrics":["assigned_work_today"],"attentionCategories":["recovery","schedule","customer","work"],"quickActions":[{"key":"open_my_day"}],"primaryProjection":"assigned-day"}}
    },
    "scenes":{"ready":{"detail":"balanced","emphasis":"presence"},"listening":{"detail":"compact","emphasis":"presence"},"plan":{"detail":"balanced","emphasis":"context"},"approval":{"detail":"detailed","emphasis":"evidence"},"working":{"detail":"balanced","emphasis":"evidence"},"outcome":{"detail":"detailed","emphasis":"evidence"},"recovery":{"detail":"detailed","emphasis":"context"}},
    "extensions":{}
  }
  $experience$::jsonb;

COMMENT ON COLUMN finnor_os.tenant_settings.workspace_config IS
  'Tenant Experience Manifest. Default product order: Home, Customers, Schedule, Money, Work, AI Team; tenant-authorized customization remains supported.';
