import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { runMigrations, syncServiceUnitsInDb } from "./migrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(SERVER_ROOT, "data");
export const UPLOADS_DIR = path.join(SERVER_ROOT, "uploads");

export const DEFAULT_RESTAURANT_ID = "rest_default";
export const DEFAULT_RESTAURANT_SLUG = "tandoor-house";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const dbPath = process.env.QM_DB_PATH || path.join(DATA_DIR, "quickmenu.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

export const DEFAULT_LOYALTY = {
  enabled: true,
  rupees_per_point: 10,
  goal: 200,
  reward: "Free Dessert",
};

export const DEFAULT_SPIN_PRIZES = [
  { label: "10% Off", kind: "pct", value: 10 },
  { label: "₹50 Off", kind: "flat", value: 50 },
  { label: "Free Chai", kind: "item" },
  { label: "Better Luck", kind: "none" },
];

export const DEFAULT_QR_STYLE = {
  style: "standard",
  fgColor: "#000000",
  bgColor: "#FFFFFF",
  dotScale: 0.85,
  frameStyle: "rounded",
};

db.exec(`
  CREATE TABLE IF NOT EXISTS platform_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    platform_name TEXT NOT NULL DEFAULT 'Khao Piyo',
    agency_name TEXT NOT NULL DEFAULT 'BROTOCOL',
    agency_tagline TEXT NOT NULL DEFAULT 'White-Label Restaurant QR Menu, Ordering & Kitchen Operations SaaS',
    support_email TEXT NOT NULL DEFAULT 'support@brotocol.local',
    default_brand_bg TEXT NOT NULL DEFAULT '#FAF8F5',
    default_brand_accent TEXT NOT NULL DEFAULT '#49332A',
    default_brand_secondary TEXT NOT NULL DEFAULT '#766158',
    pin_hmac_secret TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
    booking_code TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    party_size INTEGER NOT NULL DEFAULT 2,
    reservation_date TEXT NOT NULL,
    reservation_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    assigned_table TEXT,
    notes TEXT NOT NULL DEFAULT '',
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS restaurants (
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
    qr_style TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_QR_STYLE)}',
    menu_views INTEGER NOT NULL DEFAULT 0,
    upi_id TEXT NOT NULL DEFAULT '',
    gst_rate REAL NOT NULL DEFAULT 5,
    service_charge_pct REAL NOT NULL DEFAULT 0,
    require_table_pin INTEGER NOT NULL DEFAULT 0,
    loyalty_config TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_LOYALTY)}',
    spin_prizes TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_SPIN_PRIZES)}',
    social_links TEXT NOT NULL DEFAULT '{}',
    wifi_ssid TEXT NOT NULL DEFAULT '',
    wifi_password TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL DEFAULT 'Pro',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    restaurant_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active_restaurant_id TEXT,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
    name TEXT NOT NULL,
    station TEXT NOT NULL DEFAULT '',
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL,
    image_url TEXT,
    is_veg INTEGER NOT NULL DEFAULT 1,
    is_bestseller INTEGER NOT NULL DEFAULT 0,
    is_chef_special INTEGER NOT NULL DEFAULT 0,
    is_available INTEGER NOT NULL DEFAULT 1,
    prep_minutes INTEGER NOT NULL DEFAULT 10,
    size_variants TEXT NOT NULL DEFAULT '[]',
    addons TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
    order_number TEXT NOT NULL,
    seq_num INTEGER NOT NULL,
    table_number TEXT NOT NULL,
    client_session_id TEXT NOT NULL,
    seating_id TEXT,
    items TEXT NOT NULL,
    note TEXT,
    total_amount REAL NOT NULL,
    status TEXT NOT NULL,
    timeline TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS service_calls (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
    table_number TEXT NOT NULL,
    call_type TEXT NOT NULL,
    status TEXT NOT NULL,
    acknowledged_by TEXT,
    acknowledged_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS table_states (
    restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
    table_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'free',
    section TEXT NOT NULL DEFAULT '',
    activated_by TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (restaurant_id, table_number)
  );

  CREATE TABLE IF NOT EXISTS table_seatings (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
    table_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    table_pin TEXT,
    pin_tries INTEGER NOT NULL DEFAULT 0,
    opened_by TEXT,
    merged_into TEXT,
    discount_json TEXT,
    spin_json TEXT,
    guest_phone TEXT,
    loyalty_awarded INTEGER NOT NULL DEFAULT 0,
    close_note TEXT,
    opened_at TEXT NOT NULL,
    closed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
    seating_id TEXT NOT NULL,
    table_number TEXT NOT NULL,
    payer TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL,
    tip REAL NOT NULL DEFAULT 0,
    mode TEXT NOT NULL,
    split_type TEXT NOT NULL DEFAULT 'full',
    status TEXT NOT NULL DEFAULT 'pending',
    handled_by TEXT,
    created_at TEXT NOT NULL,
    settled_at TEXT
  );

  CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
    code TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'pct',
    value REAL NOT NULL,
    min_bill REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE (restaurant_id, code)
  );

  CREATE TABLE IF NOT EXISTS loyalty_accounts (
    restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
    phone TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    total_spent REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (restaurant_id, phone)
  );

  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    pin TEXT,
    section TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE (restaurant_id, pin)
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
    staff_name TEXT NOT NULL,
    action TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
    order_id TEXT NOT NULL,
    seating_id TEXT,
    table_number TEXT NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`);

function tableHasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === col);
}

