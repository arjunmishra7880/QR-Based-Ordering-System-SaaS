# VIDEO_FEATURE_GAP_ANALYSIS.md — Reference Video Comparison & Upgrade Plan

**Reference Concept:** *Start Your Own White Label Restaurant QR Menu Maker & Order Management System* (`Ready technology -> BROTOCOL ServeOS -> White-Label Restaurant Clients`)  
**Scope:** Strictly **Restaurant-Only** (`Restaurants`, `Cafés`, `QSRs`, `Bakeries`, `Juice Bars`, `Cloud Kitchens`, `Small/Medium Chains`). Zero hotel/room modules.

---

## Summary Comparison Matrix

| Group | Video Concept Feature | Current Baseline Status | Required Upgrade / Action |
|---|---|---|---|
| **A** | QR Menu and Ordering | **Implemented** | Keep intact; wire dynamic white-label accent CSS variables & prevent table spoofing |
| **B** | Dine-In Ordering | **Implemented (with PIN security hole)** | Fix server-side Table PIN enforcement, lock guest table identity from URL/QR, add duplicate submit idempotency |
| **C** | Takeaway Ordering | **Missing** | Add guest Takeaway selection, minimal contact form, pickup token, KDS `Ready for Pickup` flow |
| **D** | Delivery Ordering | **Missing** | Add restaurant self-managed Delivery mode (address, contact, optional fee, kitchen-to-delivery status) |
| **E** | Table Booking | **Missing** | Add public restaurant table reservation request + status check, admin approve/reject/modify/seat workflow |
| **F** | Waiter Order-Taking Panel | **Missing** (only Floor POS & PIN shift lock exist) | Build `/waiter` (and Floor-linked) order-taking panel using existing menu, modifiers & order APIs with waiter attribution |
| **G** | Restaurant Owner Dashboard | **Implemented** (`DashboardPage` 9 tabs + KDS) | Preserve existing 9 modules; surface Reservation & Takeaway/Delivery clarity cleanly without duplicating dashboards |
| **H** | White-Label Branding | **Partially Implemented** | Apply `--qm-accent` & `--qm-bg` consistently across Menu, Scan, Bills, Dashboard, KDS & QR Studio; enforce BROTOCOL ServeOS default attribution + functional custom-domain Host resolution |
| **I** | Client Management & Agency Workflow | **Partially Implemented** (`SuperAdminPage`) | Expose `custom_domain`, client subscription lifecycle (`status`, `renewal_date`, plan quotas), agency branding configuration in Super Admin, and keep Active Admins count-only UI intact |

---

## Detailed Feature Group Analysis (A – I)

### A. QR Menu and Ordering
- **Supported Today**:
  - Restaurant-specific menus scoped by `restaurant_id` via `/scan`, `/menu`, `/r/:slug/scan`, and `/r/:slug/menu`.
  - Unique QR code per table (or single QR mode) generated offline via `qrcode` + `jszip` in `QrTab.tsx`.
  - App-less browser scanning, category chips, dish photos, descriptions, sold-out/availability toggle, Veg/Non-Veg filter, size variants, add-ons, persistent cart, kitchen notes, order confirmation modal, and real-time WebSocket order tracker.
- **Gaps / Weaknesses**:
  - Customer primary CTA buttons in `MenuPage.tsx` and `DishOptionModal.tsx` hardcode `#49332A` instead of `var(--qm-accent)`.
  - Duplicate click submission creates duplicate DB orders if clicked rapidly before disable state settles (missing server `idempotency_key`).

### B. Dine-In Ordering
- **Supported Today**:
  - QR URLs encode `table` and `slug`, linking into `table_seatings` and `orders(restaurant_id, table_number, seating_id)`.
  - Multiple diners at the same table share the active open seating bill cleanly via `ensureOpenSeating` & `resolveOpenSeatingRow`.
  - Orders route via WebSocket (`broadcastToStaff` scoped by `restaurantId`) to `OrdersTab` and `KitchenPage`.
- **Gaps / Broken Security Checks**:
  - **Table Identity Manipulation Risk**: `/menu?table=4` accepts raw URL query without enforcing PIN validation if `require_table_pin = 1`, and `POST /api/public/orders` skips PIN token checks completely. Fix by enforcing a server-issued signed PIN unlock token when `require_table_pin = 1` and rejecting invalid/unverified table requests cleanly.
  - **Label Distinction**: Once Takeaway and Delivery are added, Dine-In tickets in Dashboard Orders & KDS must explicitly badge `Dine-In · Table X`.

### C. Takeaway Ordering
- **Supported Today**: **None** — all orders require a numeric/active dining table (`validateTableForOrder`) and call `ensureOpenSeating`.
- **Planned Upgrade (Self-Contained, Zero Signup)**:
  - Guest picks **Takeaway** from `/scan` or `/menu?mode=takeaway` (when `takeaway_enabled = true` in restaurant settings).
  - Guest enters only minimal pickup contact details (**Name** and **Phone** — no password/account signup).
  - Server stores `order_type = 'takeaway'`, nullable/virtual `table_number = 'TAKEAWAY'`, generates a crisp pickup code (`pickup_token`, e.g., `PK-401`), bypasses `table_seatings` floor occupancy so physical tables remain Free, broadcasts to Kitchen & Dashboard clearly badged **Takeaway**, enables **Mark Ready for Pickup** in Orders/KDS, and lets the guest track live status (`Pending` → `Accepted` → `Preparing` → `Ready for Pickup` → `Collected`).

