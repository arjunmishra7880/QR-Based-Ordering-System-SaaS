# FEATURE_GAP_ANALYSIS.md — Current Platform vs. White-Label Hotel & Restaurant SaaS

**Scope Evaluated:** Transitioning current **BROTOCOL ServeOS** (`restaurants`-only baseline) into a full multi-tenant **White-Label Hotel & Restaurant QR Ordering SaaS** across Super Admin, Hotel/Restaurant Admin, and Customer QR Ordering Website.

---

## 1. High-Level Gap Matrix

| Domain | Requirement | Current Codebase State | Gap Classification | Target Remediation |
|---|---|---|---|---|
| **Multi-Tenancy Model** | Independent hotels & restaurants as isolated tenants | `restaurants` table isolates venues well on `/api/admin/*`, `/r/:slug/*`, `custom_domain` API host resolution | **Partially Implemented** (Restaurant-only; unknown hosts fall back to default venue) | Add `tenant_type` (`hotel` / `restaurant` / `resort` / `cafe`), strict `404` on unmapped custom hosts, white-label root `/` routing |
| **Property Units (Tables + Rooms)** | Support restaurant tables AND hotel rooms/suites | JSON `table_config` (`total`, `skip`, `disabled`) numeric table IDs only | **Missing for Hotels** | Normalize into `service_units` supporting `table` & `room` units (wings/floors, labels like `101`, `Suite-4`, capacity) |
| **White-Label Branding** | Independent colors, logos, custom domains, zero platform leaks | `white_label`, `brand_bg`, `brand_accent`, `custom_domain`, `--qm-accent` active on Menu/Scan/Reserve | **Partially Implemented** | Apply dynamic branding to `LandingPage` root on custom domains (hide `BROTOCOL` showcase & `/api/public/venues` sibling directory); theme Super Admin defaults cleanly |
| **Menu & Categories** | Independent menu/categories/modifiers per hotel from single source of truth | `categories`, `menu_items`, size variants, add-ons, availability toggles, station routing | **Implemented (Single Source)** | Optionally tag channel/unit visibility (e.g., Dining vs Room Service hours) on the same `menu_items` rows—zero duplicate menus |
| **QR Studio** | Unique printable/downloadable QR per table or room | `QrTab.tsx` generates customized PNG/ZIP per numeric table, `custom_domain`-aware | **Implemented for Tables** | Extend `QrTab` cleanly to generate QR sheets for both **Tables** & **Hotel Rooms** (`/scan?unit=...`) with batch PDF/ZIP |
| **Ordering Channels** | Dine-In, Room Service, Takeaway, Delivery | Dine-In, Takeaway (`PK-*`), Delivery supported in `MenuPage` & `OrdersTab` | **Room Service Missing** | Add `room_service` channel reusing existing `orders` & `KitchenPage` pipeline + room delivery notes & tray pickup call type |
| **Billing & Tax Engine** | Consistent tax, service charge, promos & room folio settlement | `billMath.js` handles GST/service/coupons on `table_seatings` only; Takeaway/Delivery skip GST/coupons | **Inconsistent Across Channels** | Unify server tax/discount/fee engine across all channels; add optional `room_folio` payment/settlement mode |
| **Staff Accounts & RBAC** | True role-based access per hotel (`Owner`, `Manager`, `Cashier`, `Waiter`, `Kitchen`, `FrontDesk`) | `users` has only `'admin'` & `'super_admin'`; `staff` stores plaintext 4-digit PINs purely for local UI attribution | **Broken / Missing RBAC** | Hash staff PINs/passwords, issue role-scoped backend tokens/sessions, and enforce route-level middleware permissions |
| **Super Admin SaaS Controls** | Tenant onboarding, plan quotas, billing lifecycle, agency white-label | `SuperAdminPage` manages venues, `plan`/`plan_status`/`plan_expires_at`, Agency Branding, Active Admins count | **Partially Implemented** | Enforce plan limits server-side (max units, custom domain gating, expiry grace), move platform audit events to `platform_audit_log`, align `/api/super/overview` payload with count-only privacy |
| **Reservations & Table Booking** | Table reservation & approval synced to floor | `/reserve`, `/r/:slug/reserve`, `ReservationsTab` working cleanly | **Implemented for Dining** | Optionally link pre-arrivals / VIP table holds smoothly alongside existing `Bookings` tab |
| **Database Integrity & Scale** | Relational integrity, clean analytics, cloud readiness | Missing FK constraints across 14 tables; legacy `restaurant_settings` table still active; JSON `orders.items`; N+1 queries | **Architectural Debt** | Drop legacy `restaurant_settings`, add SQLite FKs (`ON DELETE CASCADE`), normalize `order_items` & `service_units`, optimize aggregation queries |

