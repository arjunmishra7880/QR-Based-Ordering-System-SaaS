# Milestone 2 Implementation Summary — Normalized Restaurant Database & Unified Order Calculation

## 1. Objective & Scope
Milestone 2 normalizes core restaurant ordering entities (`service_units`, `order_items`), enforces SQLite foreign key constraints across all child tables, introduces `platform_audit_logs` for Super Admin accountability, and consolidates all server and client bill/order/fee math into one shared pure-ESM `billMath.js` module — while keeping the application restaurant-only and preserving all Milestone 1 isolation and operational workflows.

## 2. Summary of Implementation

### Shared Authoritative Bill Calculation (`shared/billMath.js`)
- Created `shared/billMath.js` (+ `shared/billMath.d.ts` + `shared/package.json` `"type": "module"`):
  - `calculateItemPricing({ basePrice, addons, quantity, discountAmount, taxRate })`
  - `calculateDeliveryFee(subtotalAmount, { orderType, deliveryFee, freeDeliveryMin })`
  - `calculateDiscountPaise(subtotalPaise, discount)`
  - `calculateOrderTotals(items, { orderType, deliveryFee, freeDeliveryMin, explicitDeliveryFee, discount, gstRate, servicePct, includeTaxes })`
  - `calculateBill(orders, { discount, gstRate, servicePct, payments })`
- `server/src/billMath.js` re-exports from `../../shared/billMath.js`.
- `server/src/security.js` (`resolveAuthoritativeLines`) and `server/src/index.js` (`POST /api/public/orders`, `POST /api/admin/orders`, `PATCH /api/admin/orders/:id`) use `calculateItemPricing` and `calculateOrderTotals` as the authoritative backend calculation source.
- `client/src/lib/billMath.ts`, `client/src/pages/MenuPage.tsx`, and `client/src/pages/WaiterPage.tsx` import `calculateOrderTotals` and `calculateBill` from `shared/billMath.js` for live UI previews.

### Normalized Relational Database & Foreign Keys (`server/src/migrations.js` & `server/src/db.js`)
- **`service_units`**: Normalized restaurant operational destinations (`table`, `takeaway`, `delivery`) scoped to `restaurants(id)` (`UNIQUE(restaurant_id, code)`), automatically synced via `syncServiceUnitsForRestaurant` on setup, settings updates, Super Admin updates, and order creation (`resolveServiceUnitId`).
- **`order_items`**: Stores per-item immutable snapshots (`item_name_snapshot`, `base_unit_price`, `addons_unit_total`, `unit_price_snapshot`, `quantity`, `selected_variant`, `modifiers_json`, `discount_amount`, `tax_rate`, `tax_amount`, `line_total`, `station`, `note`, `image_url`) with `menu_item_id REFERENCES menu_items(id) ON DELETE SET NULL`. Historical orders mapped by `mapOrder()` reconstruct `items` from `order_items` so menu renames, repricing, or deletions never alter historical orders.
- **Foreign Keys & Indexes**: Rebuilt all child tables inside Migration 2 with `REFERENCES` foreign key constraints and composite indexes, verifying `PRAGMA foreign_key_check` = `0` violations.

### Platform Audit Logs (`platform_audit_logs`)
- Added `platform_audit_logs` table, `logPlatformAudit(...)`, `listPlatformAuditLogs(limit)` in `server/src/db.js`, and Super Admin endpoint `GET /api/super/audit-logs`.
- Records actor (`actor_user_id`, `actor_name`, `actor_role`), `action`, target (`target_type`, `target_id`, `target_restaurant_id`), timestamp (`created_at`), and redacted safe `metadata_json` across:
  - `restaurant.created`
  - `restaurant.updated`
  - `restaurant.suspended` / `restaurant.reactivated`
  - `domain.updated`
  - `domain.verification_changed`
  - `subscription.updated`
  - `platform.config_updated`
  - `admin.created` / `admin.updated`

## 3. Preserved Compatibility & Next Milestone Gate
- Milestone 1 custom-domain routing, tenant isolation, legacy QR routes (`/scan?table=X`, `/r/:slug/scan`), dine-in/takeaway/delivery/reservation flows, KDS, Waiter Panel, and Super Admin console remain fully operational.
- **Status**: Milestone 2 is complete and verified; waiting for explicit user approval before Milestone 3.
