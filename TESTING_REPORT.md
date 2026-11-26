# TESTING_REPORT.md — Verification & QA Report

**Product:** BROTOCOL ServeOS  
**Test Environment:** Local Windows Node.js `v24.18.1`, Express + `node:sqlite`, Vite `6.4.6` production bundle (`client/dist`), Headless Google Chrome (Playwright runner).  
**External Network Dependencies Verified:** None (`Unique origins: ["http://127.0.0.1:4098"]`).

---

## 1. TypeScript & Production Build Check

- **Command:** `npm run build` (`npm --prefix client run build` -> `tsc -b && vite build`)
- **Result:** Passed (Exit code `0`, `✓ 1736 modules transformed`, `✓ built in 6.90s`).
- **Bundle Verification:**
  - Confirmed lazy route splitting across `Landing`/`Menu` entry (`index-CE2C2pgU.js` `423.22 kB` / `126.01 kB` gzip), `DashboardPage-LZJ5CPbH.js` (`253.91 kB`), `SuperAdminPage-ChS3oxvH.js` (`40.65 kB`), `WaiterPage-C1JX5sF8.js` (`13.06 kB`), `KitchenPage-BTOVHpRi.js` (`12.13 kB`), and `ReservePage-DTsTtrBY.js` (`10.27 kB`).
  - Confirmed zero plaintext admin/owner passwords or demo PIN secrets are bundled in any emitted `client/dist/assets/*.js` chunk.

---

## 2. Automated Backend API, Security & WebSocket E2E Suite

- **Command:** `npm test` (`node server/tests/e2e.test.mjs` against an isolated ephemeral SQLite test DB on port `4097`)
- **Result:** Passed (Exit code `0`, output: `ALL_BROTOCOL_SERVEOS_TESTS_PASSED`).
- **Verified Flows & Assertions:**
  1. **Public Platform & Agency Metadata (`GET /api/public/platform`)**: Confirmed `platform_name === "BROTOCOL ServeOS"`.
  2. **Authoritative Dine-In Ordering & Idempotency (`POST /api/public/orders`)**: Verified server ignores tampered client item price (`price: 1`), calculates authoritative total from SQLite menu pricing, records `order_type: "dine_in"` and `table_number: "4"`, and returns `{ duplicate: true }` with `200` on matching `clientRequestId`.
  3. **WebSocket Role Auth Hardening (`/ws`)**:
     - Unauthenticated `role=staff` rejected with WebSocket close code `4401`.
     - Unauthenticated `role=super` rejected with WebSocket close code `4403`.
     - Authenticated `ADMINCAS` (`ADMINCAS@BROTOCOL2026`) connects cleanly to `role=super`.
     - Venue owner (`owner@qserve.local`) rejected from `role=super` WebSocket and blocked (`403`) on `/api/super/overview`.
  4. **Server-Side Table PIN Enforcement (`require_table_pin = true`)**:
     - Direct order submission on Table `5` without PIN token rejected with HTTP `403` (`code: "pin_required"`).
     - Joining with valid floor PIN (`/api/public/seating/join`) issues signed `pinToken` and authorizes Table `5` ordering (`201`).
  5. **Takeaway Workflow**: Created Takeaway order -> verified `order_type: "takeaway"` and `PK-*` pickup token -> progressed status to `ready` (`Ready for Pickup`).
  6. **Delivery Workflow**: Configured `delivery_fee: 45`, `free_delivery_min: 500` -> created delivery order (`total_amount = subtotal + 45`) -> progressed order to `ready` and verified `delivery_status === "out_for_delivery"`.
  7. **Table Booking / Reservations**: Rejected out-of-hours booking (`02:30` -> `400`), created in-hours booking (`BK-*` -> `201`), approved with table assignment (`200`), and verified status via public lookup (`GET /api/public/reservations?code=...`).
  8. **Waiter Order-Taking (`POST /api/admin/orders`)**: Placed Table `3` order attributed to waiter staff member (`created_by_staff_id` and `created_by_staff_name`).
  9. **White-Label Provisioning, Custom Domain Routing & Tenant Isolation**: Created `Mirchi Bistro` (`custom_domain: "menu.mirchi.local"`, `brand_accent: "#1B4332"`, `plan_status: "trial"`), verified `Host: menu.mirchi.local` resolves `Mirchi Bistro` directly on `/api/public/menu`, and confirmed Mirchi admin receives `0` Tandoor House orders and `404` when attempting cross-tenant mutation.
  10. **Agency Branding & Upload Validation**: Updated agency name via `PATCH /api/super/platform`, verified spoofed plaintext `spoof.jpg` rejected (`400`) by magic-byte upload check, and scanned all built frontend JS chunks for zero credential leaks.

