# IMPLEMENTATION_ROADMAP.md — Phased Upgrade Plan, Risks & Milestone Sequence

**Strategy:** Evolutionary modular upgrade preserving all working Restaurant Admin, Kitchen Display, Waiter POS, and Customer QR workflows while unlocking true **BROTOCOL Multi-Tenant Hotel & Restaurant White-Label SaaS** architecture without rewriting working modules.

---

## 1. Risk Register & Mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| **R1** | Breaking live production DB rows during table/FK/column migrations | **High** | Perform additive non-destructive SQLite migrations (`ALTER TABLE`, dual-write/backfill transitions into `service_units` and `order_items`), taking automated timestamped SQLite backup before running schema upgrades. |
| **R2** | Breaking existing Customer QR URLs already printed on tables (`/scan?table=4`, `/r/:slug/scan`) | **High** | Keep `/scan`, `/menu`, `/r/:slug/*` and `?table=` routes backwards compatible forever; support `?unit=` and room codes additively. |
| **R3** | Custom-domain silent fallback leaking another hotel's menu | **High** | Enforce strict host-matching in Middleware BEFORE milestone rollout of custom-domain onboarding; explicitly return clean "Unconfigured Branded Domain" view instead of defaulting to `rest_default`. |
| **R4** | Over-scoping into a full Hotel PMS (Check-in/Check-out calendars, Housekeeping, Laundry) | **Medium** | Keep boundary crisp: model ONLY **Rooms/Tables (`service_units`)**, **Room Service QR ordering**, and **Optional Room-Folio payment tag**; do NOT build PMS room reservations, housekeeping dispatch, or laundry modules unless explicitly requested later. |
| **R5** | Staff PIN RBAC rollout locking out single-owner demo/live venues | **Medium** | Preserve full permissions for primary `tenant_owner` / `hotel_admin` accounts (`owner@...`) while migrating `staff` PIN unlock into real short-lived scoped tokens (`role=waiter|kitchen|cashier|front_desk`). |
| **R6** | Duplicated billing math drifting between Client UI and Backend totals | **Medium** | Make backend `billMath.js` authoritative on EVERY channel (`dine_in`, `room_service`, `takeaway`, `delivery`) and expose calculated summary lines via API. |

---

## 2. Recommended Milestone Sequence

### Milestone 1 — Multi-Tenant Isolation, Security & Domain Hygiene (Low Risk, High Impact)
- **Objective:** Lock down strict white-label domain boundaries and clean up residual legacy debt without altering UI workflows.
- **Work Items:**
  1. Fix custom hostname resolution (`resolveRestaurant`) so unrecognized non-localhost hosts return `404 tenant_not_found` rather than falling back to `Tandoor House`.
  2. Update custom-domain `/` routing in `App.tsx` / `LandingPage.tsx` so accessing a tenant's white-label domain immediately opens that hotel/restaurant's branded QR gateway (`ScanPage` / white-label hero), hiding `BROTOCOL` showcase & `/api/public/venues`.
  3. Add unique constraint on `restaurants.custom_domain` (`LOWER(custom_domain)`), drop unused legacy `restaurant_settings` table after confirming backfill, and sanitize `/api/super/overview` so `Active Admins` count view doesn't over-fetch admin PII unnecessarily.
  4. Consolidate `brand_bg` / `brand_accent` dynamic theme tokens in `SuperAdminPage.tsx` and `DashboardPage.tsx`, and align `quickmenu` / `qserve` storage keys cleanly without invalidating guest carts abruptly.
- **Exit Criteria:** Custom domain shows zero BROTOCOL/competitor leakage; unknown hosts fail closed (`404`); existing tests pass 100%.

---

### Milestone 2 — Normalized Relational Schema & Unified Financial Engine (Foundation)
- **Objective:** Eliminate JSON-blob constraints and enforce foreign-key integrity + uniform channel tax/pricing math.
- **Work Items:**
  1. Backfill `service_units` table from existing `table_config` + `table_states` (`unit_type = 'table'`), keeping read/write compatibility in `buildFloorState()`.
  2. Add `order_items` child table (dual-write + backfill from `orders.items`), add foreign key constraints (`ON DELETE CASCADE` for tenants cleanly tested on delete/purge), and create `platform_audit_logs`.
  3. Unify financial fields (`subtotal_amount`, `tax_amount`, `service_charge_amount`, `discount_amount`, `delivery_fee`, `payable_total`) across `dine_in`, `takeaway`, and `delivery` via single shared server pricing service (`billMath.js`).
- **Exit Criteria:** Foreign keys active with zero orphaned rows; existing Dine-In, Takeaway, Delivery, Bill Split & Reports numbers match 100% cleanly; `order_items` populated for every new order.

