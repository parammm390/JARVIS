-- Business Truth Registry cutover: messages is the sole writable owner of a
-- customer communication. communications_log survives only as a read-compatible
-- projection so old read models can roll forward without a second writable fact.

-- Preserve the exact definitions before renaming the source table: PostgreSQL view
-- dependencies follow the table OID across a rename, so the Company Graph views must
-- be rebound to the compatibility projection after the cutover.
DO $cutover$
DECLARE
  graph_edges_definition text;
  graph_nodes_definition text;
  communications_kind "char";
BEGIN
  SELECT c.relkind INTO communications_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='finnor_os' AND c.relname='communications_log';

  IF communications_kind = 'r' THEN
    IF to_regclass('finnor_os.company_graph_edges') IS NOT NULL THEN
      graph_edges_definition := pg_get_viewdef('finnor_os.company_graph_edges'::regclass, true);
    END IF;
    IF to_regclass('finnor_os.company_graph_nodes') IS NOT NULL THEN
      graph_nodes_definition := pg_get_viewdef('finnor_os.company_graph_nodes'::regclass, true);
    END IF;

    -- One stable conversation per tenant/customer/channel absorbs historical rows.
    INSERT INTO finnor_os.conversations(
      id,tenant_id,household_id,channel,status,last_activity_at,
      source_system,external_id,created_by,created_at
    )
    SELECT
      md5(cl.tenant_id::text || ':communications-log:' || cl.household_id::text || ':' ||
          CASE WHEN cl.channel='call' THEN 'voice'
               WHEN cl.channel IN ('email','webchat') THEN cl.channel ELSE 'sms' END)::uuid,
      cl.tenant_id,
      cl.household_id,
      CASE WHEN cl.channel='call' THEN 'voice'
           WHEN cl.channel IN ('email','webchat') THEN cl.channel ELSE 'sms' END,
      'open',
      max(cl."timestamp"),
      'communications_log_backfill',
      cl.household_id::text || ':' || CASE WHEN cl.channel='call' THEN 'voice'
           WHEN cl.channel IN ('email','webchat') THEN cl.channel ELSE 'sms' END,
      'migration:0107',
      min(cl."timestamp")
    FROM finnor_os.communications_log cl
    GROUP BY cl.tenant_id,cl.household_id,
      CASE WHEN cl.channel='call' THEN 'voice'
           WHEN cl.channel IN ('email','webchat') THEN cl.channel ELSE 'sms' END
    ON CONFLICT (id) DO UPDATE SET
      last_activity_at=greatest(finnor_os.conversations.last_activity_at,EXCLUDED.last_activity_at);

    -- Reuse the historical communication UUID as the canonical message identity.
    -- This preserves every old URL/event reference and makes the backfill convergent.
    INSERT INTO finnor_os.messages(
      id,tenant_id,conversation_id,direction,channel,content,sent_at,
      source_system,external_id,created_by,created_at
    )
    SELECT
      cl.id,
      cl.tenant_id,
      md5(cl.tenant_id::text || ':communications-log:' || cl.household_id::text || ':' ||
          CASE WHEN cl.channel='call' THEN 'voice'
               WHEN cl.channel IN ('email','webchat') THEN cl.channel ELSE 'sms' END)::uuid,
      cl.direction,
      cl.channel,
      cl.content,
      cl."timestamp",
      'communications_log_backfill',
      cl.id::text,
      'migration:0107',
      cl."timestamp"
    FROM finnor_os.communications_log cl
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO finnor_os.business_events(
      tenant_id,entity_type,entity_id,event_type,payload,occurred_at,source
    )
    SELECT
      cl.tenant_id,'message',cl.id,'message_backfilled',
      jsonb_build_object('legacyProjection','communications_log'),cl."timestamp",'migration:0107'
    FROM finnor_os.communications_log cl
    WHERE NOT EXISTS (
      SELECT 1 FROM finnor_os.business_events be
      WHERE be.tenant_id=cl.tenant_id AND be.entity_type='message'
        AND be.entity_id=cl.id AND be.event_type='message_backfilled'
    );

    ALTER TABLE finnor_os.communications_log RENAME TO communications_log_legacy;

    EXECUTE $view$
      CREATE VIEW finnor_os.communications_log WITH (security_invoker=true,security_barrier=true) AS
      SELECT
        m.id,
        m.tenant_id,
        c.household_id,
        m.channel,
        m.direction,
        m.content,
        m.sent_at AS "timestamp"
      FROM finnor_os.messages m
      JOIN finnor_os.conversations c
        ON c.tenant_id=m.tenant_id AND c.id=m.conversation_id
      WHERE c.household_id IS NOT NULL
    $view$;

    IF graph_edges_definition IS NOT NULL THEN
      EXECUTE 'CREATE OR REPLACE VIEW finnor_os.company_graph_edges WITH (security_invoker=true) AS '
        || graph_edges_definition;
    END IF;
    IF graph_nodes_definition IS NOT NULL THEN
      EXECUTE 'CREATE OR REPLACE VIEW finnor_os.company_graph_nodes WITH (security_invoker=true) AS '
        || graph_nodes_definition;
    END IF;
  END IF;