---

## 3. End-to-End Headless Chromium UI Verification

- **Target:** Clean isolated production build & SQLite DB served on `http://127.0.0.1:4098`
- **Result:** **65 / 65 steps completed** (`completeness.status: "complete"`, `Non-completed: []`, total duration `13,955 ms`).
- **Network & Console Checks:**
  - **Unique origins contacted:** `["http://127.0.0.1:4098"]` (100% self-contained, zero third-party CDNs/requests).
  - **Uncaught Page Errors:** `0`
  - **HTTP >= 400 Responses:** Only the two expected unauthenticated `/api/auth/me` session probes (`401`) on visiting `/auth` prior to login (steps 25 and 55).
- **Bugs Caught & Fixed During Chromium Verification:**
  - **Fixed (`client/src/lib/api.ts`)**: `apiJson()` originally spread `...init` after `headers`, erasing `Content-Type: application/json` whenever `pinHeaders` was `undefined` or merged, causing UI order submissions to return `400 Session ID is required.` Moving `...init` before `headers` resolved guest Dine-In, Takeaway, Delivery, and PIN-protected submissions across all views.
- **Verified UI Flows & Visual Inspection Highlights:**
  - **Public Showcase (`/`)**: Verified `BROTOCOL ServeOS` hero, self-hosted fonts, and quick links (`Customer Menu`, `Reserve Table`, `Restaurant Admin`, `Waiter Panel`, `Kitchen (KDS)`).
  - **Table Booking (`/reserve`)**: Submitted reservation for `Ananya Kapoor` (4 guests, `19:30`), verified `BK-647379` receipt card, status lookup card, and live sync into **Dashboard -> Bookings** (`Table Bookings` tab showing `BK-647379`, Approve / Seat Guest / Reject / Modify controls).
  - **Dine-In & Service Call (`/scan?table=4`)**: Added `Samosa (2 pcs)`, submitted order (`Ticket #1 · Table 4`), confirmed live kitchen tracker modal, and triggered `Water` staff call.
  - **Takeaway Ordering (`/menu?mode=takeaway`)**: Added `Samosa (2 pcs)` with contact details (`Rohan Verma`, `9811002233`), placed takeaway order (`Ticket #2 · Pickup Token PK-102`), confirmed Takeaway tracker (`Ready for Pickup` stage) and footer attribution (`Tandoor House · Powered by BROTOCOL ServeOS`).
  - **Owner Dashboard (`/dashboard`)**: Verified login (`owner@qserve.local`), WebSocket `Live synced` badge, `Bookings`, `QR codes` (12 tables + preview), `Orders` (`#2 Takeaway · PK-102` + `#1 Table 4`), `Floor`, and `Settings -> Bills & extras`.
  - **Waiter Panel (`/waiter`)**: Verified waiter ticket submission (`Order #3 fired to Kitchen · Table 1 · Waiter: Rahul Sharma`).
  - **Kitchen Display (`/kitchen`)**: Verified `#1 Table 4`, `#2 Takeaway · PK-102`, and `#3 Waiter: Rahul Sharma · Table 1` live tickets and `Accept Order` -> `Start Preparing` transition.
  - **Multi-Tenant White-Label Customer Menu (`/r/saffron-courtyard/scan?table=1`)**: Verified isolated branding (`Saffron Courtyard`), menu categories, and Dine-In/Takeaway tray.
  - **Super Admin Console (`/super-admin`)**: Signed in with `ADMINCAS`, inspected `Platform Control Tower` live KPIs (`2 / 2 Active Venues`, `₹180`, `3 Orders`, `2 Active Admins`), opened `Agency & Reseller Branding` modal, and verified `Active Admins` tab displays count-only card (`2 Active Admins Across 2 active venue(s)`).
