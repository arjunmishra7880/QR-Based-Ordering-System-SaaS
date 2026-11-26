# PROJECT_AUDIT.md — Comprehensive Technical Audit

**Repository Path:** `c:\Arjun Projects\Quick Menu REA`  
**Current Codebase Identity:** `BROTOCOL ServeOS` (rooted in legacy `quickmenu-local` / `QServe` packages)  
**Target Product Direction:** Multi-Tenant White-Label **Hotel & Restaurant** QR Ordering SaaS Platform under **BROTOCOL**  
**Audit Mode:** Read-only code inspection (no application code modified during audit)

---

## 1. Complete Inventory of Existing Technology Stack

| Layer | Technology & Versions (Observed) | Primary Locations |
|---|---|---|
| **Frontend UI** | React `19.1.0`, TypeScript `5.8.3`, React Router DOM `7.6.0`, Vite `6.3.5`, Tailwind CSS `@tailwindcss/vite` `4.1.7`, Lucide React `0.511.0` | `client/package.json`, `client/src/` |
| **Offline Assets / QR** | `@fontsource/fraunces` `5.3.0`, `@fontsource/inter` `5.3.0`, `qrcode` `1.5.4`, `jszip` `3.10.1`, local JPG/SVG media | `client/src/main.tsx`, `client/public/food/`, `QrTab.tsx` |
| **Backend API** | Node.js ESM, Express `5.1.0`, Multer `2.0.0` (disk uploads to `server/uploads/`), native HTTP server on `127.0.0.1:4000` | `server/package.json`, `server/src/index.js` |
| **Real-Time Transport** | `ws` `8.18.1` attached to same HTTP server (`/ws`), 30s heartbeat ping/pong | `server/src/ws.js`, `client/src/lib/useWebSocket.ts` |
| **Database** | Built-in `node:sqlite` (`DatabaseSync`) in WAL mode (`server/data/quickmenu.db`, overridable via `QM_DB_PATH`) | `server/src/db.js`, `server/src/services.js` |
| **Authentication** | Cookie/Bearer opaque token sessions (`qm_session`, 7-day TTL in SQLite `sessions`), `scrypt` per-user salted hashes | `server/src/auth.js`, `server/src/security.js` |
| **Testing & Build** | `npm run build` (`tsc -b && vite build`), `npm test` (`server/tests/e2e.test.mjs`) | `package.json`, `server/tests/e2e.test.mjs` |

---

## 2. Existing Interfaces, Routes & API Surface

### Frontend SPA Routes (`client/src/App.tsx`)
- **Public / Marketing:** `/` (`LandingPage`)
- **Authentication:** `/auth` (`AuthPage` — shared login gateway routing `super_admin` to `/super-admin` and `admin` to `/dashboard`)
- **Layer 1 — Super Admin:** `/super-admin` (`SuperAdminPage` — lazy-loaded)
- **Layer 2 — Tenant Operations:**
  - `/dashboard` (`DashboardPage` — 10 tabs: `Home`, `Floor`, `Orders`, `Bookings`, `Service calls`, `Menu`, `QR codes`, `Staff`, `Reports`, `Settings`)
  - `/waiter` (`WaiterPage` — dedicated staff table/takeaway ordering interface)
  - `/kitchen` (`KitchenPage` — fullscreen Kitchen Display System)
- **Layer 3 — Customer QR Ordering Website:**
  - `/scan` & `/r/:slug/scan` (`ScanPage` — table directory, Table PIN unlock, takeaway/delivery/reserve entry)
  - `/menu` & `/r/:slug/menu` (`MenuPage` — Dine-In, Takeaway, Delivery cart, billing, feedback, call staff)
  - `/reserve` & `/r/:slug/reserve` (`ReservePage` — reservation requests & status lookup)