END $cutover$;

-- Provenance is the durable provider/import idempotency claim. Older code checked
-- then inserted, so a concurrent retry could have produced two rows with the same
-- claim. Preserve every row, but move later duplicates onto an explicitly marked
-- evidence key before installing the database fence.
WITH ranked AS (
  SELECT id,tenant_id,source_system,external_id,
         row_number() OVER (
           PARTITION BY tenant_id,source_system,external_id
           ORDER BY created_at,id
         ) AS occurrence
  FROM finnor_os.messages
  WHERE source_system IS NOT NULL AND external_id IS NOT NULL
), duplicates AS (
  SELECT * FROM ranked WHERE occurrence>1
), evidence AS (
  INSERT INTO finnor_os.business_events(
    tenant_id,entity_type,entity_id,event_type,payload,source
  )
  SELECT tenant_id,'message',id,'duplicate_message_provenance_normalized',
         jsonb_build_object(
           'sourceSystem',source_system,
           'originalExternalId',external_id,
           'occurrence',occurrence
         ),'migration:0107'
  FROM duplicates
  RETURNING entity_id
)
UPDATE finnor_os.messages m
SET external_id=m.external_id || ':duplicate:' || m.id::text
FROM duplicates d
WHERE m.id=d.id AND EXISTS (SELECT 1 FROM evidence e WHERE e.entity_id=m.id);

CREATE UNIQUE INDEX IF NOT EXISTS messages_tenant_source_external_unique
  ON finnor_os.messages(tenant_id,source_system,external_id)
  WHERE source_system IS NOT NULL AND external_id IS NOT NULL;

-- The frozen table cannot be mutated even by a table owner or maintenance script.
CREATE OR REPLACE FUNCTION finnor_os.forbid_legacy_communications_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'communications_log_legacy is frozen; write customer communication through canonical messages';
END $$;

DROP TRIGGER IF EXISTS communications_log_legacy_read_only ON finnor_os.communications_log_legacy;
CREATE TRIGGER communications_log_legacy_read_only
  BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON finnor_os.communications_log_legacy
  FOR EACH STATEMENT EXECUTE FUNCTION finnor_os.forbid_legacy_communications_write();

REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
  ON finnor_os.communications_log_legacy FROM PUBLIC;
REVOKE ALL ON finnor_os.communications_log FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
      ON finnor_os.communications_log_legacy FROM finnor_app;
    GRANT SELECT ON finnor_os.communications_log TO finnor_app;
  END IF;
END $grants$;

COMMENT ON TABLE finnor_os.communications_log_legacy IS
  'Frozen pre-0107 rows retained for recovery evidence only; never a writable business truth.';
COMMENT ON VIEW finnor_os.communications_log IS
  'Read-only legacy projection of canonical messages joined to conversations; messages owns the fact.';
