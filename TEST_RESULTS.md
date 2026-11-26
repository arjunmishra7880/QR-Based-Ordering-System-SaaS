# Test & Verification Results — Milestone 1

## 1. Automated E2E Test Suite (`npm test`)
- **Command**: `npm test` (`node server/tests/e2e.test.mjs`)
- **Exit Code**: `0`
- **Printed Result**: `ALL_BROTOCOL_SERVEOS_TESTS_PASSED`
- **Total Assertions**: `141` `assert` / `assert.*` checks across `11` test scenarios, isolated in a temporary SQLite database per run (`0` failures, `0` skipped).

### Covered Test Scenarios in `server/tests/e2e.test.mjs`
1. **Agency & Public Platform Check**: Verifies `GET /api/health` and default public agency/platform setup.
2. **Dine-In Customer Workflow + Authoritative Pricing + Duplicate Idempotency**: End-to-end cart submission, server-side pricing calculation, and duplicate submission protection.
3. **Super Admin Login (`ADMINCAS`) + WebSocket Auth Hardening**: Verifies `ADMINCAS` authentication, Super Admin dashboard access, and WS role checks.
4. **Venue Admin Login & Table PIN Enforcement**: Blocks owner access to `role=super` WS and `/api/super/*`; validates Table 5 PIN enforcement (`403` without PIN token, order succeeds with PIN token) plus Delivery & Opening Hours settings.
5. **Takeaway Ordering Workflow**: End-to-end customer takeaway order creation and validation.
6. **Delivery Ordering Workflow**: End-to-end delivery order workflow including delivery fee calculation.
7. **Table Booking / Reservations Workflow**: Reservation creation, persistence, and dashboard visibility.
8. **Waiter Order-Taking Workflow**: Waiter panel order creation flowing through to KDS/orders.
9. **Milestone 1 White-Label Client Creation, Custom Domain Routing, Verification, Branding & Isolation**:
   - Unknown hostname (`unknown.brotocol.test`) returns HTTP `404` across API (`/api/public/menu`, `/api/public/context`), customer HTML (`/`, `/scan?table=1`), and closes WS (`4404`).
   - Unverified custom domain (`menu.mirchi.local` before verification) returns HTTP `403` on API/HTML and closes WS (`4403`).
   - Duplicate custom domain assignment returns HTTP `409` for both Super Admin and Tenant Admin.
   - Super Admin verification activates `menu.mirchi.local` (`200`), serving `Mirchi Bistro` theme colors (`#1B4332`, `#95D5B2`) and `mode: "tenant"`.
   - `GET /api/public/venues` on verified custom domain leaks zero sibling outlets (`venues.length === 1`).
   - Cross-tenant `?restaurant=tandoor-house` query spoofing, `/r/tandoor-house/scan` slug spoofing, cross-tenant order cancel (`order1`), and cross-tenant admin login via `menu.mirchi.local` all return `403`.
   - Legacy QR URL compatibility confirmed for `/scan?table=4` and `/r/saffron-courtyard/scan`.
   - Cross-tenant admin isolation confirmed (`Mirchi Bistro` admin cannot inspect/mutate `Tandoor House` order).
   - Tenant Admin modification of `custom_domain` automatically resets `custom_domain_verified` to `false`.
10. **Super Admin `/api/super/overview` Cleanup & Agency Branding Update**: Verifies removal of PII `admins` list and secret/config fields, plus Agency Branding update persistence.
11. **Migration & Rollback Correctness Test (`restaurant_settings` -> `restaurants`)**:
    - Forward migration merges legacy `restaurant_settings` into `restaurants` and drops `restaurant_settings`.
    - DB-level unique constraint (`idx_restaurants_custom_domain`) rejects duplicate domain inserts.
    - `rollbackMigrationM1` restores `restaurant_settings` with full data cleanly.
    - Forward migration `runMigrations` re-runs idempotently cleanly.

## 2. Production Frontend Build (`npm run build`)
- **Command**: `npm run build` (`npm --prefix client run build` -> `tsc -b && vite build`)
- **Exit Code**: `0`
- **Result**: `✓ 1736 modules transformed.` / `✓ built in 6.97s` (TypeScript type-check + Vite bundle passed cleanly with zero errors).

## 3. Headless Browser Full UI E2E Verification (`http://127.0.0.1:4098`)
- Executed 65 automated Chromium Playwright steps against an isolated test DB covering Landing, Table Reservations (`/reserve`), Customer QR Dine-In (`Table 4`), Waiter Call, Takeaway ordering, Venue Owner Sign-In (`/auth` -> `/dashboard` Bookings, QR studio, Orders, Floor, Settings), Waiter Panel (`/waiter`), Kitchen Display (`/kitchen` KDS ticket acceptance), `Saffron Courtyard` isolated tenant menu (`/r/saffron-courtyard/scan`), and `ADMINCAS` Super Admin Console (`/super` Overview, Agency Branding modal with Bg/Primary/Secondary pickers, and Active Admins count view).
- **Telemetry**: `completeness.status = "complete"`, `total_steps = 65`, `non_completed = []`, `duration_ms = 19634`, `unique_origins = ["http://127.0.0.1:4098"]`, `page_errors = []`, unexpected non-401 console errors = `[]` (the only two 401 entries were expected unauthenticated `/api/auth/me` session probes upon navigating to `/auth` prior to login).
- **Visual inspection**: Verified rendered screenshots for Landing, Order Dialog, QR Code preview, Settings Tabs, Saffron Courtyard Menu, Super Admin Overview, Agency Branding modal, and Active Admins (`2`).

## 4. Live Server Verification (`http://127.0.0.1:4000`, Migrated `server/data/quickmenu.db`)
- Started `npm start` against the existing persistent database:
  - Automatic backup created at `server/data/quickmenu.db.pre-m1-2026-11-25T19-34-54-269Z.bak` (`233,472` bytes).
  - Live DB verified via `verifyMigrationM1`: `version = 1`, `hasLegacyTable = false`, `hasUniqueDomainIndex = true`, `DreamLand` / `Saffron Courtyard` data preserved (`upi_id = mishrasatyam01473@oksbi`, `table_config = {"total":7,"skip":[],"disabled":[]}`).
- Raw `node:http` Host-header probes against `http://127.0.0.1:4000`:
  - `/api/health` -> `200`
  - `/api/public/context` -> `200` (`mode: "platform"`)
  - `/scan?table=4` -> `200`
  - `/r/saffron-courtyard/scan` -> `200`
  - `/` (`Host: unknown.brotocol.test`) -> `404`
  - `/scan?table=4` (`Host: unknown.brotocol.test`) -> `404`
  - `/api/public/context` (`Host: unknown.brotocol.test`) -> `404`
  - `/api/public/menu` (`Host: unknown.brotocol.test`) -> `404`

## 5. Failed / Skipped Checks
- **Tests Failed**: `0`
- **Tests Skipped**: `0`
