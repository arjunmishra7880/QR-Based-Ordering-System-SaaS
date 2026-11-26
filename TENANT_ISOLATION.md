# Tenant Isolation & Security Architecture (Milestone 1)

## 1. Authoritative Tenant Boundary
Tenant resolution never trusts arbitrary client-supplied restaurant IDs when a custom domain is active or when an authenticated session is scoped to a single venue:
1. **Custom Domain Binding**: All public API endpoints (`/api/public/context`, `/api/public/menu`, `/api/public/venues`, `/api/public/orders/:id/cancel`), public SPA pages, auth endpoints (`/api/auth/login`), and WebSocket upgrades (`server/src/ws.js`) consult `resolveRestaurantContext({ identifier, host })` derived from the HTTP `Host` header.
2. **No Cross-Tenant Enumeration on White-Label Domains**:
   - Calling `GET /api/public/venues` on a verified custom domain returns **only** that single matched venue (`venues.length === 1`), preventing discovery of sibling venues on the shared SaaS backend.
   - `LandingPage.tsx` checks `GET /api/public/context` before fetching `/api/public/venues`, and redirects custom-domain visitors directly from `/` to `/scan`.
3. **Cross-Tenant Spoofing Prevention**:
   - Supplying `?restaurant=other-slug` or `/r/other-slug/scan` while hitting a tenant's verified custom domain returns HTTP `403` (and closes WebSockets with code `4403`).
   - Cancelling Tenant A's order ID (`POST /api/public/orders/:id/cancel`) from Tenant B's custom domain returns `403` / is rejected.
   - Logging in as Tenant A's admin via Tenant B's verified custom domain (`POST /api/auth/login`) returns `403`.
4. **Role & Session Isolation**:
   - Venue Owner / Staff accounts are bound to their `restaurant_id`; cross-venue mutations (orders, settings, menu) and Super Admin WebSocket/API calls (`/api/super/*`, `role=super`) are blocked with `403`.
   - `buildPlatformOverview()` (`GET /api/super/overview` in `server/src/services.js`) no longer returns sensitive per-tenant secrets (`wifi_ssid`, `wifi_password`, `upi_id`), guest config internals (`loyalty`, `spin_prizes`, `social_links`), raw `activity_log.details`, or the full `admins` PII roster array—aligning with the privacy requirement to expose aggregate Active Admin counts rather than exposing admin table details.

## 2. White-Label Visual Isolation (Theme Tokens)
Hardcoded brand hex defaults (`#49332A` / `#FAF8F5`) in `BrandMark.tsx`, `DashboardPage.tsx`, and `KitchenPage.tsx` were replaced with CSS custom properties (`--qm-primary`, `--qm-primary-hover`, `--qm-primary-ink`, `--qm-secondary`, `--qm-secondary-ink`, and background tokens) configured via `buildVenueThemeStyle`. Each venue configures independent `name`, `logo_url`, `cover_url`, `brand_bg`, `primary_color` (`brand_accent`), and `secondary_color` (`brand_secondary`), preventing another tenant's or BROTOCOL's colors/branding from bleeding into white-label customer views.

## 3. Data Integrity & Verification Controls
- **No Conflicting Source of Truth**: Legacy `restaurant_settings` has been consolidated into `restaurants` and dropped after migration, eliminating divergence between `restaurant_settings` and `restaurants`.
- **Self-Verification Blocked**: Tenant Admins cannot flip `custom_domain_verified` to `1`; editing `custom_domain` on the tenant side resets `custom_domain_verified = 0` until verified by Super Admin (`ADMINCAS`).
- **Database Uniqueness**: Duplicate `custom_domain` writes are rejected at both the API layer (`409`) and SQLite index layer (`idx_restaurants_custom_domain`).
