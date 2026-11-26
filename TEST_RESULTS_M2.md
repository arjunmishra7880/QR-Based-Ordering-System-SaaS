# TEST_RESULTS_M2.md — Milestone 2 Verification Results

## 1. Automated E2E & Unit Suite (`npm test`)
- **Command**: `npm test` (`node server/tests/e2e.test.mjs`)
- **Exit Code**: `0`
- **Printed Output**: `ALL_BROTOCOL_SERVEOS_TESTS_PASSED`
- **Total Assertions**: `194` assertions across `12` test blocks (`0` failed, `0` skipped).

### Milestone 2 Automated Test Coverage (Block 12)
- **Shared `billMath.js` consistency & rounding (`12a`)**: Verified `calculateItemPricing` (base price + addons + quantity), `calculateDeliveryFee` (below vs. at free-delivery threshold & non-delivery `0`), `calculateOrderTotals`, and `calculateBill` (pct discount + `min_bill` + service charge + GST + rupee rounding).
- **Order-Item Normalization & Historical Snapshot Preservation (`12b`)**:
  - Created dish `"Heritage Truffle Kulcha"` (`190`) + `"Butter Glaze"` (`25`), placed dine-in order (`total_amount = 430`, `service_unit_id` populated).
  - Renamed & repriced dish (`999`), then deleted dish (`DELETE /api/admin/items/:id`).
  - Verified historical order kept exact original `total_amount = 430`, `name = "Heritage Truffle Kulcha"`, `price = 215`, `base_unit_price = 190`, `addons_unit_total = 25`, and `menu_item_id = null`.
- **Platform Audit Logs (`12c`)**:
  - Verified Venue Admin is blocked (`403`) on `GET /api/super/audit-logs`.
  - Verified Super Admin audit trail captures `restaurant.created`, `restaurant.updated`, `domain.verification_changed`, and `platform.config_updated` with zero password/secret leaks.
- **M2 Migration, FK Integrity & Rollback (`12d`)**:
  - Migrated synthetic M1 schema with orphaned `menu_items.category_id` -> verified `version = 2`, `fkViolationsCount = 0`, `ordersFkCount >= 3`, orphan nullified cleanly, and DB-level FK constraint rejects invalid `order_id` insert into `order_items`.
  - Verified `rollbackMigrationM2` drops M2 tables cleanly while preserving `orders.items` JSON, and verified idempotent re-run of `runMigrationM2`.

## 2. Frontend Production Build (`npm run build`)
- **Command**: `npm run build` (`tsc -b && vite build`)
- **Exit Code**: `0`
- **Result**: `✓ 1736 modules transformed.` / `✓ built in 6.40s`

## 3. Live Server & Migrated Production DB (`http://127.0.0.1:4000/`)
- **Live Backup**: `server/data/quickmenu.db.pre-m2-2026-11-26T03-53-15-766Z.bak` (`233,472` bytes)
- **`verifyMigrationM2` on `server/data/quickmenu.db`**:
  - `version = 2`, `hasOrderItemsTable = true`, `hasServiceUnitsTable = true`, `hasPlatformAuditLogsTable = true`
  - `orderItemsCount = 4`, `serviceUnitsCount = 19`, `ordersFkCount = 3`, `fkViolationsCount = 0` (`21` tables total, `18` child tables enforcing FKs)
- **Live HTTP Probes**:
  - `GET /api/health` -> `{"ok":true}`
  - `GET /api/public/context` -> `mode: "platform"`

## 4. Failed / Skipped Checks
- **Tests Failed**: `0`
- **Tests Skipped**: `0`
