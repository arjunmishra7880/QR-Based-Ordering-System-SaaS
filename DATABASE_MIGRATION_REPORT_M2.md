# DATABASE_MIGRATION_REPORT_M2.md — Milestone 2 Schema Normalization, Foreign Keys & Audit Logs

**Milestone:** Milestone 2 — Normalized Restaurant Database and Unified Order Calculation  
**Migration ID:** `version = 2` (`m002_normalized_order_items_service_units_fks_and_audit_logs`)  
**Database Engine:** SQLite (`node:sqlite` WAL mode with `PRAGMA foreign_keys = ON`)  

---

## 1. Pre-Implementation Inspection & Orphan Audit

Inspected live database (`server/data/quickmenu.db`) before modifying any schema:

| Table | Row Count | Existing Foreign Keys | Orphaned Records Found |
|---|---:|---|---:|
| `restaurants` | 2 | None (root tenant table) | 0 |
| `platform_settings` | 1 | None | 0 |
| `users` | 4 | None -> needs `restaurant_id -> restaurants(id)` | 0 |
| `sessions` | 1 | `user_id -> users(id)` -> needs `active_restaurant_id -> restaurants(id)` | 0 |
| `categories` | 7 | None -> needs `restaurant_id -> restaurants(id)` | 0 |
| `menu_items` | 13 | `category_id -> categories(id)` -> needs `restaurant_id -> restaurants(id)` | 0 |
| `orders` | 3 | None -> needs `restaurant_id -> restaurants(id)`, `seating_id -> table_seatings(id)`, `service_unit_id -> service_units(id)` | 0 |
| `payments` | 3 | None -> needs `restaurant_id -> restaurants(id)`, `seating_id -> table_seatings(id)` | 0 |
| `reservations` | 0 | None -> needs `restaurant_id -> restaurants(id)` | 0 |
| `service_calls` | 1 | None -> needs `restaurant_id -> restaurants(id)` | 0 |
| `staff` | 5 | None -> needs `restaurant_id -> restaurants(id)` | 0 |
| `coupons` | 3 | None -> needs `restaurant_id -> restaurants(id)` | 0 |
| `feedback` | 0 | None -> needs `restaurant_id -> restaurants(id)`, `order_id -> orders(id)`, `seating_id -> table_seatings(id)` | 0 |
| `loyalty_accounts` | 0 | None -> needs `restaurant_id -> restaurants(id)` | 0 |
| `table_seatings` | 3 | None -> needs `restaurant_id -> restaurants(id)` | 0 |
| `table_states` | 2 | None -> needs `restaurant_id -> restaurants(id)` | 0 |
| `activity_log` | 21 | None -> needs `restaurant_id -> restaurants(id)` | 0 |
| `schema_migrations` | 1 | Migration registry | 0 |

Result: **Zero orphaned records** exist in the live database. Defensive orphan cleanup/nullification rules are included in Migration 2 so older/legacy test databases also migrate cleanly without FK violations.

---

## 2. Backup Plan

Before modifying any table on persistent databases (`dbFilePath && dbFilePath !== ":memory:" && !base.startsWith("test-")`):
1. Run `PRAGMA wal_checkpoint(TRUNCATE)`.
2. Write a binary snapshot to `${dbFilePath}.pre-m2-${timestamp}.bak`.

---

## 3. Forward Migration Plan (`m002_normalized_order_items_service_units_fks_and_audit_logs`)

Executed inside `BEGIN IMMEDIATE` (with `PRAGMA foreign_keys = OFF` during table rebuilds, then `PRAGMA foreign_keys = ON` + `PRAGMA foreign_key_check`):

1. **Create `service_units`:**
   - Normalized restaurant service-area destinations (`table`, `takeaway`, `delivery`) linked via `restaurant_id REFERENCES restaurants(id) ON DELETE CASCADE` and `UNIQUE(restaurant_id, code)`.
   - Seed `service_units` for every existing restaurant from `table_config`, `table_states`, plus operational `TAKEAWAY` and `DELIVERY` units.
2. **Create `order_items`:**
   - Relational line-item snapshots (`id`, `restaurant_id -> restaurants(id) ON DELETE CASCADE`, `order_id -> orders(id) ON DELETE CASCADE`, `menu_item_id -> menu_items(id) ON DELETE SET NULL`, `item_name_snapshot`, `base_unit_price`, `addons_unit_total`, `unit_price_snapshot`, `quantity`, `selected_variant`, `modifiers_json`, `discount_amount`, `tax_rate`, `tax_amount`, `line_total`, `station`, `note`, `image_url`, `created_at`).
   - Backfill all existing `orders.items` JSON lines into `order_items` cleanly (nullifying `menu_item_id` only if the referenced menu item was previously deleted, while preserving `item_name_snapshot` and `unit_price_snapshot`).