### Backend REST APIs (`server/src/index.js`) & WebSockets (`server/src/ws.js`)
- **Health & Public Tenant Directory (`3` routes):** `/api/health`, `/api/public/platform`, `/api/public/venues`.
- **Public Customer Ordering & Hospitality (`15` routes):** menu, table-status, seating join/get, orders list/create/cancel, coupon, spin-wheel, loyalty, payment, feedback, service-calls, reservations create/lookup.
- **Auth (`4` routes):** login (with IP sliding-window rate limiter), logout, `/api/auth/me`, password change (revokes other sessions).
- **Super Admin (`8` routes):** platform overview, agency settings get/patch, active tenant switch (`/api/super/select-restaurant`), tenant create/update, tenant admin create/update.
- **Tenant Admin & Kitchen (`34` routes):** overview stats, orders list/waiter-create/status/edit, reservations list/update, service-calls list/update, floor state/open/pin/clean/close/transfer/merge/counter-pay, payment settle, loyalty redeem, staff CRUD/PIN unlock, coupons CRUD, reports, menu categories/items CRUD, upload (2 MB + magic-byte validation), settings get/patch.
- **WebSockets (`/ws`):** Cookie/Bearer-verified `role=super` (`4403`), `role=staff` (`4401`), and `role=guest` (HMAC `pinToken` checked when `require_table_pin` is active).

---

## 3. Feature Implementation Status

### Fully Implemented (Current Restaurant Baseline)
1. **Multi-tenant Restaurant Data Isolation (API Level):** All admin queries scope by `req.restaurantId`; Super Admin isolation verified across tenants cleanly.
2. **Customer QR Ordering (Dine-In, Takeaway, Self-Delivery):** Dynamic menu filtering, variants/add-ons, authoritative server line pricing, idempotent checkout (`idempotency_key`), live KDS progression, pickup tokens (`PK-*`), delivery fee calculation & tracking.
3. **Billing, Splits & Engagement:** GST %, service charge %, rupee-rounded paise math, coupon redemption, Spin & Win, phone-keyed loyalty points, 4 bill-split modes, tip presets, UPI QR generation, feedback, and service calls.
4. **QR Code Studio (`QrTab.tsx`):** Single vs per-table modes, skipped/disabled tables, 6 QR patterns, 9 palettes, 4 frames, small/medium/large PNG + bulk ZIP export.
5. **Reservations & Waiter Panel:** `/reserve` (respecting operating hours & table count) synced to `Bookings` tab; `/waiter` table ordering with waiter attribution.
6. **Table PIN Hardening & Security Controls:** HMAC-signed `X-Table-Pin-Token` verified server-side on guest seating/order/payment/call endpoints; image magic bytes verified; no secrets leaked in `client/dist/assets/*.js`.

### Incomplete, Architectural or Multi-Tenant Hotel SaaS Blockers

1. **Zero Hotel / Property Multi-Unit Data Model (`restaurants` Only)**
   - **Finding:** Every tenant in `db.js` is strictly a `restaurant` (`restaurants` table, `table_config`, `table_seatings`).
   - **Impact:** A hotel client cannot model rooms, suites, floors/wings, QR room tents, Room Service ordering (`order_type = 'room_service'`), stay check-in/folio validation, or multiple dining outlets under one hotel property.
2. **Permissive Tenant Fallback on Unknown Hostnames (`server/src/db.js:652-677`)**
   - **Finding:** `resolveRestaurant(identifier, host)` falls back to `DEFAULT_RESTAURANT_ID` (`rest_default`) whenever no slug/id is supplied and `Host` does not match any `custom_domain`.
   - **Impact:** Any unmapped custom domain or mistyped tenant URL silently loads **Tandoor House's** menu and branding instead of a clean `404` or portal router.
3. **White-Label Isolation Leak on Root `/` for Custom Domains (`LandingPage.tsx`)**
   - **Finding:** Visiting `https://guest.myhotel.com/` hits `<LandingPage />`, which loads `GET /api/public/platform` (BROTOCOL branding) and `GET /api/public/venues` (exposes ALL tenants on the platform!).
   - **Impact:** Destroys true white-label tenant confidentiality on white-labeled custom domains.
