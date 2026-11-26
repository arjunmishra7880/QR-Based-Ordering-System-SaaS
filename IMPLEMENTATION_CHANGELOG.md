# IMPLEMENTATION_CHANGELOG.md — BROTOCOL ServeOS Product Upgrade

**Brand / Platform:** BROTOCOL ServeOS (White-Label Restaurant QR Menu, Ordering, Table Management & Kitchen Operations SaaS)  
**Scope:** Strictly Restaurant-Only (`Restaurants`, `Cafés`, `QSRs`, `Bakeries`, `Juice Bars`, `Cloud Kitchens`, `Small & Medium Restaurant Chains`). Zero hotel or room modules.

---

## Summary of Changes

### 1. Security Hardening & Architecture Improvements
- **Authenticated WebSocket Channels (`server/src/ws.js`, `server/src/auth.js`, `client/src/lib/useWebSocket.ts`)**:
  - Enforced cookie/Bearer authentication via `getSessionUserFromHeaders` before granting `staff` (`4401` close) or `super` (`4403` close) WebSocket streams.
  - Enforced server-issued HMAC `pinToken` verification (`signTablePinToken` / `verifyTablePinToken`) on guest table WebSocket connections when `require_table_pin` is active.
  - Updated `useRealtimeSocket` in `client/src/lib/useWebSocket.ts` to mark `connected = true` upon receiving `{ type: "connected" }` from the authenticated server socket and to forward `sessionId` and `pinToken`.
- **Server-Side Table PIN Enforcement (`server/src/security.js`, `server/src/index.js`, `client/src/lib/api.ts`)**:
  - Added `verifyGuestTableAccess` across guest seating, order, payment, coupon, spin, loyalty, feedback, and service-call endpoints so `require_table_pin` cannot be bypassed by direct API or `/menu?table=X` calls.
  - Added `getStoredPinToken` / `setStoredPinToken` in `client/src/lib/api.ts` and propagated `X-Table-Pin-Token` headers from `ScanPage.tsx`, `MenuPage.tsx`, `BillModal.tsx`, `CallStaffModal.tsx`, `FeedbackModal.tsx`, and `SpinWheelModal.tsx`.
  - Fixed `apiJson` in `client/src/lib/api.ts` so `...init` is spread before `headers`, preserving `Content-Type: application/json` whenever `headers` are merged or omitted.
- **Authoritative Pricing, Idempotency & Input Guards (`server/src/security.js`, `server/src/index.js`)**:
  - Added `resolveAuthoritativeLines` for both customer `POST /api/public/orders` and admin `PATCH /api/admin/orders/:id` order edits, ignoring client-supplied unit prices and looking up authoritative menu/variant/add-on prices in SQLite.
  - Added duplicate order protection using `idempotency_key` (`clientRequestId`) on `POST /api/public/orders`.
  - Added sliding-window rate limiting (`checkLoginRateLimit`, `clearLoginRateLimit`) on `POST /api/auth/login`, HTTP security response headers (`securityHeadersMiddleware`), upload image magic-byte validation (`validateUploadedImage`), and `revokeOtherUserSessions` on password change.
- **Removal of Exposed Credentials in Frontend Bundle (`client/src/pages/AuthPage.tsx`, `client/src/components/ShiftModal.tsx`)**:
  - Removed hardcoded demo fill buttons and plaintext credential/PIN hints from shipped client JS (`ADMINCAS@BROTOCOL2026`, `QServe123!`, `SuperQServe123!`), keeping backend auth compatibility intact (`ADMINCAS` / `ADMINCAS@BROTOCOL2026` and seeded venue owner credentials).
- **Performance & Indexing (`server/src/db.js`, `server/src/index.js`, `client/src/App.tsx`, `client/src/components/dashboard/FloorTab.tsx`)**:
  - Added SQLite indexes (`idx_orders_seating`, `idx_orders_idempotency`, `idx_seatings_rest_status`, `idx_reservations_rest_date`, `idx_reservations_code`).
  - Added lazy route code splitting (`React.lazy` + `Suspense`) in `client/src/App.tsx` for `/super-admin`, `/dashboard`, `/waiter`, `/kitchen`, `/reserve`, and `/r/:slug/reserve`.
  - Configured immutable asset caching in Express and removed the redundant 8-second polling interval in `FloorTab.tsx` in favor of WebSocket sync.

### 2. Multi-Channel Ordering Workflows (Dine-In, Takeaway & Self-Delivery)
- **Database Extensions (`server/src/db.js`)**:
  - Extended `restaurants` with `plan_status`, `plan_expires_at`, `opening_time`, `closing_time`, `takeaway_enabled`, `delivery_enabled`, `delivery_fee`, and `free_delivery_min`.
  - Extended `orders` with `order_type`, `pickup_token`, `customer_name`, `customer_phone`, `delivery_address`, `delivery_landmark`, `delivery_fee`, `delivery_status`, `created_by_staff_id`, `created_by_staff_name`, and `idempotency_key`.
