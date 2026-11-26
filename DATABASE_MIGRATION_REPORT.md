# DATABASE_MIGRATION_REPORT.md — Milestone 1 Schema Migration & Rollback Plan

**Milestone:** Milestone 1 — White-Label Tenant Isolation and Domain Routing  
**Database Engine:** SQLite (`node:sqlite` WAL mode, `server/data/quickmenu.db`)  
**Safety Policy:** Migration & Rollback plan documented prior to schema mutation; pre-migration binary backup captured before dropping legacy `restaurant_settings`.

---

## 1. Pre-Implementation Safety Audit (Step 0)

### 1.1 Existing Code References to `restaurant_settings`
Static scan across `client/src`, `server/src`, and `server/tests` confirmed `restaurant_settings` is referenced **exclusively inside `server/src/db.js`**:
- Line `121`: `CREATE TABLE IF NOT EXISTS restaurant_settings (...)`
- Line `308`: `ensureColumns("restaurant_settings", [...])`
- Line `535–538`: `SELECT * FROM restaurant_settings WHERE id = 1` legacy fallback copy when `restaurants` is empty.
- Zero references exist in `server/src/index.js`, `server/src/services.js`, `server/src/seed.js`, `server/src/ws.js`, or any file in `client/src/`.

### 1.2 Live Database Snapshot Observation (`server/data/quickmenu.db`)
Observed prior to Milestone 1 migration:
- **`restaurant_settings` (1 row, `id = 1`)**:
  - `name = 'DreamLand'`, `qr_mode = 'per_table'`, `table_config = '{"total":7,"skip":[],"disabled":[]}'`, `menu_views = 10`, `upi_id = 'mishrasatyam01473@oksbi'`, `gst_rate = 5`, `service_charge_pct = 0`, `require_table_pin = 0`, `updated_at = '2026-11-25T10:17:32.384Z'`.
- **`restaurants` (2 rows)**:
  - `rest_default`: `slug = 'tandoor-house'`, `name = 'DreamLand'`, `custom_domain = ''`, `white_label = 1`, `brand_bg = '#FAF8F5'`, `brand_accent = '#2A4EDF'`, `plan = 'Pro'`, `plan_status = 'active'`, `is_active = 1`.
  - `rest_saffron`: `slug = 'saffron-courtyard'`, `name = 'Saffron Courtyard'`, `custom_domain = ''`, `white_label = 0`, `brand_bg = '#FAF8F5'`, `brand_accent = '#49332A'`, `plan = 'Enterprise'`, `plan_status = 'active'`, `is_active = 1`.
- **`users` (4 rows)**: `owner@qserve.local` (`rest_default`), `saffron@qserve.local` (`rest_saffron`), `super@qserve.local` (`super_admin`), `admincas` (`super_admin`).

---

## 2. Field Mapping: Legacy `restaurant_settings` -> `restaurants`

Every column from `restaurant_settings (id = 1)` maps cleanly 1-to-1 into `restaurants (id = 'rest_default')`:

| Legacy Column (`restaurant_settings`) | Target Column (`restaurants`) | Merge Rule |
|---|---|---|
| `name`, `description`, `logo_url`, `cover_url` | `name`, `description`, `logo_url`, `cover_url` | Copy if target missing `rest_default`, or merge non-empty values when legacy row is newer (`updated_at`) |
| `orders_enabled`, `waiter_call_enabled` | `orders_enabled`, `waiter_call_enabled` | Preserved directly |
| `qr_mode`, `table_config`, `menu_views` | `qr_mode`, `table_config`, `menu_views` | Preserved (`MAX(legacy.menu_views, current.menu_views)` if already copied) |
| `upi_id`, `gst_rate`, `service_charge_pct`, `require_table_pin` | `upi_id`, `gst_rate`, `service_charge_pct`, `require_table_pin` | Copy non-empty `upi_id` if target empty; preserve newer tax/PIN flags |
| `loyalty_config`, `spin_prizes`, `social_links` | `loyalty_config`, `spin_prizes`, `social_links` | Preserved as validated JSON strings |
| `wifi_ssid`, `wifi_password`, `updated_at` | `wifi_ssid`, `wifi_password`, `updated_at` | Copy if newer or target blank |

---

## 3. Forward Migration Plan (`m001_tenant_isolation_and_drop_restaurant_settings`)

1. **Migration Registry:** Create `schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}')`.
2. **File Backup (Persistent DBs):** Before schema modification on a non-ephemeral DB that still contains `restaurant_settings`, write a verified copy to `quickmenu.db.pre-m1-<timestamp>.bak` alongside `quickmenu.db` (if WAL exists, checkpoint `PRAGMA wal_checkpoint(TRUNCATE)` first).
3. **Add Tenant Theme & Domain Security Columns to `restaurants`:**
   - `brand_secondary TEXT NOT NULL DEFAULT '#766158'` (secondary/companion color token, synced with `secondary_color` in API/UI while keeping `brand_accent`/`primary_color` and `brand_bg` intact).
   - `custom_domain_verified INTEGER NOT NULL DEFAULT 0` (false until verified by Super Admin / DNS verification; unverified domains cannot serve customer ordering pages).
4. **Add Default Secondary Theme Token to `platform_settings`:**
   - `default_brand_secondary TEXT NOT NULL DEFAULT '#766158'`.
