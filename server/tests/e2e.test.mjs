import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import {
  rollbackMigrationM1,
  rollbackMigrationM2,
  runMigrationM2,
  runMigrations,
  verifyMigrationM1,
  verifyMigrationM2,
} from "../src/migrations.js";
import {
  calculateBill,
  calculateDeliveryFee,
  calculateItemPricing,
  calculateOrderTotals,
} from "../../shared/billMath.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TEST_PORT = Number(process.env.TEST_PORT || 4097);
const TEST_DB = path.join(REPO_ROOT, "server", "data", `test-e2e-${process.pid}.db`);
const BASE = `http://127.0.0.1:${TEST_PORT}`;

function cleanupDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(`${TEST_DB}${suffix}`);
    } catch {
      // ignore missing files
    }
  }
}

cleanupDb();

const srv = spawn(process.execPath, [path.join(REPO_ROOT, "server", "src", "index.js")], {
  cwd: path.join(REPO_ROOT, "server"),
  env: {
    ...process.env,
    PORT: String(TEST_PORT),
    QM_DB_PATH: TEST_DB,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let srvLogs = "";
srv.stdout.on("data", (d) => (srvLogs += d.toString()));
srv.stderr.on("data", (d) => (srvLogs += d.toString()));

async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Test server failed to start:\n${srvLogs}`);
}

async function req(urlPath, { method = "GET", body, cookie, headers = {} } = {}) {
  const h = {
    ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...headers,
  };
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: h,
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  const nextCookie = setCookie ? setCookie.split(";")[0] : null;
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: nextCookie, headers: res.headers };
}

function hostHttpGet(urlPath, hostHeader, { method = "GET", body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: urlPath,
        method,
        headers: {
          Host: hostHeader,
          ...(payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, data: raw });
          }
        });
      }
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function connectWs(query, cookie, headers = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws?${query}`, {
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
    });
    const timer = setTimeout(() => resolve({ ws, opened: false, code: 0 }), 3000);
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === "connected") {
          clearTimeout(timer);
          resolve({ ws, opened: true, code: 1000 });
        }
      } catch {
        // ignore non-JSON frames
      }
    });
    ws.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ws, opened: false, code });
    });
    ws.on("error", () => {});
  });
}