3. **Create `platform_audit_logs`:**
   - Super Admin audit trail (`id`, `actor_user_id -> users(id) ON DELETE SET NULL`, `actor_name`, `actor_role`, `action`, `target_type`, `target_id`, `target_restaurant_id -> restaurants(id) ON DELETE SET NULL`, `metadata_json`, `created_at`).
4. **Enforce Foreign Keys & Rebuild Existing Child Tables (Preserving All Data):**
   - Clean up any dangling nullable references (`users.restaurant_id`, `sessions.active_restaurant_id`, `menu_items.category_id`, `orders.seating_id`, `feedback.seating_id`) and any unreferenced child rows if found in legacy data.
   - Add `orders.service_unit_id` linked to `service_units(id) ON DELETE SET NULL` and backfill `service_unit_id` from `(restaurant_id, table_number)`.
   - Rebuild child tables (`users`, `sessions`, `categories`, `menu_items`, `reservations`, `table_states`, `table_seatings`, `orders`, `service_calls`, `payments`, `coupons`, `loyalty_accounts`, `staff`, `activity_log`, `feedback`) with explicit SQLite `REFERENCES` foreign key constraints.
5. **Create Indexes & Verify Integrity:**
   - Rebuild/create composite tenant indexes and new M2 indexes (`idx_service_units_rest`, `idx_order_items_order`, `idx_order_items_rest_menu`, `idx_platform_audit_created`, `idx_platform_audit_target`, `idx_platform_audit_action`).
   - Assert `PRAGMA foreign_key_check` returns zero violations before `COMMIT`.
   - Record `version = 2` in `schema_migrations`.

---

## 4. Rollback Plan

If rollback is required after Migration 2:
1. **Binary Snapshot Restore:** Stop server and restore `${dbFilePath}.pre-m2-<timestamp>.bak`.
2. **Deterministic Programmatic Rollback (`rollbackMigrationM2(db)`):**
   - Executed inside `BEGIN IMMEDIATE` with `PRAGMA foreign_keys = OFF`:
     - Hydrate any missing `orders.items` JSON from `order_items` if needed so order items remain intact.
     - Drop `order_items`, `service_units`, `platform_audit_logs`.
     - Rebuild M1-compatible tables without `service_unit_id` or M2 FKs.
     - Remove `version = 2` from `schema_migrations`.
   - Re-enable `PRAGMA foreign_keys = ON`.

---

## 5. Execution & Verification Log

### Automated Migration & Rollback Suite (`npm test` -> Test Block 12d)
- Executed via `node server/tests/e2e.test.mjs` (`ALL_BROTOCOL_SERVEOS_TESTS_PASSED`).
- Seeded a full M1 SQLite schema containing an orphaned `menu_items.category_id` (`'orphan-cat'`) and legacy `orders.items` JSON.
- Verified `runMigrationM2`:
  - Nullified orphaned `menu_items.category_id` safely while preserving menu & order records.
  - Created `service_units`, `order_items`, and `platform_audit_logs`, backfilling `order_items` cleanly.
  - Rebuilt all child tables with foreign keys (`ordersFkCount >= 3`, `fkViolationsCount = 0`).
  - Verified DB-level FK enforcement rejects inserting an `order_items` row referencing a nonexistent `order_id`.
- Verified `rollbackMigrationM2`: dropped `order_items`, `service_units`, `platform_audit_logs` cleanly and preserved `orders.items` JSON.
- Verified idempotent re-execution of `runMigrationM2` (`version = 2`, `fkViolationsCount = 0`).

### Live Production Database Migration (`server/data/quickmenu.db`)
Executed automatically on live server startup (`npm start` listening on `http://127.0.0.1:4000`) and verified read-only via `node:sqlite` + `verifyMigrationM2`:

| Check | Verified Live Result |
|---|---|
| Pre-migration backup snapshot | `server/data/quickmenu.db.pre-m2-2026-11-26T03-53-15-766Z.bak` (`233,472` bytes) |
| `schema_migrations` row | `version = 2`, `name = m002_normalized_order_items_service_units_fks_and_audit_logs`, `applied_at = 2026-11-26T03:53:15.769Z` |
| Migration summary details | `seededServiceUnits = 19`, `migratedOrders = 3`, `migratedOrderItems = 4` |
| `tablesCount` & `fkViolationsCount` | `21` tables total, `18` child tables enforcing FKs, `fkViolationsCount = 0` |
| `liveOrderItems` verification | Historical `Paneer Tikka` (`390` base + `70` addons = `460`, `Full (8 pcs)`) and deleted historical `"panner"` (`menu_item_id = null`, `unit_price_snapshot = 348`) preserved accurately |
| `serviceUnitsSummary` | `rest_default`: `7` table + `1` takeaway + `1` delivery; `rest_saffron`: `8` table + `1` takeaway + `1` delivery (`19` total) |
