# BROTOCOL ServeOS — White-Label Restaurant SaaS Platform

**BROTOCOL ServeOS** is a self-contained, single-origin, white-label multi-tenant SaaS platform designed strictly for restaurants, cafés, QSRs, bakeries, juice bars, and cloud kitchens. Built with React 19, TypeScript, Tailwind CSS, Node.js, Express 5, SQLite (`node:sqlite`), and WebSockets (`ws`), it operates without any external APIs, external font CDNs, or third-party cloud dependencies.

---

## Core Capabilities

### 1. Customer Experience (Zero App Install)
- **Dine-In QR Ordering (`/scan`, `/menu`, `/r/:slug/scan`, `/r/:slug/menu`)**: Table-bound QR scanning with category filters, Veg-only toggle, search, dish customization (size variants, add-ons, item notes), duplicate-submit idempotency, real-time kitchen tracker, optional 4-digit Table PIN security (`X-Table-Pin-Token`), Call Staff, Spin & Win, Loyalty Wallet, Feedback ratings, Coupon discounts, split-bill math, and UPI/Cash/Card payment submission.
- **Takeaway Ordering (`/menu?mode=takeaway` or Scan toggle)**: Frictionless pickup ordering requiring only guest Name and Phone (no signup), issuing a `PK-XXX` pickup token and keeping floor tables free.
- **Restaurant Self-Delivery**: Configurable per restaurant (`delivery_enabled`, flat `delivery_fee`, free-delivery threshold), capturing address + landmark and tracking live fulfillment (`Preparing` -> `Out for Delivery` -> `Delivered`) with restaurant staff—no third-party couriers.
- **Table Booking (`/reserve`, `/r/:slug/reserve`)**: Guests select date, time (validated against restaurant operating hours), party size, contact info, and requests; generates a `BK-XXXXXX` booking code for live status lookup.

### 2. Restaurant Operations (`/dashboard`, `/waiter`, `/kitchen`)
- **Owner / Admin Dashboard (`/dashboard`)**: Live `Overview`, `Floor` (table opening/closing/transferring/merging, Table PIN reset, payment settlement), `Orders` (Dine-In/Takeaway/Delivery channel badges, live order edits), `Bookings` (approve, decline, modify, assign table, mark seated), `Service calls`, `Menu`, `QR codes` (QuickMenu-style customizable QR frames, 9 palettes, PNG & ZIP bulk downloads, custom-domain aware), `Staff` (PIN shift lock & audit log), `Reports`, and `Settings` (operating hours, takeaway/delivery rules, white-label theme & domain).
- **Dedicated Waiter Panel (`/waiter`)**: Fast table & takeaway order entry with waiter attribution synced straight to kitchen and dashboard orders.
- **Kitchen Display System (`/kitchen`)**: Dark-mode kitchen ticket board with station tabs, elapsed timers, sound alerts, and one-tap progression (`Accept` -> `Preparing` -> `Ready for Pickup` / `Out for Delivery` / `Serve Ready` -> `Complete`).

### 3. Super Admin & Agency White-Label Control (`/super-admin`)
- **Platform Control Tower**: Provision restaurants (`Starter`, `Pro`, `Enterprise`), configure `plan_status` (`active`, `trial`, `paused`) and renewal dates, assign venue owners, toggle `white_label` attribution (`© Restaurant` vs `Powered by BROTOCOL ServeOS`), customize per-venue colors (`brand_bg`, `brand_accent`) and logos, configure HTTP `Host`-based `custom_domain` routing, manage **Agency Branding** defaults, monitor `Active Admins` count, and watch the cross-venue live feed.

---

## Project Structure

- `server/src/`
  - `index.js`: Express 5 REST API, SPA static fallback, security middleware, upload handling
  - `db.js`: SQLite schema (`node:sqlite` WAL mode), indexes, `custom_domain` Host tenant resolver, `platform_settings`
  - `auth.js`: `scrypt` password hashing, `qm_session` cookies, signed Table PIN tokens
  - `security.js`: Sliding-window login rate limiting, authoritative order line pricing, magic-byte upload checks, PIN & hours helpers
  - `services.js`: Multi-tenant views, reporting, platform overview
  - `ws.js`: Authenticated `guest` / `staff` / `super` real-time WebSocket broadcaster
  - `seed.js`: Local starter restaurants, menu items, staff, coupons, and seeded accounts
- `server/tests/e2e.test.mjs`: Automated API, WebSocket, PIN security, multi-channel ordering, reservation, waiter, custom-domain, and tenant-isolation test suite
- `client/src/`: React 19 + TypeScript + Tailwind v4 SPA (`pages/`, `components/`, `components/dashboard/`, `lib/`)

---

## Quick Start

```bash
# Install dependencies (if not already installed)
npm --prefix server install
npm --prefix client install

# Build production frontend bundle (client/dist)
npm run build

# Run automated backend, WebSocket & security E2E tests
npm test

# Start production single-origin server (http://127.0.0.1:4000)
npm start
```

Development mode (concurrent API + Vite dev server):

```bash
npm run dev
```

---

## Local Routes & Accounts Reference

- **Public Showcase:** `/`
- **Sign In:** `/auth`
- **Customer Flow:** `/scan?table=4`, `/menu?mode=takeaway`, `/reserve`, `/r/:slug/scan`, `/r/:slug/reserve`
- **Restaurant Staff:** `/dashboard`, `/waiter`, `/kitchen`
- **Platform Super Admin:** `/super-admin` (Super Admin ID: `ADMINCAS` / Password: `ADMINCAS@BROTOCOL2026`, or seeded restaurant owner `owner@qserve.local`)