try {
  await waitForServer();

  // 1. Agency & Public Platform check
  const plat = await req("/api/public/platform");
  assert.equal(plat.status, 200);
  assert.equal(plat.data.platform.platform_name, "Khao Piyo");

  // 2. Dine-In Customer Workflow + Authoritative Pricing + Duplicate Idempotency
  const menuRes = await req("/api/public/menu?table=4");
  assert.equal(menuRes.status, 200);
  const samosa = menuRes.data.items.find((i) => i.name.includes("Samosa"));
  const paneer = menuRes.data.items.find((i) => i.name.includes("Paneer"));
  assert.ok(samosa && paneer);

  const guestSession = "e2e-guest-sess-1";
  const reqId = "idemp-dinein-001";
  const order1 = await req("/api/public/orders", {
    method: "POST",
    body: {
      orderType: "dine_in",
      tableNumber: "4",
      sessionId: guestSession,
      clientRequestId: reqId,
      items: [{ itemId: samosa.id, quantity: 2, price: 1 }], // attempted client price tampering
    },
  });
  assert.equal(order1.status, 201);
  assert.equal(order1.data.order.total_amount, samosa.price * 2); // authoritative server price
  assert.equal(order1.data.order.order_type, "dine_in");
  assert.equal(order1.data.order.table_number, "4");

  const dupOrder = await req("/api/public/orders", {
    method: "POST",
    body: {
      orderType: "dine_in",
      tableNumber: "4",
      sessionId: guestSession,
      clientRequestId: reqId,
      items: [{ itemId: samosa.id, quantity: 2 }],
    },
  });
  assert.equal(dupOrder.status, 200);
  assert.equal(dupOrder.data.duplicate, true);
  assert.equal(dupOrder.data.order.id, order1.data.order.id);

  // 3. Super Admin Login (ADMINCAS) + WebSocket Auth Hardening
  const unauthWs = await connectWs("role=staff");
  assert.equal(unauthWs.opened, false);
  assert.equal(unauthWs.code, 4401);

  const superUnauthWs = await connectWs("role=super");
  assert.equal(superUnauthWs.opened, false);
  assert.equal(superUnauthWs.code, 4403);

  const superLogin = await req("/api/auth/login", {
    method: "POST",
    body: { email: "ADMINCAS", password: "ADMINCAS@BROTOCOL2026" },
  });
  assert.equal(superLogin.status, 200);
  assert.equal(superLogin.data.user.role, "super_admin");
  const superCookie = superLogin.cookie;
  assert.ok(superCookie);

  const superWs = await connectWs("role=super", superCookie);
  assert.equal(superWs.opened, true);
  superWs.ws.close();

  // 4. Venue Admin Login & Table PIN Enforcement
  const ownerLogin = await req("/api/auth/login", {
    method: "POST",
    body: { email: "owner@qserve.local", password: "QServe123!" },
  });
  assert.equal(ownerLogin.status, 200);
  const ownerCookie = ownerLogin.cookie;

  // Owner cannot connect to role=super WS or call /api/super/*
  const ownerSuperWs = await connectWs("role=super", ownerCookie);
  assert.equal(ownerSuperWs.opened, false);
  const ownerSuperApi = await req("/api/super/overview", { cookie: ownerCookie });
  assert.equal(ownerSuperApi.status, 403);

  // Enable PIN, Delivery & Hours on default restaurant
  const patchSet = await req("/api/admin/settings", {
    method: "PATCH",
    cookie: ownerCookie,
    body: {
      require_table_pin: true,
      takeaway_enabled: true,
      delivery_enabled: true,
      delivery_fee: 45,
      free_delivery_min: 500,
      opening_time: "09:00",
      closing_time: "23:00",
    },
  });
  assert.equal(patchSet.status, 200);
  assert.equal(patchSet.data.settings.delivery_enabled, true);

  const openT5 = await req("/api/admin/floor/5/open", { method: "POST", cookie: ownerCookie });
  assert.ok(openT5.status === 200 || openT5.status === 201);
  const t5Pin = openT5.data.seating?.table_pin;
  assert.match(t5Pin, /^\d{4}$/);

  // Attempt order on Table 5 WITHOUT pin token -> blocked (403)
  const bypassedOrder = await req("/api/public/orders", {
    method: "POST",
    body: {
      orderType: "dine_in",
      tableNumber: "5",
      sessionId: "pin-test-sess",
      items: [{ itemId: samosa.id, quantity: 1 }],
    },
  });
  assert.equal(bypassedOrder.status, 403);
  assert.equal(bypassedOrder.data.code, "pin_required");

  // Join with valid PIN -> obtain pinToken -> place order succeeds
  const joinT5 = await req("/api/public/seating/join", {
    method: "POST",
    body: { tableNumber: "5", pin: t5Pin },
  });
  assert.equal(joinT5.status, 200);
  assert.ok(joinT5.data.pinToken);

  const pinOrder = await req("/api/public/orders", {
    method: "POST",
    headers: { "X-Table-Pin-Token": joinT5.data.pinToken },
    body: {
      orderType: "dine_in",
      tableNumber: "5",
      sessionId: "pin-test-sess",
      items: [{ itemId: samosa.id, quantity: 1 }],
    },
  });
  assert.equal(pinOrder.status, 201);

  // Restore require_table_pin: false for general open tests
  await req("/api/admin/settings", {
    method: "PATCH",
    cookie: ownerCookie,
    body: { require_table_pin: false },
  });

  // 5. Takeaway Ordering Workflow
  const takeawayOrder = await req("/api/public/orders", {
    method: "POST",
    body: {
      orderType: "takeaway",
      customerName: "Rohan Sharma",
      customerPhone: "9876543210",
      sessionId: "takeaway-sess-1",
      items: [{ itemId: samosa.id, quantity: 2 }],
    },
  });
  assert.equal(takeawayOrder.status, 201);
  assert.equal(takeawayOrder.data.order.order_type, "takeaway");
  assert.match(takeawayOrder.data.order.pickup_token, /^PK-\d+$/);

  const readyTakeaway = await req(`/api/admin/orders/${takeawayOrder.data.order.id}/status`, {
    method: "PATCH",
    cookie: ownerCookie,
    body: { status: "ready" },
  });
  assert.equal(readyTakeaway.status, 200);
  assert.equal(readyTakeaway.data.order.status, "ready");

  // 6. Delivery Ordering Workflow
  const deliveryOrder = await req("/api/public/orders", {
    method: "POST",
    body: {
      orderType: "delivery",
      customerName: "Neha Verma",
      customerPhone: "9811223344",
      deliveryAddress: "Flat 402, Green Park Residency",
      deliveryLandmark: "Near Metro Gate 2",
      sessionId: "delivery-sess-1",
      items: [{ itemId: samosa.id, quantity: 2 }], // ₹120 < ₹500 free min => ₹45 delivery fee
    },
  });
  assert.equal(deliveryOrder.status, 201);
  assert.equal(deliveryOrder.data.order.order_type, "delivery");
  assert.equal(deliveryOrder.data.order.delivery_fee, 45);
  assert.equal(deliveryOrder.data.order.total_amount, samosa.price * 2 + 45);

  const outDel = await req(`/api/admin/orders/${deliveryOrder.data.order.id}/status`, {
    method: "PATCH",
    cookie: ownerCookie,
    body: { status: "ready" },
  });
  assert.equal(outDel.status, 200);
  assert.equal(outDel.data.order.delivery_status, "out_for_delivery");

  // 7. Table Booking / Reservations Workflow
  const badHour = await req("/api/public/reservations", {
    method: "POST",
    body: {
      customerName: "Late Guest",
      customerPhone: "9988776655",
      partySize: 2,
      reservationDate: new Date().toISOString().slice(0, 10),
      reservationTime: "02:30",
    },
  });
  assert.equal(badHour.status, 400);

  const bookRes = await req("/api/public/reservations", {
    method: "POST",
    body: {
      customerName: "Ananya Kapoor",
      customerPhone: "9988776655",
      partySize: 4,
      reservationDate: new Date().toISOString().slice(0, 10),
      reservationTime: "19:30",
      notes: "Window table",
    },
  });
  assert.equal(bookRes.status, 201);
  assert.match(bookRes.data.reservation.booking_code, /^BK-/);

  const approveRes = await req(`/api/admin/reservations/${bookRes.data.reservation.id}`, {
    method: "PATCH",
    cookie: ownerCookie,
    body: { status: "confirmed", assigned_table: "2" },
  });
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.data.reservation.status, "confirmed");
  assert.equal(approveRes.data.reservation.assigned_table, "2");

  const guestLookup = await req(
    `/api/public/reservations?code=${encodeURIComponent(bookRes.data.reservation.booking_code)}`
  );
  assert.equal(guestLookup.status, 200);
  assert.equal(guestLookup.data.reservations[0].status, "confirmed");

  // 8. Waiter Order-Taking Workflow
  const staffRes = await req("/api/admin/staff", { cookie: ownerCookie });
  assert.equal(staffRes.status, 200);
  const waiterStaff = staffRes.data.staff.find((s) => s.role === "waiter");
  assert.ok(waiterStaff);

  const waiterOrder = await req("/api/admin/orders", {
    method: "POST",
    cookie: ownerCookie,
    body: {
      orderType: "dine_in",
      tableNumber: "3",
      staffId: waiterStaff.id,
      note: "Extra crisp",
      items: [{ itemId: samosa.id, quantity: 3 }],
    },
  });
  assert.equal(waiterOrder.status, 201);
  assert.equal(waiterOrder.data.order.created_by_staff_id, waiterStaff.id);
  assert.equal(waiterOrder.data.order.created_by_staff_name, waiterStaff.name);
  assert.equal(waiterOrder.data.order.table_number, "3");

  // 9. Milestone 1: White-Label Client Creation, Custom Domain Host Routing, Verification, Branding & Isolation
  const mirchiCreate = await req("/api/super/restaurants", {
    method: "POST",
    cookie: superCookie,
    body: {
      name: "Mirchi Bistro",
      slug: "mirchi-bistro",
      plan: "Enterprise",
      plan_status: "trial",
      tables: 10,
      white_label: true,
      brand_bg: "#FFFDF7",
      primary_color: "#1B4332",
      secondary_color: "#95D5B2",
      custom_domain: "menu.mirchi.local",
      custom_domain_verified: false,
      ownerName: "Mirchi Owner",
      ownerEmail: "mirchi@bistro.local",
      ownerPassword: "MirchiPass2026!",
    },
  });
  assert.equal(mirchiCreate.status, 201);
  assert.equal(mirchiCreate.data.restaurant.custom_domain, "menu.mirchi.local");
  assert.equal(mirchiCreate.data.restaurant.custom_domain_verified, false);
  assert.equal(mirchiCreate.data.restaurant.white_label, true);
  assert.equal(mirchiCreate.data.restaurant.primary_color, "#1B4332");
  assert.equal(mirchiCreate.data.restaurant.secondary_color, "#95D5B2");

  // Unknown hostname MUST return 404 across API, HTML customer routes, and close WS!
  const unknownApi = await hostHttpGet("/api/public/menu", "unknown.brotocol.test");
  assert.equal(unknownApi.status, 404);
  assert.equal(unknownApi.data.code, "domain_not_found");
  const unknownCtx = await hostHttpGet("/api/public/context", "unknown.brotocol.test");
  assert.equal(unknownCtx.status, 404);
  const unknownHtml = await hostHttpGet("/scan?table=1", "unknown.brotocol.test");
  assert.equal(unknownHtml.status, 404);
  const unknownRootHtml = await hostHttpGet("/", "unknown.brotocol.test");
  assert.equal(unknownRootHtml.status, 404);
  const unknownWs = await connectWs("role=guest&table=1", null, { Host: "unknown.brotocol.test" });
  assert.equal(unknownWs.opened, false);
  assert.equal(unknownWs.code, 4404);

  // Unverified custom domain MUST NOT serve customer ordering pages (403)!
  const unverifiedApi = await hostHttpGet("/api/public/menu", "menu.mirchi.local");
  assert.equal(unverifiedApi.status, 403);
  assert.equal(unverifiedApi.data.code, "domain_unverified");
  const unverifiedHtml = await hostHttpGet("/scan?table=1", "menu.mirchi.local");
  assert.equal(unverifiedHtml.status, 403);
  const unverifiedWs = await connectWs("role=guest&table=1", null, { Host: "menu.mirchi.local" });
  assert.equal(unverifiedWs.opened, false);
  assert.equal(unverifiedWs.code, 4403);

  // Duplicate custom-domain rejection (Super Admin & Tenant Admin -> 409)!
  const dupSuperDomain = await req("/api/super/restaurants", {
    method: "POST",
    cookie: superCookie,
    body: {
      name: "Duplicate Domain Bistro",
      custom_domain: "menu.mirchi.local",
    },
  });
  assert.equal(dupSuperDomain.status, 409);
  assert.equal(dupSuperDomain.data.code, "duplicate_domain");

  const dupAdminDomain = await req("/api/admin/settings", {
    method: "PATCH",
    cookie: ownerCookie,
    body: { custom_domain: "menu.mirchi.local" },
  });
  assert.equal(dupAdminDomain.status, 409);
  assert.equal(dupAdminDomain.data.code, "duplicate_domain");

  // Super Admin verifies menu.mirchi.local -> custom domain goes live cleanly!
  const verifyDomain = await req(`/api/super/restaurants/${mirchiCreate.data.restaurant.id}`, {
    method: "PATCH",
    cookie: superCookie,
    body: { custom_domain_verified: true },
  });
  assert.equal(verifyDomain.status, 200);
  assert.equal(verifyDomain.data.restaurant.custom_domain_verified, true);

  const hostResolve = await hostHttpGet("/api/public/menu", "menu.mirchi.local");
  assert.equal(hostResolve.status, 200);
  assert.equal(hostResolve.data.settings.name, "Mirchi Bistro");
  assert.equal(hostResolve.data.settings.brand_accent, "#1B4332");
  assert.equal(hostResolve.data.settings.secondary_color, "#95D5B2");

  const hostContext = await hostHttpGet("/api/public/context", "menu.mirchi.local");
  assert.equal(hostContext.status, 200);
  assert.equal(hostContext.data.mode, "tenant");
  assert.equal(hostContext.data.tenant.name, "Mirchi Bistro");

  // On verified custom domain, /api/public/venues MUST return ONLY Mirchi Bistro (no sibling leak!)
  const hostVenues = await hostHttpGet("/api/public/venues", "menu.mirchi.local");
  assert.equal(hostVenues.status, 200);
  assert.equal(hostVenues.data.venues.length, 1);
  assert.equal(hostVenues.data.venues[0].id, mirchiCreate.data.restaurant.id);

  // Cross-tenant query/slug spoofing on custom domain MUST be blocked (403)!
  const spoofQuery = await hostHttpGet("/api/public/menu?restaurant=tandoor-house", "menu.mirchi.local");
  assert.equal(spoofQuery.status, 403);
  assert.equal(spoofQuery.data.code, "cross_tenant_forbidden");
  const spoofSlugHtml = await hostHttpGet("/r/tandoor-house/scan?table=1", "menu.mirchi.local");
  assert.equal(spoofSlugHtml.status, 403);

  // Cannot cancel Tenant A's order from Tenant B's custom domain!
  const crossCancel = await hostHttpGet(`/api/public/orders/${order1.data.order.id}/cancel`, "menu.mirchi.local", {
    method: "POST",
    body: { sessionId: guestSession },
  });
  assert.equal(crossCancel.status, 404);

  // Cannot log in as Tenant A admin via Tenant B's verified custom domain!
  const crossDomainLogin = await hostHttpGet("/api/auth/login", "menu.mirchi.local", {
    method: "POST",
    body: { email: "owner@qserve.local", password: "QServe123!" },
  });
  assert.equal(crossDomainLogin.status, 403);
  assert.equal(crossDomainLogin.data.code, "cross_tenant_forbidden");

  // Preserved Legacy QR URL Compatibility checks (/scan?table=4 & /r/saffron-courtyard/scan)
  const legacyScanHtml = await req("/scan?table=4");
  assert.equal(legacyScanHtml.status, 200);
  const legacySlugScanHtml = await req("/r/saffron-courtyard/scan?table=1");
  assert.equal(legacySlugScanHtml.status, 200);
  const legacyTableStatus = await req("/api/public/table-status?table=4");
  assert.equal(legacyTableStatus.status, 200);
  assert.equal(legacyTableStatus.data.restaurant.slug, "tandoor-house");
  const saffronMenu = await req("/api/public/menu?restaurant=saffron-courtyard");
  assert.equal(saffronMenu.status, 200);
  assert.equal(saffronMenu.data.settings.name, "Saffron Courtyard");

  // Mirchi admin cannot see or mutate Tandoor House order!
  const mirchiLogin = await req("/api/auth/login", {
    method: "POST",
    body: { email: "mirchi@bistro.local", password: "MirchiPass2026!" },
  });
  assert.equal(mirchiLogin.status, 200);
  const mirchiOrders = await req("/api/admin/orders", { cookie: mirchiLogin.cookie });
  assert.equal(mirchiOrders.status, 200);
  assert.equal(mirchiOrders.data.orders.length, 0);
  const crossEdit = await req(`/api/admin/orders/${order1.data.order.id}/status`, {
    method: "PATCH",
    cookie: mirchiLogin.cookie,
    body: { status: "cancelled" },
  });
  assert.equal(crossEdit.status, 404);

  // Tenant Admin updating custom_domain resets custom_domain_verified to false (cannot self-verify!)
  const selfDomainPatch = await req("/api/admin/settings", {
    method: "PATCH",
    cookie: mirchiLogin.cookie,
    body: { custom_domain: "new-unverified.mirchi.local", secondary_color: "#A3B18A" },
  });
  assert.equal(selfDomainPatch.status, 200);
  assert.equal(selfDomainPatch.data.settings.custom_domain, "new-unverified.mirchi.local");
  assert.equal(selfDomainPatch.data.settings.custom_domain_verified, false);
  assert.equal(selfDomainPatch.data.settings.secondary_color, "#A3B18A");

  // 10. Super Admin /api/super/overview PII Cleanup + Agency Branding Update
  const overviewRes = await req("/api/super/overview", { cookie: superCookie });
  assert.equal(overviewRes.status, 200);
  assert.equal("admins" in overviewRes.data, false, "Overview must not expose admin roster PII");
  assert.equal(typeof overviewRes.data.stats.activeAdmins, "number");
  assert.equal(typeof overviewRes.data.stats.pausedVenues, "number");
  for (const v of overviewRes.data.venues) {
    assert.equal("wifi_password" in v, false, "Overview must not expose tenant WiFi password");
    assert.equal("upi_id" in v, false, "Overview must not expose tenant UPI ID");
  }
  const singleVenue = await req(`/api/super/restaurants/${mirchiCreate.data.restaurant.id}`, {
    cookie: superCookie,
  });
  assert.equal(singleVenue.status, 200);
  assert.equal(singleVenue.data.restaurant.name, "Mirchi Bistro");

  const agencyPatch = await req("/api/super/platform", {
    method: "PATCH",
    cookie: superCookie,
    body: { agency_name: "BROTOCOL Reseller", default_brand_secondary: "#6B4F43" },
  });
  assert.equal(agencyPatch.status, 200);
  assert.equal(agencyPatch.data.platform.agency_name, "BROTOCOL Reseller");
  assert.equal(agencyPatch.data.platform.default_brand_secondary, "#6B4F43");

  // 11. Migration & Rollback Correctness Test (legacy restaurant_settings -> restaurants)
  const legacyDb = new DatabaseSync(":memory:");
  legacyDb.exec(`
    CREATE TABLE platform_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      platform_name TEXT NOT NULL DEFAULT 'BROTOCOL ServeOS',
      agency_name TEXT NOT NULL DEFAULT 'BROTOCOL',
      agency_tagline TEXT NOT NULL DEFAULT '',
      support_email TEXT NOT NULL DEFAULT '',
      default_brand_bg TEXT NOT NULL DEFAULT '#FAF8F5',
      default_brand_accent TEXT NOT NULL DEFAULT '#49332A',
      pin_hmac_secret TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE restaurants (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      logo_url TEXT,
      cover_url TEXT,
      orders_enabled INTEGER NOT NULL DEFAULT 1,
      waiter_call_enabled INTEGER NOT NULL DEFAULT 1,
      qr_mode TEXT NOT NULL DEFAULT 'per_table',
      table_config TEXT NOT NULL DEFAULT '{"total":12,"skip":[],"disabled":[]}',
      menu_views INTEGER NOT NULL DEFAULT 0,
      upi_id TEXT NOT NULL DEFAULT '',
      gst_rate REAL NOT NULL DEFAULT 5,
      service_charge_pct REAL NOT NULL DEFAULT 0,
      require_table_pin INTEGER NOT NULL DEFAULT 0,
      loyalty_config TEXT NOT NULL DEFAULT '{}',
      spin_prizes TEXT NOT NULL DEFAULT '[]',
      social_links TEXT NOT NULL DEFAULT '{}',
      wifi_ssid TEXT NOT NULL DEFAULT '',
      wifi_password TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE restaurant_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      logo_url TEXT,
      cover_url TEXT,
      orders_enabled INTEGER NOT NULL DEFAULT 1,
      waiter_call_enabled INTEGER NOT NULL DEFAULT 1,
      qr_mode TEXT NOT NULL DEFAULT 'per_table',
      table_config TEXT NOT NULL DEFAULT '{"total":7,"skip":[],"disabled":[]}',
      menu_views INTEGER NOT NULL DEFAULT 19,
      updated_at TEXT NOT NULL,
      upi_id TEXT NOT NULL DEFAULT 'legacy@upi',
      gst_rate REAL NOT NULL DEFAULT 5,
      service_charge_pct REAL NOT NULL DEFAULT 0,
      require_table_pin INTEGER NOT NULL DEFAULT 0,
      loyalty_config TEXT NOT NULL DEFAULT '{}',
      spin_prizes TEXT NOT NULL DEFAULT '[]',
      social_links TEXT NOT NULL DEFAULT '{}',
      wifi_ssid TEXT NOT NULL DEFAULT 'GuestWiFi',
      wifi_password TEXT NOT NULL DEFAULT 'pass123'
    );
    INSERT INTO restaurant_settings (id, name, description, table_config, menu_views, updated_at, upi_id, wifi_ssid, wifi_password)
    VALUES (1, 'Legacy Grand Hotel', 'Fine dining', '{"total":18,"skip":[],"disabled":[]}', 42, '2026-11-20T00:00:00.000Z', 'legacyhotel@okaxis', 'HotelWiFi', 'room123');
  `);
  const migRes = runMigrations(legacyDb, { runM2: false });
  assert.equal(migRes.version, 1);
  assert.equal(migRes.hasLegacyTable, false);
  assert.equal(migRes.hasUniqueDomainIndex, true);
  assert.equal(migRes.defaultTenant.name, "Legacy Grand Hotel");
  assert.equal(migRes.defaultTenant.upi_id, "legacyhotel@okaxis");
  assert.equal(migRes.defaultTenant.menu_views, 42);
  assert.equal(migRes.defaultTenant.table_config, '{"total":18,"skip":[],"disabled":[]}');

  // Verify DB-level unique constraint blocks duplicate custom domains
  legacyDb.prepare("UPDATE restaurants SET custom_domain = 'hotel1.local' WHERE id = 'rest_default'").run();
  legacyDb.prepare("INSERT INTO restaurants (id, slug, name, custom_domain, created_at, updated_at) VALUES ('r2', 'r2', 'R2', '', '2026-11-20', '2026-11-20')").run();
  assert.throws(() => {
    legacyDb.prepare("UPDATE restaurants SET custom_domain = 'HOTEL1.local' WHERE id = 'r2'").run();
  });

  // Test Rollback -> restores restaurant_settings with full data cleanly!
  const rbRes = rollbackMigrationM1(legacyDb);
  assert.equal(rbRes.version, 0);
  assert.equal(rbRes.hasLegacyTable, true);
  assert.equal(rbRes.hasUniqueDomainIndex, false);
  const restored = legacyDb.prepare("SELECT * FROM restaurant_settings WHERE id = 1").get();
  assert.equal(restored.name, "Legacy Grand Hotel");
  assert.equal(restored.upi_id, "legacyhotel@okaxis");
  assert.equal(restored.menu_views, 42);

  // Re-run forward migration idempotently cleanly
  legacyDb.prepare("UPDATE restaurants SET custom_domain = '' WHERE id = 'r2'").run();
  const reMig = runMigrations(legacyDb, { runM2: false });
  assert.equal(reMig.version, 1);
  assert.equal(reMig.hasLegacyTable, false);
  legacyDb.close();

  // 12. Milestone 2: Shared billMath, Normalized order_items, Historical Price Snapshot, service_units, FKs, Audit Logs & M2 Migration/Rollback
  // 12a. Shared billMath.js unit & rounding verification
  const itemPriceCheck = calculateItemPricing({
    basePrice: 240,
    addons: [{ name: "Extra Cheese", price: 35 }],
    quantity: 2,
  });
  assert.equal(itemPriceCheck.base_unit_price, 240);
  assert.equal(itemPriceCheck.addons_unit_total, 35);
  assert.equal(itemPriceCheck.unit_price, 275);
  assert.equal(itemPriceCheck.line_total, 550);

  assert.equal(calculateDeliveryFee(499, { orderType: "delivery", deliveryFee: 40, freeDeliveryMin: 500 }), 40);
  assert.equal(calculateDeliveryFee(500, { orderType: "delivery", deliveryFee: 40, freeDeliveryMin: 500 }), 0);
  assert.equal(calculateDeliveryFee(200, { orderType: "dine_in", deliveryFee: 40, freeDeliveryMin: 500 }), 0);

  const orderTotalsCheck = calculateOrderTotals(
    [{ price: 275, quantity: 2 }],
    { orderType: "delivery", deliveryFee: 40, freeDeliveryMin: 600 }
  );
  assert.equal(orderTotalsCheck.subtotal, 550);
  assert.equal(orderTotalsCheck.delivery_fee, 40);
  assert.equal(orderTotalsCheck.total_amount, 590);

  const billRoundCheck = calculateBill(
    [{ status: "accepted", items: [{ price: 103, quantity: 1 }] }],
    { discount: { kind: "pct", value: 10, min_bill: 50 }, gstRate: 5, servicePct: 10 }
  );
  // 103 - 10% (10.30) = 92.70 -> +10% service (9.27) = 101.97 -> +5% GST (5.10) = 107.07 -> rounded rupee = 107
  assert.equal(billRoundCheck.subtotal, 103);
  assert.equal(billRoundCheck.discount, 10.3);
  assert.equal(billRoundCheck.service, 9.27);
  assert.equal(billRoundCheck.gst, 5.1);
  assert.equal(billRoundCheck.total, 107);

  // 12b. Historical Order Price & Name Preservation when menu item is repriced, renamed & deleted
  const tempMenuCat = await req("/api/public/menu");
  const firstCatId = tempMenuCat.data.categories[0]?.id;
  assert.ok(firstCatId);

  const createdTempDish = await req("/api/admin/items", {
    method: "POST",
    cookie: ownerCookie,
    body: {
      name: "Heritage Truffle Kulcha",
      price: 190,
      category_id: firstCatId,
      is_veg: 1,
      addons: [{ name: "Butter Glaze", price: 25 }],
    },
  });
  assert.equal(createdTempDish.status, 201);
  const tempDishId = createdTempDish.data.item.id;

  const snapOrderRes = await req("/api/public/orders", {
    method: "POST",
    body: {
      tableNumber: "4",
      sessionId: "sess-m2-snap",
      clientRequestId: "req-m2-snap-1",
      items: [{ itemId: tempDishId, quantity: 2, addons: ["Butter Glaze"] }],
    },
  });
  assert.equal(snapOrderRes.status, 201);
  assert.equal(snapOrderRes.data.order.total_amount, 430); // (190 + 25) * 2
  assert.ok(snapOrderRes.data.order.service_unit_id);
  const snapOrderId = snapOrderRes.data.order.id;

  // Rename + reprice menu item
  const repriceRes = await req(`/api/admin/items/${tempDishId}`, {
    method: "PATCH",
    cookie: ownerCookie,
    body: { name: "Renamed Expensive Kulcha", price: 999 },
  });
  assert.equal(repriceRes.status, 200);

  // Delete menu item completely (triggers ON DELETE SET NULL on order_items.menu_item_id)
  const delDishRes = await req(`/api/admin/items/${tempDishId}`, {
    method: "DELETE",
    cookie: ownerCookie,
  });
  assert.equal(delDishRes.status, 200);

  const adminOrdersAfterDel = await req("/api/admin/orders", { cookie: ownerCookie });
  assert.equal(adminOrdersAfterDel.status, 200);
  const preservedOrder = adminOrdersAfterDel.data.orders.find((o) => o.id === snapOrderId);
  assert.ok(preservedOrder);
  assert.equal(preservedOrder.total_amount, 430);
  assert.equal(preservedOrder.items[0].name, "Heritage Truffle Kulcha");
  assert.equal(preservedOrder.items[0].price, 215);
  assert.equal(preservedOrder.items[0].base_unit_price, 190);
  assert.equal(preservedOrder.items[0].addons_unit_total, 25);
  assert.equal(preservedOrder.items[0].menu_item_id, null);

  // 12c. Platform Audit Logs verification (actor, action, target, safe metadata, no secrets/PII)
  const ownerBlockedAudit = await req("/api/super/audit-logs", { cookie: ownerCookie });
  assert.equal(ownerBlockedAudit.status, 403);

  const auditRes = await req("/api/super/audit-logs?limit=50", { cookie: superCookie });
  assert.equal(auditRes.status, 200);
  const auditActions = new Set(auditRes.data.logs.map((l) => l.action));
  assert.ok(auditActions.has("restaurant.created"));
  assert.ok(auditActions.has("restaurant.updated"));
  assert.ok(auditActions.has("domain.verification_changed"));
  assert.ok(auditActions.has("platform.config_updated"));
  const auditRaw = JSON.stringify(auditRes.data.logs);
  assert.equal(auditRaw.includes("MirchiPass123!"), false);
  assert.equal(auditRaw.includes("ADMINCAS@BROTOCOL2026"), false);

  // 12d. M2 Migration & Rollback Correctness Test (with orphan cleanup + FK enforcement)
  const m2Db = new DatabaseSync(":memory:");
  m2Db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE restaurants (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, table_config TEXT NOT NULL DEFAULT '{"total":6,"skip":[],"disabled":[]}', gst_rate REAL NOT NULL DEFAULT 5, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', restaurant_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, active_restaurant_id TEXT, expires_at TEXT NOT NULL);
    CREATE TABLE categories (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, name TEXT NOT NULL, station TEXT NOT NULL DEFAULT '', display_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE menu_items (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, category_id TEXT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price REAL NOT NULL, image_url TEXT, is_veg INTEGER NOT NULL DEFAULT 1, is_bestseller INTEGER NOT NULL DEFAULT 0, is_chef_special INTEGER NOT NULL DEFAULT 0, is_available INTEGER NOT NULL DEFAULT 1, prep_minutes INTEGER NOT NULL DEFAULT 10, size_variants TEXT NOT NULL DEFAULT '[]', addons TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);
    CREATE TABLE reservations (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, booking_code TEXT NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, party_size INTEGER NOT NULL DEFAULT 2, reservation_date TEXT NOT NULL, reservation_time TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', assigned_table TEXT, notes TEXT NOT NULL DEFAULT '', admin_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE table_states (restaurant_id TEXT NOT NULL, table_number TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'free', section TEXT NOT NULL DEFAULT '', activated_by TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (restaurant_id, table_number));
    CREATE TABLE table_seatings (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, table_number TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', table_pin TEXT, pin_tries INTEGER NOT NULL DEFAULT 0, opened_by TEXT, merged_into TEXT, discount_json TEXT, spin_json TEXT, guest_phone TEXT, loyalty_awarded INTEGER NOT NULL DEFAULT 0, close_note TEXT, opened_at TEXT NOT NULL, closed_at TEXT);
    CREATE TABLE orders (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, order_number TEXT NOT NULL, seq_num INTEGER NOT NULL, order_type TEXT NOT NULL DEFAULT 'dine_in', table_number TEXT NOT NULL, pickup_token TEXT, customer_name TEXT, customer_phone TEXT, delivery_address TEXT, delivery_landmark TEXT, delivery_fee REAL NOT NULL DEFAULT 0, delivery_status TEXT, created_by_staff_id TEXT, created_by_staff_name TEXT, client_session_id TEXT NOT NULL, seating_id TEXT, items TEXT NOT NULL, note TEXT, total_amount REAL NOT NULL, status TEXT NOT NULL, timeline TEXT NOT NULL, idempotency_key TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE service_calls (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, table_number TEXT NOT NULL, call_type TEXT NOT NULL, status TEXT NOT NULL, acknowledged_by TEXT, acknowledged_at TEXT, completed_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE payments (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, seating_id TEXT NOT NULL, table_number TEXT NOT NULL, payer TEXT NOT NULL DEFAULT '', amount REAL NOT NULL, tip REAL NOT NULL DEFAULT 0, mode TEXT NOT NULL, split_type TEXT NOT NULL DEFAULT 'full', status TEXT NOT NULL DEFAULT 'pending', handled_by TEXT, created_at TEXT NOT NULL, settled_at TEXT);
    CREATE TABLE coupons (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, code TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'pct', value REAL NOT NULL, min_bill REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE loyalty_accounts (restaurant_id TEXT NOT NULL, phone TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0, total_spent REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (restaurant_id, phone));
    CREATE TABLE staff (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, pin TEXT, section TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE activity_log (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, staff_name TEXT NOT NULL, action TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE TABLE feedback (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, order_id TEXT NOT NULL, seating_id TEXT, table_number TEXT NOT NULL, rating INTEGER NOT NULL, comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);

    INSERT INTO restaurants (id, slug, name, gst_rate, created_at, updated_at) VALUES ('r1', 'r1', 'Bistro One', 5, '2026-11-25', '2026-11-25');
    INSERT INTO menu_items (id, restaurant_id, category_id, name, price, created_at) VALUES ('m1', 'r1', 'orphan-cat', 'Legacy Chaat', 120, '2026-11-25');
    INSERT INTO orders (id, restaurant_id, order_number, seq_num, table_number, client_session_id, items, total_amount, status, timeline, created_at, updated_at)
    VALUES ('o1', 'r1', '#1', 1, '3', 's1', '[{"id":"m1","name":"Legacy Chaat","price":120,"quantity":2,"addons":[{"name":"Sev","price":20}],"selectedSize":"Regular","station":"Chaat"}]', 240, 'completed', '{}', '2026-11-25', '2026-11-25');
  `);
  const m2Res = runMigrationM2(m2Db);
  assert.equal(m2Res.version, 2);
  assert.equal(m2Res.hasOrderItemsTable, true);
  assert.equal(m2Res.hasServiceUnitsTable, true);
  assert.equal(m2Res.hasPlatformAuditLogsTable, true);
  assert.equal(m2Res.fkViolationsCount, 0);
  assert.ok(m2Res.ordersFkCount >= 3);
  assert.equal(m2Res.orderItemsCount, 1);

  const migratedMenu = m2Db.prepare("SELECT category_id FROM menu_items WHERE id = 'm1'").get();
  assert.equal(migratedMenu.category_id, null);

  // DB-level FK enforcement check
  assert.throws(() => {
    m2Db.prepare(
      "INSERT INTO order_items (id, restaurant_id, order_id, menu_item_id, item_name_snapshot, base_unit_price, unit_price_snapshot, quantity, line_total, created_at) VALUES ('bad', 'r1', 'nonexistent-order', null, 'X', 10, 10, 1, 10, '2026-11-26')"
    ).run();
  });

  // Test Rollback M2 -> restores clean state with orders.items preserved
  const rb2 = rollbackMigrationM2(m2Db);
  assert.equal(rb2.version, 0);
  assert.equal(rb2.hasOrderItemsTable, false);
  assert.equal(rb2.hasServiceUnitsTable, false);
  const ordAfterRb = m2Db.prepare("SELECT items FROM orders WHERE id = 'o1'").get();
  assert.ok(JSON.parse(ordAfterRb.items)[0].name === "Legacy Chaat");

  // Re-run M2 migration idempotently cleanly
  const reM2 = runMigrationM2(m2Db);
  assert.equal(reM2.version, 2);
  assert.equal(reM2.fkViolationsCount, 0);
  m2Db.close();

  // 12e. Super Admin Analytics & API Security Hardening Checks
  const superAnalytics = await req("/api/super/overview", { cookie: superCookie });
  assert.equal(superAnalytics.status, 200);
  assert.equal(superAnalytics.data.monthlyStats.length, 6);
  assert.equal(superAnalytics.data.orderTypeBreakdown.length, 3);

  // Security checks: unauthenticated protected routes -> 401, unknown API -> 404, CSRF origin mismatch -> 403, security headers present
  const unauthAdmin = await req("/api/admin/overview");
  assert.equal(unauthAdmin.status, 401);
  const unauthSuper = await req("/api/super/overview");
  assert.equal(unauthSuper.status, 401);
  const unknownApiEndpoint = await req("/api/does-not-exist");
  assert.equal(unknownApiEndpoint.status, 404);

  const csrfBlocked = await fetch(`${BASE}/api/admin/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: ownerCookie,
      Origin: "https://evil.example.com",
    },
    body: JSON.stringify({ name: "Hijacked" }),
  });
  assert.equal(csrfBlocked.status, 403);

  const hdrCheck = await fetch(`${BASE}/api/health`);
  assert.equal(hdrCheck.headers.get("x-content-type-options"), "nosniff");
  assert.equal(hdrCheck.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.ok(hdrCheck.headers.get("content-security-policy"));
  assert.equal(hdrCheck.headers.get("x-powered-by"), null);

  const fakeUploadForm = new FormData();
  fakeUploadForm.append(
    "file",
    new Blob(["this is plain text pretending to be jpeg"], { type: "image/jpeg" }),
    "spoof.jpg"
  );
  const badUpload = await req("/api/admin/upload", {
    method: "POST",
    cookie: ownerCookie,
    body: fakeUploadForm,
  });
  assert.equal(badUpload.status, 400);

  const distAssetsDir = path.join(REPO_ROOT, "client", "dist", "assets");
  if (fs.existsSync(distAssetsDir)) {
    const jsFiles = fs.readdirSync(distAssetsDir).filter((f) => f.endsWith(".js"));
    for (const jf of jsFiles) {
      const content = fs.readFileSync(path.join(distAssetsDir, jf), "utf8");
      assert.equal(content.includes("ADMINCAS@BROTOCOL2026"), false, `${jf} exposes Super Admin password`);
      assert.equal(content.includes("QServe123!"), false, `${jf} exposes owner password`);
      assert.equal(content.includes("SuperQServe123!"), false, `${jf} exposes super password`);
    }
  }

  console.log("ALL_BROTOCOL_SERVEOS_TESTS_PASSED");
} finally {
  try {
    srv.kill();
  } catch {
    // ignore
  }
  await new Promise((r) => setTimeout(r, 250));
  cleanupDb();
}
