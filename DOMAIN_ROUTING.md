# Domain Routing Specification (Milestone 1)

## 1. Hostname Extraction & Classification (`server/src/db.js`)
Every incoming HTTP and WebSocket request passes through trusted server-side host normalization:
1. `extractHostname(hostHeader)` strips ports and lowercases the incoming `Host` header hostname.
2. `isPlatformHost(hostHeader)` checks whether the hostname belongs to configured platform hosts (including `localhost`, `127.0.0.1`, `[::1]`, or `QM_PLATFORM_DOMAINS`).
3. `normalizeCustomDomain(value)` normalizes admin/super-admin domain inputs for consistent storage and comparison.
4. `resolveRestaurantContext({ identifier, host })` combines the trusted request `Host` with optional route/query identifiers:
   - If `host` is a **custom domain** (`cleanHost && !isPlatformHost(cleanHost)`), SQLite looks up the unique matching row by normalized `custom_domain`.
   - If `host` matches no registered tenant, resolution fails with **unknown host** (`404 domain_not_found`).
   - If the matched tenant has `custom_domain_verified === 0` (or inactive venue), customer serving is denied (**403**).
   - If the client additionally supplies a route slug (`identifier`, e.g., `/r/:slug/scan` or `?restaurant=slug`) that disagrees with the custom-domain tenant, the server rejects the cross-tenant attempt (**403**).
   - If `host` is a **platform host**, slug/ID lookup proceeds against `restaurants` (`/scan` resolves the default tenant unless `/r/:slug/...` or `?restaurant=` specifies an active tenant).

## 2. Routing Behavior Matrix

| Request Scenario | Host Classification | Public API (`/api/public/context`, `/api/public/menu`) | Customer HTML (`/`, `/scan?table=X`, `/r/:slug/scan`) | Guest WebSocket (`role=guest`) |
|---|---|---|---|---|
| **Platform host** (`127.0.0.1`, `localhost`) + `/` | Platform | `200` (`mode: "platform"`) | `200` Platform Showcase SPA | `101` (resolves requested/default tenant) |
| **Platform host** + `/scan?table=4` | Platform | `200` (default tenant context) | `200` Customer Menu (`rest_default`) | `101` connected to `rest_default` |
| **Platform host** + `/r/saffron-courtyard/scan` | Platform | `200` (`Saffron Courtyard`) | `200` Customer Menu (`rest_saffron`) | `101` connected to `rest_saffron` |
| **Verified custom domain** (`menu.mirchi.local`) + `/` | Verified Tenant | `200` (`mode: "tenant"`, branded) | `200` SPA (redirects `/` -> `/scan`) | `101` connected strictly to tenant |
| **Verified custom domain** + mismatched `/r/tandoor-house/scan` or `?restaurant=tandoor-house` | Verified Tenant (Spoof) | `403` blocked | `403` blocked | Closed `4403` |
| **Unverified custom domain** (`custom_domain_verified = 0`) | Unverified Tenant | `403` blocked | `403` blocked | Closed `4403` |
| **Unknown hostname** (`unknown.brotocol.test`) | Unregistered | `404` (`code: "domain_not_found"`) | `404` (`Domain Not Found` HTML) | Closed `4404` |

## 3. Verified Runtime Probes (`http://127.0.0.1:4000`)
Raw TCP `http.request` probes (which send explicit `Host` headers without Fetch API header-stripping) confirmed against the live production server on `http://127.0.0.1:4000`:
- `GET /api/health` -> `200` (`{"ok":true,...}`)
- `GET /api/public/context` (`Host: 127.0.0.1:4000`) -> `200` (`mode: "platform"`)
- `GET /scan?table=4` (`Host: 127.0.0.1:4000`) -> `200` (`text/html`)
- `GET /r/saffron-courtyard/scan` (`Host: 127.0.0.1:4000`) -> `200` (`text/html`)
- `GET /` (`Host: unknown.brotocol.test`) -> `404` (`404 — Domain Not Found` HTML)
- `GET /scan?table=4` (`Host: unknown.brotocol.test`) -> `404` (`404 — Domain Not Found` HTML)
- `GET /api/public/context` (`Host: unknown.brotocol.test`) -> `404` (`code: "domain_not_found"`)
- `GET /api/public/menu` (`Host: unknown.brotocol.test`) -> `404` (`code: "domain_not_found"`)

*(Note on `Express` static serving: `express.static(clientDist, { index: false })` ensures root `/` requests pass through the hostname policy middleware rather than bypassing directly to static `index.html`.)*

## 4. Custom Domain Verification & QR Target Rules
- **Database constraint**: `CREATE UNIQUE INDEX idx_restaurants_custom_domain ON restaurants(LOWER(custom_domain)) WHERE custom_domain != ''` prevents duplicate domain assignment at the storage layer alongside `409` conflict validation on Super Admin and Tenant Admin update endpoints.
- **Verification ownership**: Only the BROTOCOL Super Admin can mark a domain verified (`custom_domain_verified = 1`). When a Tenant Admin changes `custom_domain` in `SettingsTab`, the server automatically resets `custom_domain_verified` to `0` (`Pending Verification`), preventing self-verification.
- **QR Code target selection (`QrTab.tsx`)**: Generated table QR codes use the tenant's `custom_domain` only when `custom_domain_verified` is true; otherwise they generate platform `/scan` or `/r/:slug/scan` URLs so printed QRs never point to unverified domains.
