# Declarative client data imports

FINNOR imports dealer exports through one tenant-scoped pipeline:

`source → mapping → parse → normalize → validate → identity/relationships → dry-run or canonical write → quarantine → report`

Mappings are data, not importer source code. CSV, JSON arrays, and JSONL are supported. The engine deliberately is not a general ETL runtime: mappings can select or compose columns, convert types, apply a small normalization vocabulary, map enum values, supply explicit defaults, declare ordered exact identity keys, and resolve source-ID relationships.

## Mapping example

Dealer A can map `cust_fname`; Dealer B can map `FIRST_NAME`. Both target the same structured canonical contact fields on the household/contact customer aggregate:

```json
{
  "key": "dealer-a-customers",
  "format": "csv",
  "version": 1,
  "entity": "customer",
  "sourceSystem": "dealer-a-crm",
  "fields": {
    "firstName": { "from": "cust_fname", "required": true, "normalize": ["trim", "title_case"] },
    "lastName": { "from": "cust_lname", "normalize": ["trim", "title_case"] },
    "phone": { "from": "mobile", "normalize": ["phone_e164", "empty_to_null"] },
    "email": { "from": "email", "normalize": ["trim", "lowercase", "empty_to_null"] },
    "address": { "compose": { "from": ["street", "city"], "separator": ", " } }
  },
  "externalId": { "from": "customer_no", "required": true, "normalize": ["trim"] },
  "identity": [{ "fields": ["email"] }, { "fields": ["phone"] }],
  "updateMode": "fill_missing"
}
```

The equivalent Dealer B mapping changes only the `from` values. A versioned mapping can live in `clientManifest.imports`; `docs/client-manifest.example.json` is executable schema-valid documentation.

## Identity and safe updates

Resolution precedence is deterministic and tenant-local:

1. exact `(tenant, sourceSystem, canonical entity, sourceId)` reference;
2. first complete configured identity rule, matched exactly within the same tenant/source/entity;
3. narrow canonical exact matches implemented by `@finnor/data-platform` (for example normalized customer phone/email or inventory SKU);
4. create a new canonical record.

Multiple candidates quarantine as `ambiguous_match`; the engine never chooses one approximately. Source references are written in the same transaction as the canonical row. A concurrent identity claim rolls the entire row back.

Update modes are explicit:

- `insert_only`: an existing record is never changed.
- `fill_missing` (default): populate only absent canonical values.
- `source_owned`: overwrite mapped mutable fields only after an existing reference proves the same tenant/source owns that canonical record. A phone/email match to an existing production record is not enough to grant overwrite authority.

Quotes never have financial line history silently replaced; a corrected quote should be a new source record. Payments are append-only on replay. Inventory quantities require explicit `source_owned` mode to replace an existing snapshot.

## Relationships and import order

Relationships resolve only through the durable import reference ledger. Example appointment mapping:

```json
{
  "relationships": {
    "householdId": {
      "entity": "customer",
      "sourceId": { "from": "customer_no", "required": true },
      "required": true
    }
  }
}
```

Import parents before children: customers and technicians, then leads/equipment, then appointments/service/work/quotes/invoices, then payments. A missing parent quarantines only that child row. After the parent import succeeds, rerun the child file; prior valid rows replay without duplication and the formerly quarantined row can recover.

## Running an import

Standalone mapping:

```sh
npm run import:client -- --tenantId=<uuid> --mapping=imports/acme-customers.json --file=exports/customers.csv --dry-run
npm run import:client -- --tenantId=<uuid> --mapping=imports/acme-customers.json --file=exports/customers.csv
```

Manifest mapping:

```sh
npm run import:client -- --tenantId=<uuid> --manifest=docs/client-manifest.example.json --importKey=initial-crm-export --file=exports/customers.csv --dry-run
```

Dry-run writes only `import_runs`/`import_rows` audit state. It makes zero business-data changes. The JSON report includes hashes of the source and normalized mapping plus created/updated/skipped/planned/quarantined counts. Exit code `2` means the run completed with quarantined rows; it is not reported as success.

Every non-dry row is its own database transaction, so a malformed or failed row cannot roll back valid rows and cannot leave a half-written canonical aggregate. `import_rows.reasons` contains the exact parse/mapping/normalization/validation/identity/relationship/write error. The `import_entity_refs` ledger preserves source provenance across runs.

## Supported canonical domains

- customer aggregate: households, contacts, contact methods
- leads
- appointments
- completed or scheduled service visits
- install/repair/warranty work orders
- equipment
- quotes, quote line items, and linked proposal records
- invoices
- payments
- single-location native inventory items
- operational technicians

Authenticated employees/users are intentionally provisioned through the Phase 1 client manifest and Supabase identity flow, not data import. Warehouses/multi-location stock, maintenance agreements, and auth identities are not imported until their canonical write contracts are extended; the engine does not invent or write shadow entities for them.