5. **Backfill & Verify `restaurant_settings` -> `restaurants`:**
   - Within `BEGIN IMMEDIATE`:
     - If `restaurant_settings` exists and row `id = 1` exists:
       - Insert `rest_default` if absent; otherwise backfill any missing/newer fields (`menu_views`, `upi_id`, `table_config`, `name`, `description`, `wifi_ssid`, etc.).
     - Assert `rest_default` (or upgraded row) exists and matches expected `name`, `table_config`, and non-empty `upi_id` from legacy row before proceeding.
6. **Enforce Custom-Domain Uniqueness at DB Level:**
   - Normalize `custom_domain = LOWER(TRIM(custom_domain))` across existing `restaurants` rows; if any pre-existing collision existed in legacy data, suffix duplicate non-empty domains safely while logging warning.
   - Create unique partial index:
     `CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_custom_domain ON restaurants(LOWER(custom_domain)) WHERE custom_domain != ''`.
7. **Retire `restaurant_settings`:**
   - Execute `DROP TABLE IF EXISTS restaurant_settings`.
   - Record migration version `1` (`m001_tenant_isolation_and_drop_restaurant_settings`) in `schema_migrations`.

---

## 4. Rollback Plan

If rollback is required after Migration 1:
1. **Binary Snapshot Restore (Full Production Restore):**
   - Stop `server/src/index.js`.
   - Restore `server/data/quickmenu.db` from `server/data/quickmenu.db.pre-m1-<timestamp>.bak` (removing stale `-wal` / `-shm` files).
2. **Deterministic Programmatic Rollback (`rollbackMigrationM1(db)` in `server/src/migrations.js`):**
   - Executed inside `BEGIN IMMEDIATE`:
     - Re-create `restaurant_settings` table with its original 21 columns.
     - Repopulate row `id = 1` directly from `restaurants WHERE id = 'rest_default'`.
     - Execute `DROP INDEX IF EXISTS idx_restaurants_custom_domain`.
     - Execute `DELETE FROM schema_migrations WHERE version = 1`.
   - Note: `restaurants.brand_secondary` and `restaurants.custom_domain_verified` remain harmlessly nullable/defaulted in SQLite or ignored by older code, maintaining zero data loss on downgrade.

---

## 5. Execution & Verification Log (Step 7)

### Automated Migration & Rollback Suite (`npm test` -> Test Block 11)
- Executed via `node server/tests/e2e.test.mjs` (`ALL_BROTOCOL_SERVEOS_TESTS_PASSED`).
- Seeded a synthetic legacy SQLite database containing `restaurant_settings` (`id=1`) with custom `DreamLand` / `upi_id` / `table_config` / `menu_views` alongside `restaurants` (`rest_default`).
- Verified forward migration (`runMigrations`):
  - Populated `schema_migrations` version `1` (`m001_tenant_isolation_and_drop_restaurant_settings`).
  - Preserved all legacy fields into `restaurants` (`rest_default`) losslessly.
  - Enforced DB-level uniqueness on normalized non-empty `custom_domain` via `idx_restaurants_custom_domain` (verified SQLite constraint rejection on duplicate domain insert).
  - Dropped legacy `restaurant_settings` table.
- Verified rollback (`rollbackMigrationM1`):
  - Re-created `restaurant_settings` from `restaurants` (`rest_default`) with full data restored cleanly.
  - Removed version `1` from `schema_migrations` as verified by `verifyMigrationM1`.
- Verified idempotent re-run of `runMigrations`: cleanly re-applied version `1` without data loss.

### Live Production Database Migration (`server/data/quickmenu.db`)
Executed automatically on live server startup (`npm start` listening on `http://127.0.0.1:4000`) and verified read-only via `node:sqlite` + `verifyMigrationM1`:

| Check | Verified Live Result |
|---|---|
| Pre-migration backup snapshot | `server/data/quickmenu.db.pre-m1-2026-11-25T19-34-54-269Z.bak` (`233,472` bytes) |
| `schema_migrations` row | `version = 1`, `name = m001_tenant_isolation_and_drop_restaurant_settings`, `applied_at = 2026-11-25T19:34:54.275Z`, `migratedLegacyRow = true` |
| `hasLegacyTable` (`restaurant_settings`) | `false` (dropped cleanly; 18 tables remain) |
| `hasUniqueDomainIndex` | `true` (`CREATE UNIQUE INDEX idx_restaurants_custom_domain ON restaurants(LOWER(custom_domain)) WHERE custom_domain != ''`) |
| `restaurants` schema | `39` columns including `brand_bg`, `brand_accent`, `brand_secondary`, `custom_domain`, `custom_domain_verified` |
| `rest_default` merged values | `name = "DreamLand"`, `slug = "tandoor-house"`, `upi_id = "mishrasatyam01473@oksbi"`, `table_config = {"total":7,"skip":[],"disabled":[]}`, `menu_views = 17` (incremented during live probes), `brand_bg = "#FAF8F5"`, `brand_accent = "#2A4EDF"`, `brand_secondary = "#766158"` |
| `rest_saffron` preserved values | `name = "Saffron Courtyard"`, `slug = "saffron-courtyard"`, `upi_id = "saffron@okaxis"`, `table_config = {"total":8,"skip":[],"disabled":[]}`, `brand_accent = "#49332A"`, `brand_secondary = "#766158"` |
