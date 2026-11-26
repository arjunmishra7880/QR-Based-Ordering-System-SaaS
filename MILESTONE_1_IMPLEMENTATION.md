# Milestone 1 Implementation Summary — White-Label Tenant Isolation & Domain Routing

## 1. Objective & Scope
Milestone 1 converts the existing multi-tenant restaurant/hotel QR ordering application (**BROTOCOL ServeOS**) into a white-label, hostname-isolated multi-tenant SaaS while preserving existing restaurant records, admin/KDS/Waiter workflows, authentication, printed QR routes (`/scan?table=X` and `/r/:slug/scan`), and core API compatibility.

## 2. Summary of Architectural Changes

### Backend Persistence & Migration (`server/src/`)
- **`server/src/migrations.js`** *(new)*:
  - Introduces versioned migration tracking via `schema_migrations`.
  - Exports `runMigrations(db, { dbFilePath, defaultRestaurantId, defaultSlug })`, `rollbackMigrationM1(db, { defaultRestaurantId })`, and `verifyMigrationM1(db, { defaultRestaurantId })`.
  - Automatically creates a `.bak` database snapshot before migrating live SQLite databases containing legacy `restaurant_settings`.
  - Losslessly merges `restaurant_settings` values into `restaurants` (`rest_default`), normalizes and deduplicates non-empty `custom_domain` values, adds `brand_secondary` and `custom_domain_verified` columns, creates `UNIQUE INDEX idx_restaurants_custom_domain ON restaurants(LOWER(custom_domain)) WHERE custom_domain != ''`, and drops `restaurant_settings`.
- **`server/src/db.js`**:
  - Removes `restaurant_settings` DDL and legacy table references.
  - Invokes `runMigrations()` during DB initialization.
  - Adds `brand_secondary`, `custom_domain_verified`, and `default_brand_secondary` support and exposes `primary_color`, `secondary_color`, and `custom_domain_verified` in `mapSettings()`.
  - Implements authoritative hostname/tenant resolution helpers: `extractHostname`, `isPlatformHost`, `normalizeCustomDomain`, `validateCustomDomainAvailable`, and `resolveRestaurantContext`.
- **`server/src/index.js`**:
  - Adds `GET /api/public/context` so public/guest/auth entry pages resolve platform vs. tenant branding from the verified `Host` context.
  - Adds `GET /api/super/restaurants/:id` for Super Admin venue detail retrieval.
  - Updates `resolvePublicRestaurant`, `/api/public/venues`, `/api/public/orders/:id/cancel`, and `/api/auth/login` to enforce strict hostname/tenant isolation and prevent cross-tenant access or spoofing.
  - Enforces HTTP `404` (`domain_not_found`) for unknown hostnames and `403` for unverified custom domains across both `/api/*` and customer HTML routes (`express.static(clientDist, { index: false })` + SPA fallback).
  - Returns HTTP `409` when Super Admin or Tenant Admin attempts to assign a duplicate custom domain; automatically resets `custom_domain_verified = 0` when a Tenant Admin updates `custom_domain`.
- **`server/src/ws.js`**:
  - Enforces `resolveRestaurantContext` on guest WebSocket connections (`4404` close code on unknown host, `4403` on unverified/paused domain or cross-tenant slug mismatch) and applies host/tenant validation to staff WebSocket upgrades.
- **`server/src/services.js`**:
  - Sanitizes `buildPlatformOverview()` (`GET /api/super/overview`): removes sensitive `admins` PII roster, removes `wifi_ssid`, `wifi_password`, `upi_id`, `loyalty`, `spin_prizes`, `social_links`, and raw `activity_log.details`; flattens `tables_total`; adds `pausedVenues`; exposes `brand_secondary`, `primary_color`, `secondary_color`, and `custom_domain_verified`.

### Frontend Theme Tokens & White-Label UI (`client/src/`)
- **Theme Tokens & Shared Helpers**:
  - `client/src/index.css`: Defines `:root` CSS custom properties `--qm-primary`, `--qm-primary-hover`, `--qm-primary-ink`, `--qm-secondary`, and `--qm-secondary-ink`.
  - `client/src/lib/api.ts`: Extends `buildVenueThemeStyle` and public/context API types cleanly; removes rigid single-hotel defaults.
  - `client/src/types.ts`: Updates `SuperVenueSummary`, `PlatformOverviewResponse`, and `RestaurantSettings` TypeScript contracts for Milestone 1 fields.
  - `client/src/components/BrandMark.tsx`: Uses CSS custom properties (`--qm-primary`, `--qm-secondary`, etc.) instead of hardcoded `#49332A` / `#FAF8F5`.
- **Entry & White-Label Context Resolution**:
  - `client/src/pages/LandingPage.tsx`: Fetches `GET /api/public/context` first. On verified custom domains, redirects `/` straight to `/scan` without exposing platform branding or calling `/api/public/venues`; renders clean `404` / `403` states for unknown or unverified domains.
  - `client/src/pages/AuthPage.tsx`: Applies verified tenant white-label branding on `/auth` when accessed via a verified custom domain.
- **Customer & Operational Surfaces**:
  - `client/src/pages/ScanPage.tsx`, `MenuPage.tsx`, `ReservePage.tsx`, `DashboardPage.tsx`, `KitchenPage.tsx`, `WaiterPage.tsx`: Apply per-tenant `primary_color` / `secondary_color` (`brand_secondary`) + `brand_bg` via `buildVenueThemeStyle`, and replace hardcoded sidebar/loading brown colors (`#49332A`) with theme variables.
- **Dashboard & Super Admin Controls**:
  - `client/src/components/dashboard/SettingsTab.tsx`: Adds Primary Color, Secondary Color, and Background Color pickers plus Custom Domain `Verified` / `Pending Verification` badges.
  - `client/src/components/dashboard/QrTab.tsx`: Uses the tenant's `custom_domain` as QR URL target only when `custom_domain_verified` is truthy.
  - `client/src/pages/SuperAdminPage.tsx`: Applies dynamic platform branding CSS variables, loads venue details via `GET /api/super/restaurants/:id` on edit, supports `custom_domain_verified` verification toggles, and keeps Active Admins display scoped to count-only platform metrics.

## 3. Preserved Compatibility & Next Milestone Gate
- Legacy `/scan?table=X` and `/r/:slug/scan` QR routes remain operational and resolve through the unified `restaurants` table.
- Existing `DreamLand` (`rest_default`) and `Saffron Courtyard` (`rest_saffron`) configuration, menu items, UPI ID, and table configuration were migrated without data loss.
- **Status**: Milestone 1 is complete and verified; implementation stops here pending explicit user approval for Milestone 2.