4. **Staff RBAC Not Enforced on Backend (`staff` Table vs `users` Table)**
   - **Finding:** `users` only supports `'admin'` and `'super_admin'`. Operational staff (`waiter`, `kitchen`, `cashier`, `manager`) exist only in `staff` with **4-digit plaintext PINs** (`staff.pin`), returned in `GET /api/admin/staff`. `ShiftModal` / `useShift.ts` sets actor name in `localStorage` purely for logging (`req.body.by`).
   - **Impact:** Any staff device holding the logged-in admin cookie can modify tax rates, delete menu items, export financial reports, or spoof `req.body.by` even when "locked" to a waiter or kitchen role.
5. **Non-Transactional / Denormalized Schema Gaps (`server/src/db.js`)**
   - **Missing Foreign Keys:** Only `sessions.user_id` and `menu_items.category_id` declare `REFERENCES`. Child tables (`orders`, `payments`, `categories`, `menu_items`, `reservations`, `staff`, `service_calls`, `feedback`) lack `REFERENCES restaurants(id)` and inter-table FKs (`seating_id`, `order_id`, `created_by_staff_id`).
   - **JSON Blobs:** `orders.items`, `orders.timeline`, and `restaurants.table_config` prevent SQL aggregation, room/table metadata extension, and item-level auditing.
   - **Duplicate / Legacy Schema Table:** Legacy `restaurant_settings` table is still initialized and migrated in `db.js:121-133` even though `restaurants` replaced it.
6. **Duplicated Logic & Mixed Naming Hygiene**
   - `billMath` (`server/src/billMath.js` vs `client/src/lib/billMath.ts`) and `DEFAULT_QR_STYLE` (`server/src/db.js` vs `client/src/components/dashboard/QrTab.tsx`).
   - Mixed branding tokens across infra: `quickmenu-local`, `quickmenu.db`, `qm_session`, `qserve_shift_actor_v1`, `qserve_pin_token_*`, `owner@qserve.local`, and hardcoded `#49332A` / `#FAF8F5` in `SuperAdminPage.tsx` and parts of `DashboardPage.tsx`.
7. **Billing & Inconsistent Totals Across Channels**
   - Dine-In orders store pre-tax item subtotals in `orders.total_amount` and compute GST/service/coupons inside `calculateBill()` (`table_seatings`), whereas Takeaway (`pk-*`) and Delivery calculate GST/coupons nowhere and bake `delivery_fee` directly into `orders.total_amount`.
8. **Plan Tier / Quota Not Enforced**
   - `plan` (`Starter`, `Pro`, `Enterprise`), `plan_status`, and `plan_expires_at` are UI metadata only; expired `plan_expires_at` dates do not restrict access, and plan limits (room/table caps, staff caps, custom domains) are unchecked.
9. **Super Admin API vs UI Mismatch**
   - `GET /api/super/overview` sends the full `admins` table over the network (`services.js:495-502`), while `SuperAdminPage.tsx` (`Active Admins` tab) intentionally hides table rows and shows only a count card—and `PATCH /api/super/admins/:id` has no UI trigger.
   - `SuperAdminPage.tsx` writes Super Admin `select-restaurant` actions into tenant `activity_log` (`index.js`) without a separate platform-level super-admin audit log.
10. **Single-Node Scalability & Deployment Limitations**
    - No `.env.example`, `Dockerfile`, reverse-proxy/TLS template, or automated DB backup scripts.
    - In-memory WebSocket connection registry (`ws.js`) and in-memory IP login rate limiter (`security.js`) bind cleanly to one Node process but break under horizontal scaling.
    - N+1 query loops in `buildPlatformOverview()` and `buildFloorState()`.