function ensureColumns(table, columnDefs) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
  for (const [col, def] of columnDefs) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
    }
  }
}

// Legacy upgrades on existing DBs
ensureColumns("users", [
  ["role", "TEXT NOT NULL DEFAULT 'admin'"],
  ["restaurant_id", "TEXT DEFAULT 'rest_default'"],
]);
ensureColumns("sessions", [["active_restaurant_id", "TEXT"]]);
ensureColumns("restaurants", [
  ["qr_style", `TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_QR_STYLE)}'`],
  ["plan", "TEXT NOT NULL DEFAULT 'Pro'"],
  ["plan_status", "TEXT NOT NULL DEFAULT 'active'"],
  ["plan_expires_at", "TEXT NOT NULL DEFAULT ''"],
  ["is_active", "INTEGER NOT NULL DEFAULT 1"],
  ["white_label", "INTEGER NOT NULL DEFAULT 0"],
  ["brand_bg", "TEXT NOT NULL DEFAULT '#FAF8F5'"],
  ["brand_accent", "TEXT NOT NULL DEFAULT '#49332A'"],
  ["brand_secondary", "TEXT NOT NULL DEFAULT '#766158'"],
  ["custom_domain", "TEXT NOT NULL DEFAULT ''"],
  ["custom_domain_verified", "INTEGER NOT NULL DEFAULT 0"],
  ["opening_time", "TEXT NOT NULL DEFAULT '09:00'"],
  ["closing_time", "TEXT NOT NULL DEFAULT '23:00'"],
  ["takeaway_enabled", "INTEGER NOT NULL DEFAULT 1"],
  ["delivery_enabled", "INTEGER NOT NULL DEFAULT 0"],
  ["delivery_fee", "REAL NOT NULL DEFAULT 40"],
  ["free_delivery_min", "REAL NOT NULL DEFAULT 500"],
]);

for (const tbl of [
  "categories",
  "menu_items",
  "orders",
  "service_calls",
  "table_seatings",
  "payments",
  "activity_log",
  "feedback",
]) {
  ensureColumns(tbl, [["restaurant_id", "TEXT NOT NULL DEFAULT 'rest_default'"]]);
}
ensureColumns("orders", [
  ["seating_id", "TEXT"],
  ["order_type", "TEXT NOT NULL DEFAULT 'dine_in'"],
  ["pickup_token", "TEXT"],
  ["customer_name", "TEXT"],
  ["customer_phone", "TEXT"],
  ["delivery_address", "TEXT"],
  ["delivery_landmark", "TEXT"],
  ["delivery_fee", "REAL NOT NULL DEFAULT 0"],
  ["delivery_status", "TEXT"],
  ["created_by_staff_id", "TEXT"],
  ["created_by_staff_name", "TEXT"],
  ["idempotency_key", "TEXT"],
]);

// Migrate single-PK/UNIQUE tables cleanly if upgraded from legacy single-tenant DB
if (!tableHasColumn("table_states", "restaurant_id")) {
  db.exec(`
    CREATE TABLE table_states_v2 (
      restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
      table_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'free',
      section TEXT NOT NULL DEFAULT '',
      activated_by TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, table_number)
    );
    INSERT INTO table_states_v2 (restaurant_id, table_number, status, section, activated_by, updated_at)
    SELECT 'rest_default', table_number, status, section, activated_by, updated_at FROM table_states;
    DROP TABLE table_states;
    ALTER TABLE table_states_v2 RENAME TO table_states;
  `);
}

if (!tableHasColumn("loyalty_accounts", "restaurant_id")) {
  db.exec(`
    CREATE TABLE loyalty_accounts_v2 (
      restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
      phone TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      total_spent REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, phone)
    );
    INSERT INTO loyalty_accounts_v2 (restaurant_id, phone, points, total_spent, updated_at)
    SELECT 'rest_default', phone, points, total_spent, updated_at FROM loyalty_accounts;
    DROP TABLE loyalty_accounts;
    ALTER TABLE loyalty_accounts_v2 RENAME TO loyalty_accounts;
  `);
}