---

## 2. Detailed Domain Breakdown

### A. Hotel-Specific Capabilities vs. Current Codebase
1. **Room vs. Table Identification (`services.js:23-64`)**:
   - `normalizeTableNumber()` strips non-alphanumeric chars cleanly, yet `validateTableForOrder()` assumes integer table IDs `1..total` in `table_config`. Real hotel room labels (`101`, `102`, `204A`, `Villa-3`) cannot be grouped by wing/floor or distinguished from Dining Table `4`.
2. **Room Service & Guest Verification**:
   - Current `require_table_pin` checks open `table_seatings` rows. For hotel guests ordering from a room QR at midnight, Front Desk / Hotel Admin needs the ability to activate/open a room check-in folio (`open` seating/folio session with room PIN / surname or surname-free QR depending on policy) cleanly without marking a restaurant dining table occupied on the restaurant Floor POS!
3. **Billing Settlement Modes (`payments.mode`)**:
   - Currently restricted to `VALID_PAY_MODES = new Set(["upi", "card", "cash"])`. Hotels additionally need `room_charge` / `pay_at_checkout` logged cleanly on the room's active folio for Front Desk checkout reconciliation.

### B. Authorization & Security Gaps
1. **Privilege Escalation Inside Tenant Session (`useShift.ts`, `index.js`)**:
   - Any browser logged in via `owner@...` shares full Admin privileges. Switching `ShiftModal` to `Waiter` (`PIN 1111`) or `Kitchen` (`PIN 3333`) only alters a `localStorage` label (`qserve_shift_actor_v1`)—the underlying HTTP cookie can still delete categories, change UPI IDs, or view revenue reports.
2. **Plaintext Staff PIN Storage (`db.js:261`, `index.js:2185`)**:
   - `GET /api/admin/staff` exposes every active employee's cleartext PIN (`1111`, `2222`, `3333`) in API JSON responses.
3. **Super Admin Privacy vs Payload Exposure (`services.js:495-549`)**:
   - While `SuperAdminPage.tsx` (`Active Admins`) displays only the integer count (`stats.activeAdmins`), the `/api/super/overview` API response still transmits full admin PII (`id`, `email`, `name`, `restaurant_id`) over the network.

### C. Consistency & Code Duplication Gaps
- **Duplicated Math:** `server/src/billMath.js` vs `client/src/lib/billMath.ts` (rounding/split helpers maintained twice).
- **Duplicated Constants:** `DEFAULT_QR_STYLE` duplicated in `server/src/db.js` and `client/src/components/dashboard/QrTab.tsx`.
- **Naming Drift:** `quickmenu-local`, `quickmenu.db`, `qm_session`, `qm_guest_session_v1`, `qserve_shift_actor_v1`, `qserve_pin_token_*`, and `owner@qserve.local` coexist with `BROTOCOL ServeOS` / `brotocol_pin_token_*`.
- **Single-Node State:** In-memory `failedLoginBuckets` Map (`security.js:9`) and process-local WebSocket registry (`ws.js`) require externalized adapters if deployed across multiple instances.