- **Takeaway Ordering (`server/src/index.js`, `client/src/pages/ScanPage.tsx`, `client/src/pages/MenuPage.tsx`, `client/src/components/dashboard/OrdersTab.tsx`, `client/src/pages/KitchenPage.tsx`)**:
  - Added zero-signup customer Takeaway ordering (`orderType = "takeaway"`), minimal Name + Phone validation, auto-generated `PK-XXX` pickup tokens, non-table virtual `TAKEAWAY` routing (leaving physical tables Free), KDS/Orders `Ready for Pickup` and `Picked up` actions, and live customer tracker status.
- **Restaurant Self-Delivery (`server/src/index.js`, `client/src/pages/MenuPage.tsx`, `client/src/components/dashboard/SettingsTab.tsx`)**:
  - Added restaurant-managed Delivery (`orderType = "delivery"`) with configurable toggle, flat `delivery_fee`, and `free_delivery_min` waiver threshold in `SettingsTab.tsx`.
  - Captures customer name, phone, street address, and optional landmark, computes authoritative server totals including delivery fee + GST, and syncs live `delivery_status` (`pending` -> `preparing` -> `out_for_delivery` -> `delivered`) from Dashboard/KDS to the customer tracker.

### 3. Table Booking / Reservations System
- **Schema & APIs (`server/src/db.js`, `server/src/index.js`, `server/src/security.js`)**:
  - Added `reservations` table with unique `BK-XXXXXX` booking codes (`generateBookingCode`) and operating-hours validation (`isTimeWithinHours`).
  - Added `POST /api/public/reservations`, `GET /api/public/reservations`, `GET /api/admin/reservations`, and `PATCH /api/admin/reservations/:id`.
- **Customer & Admin UI (`client/src/pages/ReservePage.tsx`, `client/src/components/dashboard/ReservationsTab.tsx`)**:
  - Added public reservation routes (`/reserve` and `/r/:slug/reserve`) with date/time/party-size/contact submission and booking-code/phone status lookup.
  - Added the **Bookings** tab (`ReservationsTab.tsx`) in `DashboardPage.tsx` to approve, reject, modify time/party/notes, assign tables from venue floor config, or mark guests seated.

### 4. Dedicated Waiter Order-Taking Panel
- **Backend & UI (`server/src/index.js`, `client/src/pages/WaiterPage.tsx`)**:
  - Added `POST /api/admin/orders` allowing staff to submit Dine-In or Counter Takeaway tickets directly into `orders` / `order_items` / KDS with `created_by_staff_id` and `created_by_staff_name` attribution.
  - Added `/waiter` (`WaiterPage.tsx`), accessible from `LandingPage.tsx`, `DashboardPage.tsx`, and `KitchenPage.tsx`, featuring table grid selection, active waiter selector, veg/category filters, Dish Option modifiers (`DishOptionModal`), kitchen notes, and real-time KDS ticket dispatch.

### 5. White-Label Branding, Agency Controls & Domain Routing
- **Agency Platform Branding (`server/src/db.js`, `server/src/services.js`, `server/src/index.js`, `client/src/pages/SuperAdminPage.tsx`, `client/src/pages/LandingPage.tsx`)**:
  - Added `platform_settings` table and `GET /api/public/platform`, `GET /api/super/platform`, and `PATCH /api/super/platform` endpoints for agency/reseller product name, agency name, support email, tagline, and default palette.
  - Added the **Agency Branding** modal plus subscription lifecycle fields (`plan`, `plan_status`, `plan_expires_at`, `custom_domain`) in `SuperAdminPage.tsx` while keeping the `Active Admins` tab as a count-only card.
- **Custom Domain Resolution & Theme Consistency (`server/src/db.js`, `client/src/index.css`, `client/src/components/`, `client/src/pages/`)**:
  - Updated `resolveRestaurant(identifier, host)` in `server/src/db.js` to resolve tenants cleanly from HTTP `Host` / `X-Forwarded-Host` matching `custom_domain`.
  - Updated `QrTab.tsx` to target custom-domain URLs when configured and export `*-restaurant-qr-codes.zip`.
  - Unified customer and venue styling onto dynamic `--qm-accent`, `--qm-accent-hover`, and `--qm-accent-ink` theme variables (`buildVenueThemeStyle`), preserved `#FAF8F5` + `#49332A` defaults when untouched, toggled customer attribution (`© {Restaurant}` in white-label mode vs `Powered by BROTOCOL ServeOS`), and removed all legacy hotel terminology across code and UI copy.