if (!tableHasColumn("coupons", "restaurant_id")) {
  db.exec(`
    CREATE TABLE coupons_v2 (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
      code TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'pct',
      value REAL NOT NULL,
      min_bill REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE (restaurant_id, code)
    );
    INSERT INTO coupons_v2 (id, restaurant_id, code, kind, value, min_bill, active, created_at)
    SELECT id, 'rest_default', code, kind, value, min_bill, active, created_at FROM coupons;
    DROP TABLE coupons;
    ALTER TABLE coupons_v2 RENAME TO coupons;
  `);
}

if (!tableHasColumn("staff", "restaurant_id")) {
  db.exec(`
    CREATE TABLE staff_v2 (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      pin TEXT,
      section TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE (restaurant_id, pin)
    );
    INSERT INTO staff_v2 (id, restaurant_id, name, role, pin, section, active, created_at)
    SELECT id, 'rest_default', name, role, pin, section, active, created_at FROM staff;
    DROP TABLE staff;
    ALTER TABLE staff_v2 RENAME TO staff;
  `);
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_orders_rest_created ON orders(restaurant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_table_session ON orders(restaurant_id, table_number, client_session_id);
  CREATE INDEX IF NOT EXISTS idx_orders_seating ON orders(seating_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_calls_table_created ON service_calls(restaurant_id, table_number, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_seatings_table_status ON table_seatings(restaurant_id, table_number, status);
  CREATE INDEX IF NOT EXISTS idx_seatings_rest_status ON table_seatings(restaurant_id, status);
  CREATE INDEX IF NOT EXISTS idx_payments_seating ON payments(seating_id, status);
  CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(restaurant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(restaurant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reservations_rest_date ON reservations(restaurant_id, reservation_date, reservation_time);
  CREATE INDEX IF NOT EXISTS idx_reservations_code ON reservations(restaurant_id, booking_code);
`);

function ensurePlatformRow() {
  let row = db.prepare("SELECT * FROM platform_settings WHERE id = 1").get();
  if (!row) {
    const now = new Date().toISOString();
    const secret = crypto.randomBytes(32).toString("hex");
    db.prepare(
      `INSERT INTO platform_settings (
        id, platform_name, agency_name, agency_tagline, support_email,
        default_brand_bg, default_brand_accent, pin_hmac_secret, updated_at
      ) VALUES (1, 'Khao Piyo', 'Khao Piyo', 'White-Label Restaurant QR Menu, Ordering & Kitchen Operations SaaS', 'support@brotocol.local', '#FAF8F5', '#49332A', ?, ?)`
    ).run(secret, now);
    row = db.prepare("SELECT * FROM platform_settings WHERE id = 1").get();
  } else {
    if (!row.pin_hmac_secret) {
      const secret = crypto.randomBytes(32).toString("hex");
      db.prepare("UPDATE platform_settings SET pin_hmac_secret = ? WHERE id = 1").run(secret);
      row.pin_hmac_secret = secret;
    }
    if (row.platform_name === "BROTOCOL ServeOS") {
      db.prepare("UPDATE platform_settings SET platform_name = 'Khao Piyo' WHERE id = 1").run();
      row.platform_name = "Khao Piyo";
    }
  }
  return row;
}

ensurePlatformRow();

export function getPlatformSettings({ includeSecret = false } = {}) {
  const row = ensurePlatformRow();
  return {
    platform_name: row.platform_name || "Khao Piyo",
    agency_name: row.agency_name || "Khao Piyo",
    agency_tagline:
      row.agency_tagline ||
      "White-Label Restaurant QR Menu, Ordering & Kitchen Operations SaaS",
    support_email: row.support_email || "support@brotocol.local",
    default_brand_bg: row.default_brand_bg || "#FAF8F5",
    default_brand_accent: row.default_brand_accent || "#49332A",
    default_brand_secondary: row.default_brand_secondary || "#766158",
    ...(includeSecret ? { pin_hmac_secret: row.pin_hmac_secret } : {}),
    updated_at: row.updated_at,
  };
}

export function updatePlatformSettings(patch = {}) {
  const current = getPlatformSettings({ includeSecret: false });
  const platform_name =
    patch.platform_name !== undefined
      ? String(patch.platform_name).trim().slice(0, 80) || current.platform_name
      : current.platform_name;
  const agency_name =
    patch.agency_name !== undefined
      ? String(patch.agency_name).trim().slice(0, 60) || current.agency_name
      : current.agency_name;
  const agency_tagline =
    patch.agency_tagline !== undefined
      ? String(patch.agency_tagline).trim().slice(0, 200) || current.agency_tagline
      : current.agency_tagline;
  const support_email =
    patch.support_email !== undefined
      ? String(patch.support_email).trim().slice(0, 120)
      : current.support_email;
  const default_brand_bg = /^#[0-9a-fA-F]{6}$/.test(String(patch.default_brand_bg || ""))
    ? String(patch.default_brand_bg).toUpperCase()
    : current.default_brand_bg;
  const default_brand_accent = /^#[0-9a-fA-F]{6}$/.test(String(patch.default_brand_accent || ""))
    ? String(patch.default_brand_accent).toUpperCase()
    : current.default_brand_accent;
  const default_brand_secondary = /^#[0-9a-fA-F]{6}$/.test(
    String(patch.default_brand_secondary || "")
  )
    ? String(patch.default_brand_secondary).toUpperCase()
    : current.default_brand_secondary;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE platform_settings SET
      platform_name = ?, agency_name = ?, agency_tagline = ?, support_email = ?,
      default_brand_bg = ?, default_brand_accent = ?, default_brand_secondary = ?, updated_at = ?
     WHERE id = 1`
  ).run(
    platform_name,
    agency_name,
    agency_tagline,
    support_email,
    default_brand_bg,
    default_brand_accent,
    default_brand_secondary,
    now
  );
  return getPlatformSettings({ includeSecret: false });
}

// Run versioned database migrations (migrates & retires legacy restaurant_settings, adds custom domain index)
export const migrationStatus = runMigrations(db, {
  dbFilePath: dbPath,
  defaultRestaurantId: DEFAULT_RESTAURANT_ID,
  defaultSlug: DEFAULT_RESTAURANT_SLUG,
});

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function mapSettings(row, { includePrivate = true } = {}) {
  if (!row) return null;
  const loyalty = safeJson(row.loyalty_config, DEFAULT_LOYALTY);
  const qrStyleRaw = safeJson(row.qr_style, DEFAULT_QR_STYLE);
  return {
    id: row.id || DEFAULT_RESTAURANT_ID,
    slug: row.slug || DEFAULT_RESTAURANT_SLUG,
    name: row.name,
    description: row.description,
    logo_url: row.logo_url ?? null,
    cover_url: row.cover_url ?? null,
    orders_enabled: Boolean(row.orders_enabled),
    waiter_call_enabled: Boolean(row.waiter_call_enabled),
    qr_mode: row.qr_mode === "single" ? "single" : "per_table",
    table_config: safeJson(row.table_config, { total: 12, skip: [], disabled: [] }),
    qr_style: {
      style: qrStyleRaw?.style || "standard",
      fgColor: qrStyleRaw?.fgColor || "#000000",
      bgColor: qrStyleRaw?.bgColor || "#FFFFFF",
      dotScale: Math.min(1, Math.max(0.5, Number(qrStyleRaw?.dotScale ?? 0.85))),
      frameStyle: ["none", "simple", "rounded", "fancy"].includes(qrStyleRaw?.frameStyle)
        ? qrStyleRaw.frameStyle
        : "rounded",
    },
    menu_views: Number(row.menu_views || 0),
    upi_id: row.upi_id || "",
    gst_rate: Number(row.gst_rate ?? 5),
    service_charge_pct: Number(row.service_charge_pct ?? 0),
    require_table_pin: Boolean(row.require_table_pin),
    loyalty: {
      enabled: loyalty.enabled !== false,
      rupees_per_point: Math.max(1, Number(loyalty.rupees_per_point || 10)),
      goal: Math.max(1, Number(loyalty.goal || 200)),
      reward: String(loyalty.reward || "Free Dessert"),
    },
    spin_prizes: safeJson(row.spin_prizes, DEFAULT_SPIN_PRIZES),
    social_links: safeJson(row.social_links, {}),
    wifi_ssid: includePrivate ? row.wifi_ssid || "" : "",
    wifi_password: includePrivate ? row.wifi_password || "" : "",
    has_wifi: Boolean((row.wifi_ssid || "").trim()),
    plan: row.plan || "Pro",
    plan_status: row.plan_status || "active",
    plan_expires_at: row.plan_expires_at || "",
    is_active: row.is_active === undefined ? true : Boolean(row.is_active),
    white_label: Boolean(row.white_label),
    brand_bg: row.brand_bg || "#FAF8F5",
    brand_accent: row.brand_accent || "#49332A",
    brand_secondary: row.brand_secondary || "#766158",
    primary_color: row.brand_accent || "#49332A",
    secondary_color: row.brand_secondary || "#766158",
    custom_domain: row.custom_domain || "",
    custom_domain_verified: Boolean(row.custom_domain_verified),
    opening_time: row.opening_time || "09:00",
    closing_time: row.closing_time || "23:00",
    takeaway_enabled: row.takeaway_enabled === undefined ? true : Boolean(row.takeaway_enabled),
    delivery_enabled: Boolean(row.delivery_enabled),
    delivery_fee: Number(row.delivery_fee ?? 40),
    free_delivery_min: Number(row.free_delivery_min ?? 500),
    created_at: row.created_at || row.updated_at,
    updated_at: row.updated_at,
  };
}

const BUILTIN_PLATFORM_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DOMAIN_HOSTNAME_RE =
  /^(?=.{3,120}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function extractHostname(hostHeader = "") {
  const raw = String(hostHeader || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const endIdx = raw.indexOf("]");
    return endIdx !== -1 ? raw.slice(0, endIdx + 1) : raw;
  }
  return raw.split(":")[0].replace(/\.+$/, "");
}

export function isPlatformHost(hostHeader = "") {
  const hostname = extractHostname(hostHeader);
  if (!hostname) return true;
  if (BUILTIN_PLATFORM_HOSTS.has(hostname)) return true;
  const extraHosts = String(process.env.PLATFORM_HOSTS || "")
    .split(",")
    .map((s) => extractHostname(s))
    .filter(Boolean);
  return extraHosts.includes(hostname);
}

export function normalizeCustomDomain(rawInput) {
  const stripped = String(rawInput || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .split(":")[0]
    .replace(/\.+$/, "")
    .slice(0, 120);

  if (!stripped) return { ok: true, domain: "" };
  if (
    BUILTIN_PLATFORM_HOSTS.has(stripped) ||
    IPV4_RE.test(stripped) ||
    !DOMAIN_HOSTNAME_RE.test(stripped)
  ) {
    return {
      ok: false,
      error: "Enter a valid multi-label domain hostname (for example menu.yourhotel.com).",
    };
  }
  return { ok: true, domain: stripped };
}

export function validateCustomDomainAvailable(rawInput, excludeRestaurantId = null) {
  const norm = normalizeCustomDomain(rawInput);
  if (!norm.ok) return { ok: false, status: 400, error: norm.error };
  if (!norm.domain) return { ok: true, domain: "" };

  const existing = db
    .prepare(
      "SELECT id FROM restaurants WHERE custom_domain != '' AND LOWER(custom_domain) = LOWER(?) LIMIT 1"
    )
    .get(norm.domain);
  if (existing && existing.id !== excludeRestaurantId) {
    return {
      ok: false,
      status: 409,
      code: "duplicate_domain",
      error: `Custom domain '${norm.domain}' is already assigned to another property.`,
    };
  }
  return { ok: true, domain: norm.domain };
}

export function resolveRestaurantContext({ identifier = null, host = null } = {}) {
  const cleanHost = extractHostname(host);
  const cleanId = String(identifier || "").trim();

  if (cleanHost && !isPlatformHost(cleanHost)) {
    const byDomain = db
      .prepare(
        "SELECT * FROM restaurants WHERE custom_domain != '' AND LOWER(custom_domain) = ? LIMIT 1"
      )
      .get(cleanHost);
    if (!byDomain) {
      return {
        ok: false,
        status: 404,
        code: "domain_not_found",
        error: "Unknown hostname: this domain is not registered on BROTOCOL ServeOS.",
        host: cleanHost,
      };
    }
    if (
      cleanId &&
      cleanId.toLowerCase() !== String(byDomain.id).toLowerCase() &&
      cleanId.toLowerCase() !== String(byDomain.slug).toLowerCase()
    ) {
      return {
        ok: false,
        status: 403,
        code: "cross_tenant_forbidden",
        error: "Cross-tenant access is not permitted from this hostname.",
        host: cleanHost,
      };
    }
    if (byDomain.is_active === 0 || byDomain.plan_status === "paused") {
      return {
        ok: false,
        status: 403,
        code: "venue_paused",
        error: "This venue is currently paused by the platform administrator.",
        host: cleanHost,
        isCustomDomain: true,
        restaurant: byDomain,
      };
    }
    if (!byDomain.custom_domain_verified) {
      return {
        ok: false,
        status: 403,
        code: "domain_unverified",
        error: "This custom domain is pending verification and cannot serve customer ordering pages yet.",
        host: cleanHost,
        isCustomDomain: true,
        verified: false,
        restaurant: byDomain,
      };
    }
    return {
      ok: true,
      host: cleanHost,
      isCustomDomain: true,
      verified: true,
      restaurant: byDomain,
    };
  }

  if (cleanId) {
    const byId = db
      .prepare("SELECT * FROM restaurants WHERE id = ? OR LOWER(slug) = LOWER(?) LIMIT 1")
      .get(cleanId, cleanId);
    if (!byId) {
      return {
        ok: false,
        status: 404,
        code: "venue_not_found",
        error: "Restaurant or hotel venue not found.",
        host: cleanHost,
      };
    }
    if (byId.is_active === 0 || byId.plan_status === "paused") {
      return {
        ok: false,
        status: 403,
        code: "venue_paused",
        error: "This venue is currently paused by the platform administrator.",
        host: cleanHost,
        isCustomDomain: false,
        restaurant: byId,
      };
    }
    return {
      ok: true,
      host: cleanHost,
      isCustomDomain: false,
      verified: true,
      restaurant: byId,
    };
  }

  const defRow =
    db.prepare("SELECT * FROM restaurants WHERE id = ?").get(DEFAULT_RESTAURANT_ID) ||
    db.prepare("SELECT * FROM restaurants ORDER BY created_at ASC LIMIT 1").get() ||
    null;
  if (!defRow) {
    return {
      ok: false,
      status: 404,
      code: "venue_not_found",
      error: "No venue configured.",
      host: cleanHost,
    };
  }
  if (defRow.is_active === 0 || defRow.plan_status === "paused") {
    return {
      ok: false,
      status: 403,
      code: "venue_paused",
      error: "This venue is currently paused by the platform administrator.",
      host: cleanHost,
      isCustomDomain: false,
      restaurant: defRow,
    };
  }
  return {
    ok: true,
    host: cleanHost,
    isCustomDomain: false,
    verified: true,
    restaurant: defRow,
  };
}

export function resolveRestaurant(identifier = null, host = null) {
  const ctx = resolveRestaurantContext({ identifier, host });
  return ctx.ok ? ctx.restaurant : ctx.restaurant || null;
}

export function listRestaurants({ activeOnly = false } = {}) {
  const sql = activeOnly
    ? "SELECT * FROM restaurants WHERE is_active = 1 ORDER BY created_at ASC"
    : "SELECT * FROM restaurants ORDER BY created_at ASC";
  return db.prepare(sql).all().map((r) => mapSettings(r, { includePrivate: true }));
}

export function getSettings(opts = {}) {
  const restaurantId = opts.restaurantId || DEFAULT_RESTAURANT_ID;
  const row =
    db.prepare("SELECT * FROM restaurants WHERE id = ?").get(restaurantId) ||
    db.prepare("SELECT * FROM restaurants WHERE LOWER(slug) = LOWER(?)").get(restaurantId);
  return mapSettings(row, opts);
}

export function mapMenuItem(row) {
  const sizeVariants = safeJson(row.size_variants, []);
  return {
    id: row.id,
    restaurant_id: row.restaurant_id || DEFAULT_RESTAURANT_ID,
    category_id: row.category_id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    image_url: row.image_url ?? null,
    is_veg: Number(row.is_veg),
    is_bestseller: Boolean(row.is_bestseller),
    is_chef_special: Boolean(row.is_chef_special),
    is_available: Boolean(row.is_available),
    prep_minutes: Number(row.prep_minutes || 10),
    has_size_variants: sizeVariants.length > 0,
    size_variants: sizeVariants,
    addons: safeJson(row.addons, []),
    created_at: row.created_at,
  };
}

export function mapOrder(row) {
  const normalizedLines = db
    .prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at ASC, id ASC")
    .all(row.id);

  const items =
    normalizedLines.length > 0
      ? normalizedLines.map((li) => ({
          id: li.menu_item_id || li.id,
          menu_item_id: li.menu_item_id ?? null,
          name: li.item_name_snapshot,
          base_unit_price: Number(li.base_unit_price),
          addons_unit_total: Number(li.addons_unit_total || 0),
          price: Number(li.unit_price_snapshot),
          unit_price_snapshot: Number(li.unit_price_snapshot),
          quantity: Number(li.quantity || 1),
          selectedSize: li.selected_variant ?? null,
          addons: safeJson(li.modifiers_json, []),
          discount_amount: Number(li.discount_amount || 0),
          tax_rate: Number(li.tax_rate || 0),
          tax_amount: Number(li.tax_amount || 0),
          line_total: Number(li.line_total),
          note: li.note ?? null,
          station: li.station || "",
          image_url: li.image_url ?? null,
        }))
      : safeJson(row.items, []);

  return {
    id: row.id,
    restaurant_id: row.restaurant_id || DEFAULT_RESTAURANT_ID,
    order_number: row.order_number,
    seq_num: Number(row.seq_num),
    order_type: row.order_type || "dine_in",
    table_number: row.table_number,
    service_unit_id: row.service_unit_id ?? null,
    pickup_token: row.pickup_token ?? null,
    customer_name: row.customer_name ?? null,
    customer_phone: row.customer_phone ?? null,
    delivery_address: row.delivery_address ?? null,
    delivery_landmark: row.delivery_landmark ?? null,
    delivery_fee: Number(row.delivery_fee || 0),
    delivery_status: row.delivery_status ?? null,
    created_by_staff_id: row.created_by_staff_id ?? null,
    created_by_staff_name: row.created_by_staff_name ?? null,
    client_session_id: row.client_session_id,
    seating_id: row.seating_id ?? null,
    items,
    note: row.note ?? null,
    total_amount: Number(row.total_amount),
    status: row.status,
    timeline: safeJson(row.timeline, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function syncServiceUnitsForRestaurant(restaurantId, tableConfigRaw = null) {
  return syncServiceUnitsInDb(db, restaurantId, tableConfigRaw);
}

export function resolveServiceUnitId(restaurantId, tableNumber, orderType = "dine_in") {
  const code = String(tableNumber || "").trim() || (orderType === "takeaway" ? "TAKEAWAY" : orderType === "delivery" ? "DELIVERY" : "1");
  const existing = db
    .prepare("SELECT id FROM service_units WHERE restaurant_id = ? AND code = ? LIMIT 1")
    .get(restaurantId, code);
  if (existing?.id) return existing.id;

  const unitType = orderType === "takeaway" ? "takeaway" : orderType === "delivery" ? "delivery" : "table";
  const label = unitType === "takeaway" ? "Takeaway Counter" : unitType === "delivery" ? "Delivery Dispatch" : `Table ${code}`;
  const unitId = `${restaurantId}::${unitType}::${code}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO service_units (id, restaurant_id, code, label, unit_type, section, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', 1, ?, ?)
     ON CONFLICT(restaurant_id, code) DO NOTHING`
  ).run(unitId, restaurantId, code, label, unitType, now, now);
  return unitId;
}

export function insertOrderItemsForOrder(
  orderId,
  restaurantId,
  resolvedLines = [],
  { gstRate = 0, createdAt = new Date().toISOString(), replaceExisting = false } = {}
) {
  if (replaceExisting) {
    db.prepare("DELETE FROM order_items WHERE order_id = ? AND restaurant_id = ?").run(orderId, restaurantId);
  }
  const validMenuIds = new Set(
    db.prepare("SELECT id FROM menu_items WHERE restaurant_id = ?").all(restaurantId).map((m) => m.id)
  );
  const stmt = db.prepare(`
    INSERT INTO order_items (
      id, restaurant_id, order_id, menu_item_id, item_name_snapshot,
      base_unit_price, addons_unit_total, unit_price_snapshot, quantity,
      selected_variant, modifiers_json, discount_amount, tax_rate, tax_amount,
      line_total, station, note, image_url, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let idx = 0; idx < resolvedLines.length; idx++) {
    const line = resolvedLines[idx] || {};
    const menuItemId = line.id && validMenuIds.has(line.id) ? String(line.id) : null;
    const unitPrice = Math.max(0, Number(line.unit_price_snapshot ?? line.price ?? 0));
    const addons = Array.isArray(line.addons) ? line.addons : [];
    const addonsUnit =
      line.addons_unit_total !== undefined
        ? Math.max(0, Number(line.addons_unit_total || 0))
        : addons.reduce((s, a) => s + Math.max(0, Number(a?.price || 0)), 0);
    const baseUnit =
      line.base_unit_price !== undefined
        ? Math.max(0, Number(line.base_unit_price || 0))
        : Math.max(0, Math.round((unitPrice - addonsUnit) * 100) / 100);
    const qty = Math.max(1, Number(line.quantity || 1));
    const discountAmt = Math.max(0, Number(line.discount_amount || 0));
    const lineTotal =
      line.line_total !== undefined
        ? Math.max(0, Number(line.line_total || 0))
        : Math.max(0, Math.round((unitPrice * qty - discountAmt) * 100) / 100);

    stmt.run(
      `${orderId}::item::${idx}::${crypto.randomUUID().slice(0, 6)}`,
      restaurantId,
      orderId,
      menuItemId,
      String(line.name || "Menu Item"),
      baseUnit,
      addonsUnit,
      unitPrice,
      qty,
      line.selectedSize ?? line.selected_variant ?? null,
      JSON.stringify(addons),
      discountAmt,
      Math.max(0, Number(gstRate || 0)),
      0,
      lineTotal,
      String(line.station || ""),
      line.note ?? null,
      line.image_url ?? null,
      createdAt
    );
  }
}

export function mapReservation(row) {
  if (!row) return null;
  return {
    id: row.id,
    restaurant_id: row.restaurant_id || DEFAULT_RESTAURANT_ID,
    booking_code: row.booking_code,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    party_size: Number(row.party_size || 2),
    reservation_date: row.reservation_date,
    reservation_time: row.reservation_time,
    status: row.status || "pending",
    assigned_table: row.assigned_table ?? null,
    notes: row.notes || "",
    admin_note: row.admin_note || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listReservations(restaurantId = DEFAULT_RESTAURANT_ID, limit = 150) {
  return db
    .prepare(
      "SELECT * FROM reservations WHERE restaurant_id = ? ORDER BY reservation_date ASC, reservation_time ASC, created_at DESC LIMIT ?"
    )
    .all(restaurantId, limit)
    .map(mapReservation);
}

export function listCategories(restaurantId = DEFAULT_RESTAURANT_ID) {
  return db
    .prepare("SELECT * FROM categories WHERE restaurant_id = ? ORDER BY display_order ASC, created_at ASC")
    .all(restaurantId);
}

export function listMenuItems({ restaurantId = DEFAULT_RESTAURANT_ID, availableOnly = false } = {}) {
  const sql = availableOnly
    ? "SELECT * FROM menu_items WHERE restaurant_id = ? AND is_available = 1 ORDER BY created_at ASC"
    : "SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY created_at ASC";
  return db.prepare(sql).all(restaurantId).map(mapMenuItem);
}

export function listOrders({ restaurantId = DEFAULT_RESTAURANT_ID, limit = 300 } = {}) {
  return db
    .prepare("SELECT * FROM orders WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(restaurantId, limit)
    .map(mapOrder);
}

export function listServiceCalls({ restaurantId = DEFAULT_RESTAURANT_ID, limit = 150 } = {}) {
  return db
    .prepare("SELECT * FROM service_calls WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(restaurantId, limit);
}

export function listCoupons({ restaurantId = DEFAULT_RESTAURANT_ID, activeOnly = false } = {}) {
  const sql = activeOnly
    ? "SELECT * FROM coupons WHERE restaurant_id = ? AND active = 1 ORDER BY created_at ASC"
    : "SELECT * FROM coupons WHERE restaurant_id = ? ORDER BY created_at ASC";
  return db
    .prepare(sql)
    .all(restaurantId)
    .map((r) => ({
      id: r.id,
      code: r.code,
      kind: r.kind === "flat" ? "flat" : "pct",
      value: Number(r.value),
      min_bill: Number(r.min_bill || 0),
      active: Boolean(r.active),
      created_at: r.created_at,
    }));
}

export function listStaff(restaurantId = DEFAULT_RESTAURANT_ID) {
  return db
    .prepare(
      "SELECT id, name, role, pin, section, active, created_at FROM staff WHERE restaurant_id = ? ORDER BY name ASC"
    )
    .all(restaurantId)
    .map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      pin: r.pin,
      section: r.section || "",
      active: Boolean(r.active),
      created_at: r.created_at,
    }));
}

export function logActivity(restaurantId, staffName, action, details = {}) {
  db.prepare(
    "INSERT INTO activity_log (id, restaurant_id, staff_name, action, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    crypto.randomUUID(),
    restaurantId || DEFAULT_RESTAURANT_ID,
    String(staffName || "Owner").slice(0, 60),
    String(action),
    JSON.stringify(details || {}),
    new Date().toISOString()
  );
}

const REDACTED_META_KEYS = new Set(["password", "passwordhash", "password_hash", "token", "pintoken", "secret", "email", "phone", "customer_phone"]);

function sanitizeAuditMetadata(meta = {}) {
  if (!meta || typeof meta !== "object") return {};
  const clean = {};
  for (const [k, v] of Object.entries(meta)) {
    if (REDACTED_META_KEYS.has(k.toLowerCase())) continue;
    clean[k] = v;
  }
  return clean;
}

export function logPlatformAudit({
  actorUserId = null,
  actorName = "Super Admin",
  actorRole = "super_admin",
  action,
  targetType,
  targetId = null,
  targetRestaurantId = null,
  metadata = {},
}) {
  const safeMeta = sanitizeAuditMetadata(metadata);
  db.prepare(
    `INSERT INTO platform_audit_logs (
      id, actor_user_id, actor_name, actor_role, action, target_type, target_id,
      target_restaurant_id, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    actorUserId ?? null,
    String(actorName || "Super Admin").slice(0, 60),
    String(actorRole || "super_admin").slice(0, 32),
    String(action),
    String(targetType || "platform"),
    targetId ? String(targetId) : null,
    targetRestaurantId ? String(targetRestaurantId) : null,
    JSON.stringify(safeMeta),
    new Date().toISOString()
  );
}

export function listPlatformAuditLogs(limit = 50) {
  return db
    .prepare("SELECT * FROM platform_audit_logs ORDER BY created_at DESC LIMIT ?")
    .all(Math.max(1, Math.min(200, Number(limit) || 50)))
    .map((r) => ({
      id: r.id,
      actor_user_id: r.actor_user_id ?? null,
      actor_name: r.actor_name,
      actor_role: r.actor_role,
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id ?? null,
      target_restaurant_id: r.target_restaurant_id ?? null,
      metadata: safeJson(r.metadata_json, {}),
      created_at: r.created_at,
    }));
}