### D. Delivery Ordering
- **Supported Today**: **None**.
- **Architecture Fit**: Fits cleanly onto the `orders` pipeline (`order_type = 'delivery'`) using restaurant-managed fulfillment—no third-party courier APIs, map SDKs, or marketplaces.
- **Planned Upgrade**:
  - Venue Admin configures `delivery_enabled`, flat `delivery_fee`, and `free_delivery_min` in Settings.
  - Customer selects **Delivery**, enters **Name**, **Phone**, **Delivery Address**, and optional **Landmark**.
  - Server calculates authoritative food subtotal + `delivery_fee` + GST (`server/src/index.js`), tags the order `Delivery`, and sends to Kitchen & Admin Orders.
  - Staff can Accept, Prepare, mark `Out for Delivery` (`ready` / `delivery_status = 'out_for_delivery'`), or mark `Delivered` (`completed`), reflected live on the customer tracker.

### E. Table Booking (Reservations)
- **Supported Today**: **None**.
- **Planned Upgrade (Strictly Restaurant Dining Only)**:
  - New `reservations` SQLite table scoped strictly by `restaurant_id` (`id`, `restaurant_id`, `booking_code`, `customer_name`, `customer_phone`, `party_size`, `reservation_date`, `reservation_time`, `status` [`pending` | `confirmed` | `seated` | `rejected` | `cancelled`], `assigned_table`, `notes`, `admin_note`, `created_at`, `updated_at`).
  - Operating hours (`opening_time`, `closing_time`) stored per restaurant and validated when submitting reservations alongside total active tables (`table_config`).
  - Public reservation view (`/reserve` & `/r/:slug/reserve`, linked from `/scan` and `/menu`) lets guests submit reservation requests and check booking status by booking code or phone number.
  - Existing Floor / Service workspace in `DashboardPage` gains a clean **Bookings** management panel (`FloorTab` / Dashboard tab) where restaurant staff Approve (with optional table assignment), Modify date/time/party size/table, Reject, or `Seat Guest Now` (auto-opening the assigned table on Floor POS).

### F. Waiter Order-Taking Panel
- **Supported Today**: Staff can unlock Shift PIN attribution (`ShiftModal`, `/api/admin/staff/unlock`) and inspect/collect payment on `FloorTab` or edit existing tickets on `OrdersTab`, **but** waiters cannot punch a brand-new order from the Floor/Dashboard on behalf of a table or takeaway guest.
- **Planned Upgrade**:
  - Dedicated Waiter Order-Taking route (`/waiter` + 1-click button on `FloorTab` table drawer & Dashboard sidebar) built directly on existing categories, menu items, variants, add-ons, and `POST /api/admin/orders`.
  - Flow: Waiter unlocks/confirms Staff identity (logged-in session + active Waiter/Staff member) -> selects any active table (Free or Seated) or Takeaway -> searches categories/veg items -> adds customized dishes + kitchen note -> submits directly to `orders`, associating `created_by_staff_id` & `created_by_staff_name` (`waiter` attribution) and broadcasting instantaneously to Kitchen Display (`KDS`) and Table Bill.

### G. Restaurant Owner Dashboard
- **Supported Today**: 9 integrated tabs (`Home`, `Floor`, `Orders`, `Service calls`, `Menu`, `QR codes`, `Staff`, `Reports`, `Settings`) + `Kitchen Display` link, mobile responsive bottom nav, real-time WebSocket updates, audio alerts.
- **Planned Improvements**:
  - Preserve existing tabs & layout cleanly.
  - Add clean service-channel badges (`Dine-In`, `Takeaway`, `Delivery`) and Pickup/Delivery action controls in `OrdersTab` & `KitchenPage`.
  - Add **Reservations** management integrated smoothly alongside Floor/Service without creating a redundant second dashboard.
  - Scrub leftover `"hotel"` strings in `SettingsTab.tsx` and apply venue white-label accent colors to Dashboard & Kitchen header accents cleanly.

### H. White-Label Branding
- **Supported Today**:
  - Venue name, logo upload/URL, cover image upload/URL, `white_label` attribution toggle, `brand_bg`, `brand_accent`, `custom_domain` string persisted in SQLite (`restaurants`).
- **Gaps to Close**:
  - Apply `--qm-bg` and `--qm-accent` consistently across **every interactive CTA, active filter pill, qty stepper, `DishOptionModal`, `BillModal`, `CallStaffModal`, `FeedbackModal`, `ScanPage`, `DashboardPage`, `KitchenPage`, and QR card badges**.
  - Update platform fallback attribution from `QServe` to **BROTOCOL ServeOS** when `white_label = false`, and hide all platform attribution completely (`© <Restaurant Name>`) when `white_label = true`.
  - Make `custom_domain` genuinely functional: add `Host` header tenant resolution in Express (`server/src/index.js`) matching configured `custom_domain`, expose `custom_domain` in `SuperAdminPage` modals, and generate QR codes targeting `https://${settings.custom_domain}` (when set and enabled) or `/r/${slug}/scan`.

### I. Client Management & Agency / Reseller Workflow
- **Supported Today**:
  - `SuperAdminPage` supports platform KPIs, create/edit/pause/activate venues, plan tier selection, provision admins, switch workspace, Active Admins count view, and cross-venue activity stream.
- **Gaps / Additions**:
  - Add **Agency / Reseller Brand Settings (`platform_settings` table)** editable from `SuperAdminPage` so BROTOCOL (or any reseller agency) can customize default platform name (`BROTOCOL ServeOS`), agency tagline, support contact, and default white-label palette across public Landing & Auth views.
  - Upgrade client subscription tracking (`plan_status`: `active` | `trial` | `past_due` | `suspended`, `plan_expires_at`, table/menu limits per plan tier enforced server-side).
  - Expose `custom_domain` field cleanly inside `SuperAdminPage` Add/Edit Restaurant modals while preserving the user-requested **Active Admins count-only display**.
