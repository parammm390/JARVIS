# Policy Matrix — Phase 3, Task 3.1

The committed source of truth for every registered domain action's policy: required
config fields, the chosen value, risk tier, and confirmation posture. `scripts/seed-tenant-policies.ts`
is generated from this table (mechanically, not by hand-typing a second copy) — if this
file and the script ever disagree, the script is wrong, fix it here first.

**Confirmation rule applied throughout (fail-closed default, per the pack's risk law):**
`requiresConfirmation` defaults to **true** for every action. It is relaxed to **false**
only where the action is provably read-only (no DB write, no external call, no side
effect) or the plugin already hardcodes `false` in code with an explicit read-only
rationale. Every action that contacts a customer, moves inventory, or touches money
stays `true` — no exceptions — matching `DECISIONS`. This is stricter than the pack's
literal floor (which only *requires* true for those three categories) because the
existing codebase's own precedent (`packages/db/seed.ts`, 10+ pre-existing rows) already
defaults every non-read mutation to gated, and §0.3.10 ("fail-closed posture may never be
weakened") makes the stricter reading the correct one.

**Risk tiers** (documentation-level, for review — see note at bottom on runtime wiring):
- **low** — no external effect, reversible, no money/inventory/customer contact.
- **medium** — an internal commitment with real-world consequences (a scheduled visit,
  inventory consumed, an outbound answer to an existing question) but not itself a new
  irreversible customer-facing or financial event.
- **high** — money moves, a customer receives new unsolicited outreach, or a workflow
  starts that commits real resources (installation, e-signature, invoicing).

Legend: **PF** = policy field read from `domain_policies.policy` (only fields the plugin
or its zod policy-schema actually reads or validates — see `finnor-os/docs/effect-census.md`-style
per-plugin analysis below). Fields not read by any code path are omitted here even if a
prior seed row happened to include them (e.g. `pricing_tier`, `consent_required`,
`grounding` were found to be dead keys in the pre-existing seed data — not carried
forward into the real matrix below to avoid documenting fictional configuration).

---

## 1. water-test
| Action | PF | Chosen value | Confirmation | Risk |
|---|---|---|---|---|
| `schedule_water_test` | `service_radius_miles` | **25** | true | medium |
| | `default_duration_minutes` | 45 | | |
| | `allowed_windows` | `["09:00-12:00","13:00-17:00"]` | | |

## 2. maintenance-agreement
| Action | PF | Chosen value | Confirmation | Risk |
|---|---|---|---|---|
| `renew_maintenance_agreement` | `renewal_window_days` | 30 | true | high |
| | `price_usd` | **249** | | |
| | `cadence_options` | `["annual","semi_annual"]` | | |

## 3. crm (no policy fields read by any of the 4 action types)
| Action | Confirmation | Risk |
|---|---|---|
| `create_lead` | true | low |
| `update_lead_status` | true | low |
| `log_interaction` | true | low |
| `assign_lead_to_technician` | true | medium |

## 4. inventory
| Action | PF | Chosen value | Confirmation | Risk |
|---|---|---|---|---|
| `check_stock_level` | — | — | false (read-only) | low |
| `flag_reorder_needed` | `autoDraftReorderFlags` (read by `scan_low_inventory`, not the plugin itself) | **true** — §3.4 detection loop: below-threshold stock drafts a real flag_reorder_needed action instead of only a scan_findings row | false (a flag, not a reorder — no inventory movement) | low |
| `log_stock_used_on_visit` | — | — | true (moves inventory) | medium |

## 5. scheduling (no policy fields read)
| Action | Confirmation | Risk |
|---|---|---|
| `assign_technician_to_visit` | true | medium |
| `check_technician_availability` | false (read-only) | low |
| `reschedule_visit` | true | medium |

## 6. quotation (pricing comes from `price_book_items` + the `pricing_catalog` pseudo-row, not `policy.policy` — see §Pricing below)
| Action | Confirmation | Risk |
|---|---|---|
| `size_equipment_for_household` | false (pure calculation, no external effect) | low |
| `generate_quote` | true (creates an authoritative priced quote) | medium |
| `send_proposal` | true (reaches the customer) | high |

## 7. accounting (no policy fields read)
| Action | Confirmation | Risk |
|---|---|---|
| `create_invoice` | true | high |
| `send_payment_reminder` | true | high |
| `record_payment` | true | high |
| `call_overdue_invoices` | true (hardcoded in code) | high |

## 8. marketing
| Action | PF | Chosen value | Confirmation | Risk |
|---|---|---|---|---|
| `summarize_ad_performance` | — | — | false (hardcoded in code) | low |
| `launch_ad_campaign` | `default_daily_budget_usd` | **30** | true | high |
| | `max_daily_budget_usd` | 50 | | |
| `create_review_request` | `review_link_url` | **owner-blocked for the primary tenant — see below** | true | high |
| | `channel` | `sms` | | |
| | `message_template` | *(plugin default)* | | |

## 9. customer-comm
| Action | PF | Chosen value | Confirmation | Risk |
|---|---|---|---|---|
| `answer_customer_question` | — | — | true (answer reaches a customer) | medium |
| `send_customer_message` | — | — | true (hardcoded in code) | medium |
| `send_follow_up` | `serviceDueScript` (read by `scan_service_due`, not the plugin itself) | **"Hi! Our records show your {{equipmentType}} may be due for service. Reply or call to book a visit — happy to answer any questions in the meantime."** — §3.4 detection loop: a due reminder drafts a real, gated send_follow_up instead of only a scan_findings row | true (hardcoded in code) | medium |

## 10. water-domain-knowledge (no policy fields read)
| Action | Confirmation | Risk |
|---|---|---|
| `answer_water_question` | false (static public-domain lookup, read-only) | low |

## 11. proposal-batch
| Action | PF | Chosen value | Confirmation | Risk |
|---|---|---|---|---|
| `send_proposal_to_recent_installs` | `window_days_default` | 30 | true (hardcoded in code) | high |
| | `max_batch` | 10 | | |

## 12. bulk-notify (no policy fields read — targeting is `households.marketingConsent`, enforced in code, not policy)
| Action | Confirmation | Risk |
|---|---|---|
| `bulk_notify_existing_customers` | true (hardcoded in code) | high |

## 13. technician-reports (no policy fields read)
| Action | Confirmation | Risk |
|---|---|---|
| `log_visit_report` | false (technician's own attestation of completed work — see rationale below) | low |
| `flag_visit_issue` | false (escalation must be frictionless, not itself gated) | low |

*Rationale for the two `false` values above, as the one deliberate departure from the
strict "default true" rule*: Phase 7's cockpit spec puts these two actions directly in
the technician role's normal daily workflow ("today's visits, visit-report form... stock-used
entry") with no mention of an approval step — gating a technician's own report of work
they just physically performed would make the cockpit unusable as designed. Neither
touches a customer, money, or (per `log_stock_used_on_visit` being the *separate*,
still-gated action for that) inventory.

## 14. service-reminders
| Action | PF | Chosen value | Confirmation | Risk |
|---|---|---|---|---|
| `check_reminder_due` | `sediment_filter_months` | `"3-6"` | false (read-only) | low |
| | `carbon_filter_months` | `"6-12"` | | |
| | `ro_membrane_years` | `"2-3"` | | |

## 15. compliance-documentation
| Action | PF | Chosen value | Confirmation | Risk |
|---|---|---|---|---|
| `generate_compliance_summary` | `pfoa_mcl_ppt` | 4 | false (read-only summary) | low |
| | `pfos_mcl_ppt` | 4 | | |
| | `fluoride_mcl_mg_l` | 4.0 | | |
| | `fluoride_secondary_standard_mg_l` | 2.0 | | |
| | `hardness_classification_gpg` | `{soft:"<1", slightly_hard:"1-3.5", moderately_hard:"3.5-7", hard:"7-10.5", very_hard:">10.5"}` | | |
| | `source` | `"EPA National Primary/Secondary Drinking Water Regulations"` | | |
| | `paperwork_format` | **`"pdf"`** | | |

## 16. web-research (no policy fields read)
| Action | Confirmation | Risk |
|---|---|---|
| `search_web` | false (read-only) | low |
| `scan_competitors` | false (read-only) | low |
| `check_business_reviews` | false (read-only) | low |

## 17. ops-overview (no policy fields read; both hardcoded false in code)
| Action | Confirmation | Risk |
|---|---|---|
| `get_business_overview` | false | low |
| `answer_business_question` | false | low |

## 18. lead-to-water-test (no policy fields read)
| Action | Confirmation | Risk |
|---|---|---|
| `start_water_test_workflow` | true (books + calls the customer) | medium |

## 19. proposal-signature (no policy fields read)
| Action | Confirmation | Risk |
|---|---|---|
| `request_proposal_signature` | true (reaches the customer, starts a binding flow) | high |

## 20. proposal-to-installation (no policy fields read)
| Action | Confirmation | Risk |
|---|---|---|
| `start_installation_workflow` | true (commits inventory + money) | high |

## 21. invoice-to-cash (no policy fields read)
| Action | Confirmation | Risk |
|---|---|---|
| `start_invoice_to_cash_workflow` | true (touches money) | high |

**Total registered action types: 41** (`PluginRegistry.actionTypes().length`, verified live
by `scripts/seed-tenant-policies.ts --verify`).

---

## §Pricing — the 42nd tracked item, and it is NOT a `domain_policies` row

`GET /api/setup/status` tracks one more item beyond the 41 above: the pseudo action-type
`pricing_catalog` (`packages/domain-plugins/shared/pricing-catalog.ts`), deliberately never
registered with the Planner/Gate/Executor. It has two real parts:

1. **`price_book_items`** table — the actual 12-20 line-item price book. Seeded values
   (mid-market US water-treatment dealer, `scripts/seed-tenant-policies.ts` calls
   `upsertPriceBookItem` once per row, idempotent by `(tenantId, sku)`):

   | SKU | Label | Price (USD) | Unit |
   |---|---|---|---|
   | RO-STD | Standard 4-Stage Reverse Osmosis System | 899 | each |
   | RO-PRM | Premium 6-Stage Reverse Osmosis System (Remineralizing) | 1349 | each |
   | SOFT-32K | 32,000 Grain Water Softener | 1199 | each |
   | SOFT-48K | 48,000 Grain Water Softener | 1549 | each |
   | SOFT-64K | 64,000 Grain Whole-House Water Softener | 1899 | each |
   | FILT-SED | Sediment Pre-Filter Cartridge | 18 | each |
   | FILT-CARB | Carbon Block Filter Cartridge | 24 | each |
   | FILT-WH-SED | Whole-House Sediment Filter Housing | 149 | each |
   | FILT-WH-CARB | Whole-House Carbon Filtration System | 649 | each |
   | MEMB-RO | RO Membrane Replacement (50 GPD) | 65 | each |
   | UV-STER | UV Water Sterilization System | 749 | each |
   | NEUT-CAL | Calcite Acid Neutralizer System (pH Correction) | 1099 | each |
   | IRON-FILT | Iron & Sulfur Removal Filter System | 1299 | each |
   | TANK-PRESS | Well Pressure Tank (20-Gallon) | 399 | each |
   | SALT-BAG | Water Softener Salt (40lb bag) | 9 | each |

2. **The `pricing_catalog` `domain_policies` row** (scalars only, per `pricing-catalog.schema.ts`):
   `laborRatePerHourUsd = 95` (DECISIONS), `taxRatePct = 7` (generic mid-market US default —
   genuinely tenant/state-specific; the dealer should localize this once real, flagged in
   `owner-actions.md`, not a blocking placeholder since 7% is a real usable number, not the
   sentinel).

---

## §Owner-blocked field: `create_review_request.review_link_url`

Every other field above has a defensible generic "mid-market US water dealer" default.
This one doesn't — a Google/Yelp/Facebook review link is inherently unique per real
business, and Finnor doesn't operate one for the primary tenant. Fabricating a URL here
would violate §0.3.10 ("nothing fake reports itself real") even though it would make the
readiness scanner pass. **Dealer Zero** (a fully synthetic, permanently-labeled tenant per
§DECISIONS) gets an honest synthetic value consistent with the rest of its fake identity:
`https://g.page/r/dealer-zero-finnor-water-co/review`. **The primary tenant does not** —
logged as a real owner action (`finnor-os/docs/owner-actions.md`): paste your real Google
Business review link, then run
`npm run seed:tenant-policies -- --tenant=<id> --reviewLinkUrl=<url>` (or set
`PRIMARY_TENANT_REVIEW_LINK_URL` before running the script with no flag). Until supplied,
`create_review_request` will honestly show `unconfigured` for the primary tenant only —
the one action type §3.5's "42/42 clean" target cannot honestly claim for that tenant
without it.

## Note on risk tier and the runtime

This matrix's risk tiers are a **documentation-level** classification for policy review.
The runtime's `DecisionReceipt.riskTier` field (`packages/workflow-runtime/src/steps.ts`,
`run-controls.ts`) is currently hardcoded `"medium"` for every receipt regardless of
action type — a real, pre-existing simplification this task did not touch (Task 3.1 asks
for a documented matrix, not for wiring risk tiers into the runtime; that's a scoped,
separate follow-up, not something to silently claim as done here).