---

### Milestone 3 — Hotel Rooms, Room Service & Folio Settlement Extensions
- **Objective:** Extend existing restaurant architecture cleanly into **Hotels & Resorts** while preserving 100% of existing Restaurant Admin tabs.
- **Work Items:**
  1. Add `tenant_type` (`restaurant` | `hotel` | `resort` | `cafe`) plus `room_service_enabled` and `charge_to_room_enabled` flags in Super Admin & Tenant Settings.
  2. Extend `QrTab.tsx` and `FloorTab.tsx` cleanly (tabbed selector inside existing components—NO duplicate dashboard!) to manage **Rooms / Suites** alongside **Dining Tables** (`zone_floor`, alphanumeric unit codes like `101`, `204`, `Suite-1`), printable room QR tent cards, and room check-in session/PIN opening.
  3. Add `order_type = 'room_service'` across Customer Menu (`/scan?unit=101` -> `/menu?unit=101`), Kitchen Display, Dashboard Orders (`Room 101 · Room Service`), and optional `room_folio` settlement alongside UPI/Card/Cash.
  4. Support channel visibility flags on the **existing single `categories` / `menu_items` source of truth** (e.g., show item in Dining Room, Room Service, or both—zero duplicate menu tables!).
- **Exit Criteria:** A test hotel tenant (`hotel` type) issues Room `101` QR, guest submits a verified Room Service order from the unified menu catalog, Kitchen prepares it, and Hotel Admin sees/settles the Room `101` folio cleanly while a test restaurant tenant remains uncluttered and unchanged.

---

### Milestone 4 — True Role-Based Staff Access Control (RBAC)
- **Objective:** Replace UI-only `useShift` PIN attribution with real server-enforced operational roles.
- **Work Items:**
  1. Hash staff PINs on save (`pin_hash`, `pin_lookup_hash`), redact raw PINs from `GET /api/admin/staff`, and make `POST /api/admin/staff/unlock` issue a signed, short-lived `staff_session` token scoped to the employee's actual role (`waiter`, `kitchen`, `cashier`, `front_desk`, `manager`).
  2. Apply backend middleware permission matrices across `/api/admin/*` routes (e.g., `kitchen` can view/progress orders; `waiter` can take orders/manage calls; `cashier`/`front_desk` can settle bills/folios; only `manager`/`owner` can edit menu, tax, coupons, staff, or settings).
  3. Update `DashboardPage`, `WaiterPage`, and `KitchenPage` cleanly to handle role-scoped navigation links without locking out `tenant_owner` accounts.
- **Exit Criteria:** API tests prove a Waiter token gets `403 Forbidden` on `PATCH /api/admin/settings` and `DELETE /api/admin/items/:id`, while Waiter POS & KDS operate seamlessly.

---

### Milestone 5 — SaaS Plan Quotas, Hardening & Production Deployment Pack
- **Objective:** Prepare BROTOCOL ServeOS for multi-client SaaS hosting and agency scaling.
- **Work Items:**
  1. Enforce server-side plan quotas (`Starter` / `Pro` / `Enterprise`: unit limits, custom domain gating, active vs expired/paused lockout with clean renewal banner).
  2. Replace N+1 query loops in `buildPlatformOverview()` and `buildFloorState()` with grouped SQL aggregates; add gzip/brotli response compression & image size optimization.
  3. Deliver `.env.example`, `Dockerfile` + `docker-compose.yml`, Nginx reverse-proxy & wildcard SSL guide for multi-tenant `custom_domain` TLS termination, automated SQLite backup CLI script, and expanded E2E + Chromium tests covering hotel room QR workflows and RBAC denial checks.
- **Exit Criteria:** Clean Dockerized startup, passing CI `npm run build` + `npm test` + Chromium E2E across super-admin, hotel-admin, restaurant-admin, waiter, KDS, and guest room/table flows.

---

## 3. Suggested Approval Checklist Before Coding Starts

Before Milestone 1 begins, please confirm:
1. **Scope of "Hotel" Features:** Confirm whether "Hotel Admin" means **Room QR Menu + Room Service Ordering + Optional Charge-to-Room Settlement** (keeping BROTOCOL strictly a hospitality QR ordering SaaS), or whether any additional non-ordering hospitality workflows are desired.
2. **Existing Default Tenants:** Should seeded demo venues (`Tandoor House`, `Saffron Courtyard`) remain restaurant demos alongside an optional seeded hotel demo (e.g., *BROTOCOL Heritage Hotel*), or stay untouched?
3. **Priority:** Confirm proceeding sequentially from **Milestone 1 -> Milestone 2 -> Milestone 3 -> Milestone 4 -> Milestone 5**.
