import fs from "node:fs";
import path from "node:path";

const DEFAULT_LOYALTY = {
  enabled: true,
  rupees_per_point: 10,
  goal: 200,
  reward: "Free Dessert",
};

const DEFAULT_SPIN_PRIZES = [
  { label: "10% Off", kind: "pct", value: 10 },
  { label: "₹50 Off", kind: "flat", value: 50 },
  { label: "Free Chai", kind: "item" },
  { label: "Better Luck", kind: "none" },
];

const DEFAULT_QR_STYLE = {
  style: "standard",
  fgColor: "#000000",
  bgColor: "#FFFFFF",
  dotScale: 0.85,
  frameStyle: "rounded",
};

function tableExists(db, tableName) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
  );
}

function indexExists(db, indexName) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName)
  );
}

function ensureColumn(db, table, col, definition) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
  if (!existing.has(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition};`);
    return true;
  }
  return false;
}

function createPreMigrationBackup(db, dbFilePath, label = "pre-m1") {
  if (!dbFilePath || dbFilePath === ":memory:") return null;
  const base = path.basename(dbFilePath);
  // Skip ephemeral test DB filenames so test runs stay clean
  if (base.startsWith("test-") || !fs.existsSync(dbFilePath)) return null;
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    // ignore checkpoint errors
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbFilePath}.${label}-${stamp}.bak`;
  fs.copyFileSync(dbFilePath, backupPath);
  return backupPath;
}

function normalizeAndDeduplicateDomains(db) {
  const rows = db
    .prepare("SELECT id, custom_domain FROM restaurants ORDER BY created_at ASC, id ASC")
    .all();
  const seen = new Set();
  const updateStmt = db.prepare("UPDATE restaurants SET custom_domain = ? WHERE id = ?");

  for (const row of rows) {
    const clean = String(row.custom_domain || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .split(":")[0]
      .slice(0, 120);
    if (!clean) {
      if (row.custom_domain !== "") updateStmt.run("", row.id);
      continue;
    }
    let candidate = clean;
    if (seen.has(candidate)) {
      candidate = `dup-${String(row.id).slice(-6)}.${clean}`.slice(0, 120);
    }
    seen.add(candidate);
    if (candidate !== row.custom_domain) {
      updateStmt.run(candidate, row.id);
    }
  }
}

export function runMigrations(
  db,
  {
    dbFilePath = null,
    defaultRestaurantId = "rest_default",
    defaultSlug = "tandoor-house",
    runM2 = true,
  } = {}
) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}'
    );
  `);

  const hasLegacyTable = tableExists(db, "restaurant_settings");
  const hasUniqueDomainIdx = indexExists(db, "idx_restaurants_custom_domain");
  const recorded = db.prepare("SELECT version FROM schema_migrations WHERE version = 1").get();

  ensureColumn(db, "restaurants", "qr_style", `TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_QR_STYLE)}'`);
  ensureColumn(db, "restaurants", "plan", "TEXT NOT NULL DEFAULT 'Pro'");
  ensureColumn(db, "restaurants", "plan_status", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(db, "restaurants", "plan_expires_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "restaurants", "is_active", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "restaurants", "white_label", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "restaurants", "brand_bg", "TEXT NOT NULL DEFAULT '#FAF8F5'");
  ensureColumn(db, "restaurants", "brand_accent", "TEXT NOT NULL DEFAULT '#49332A'");
  ensureColumn(db, "restaurants", "brand_secondary", "TEXT NOT NULL DEFAULT '#766158'");
  ensureColumn(db, "restaurants", "custom_domain", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "restaurants", "custom_domain_verified", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "platform_settings", "default_brand_secondary", "TEXT NOT NULL DEFAULT '#766158'");

  if (recorded && !hasLegacyTable && hasUniqueDomainIdx) {
    const m1Status = verifyMigrationM1(db, { defaultRestaurantId });
    if (runM2) {
      const m2Status = runMigrationM2(db, { dbFilePath });
      return { ...m1Status, m2: m2Status };
    }
    return m1Status;
  }

  let backupPath = null;
  if (hasLegacyTable) {
    backupPath = createPreMigrationBackup(db, dbFilePath);
  }

  const details = { migratedLegacyRow: false, backupPath };

  db.exec("BEGIN IMMEDIATE");
  try {
    if (hasLegacyTable) {
      const legacy = db.prepare("SELECT * FROM restaurant_settings WHERE id = 1").get();
      if (legacy) {
        details.migratedLegacyRow = true;
        const current = db
          .prepare("SELECT * FROM restaurants WHERE id = ?")
          .get(defaultRestaurantId);
        const now = new Date().toISOString();

        if (!current) {
          db.prepare(
            `INSERT INTO restaurants (
              id, slug, name, description, logo_url, cover_url,
              orders_enabled, waiter_call_enabled, qr_mode, table_config, qr_style, menu_views,
              upi_id, gst_rate, service_charge_pct, require_table_pin, loyalty_config, spin_prizes,
              social_links, wifi_ssid, wifi_password, plan, plan_status, is_active,
              brand_bg, brand_accent, brand_secondary, custom_domain, custom_domain_verified,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pro', 'active', 1, '#FAF8F5', '#49332A', '#766158', '', 0, ?, ?)`
          ).run(
            defaultRestaurantId,
            defaultSlug,
            legacy.name,
            legacy.description,
            legacy.logo_url ?? "/food/brand-logo.svg",
            legacy.cover_url ?? "/food/hero-cover.jpg",
            legacy.orders_enabled ?? 1,
            legacy.waiter_call_enabled ?? 1,
            legacy.qr_mode || "per_table",
            legacy.table_config || '{"total":12,"skip":[],"disabled":[]}',
            JSON.stringify(DEFAULT_QR_STYLE),
            legacy.menu_views ?? 0,
            legacy.upi_id || "",
            legacy.gst_rate ?? 5,
            legacy.service_charge_pct ?? 0,
            legacy.require_table_pin ?? 0,
            legacy.loyalty_config || JSON.stringify(DEFAULT_LOYALTY),
            legacy.spin_prizes || JSON.stringify(DEFAULT_SPIN_PRIZES),
            legacy.social_links || "{}",
            legacy.wifi_ssid || "",
            legacy.wifi_password || "",
            legacy.updated_at || now,
            legacy.updated_at || now
          );
        } else {
          const legacyTime = new Date(legacy.updated_at || 0).getTime() || 0;
          const currentTime = new Date(current.updated_at || 0).getTime() || 0;
          const legacyIsNewer = legacyTime > currentTime;

          const mergedName = legacyIsNewer && legacy.name ? legacy.name : current.name || legacy.name;
          const mergedDesc =
            legacyIsNewer && legacy.description
              ? legacy.description
              : current.description || legacy.description;
          const mergedLogo = current.logo_url || legacy.logo_url || "/food/brand-logo.svg";
          const mergedCover = current.cover_url || legacy.cover_url || "/food/hero-cover.jpg";
          const mergedUpi = current.upi_id || legacy.upi_id || "";
          const mergedViews = Math.max(Number(current.menu_views || 0), Number(legacy.menu_views || 0));
          const mergedTableCfg =
            legacyIsNewer && legacy.table_config
              ? legacy.table_config
              : current.table_config || legacy.table_config || '{"total":12,"skip":[],"disabled":[]}';
          const mergedWifiSsid = current.wifi_ssid || legacy.wifi_ssid || "";
          const mergedWifiPass = current.wifi_password || legacy.wifi_password || "";

          db.prepare(
            `UPDATE restaurants SET
              name = ?, description = ?, logo_url = ?, cover_url = ?,
              upi_id = ?, menu_views = ?, table_config = ?,
              wifi_ssid = ?, wifi_password = ?
             WHERE id = ?`
          ).run(
            mergedName,
            mergedDesc,
            mergedLogo,
            mergedCover,
            mergedUpi,
            mergedViews,
            mergedTableCfg,
            mergedWifiSsid,
            mergedWifiPass,
            current.id
          );
        }

        const verifiedRow = db
          .prepare("SELECT id, name FROM restaurants WHERE id = ?")
          .get(defaultRestaurantId);
        if (!verifiedRow || !verifiedRow.name) {
          throw new Error("Migration verification failed: default tenant missing after legacy copy");
        }
      }

      db.exec("DROP TABLE IF EXISTS restaurant_settings;");
    }

    normalizeAndDeduplicateDomains(db);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_custom_domain
      ON restaurants(LOWER(custom_domain))
      WHERE custom_domain != '';
    `);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO schema_migrations (version, name, applied_at, details_json)
       VALUES (1, 'm001_tenant_isolation_and_drop_restaurant_settings', ?, ?)
       ON CONFLICT(version) DO UPDATE SET applied_at = excluded.applied_at, details_json = excluded.details_json`
    ).run(now, JSON.stringify(details));

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const m1Status = verifyMigrationM1(db, { defaultRestaurantId });
  if (runM2) {
    const m2Status = runMigrationM2(db, { dbFilePath });
    return { ...m1Status, m2: m2Status };
  }
  return m1Status;
}

export function rollbackMigrationM1(db, { defaultRestaurantId = "rest_default" } = {}) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS restaurant_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        logo_url TEXT,
        cover_url TEXT,
        orders_enabled INTEGER NOT NULL DEFAULT 1,
        waiter_call_enabled INTEGER NOT NULL DEFAULT 1,
        qr_mode TEXT NOT NULL DEFAULT 'per_table',
        table_config TEXT NOT NULL DEFAULT '{"total":12,"skip":[],"disabled":[]}',
        menu_views INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        upi_id TEXT NOT NULL DEFAULT '',
        gst_rate REAL NOT NULL DEFAULT 5,
        service_charge_pct REAL NOT NULL DEFAULT 0,
        require_table_pin INTEGER NOT NULL DEFAULT 0,
        loyalty_config TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_LOYALTY)}',
        spin_prizes TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_SPIN_PRIZES)}',
        social_links TEXT NOT NULL DEFAULT '{}',
        wifi_ssid TEXT NOT NULL DEFAULT '',
        wifi_password TEXT NOT NULL DEFAULT ''
      );
    `);

    const defRow = db
      .prepare("SELECT * FROM restaurants WHERE id = ?")
      .get(defaultRestaurantId);
    if (defRow) {
      db.prepare(
        `INSERT INTO restaurant_settings (
          id, name, description, logo_url, cover_url, orders_enabled, waiter_call_enabled,
          qr_mode, table_config, menu_views, updated_at, upi_id, gst_rate, service_charge_pct,
          require_table_pin, loyalty_config, spin_prizes, social_links, wifi_ssid, wifi_password
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          logo_url = excluded.logo_url,
          cover_url = excluded.cover_url,
          orders_enabled = excluded.orders_enabled,
          waiter_call_enabled = excluded.waiter_call_enabled,
          qr_mode = excluded.qr_mode,
          table_config = excluded.table_config,
          menu_views = excluded.menu_views,
          updated_at = excluded.updated_at,
          upi_id = excluded.upi_id,
          gst_rate = excluded.gst_rate,
          service_charge_pct = excluded.service_charge_pct,
          require_table_pin = excluded.require_table_pin,
          loyalty_config = excluded.loyalty_config,
          spin_prizes = excluded.spin_prizes,
          social_links = excluded.social_links,
          wifi_ssid = excluded.wifi_ssid,
          wifi_password = excluded.wifi_password`
      ).run(
        defRow.name,
        defRow.description || "",
        defRow.logo_url ?? null,
        defRow.cover_url ?? null,
        defRow.orders_enabled ?? 1,
        defRow.waiter_call_enabled ?? 1,
        defRow.qr_mode || "per_table",
        defRow.table_config || '{"total":12,"skip":[],"disabled":[]}',
        Number(defRow.menu_views || 0),
        defRow.updated_at || new Date().toISOString(),
        defRow.upi_id || "",
        Number(defRow.gst_rate ?? 5),
        Number(defRow.service_charge_pct ?? 0),
        defRow.require_table_pin ?? 0,
        defRow.loyalty_config || JSON.stringify(DEFAULT_LOYALTY),
        defRow.spin_prizes || JSON.stringify(DEFAULT_SPIN_PRIZES),
        defRow.social_links || "{}",
        defRow.wifi_ssid || "",
        defRow.wifi_password || ""
      );
    }

    db.exec("DROP INDEX IF EXISTS idx_restaurants_custom_domain;");
    db.prepare("DELETE FROM schema_migrations WHERE version = 1").run();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return verifyMigrationM1(db, { defaultRestaurantId });
}

export function verifyMigrationM1(db, { defaultRestaurantId = "rest_default" } = {}) {
  const migRow = tableExists(db, "schema_migrations")
    ? db.prepare("SELECT * FROM schema_migrations WHERE version = 1").get()
    : null;
  const defaultTenant = tableExists(db, "restaurants")
    ? db
        .prepare(
          "SELECT id, slug, name, brand_bg, brand_accent, brand_secondary, custom_domain, custom_domain_verified, table_config, upi_id, menu_views FROM restaurants WHERE id = ?"
        )
        .get(defaultRestaurantId)
    : null;
  const restaurantCount = tableExists(db, "restaurants")
    ? Number(db.prepare("SELECT COUNT(*) AS cnt FROM restaurants").get().cnt || 0)
    : 0;

  return {
    version: migRow ? Number(migRow.version) : 0,
    hasLegacyTable: tableExists(db, "restaurant_settings"),
    hasUniqueDomainIndex: indexExists(db, "idx_restaurants_custom_domain"),
    restaurantCount,
    defaultTenant: defaultTenant || null,
  };
}

function safeJsonParse(raw, fallback) {
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function syncServiceUnitsInDb(db, restaurantId, tableConfigRaw = null, { now = new Date().toISOString() } = {}) {
  const rest = db
    .prepare("SELECT id, table_config FROM restaurants WHERE id = ?")
    .get(restaurantId);
  if (!rest) return 0;

  const cfg =
    typeof tableConfigRaw === "string"
      ? safeJsonParse(tableConfigRaw, { total: 12, skip: [], disabled: [] })
      : tableConfigRaw && typeof tableConfigRaw === "object"
        ? tableConfigRaw
        : safeJsonParse(rest.table_config, { total: 12, skip: [], disabled: [] });

  const total = Math.max(1, Math.min(200, Number.parseInt(cfg?.total ?? 12, 10) || 12));
  const skipSet = new Set((Array.isArray(cfg?.skip) ? cfg.skip : []).map(String));
  const disabledSet = new Set((Array.isArray(cfg?.disabled) ? cfg.disabled : []).map(String));
  const stateRows = db
    .prepare("SELECT table_number, section FROM table_states WHERE restaurant_id = ?")
    .all(restaurantId);
  const sectionByTable = new Map(stateRows.map((r) => [String(r.table_number), r.section || ""]));

  const upsert = db.prepare(`
    INSERT INTO service_units (id, restaurant_id, code, label, unit_type, section, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(restaurant_id, code) DO UPDATE SET
      label = excluded.label,
      unit_type = excluded.unit_type,
      section = CASE WHEN excluded.section != '' THEN excluded.section ELSE service_units.section END,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `);

  let count = 0;
  for (let i = 1; i <= total; i++) {
    const code = String(i);
    if (skipSet.has(code)) continue;
    const isActive = disabledSet.has(code) ? 0 : 1;
    const unitId = `${restaurantId}::table::${code}`;
    upsert.run(unitId, restaurantId, code, `Table ${code}`, "table", sectionByTable.get(code) || "", isActive, now, now);
    count++;
  }

  for (const [code, label, unitType] of [
    ["TAKEAWAY", "Takeaway Counter", "takeaway"],
    ["DELIVERY", "Delivery Dispatch", "delivery"],
  ]) {
    upsert.run(`${restaurantId}::${unitType}::${code}`, restaurantId, code, label, unitType, "", 1, now, now);
    count++;
  }

  return count;
}

function rebuildTable(db, tableName, tempCreateSql, columnList) {
  if (!tableExists(db, tableName)) return;
  const tmpName = `${tableName}__m2_new`;
  db.exec(`DROP TABLE IF EXISTS "${tmpName}";`);
  db.exec(tempCreateSql.replace(`CREATE TABLE "${tmpName}"`, `CREATE TABLE "${tmpName}"`));
  const colsCsv = columnList.map((c) => `"${c}"`).join(", ");
  db.exec(`INSERT INTO "${tmpName}" (${colsCsv}) SELECT ${colsCsv} FROM "${tableName}";`);
  db.exec(`DROP TABLE "${tableName}";`);
  db.exec(`ALTER TABLE "${tmpName}" RENAME TO "${tableName}";`);
}

function createOrderItemsAndAuditTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_units (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      unit_type TEXT NOT NULL DEFAULT 'table',
      section TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (restaurant_id, code)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id TEXT REFERENCES menu_items(id) ON DELETE SET NULL,
      item_name_snapshot TEXT NOT NULL,
      base_unit_price REAL NOT NULL,
      addons_unit_total REAL NOT NULL DEFAULT 0,
      unit_price_snapshot REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      selected_variant TEXT,
      modifiers_json TEXT NOT NULL DEFAULT '[]',
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL,
      station TEXT NOT NULL DEFAULT '',
      note TEXT,
      image_url TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      target_restaurant_id TEXT REFERENCES restaurants(id) ON DELETE SET NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
}

function ensureM2Indexes(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_rest_created ON orders(restaurant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_table_session ON orders(restaurant_id, table_number, client_session_id);
    CREATE INDEX IF NOT EXISTS idx_orders_seating ON orders(seating_id);
    CREATE INDEX IF NOT EXISTS idx_orders_service_unit ON orders(service_unit_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_rest_menu ON order_items(restaurant_id, menu_item_id);
    CREATE INDEX IF NOT EXISTS idx_service_units_rest ON service_units(restaurant_id, unit_type, is_active);
    CREATE INDEX IF NOT EXISTS idx_calls_table_created ON service_calls(restaurant_id, table_number, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_seatings_table_status ON table_seatings(restaurant_id, table_number, status);
    CREATE INDEX IF NOT EXISTS idx_seatings_rest_status ON table_seatings(restaurant_id, status);
    CREATE INDEX IF NOT EXISTS idx_payments_seating ON payments(seating_id, status);
    CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(restaurant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(restaurant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reservations_rest_date ON reservations(restaurant_id, reservation_date, reservation_time);
    CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_platform_audit_target ON platform_audit_logs(target_restaurant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_platform_audit_action ON platform_audit_logs(action, created_at DESC);
  `);
}

export function runMigrationM2(db, { dbFilePath = null } = {}) {
  const recorded = db.prepare("SELECT version FROM schema_migrations WHERE version = 2").get();
  if (
    recorded &&
    tableExists(db, "order_items") &&
    tableExists(db, "service_units") &&
    tableExists(db, "platform_audit_logs")
  ) {
    ensureM2Indexes(db);
    return verifyMigrationM2(db);
  }

  const backupPath = createPreMigrationBackup(db, dbFilePath, "pre-m2");
  const now = new Date().toISOString();

  let seededServiceUnits = 0;
  let migratedOrders = 0;
  let migratedOrderItems = 0;

  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("BEGIN IMMEDIATE;");
  try {
    createOrderItemsAndAuditTables(db);

    // 1. Seed service_units for every restaurant
    const restRows = db.prepare("SELECT id, table_config, gst_rate FROM restaurants").all();
    const gstByRest = new Map(restRows.map((r) => [r.id, Number(r.gst_rate || 0)]));
    for (const r of restRows) {
      seededServiceUnits += syncServiceUnitsInDb(db, r.id, r.table_config, { now });
    }

    // Ensure every historical order's (restaurant_id, table_number) exists as a service_unit
    const existingOrders = db.prepare("SELECT id, restaurant_id, order_type, table_number, items, created_at FROM orders").all();
    const upsertUnit = db.prepare(`
      INSERT INTO service_units (id, restaurant_id, code, label, unit_type, section, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '', 1, ?, ?)
      ON CONFLICT(restaurant_id, code) DO NOTHING
    `);
    for (const ord of existingOrders) {
      if (!gstByRest.has(ord.restaurant_id)) continue;
      const code = String(ord.table_number || "").trim() || "1";
      const unitType = ord.order_type === "takeaway" ? "takeaway" : ord.order_type === "delivery" ? "delivery" : "table";
      const label = unitType === "takeaway" ? "Takeaway Counter" : unitType === "delivery" ? "Delivery Dispatch" : `Table ${code}`;
      upsertUnit.run(`${ord.restaurant_id}::${unitType}::${code}`, ord.restaurant_id, code, label, unitType, now, now);
    }

    // 2. Sanitize any dangling references prior to enforcing FKs
    db.exec(`
      UPDATE users SET restaurant_id = NULL WHERE restaurant_id IS NOT NULL AND (restaurant_id = '' OR restaurant_id NOT IN (SELECT id FROM restaurants));
      UPDATE sessions SET active_restaurant_id = NULL WHERE active_restaurant_id IS NOT NULL AND (active_restaurant_id = '' OR active_restaurant_id NOT IN (SELECT id FROM restaurants));
      DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users);
      UPDATE menu_items SET category_id = NULL WHERE category_id IS NOT NULL AND (category_id = '' OR category_id NOT IN (SELECT id FROM categories));
      UPDATE orders SET seating_id = NULL WHERE seating_id IS NOT NULL AND (seating_id = '' OR seating_id NOT IN (SELECT id FROM table_seatings));
      UPDATE feedback SET seating_id = NULL WHERE seating_id IS NOT NULL AND (seating_id = '' OR seating_id NOT IN (SELECT id FROM table_seatings));
      DELETE FROM categories WHERE restaurant_id NOT IN (SELECT id FROM restaurants);
      DELETE FROM menu_items WHERE restaurant_id NOT IN (SELECT id FROM restaurants);
      DELETE FROM reservations WHERE restaurant_id NOT IN (SELECT id FROM restaurants);
      DELETE FROM table_states WHERE restaurant_id NOT IN (SELECT id FROM restaurants);
      DELETE FROM table_seatings WHERE restaurant_id NOT IN (SELECT id FROM restaurants);
      DELETE FROM orders WHERE restaurant_id NOT IN (SELECT id FROM restaurants);
      DELETE FROM service_calls WHERE restaurant_id NOT IN (SELECT id FROM restaurants);
      DELETE FROM payments WHERE restaurant_id NOT IN (SELECT id FROM restaurants) OR seating_id NOT IN (SELECT id FROM table_seatings);
      DELETE FROM coupons WHERE restaurant_id NOT IN (SELECT id FROM restaurants);
      DELETE FROM loyalty_accounts WHERE restaurant_id NOT IN (SELECT id FROM restaurants);
      DELETE FROM staff WHERE restaurant_id NOT IN (SELECT id FROM restaurants);
      DELETE FROM activity_log WHERE restaurant_id NOT IN (SELECT id FROM restaurants);
      DELETE FROM feedback WHERE restaurant_id NOT IN (SELECT id FROM restaurants) OR order_id NOT IN (SELECT id FROM orders);
    `);

    // 3. Rebuild child tables with formal Foreign Key constraints
    rebuildTable(
      db,
      "users",
      `CREATE TABLE "users__m2_new" (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        restaurant_id TEXT REFERENCES restaurants(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );`,
      ["id", "email", "password_hash", "name", "role", "restaurant_id", "created_at"]
    );

    rebuildTable(
      db,
      "sessions",
      `CREATE TABLE "sessions__m2_new" (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        active_restaurant_id TEXT REFERENCES restaurants(id) ON DELETE SET NULL,
        expires_at TEXT NOT NULL
      );`,
      ["token", "user_id", "active_restaurant_id", "expires_at"]
    );

    rebuildTable(
      db,
      "categories",
      `CREATE TABLE "categories__m2_new" (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL DEFAULT 'rest_default' REFERENCES restaurants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        station TEXT NOT NULL DEFAULT '',
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );`,
      ["id", "restaurant_id", "name", "station", "display_order", "created_at"]
    );

    rebuildTable(
      db,
      "menu_items",
      `CREATE TABLE "menu_items__m2_new" (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL DEFAULT 'rest_default' REFERENCES restaurants(id) ON DELETE CASCADE,
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
      );`,
      [
        "id",
        "restaurant_id",
        "category_id",
        "name",
        "description",
        "price",
        "image_url",
        "is_veg",
        "is_bestseller",
        "is_chef_special",
        "is_available",
        "prep_minutes",
        "size_variants",
        "addons",
        "created_at",
      ]
    );

    rebuildTable(
      db,
      "reservations",
      `CREATE TABLE "reservations__m2_new" (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL DEFAULT 'rest_default' REFERENCES restaurants(id) ON DELETE CASCADE,
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
      );`,
      [
        "id",
        "restaurant_id",
        "booking_code",
        "customer_name",
        "customer_phone",
        "party_size",
        "reservation_date",
        "reservation_time",
        "status",
        "assigned_table",
        "notes",
        "admin_note",
        "created_at",
        "updated_at",
      ]
    );

    rebuildTable(
      db,
      "table_states",
      `CREATE TABLE "table_states__m2_new" (
        restaurant_id TEXT NOT NULL DEFAULT 'rest_default' REFERENCES restaurants(id) ON DELETE CASCADE,
        table_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'free',
        section TEXT NOT NULL DEFAULT '',
        activated_by TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (restaurant_id, table_number)
      );`,
      ["restaurant_id", "table_number", "status", "section", "activated_by", "updated_at"]
    );

    rebuildTable(
      db,
      "table_seatings",
      `CREATE TABLE "table_seatings__m2_new" (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL DEFAULT 'rest_default' REFERENCES restaurants(id) ON DELETE CASCADE,
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
      );`,
      [
        "id",
        "restaurant_id",
        "table_number",
        "status",
        "table_pin",
        "pin_tries",
        "opened_by",
        "merged_into",
        "discount_json",
        "spin_json",
        "guest_phone",
        "loyalty_awarded",
        "close_note",
        "opened_at",
        "closed_at",
      ]
    );

    ensureColumn(db, "orders", "service_unit_id", "TEXT");
    db.exec(`
      UPDATE orders SET service_unit_id = (
        SELECT su.id FROM service_units su
        WHERE su.restaurant_id = orders.restaurant_id AND su.code = orders.table_number
        LIMIT 1
      ) WHERE service_unit_id IS NULL;
    `);

    rebuildTable(
      db,
      "orders",
      `CREATE TABLE "orders__m2_new" (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL DEFAULT 'rest_default' REFERENCES restaurants(id) ON DELETE CASCADE,
        order_number TEXT NOT NULL,
        seq_num INTEGER NOT NULL,
        order_type TEXT NOT NULL DEFAULT 'dine_in',
        table_number TEXT NOT NULL,
        service_unit_id TEXT REFERENCES service_units(id) ON DELETE SET NULL,
        pickup_token TEXT,
        customer_name TEXT,
        customer_phone TEXT,
        delivery_address TEXT,
        delivery_landmark TEXT,
        delivery_fee REAL NOT NULL DEFAULT 0,
        delivery_status TEXT,
        created_by_staff_id TEXT,
        created_by_staff_name TEXT,
        client_session_id TEXT NOT NULL,
        seating_id TEXT REFERENCES table_seatings(id) ON DELETE SET NULL,
        items TEXT NOT NULL,
        note TEXT,
        total_amount REAL NOT NULL,
        status TEXT NOT NULL,
        timeline TEXT NOT NULL,
        idempotency_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      [
        "id",
        "restaurant_id",
        "order_number",
        "seq_num",
        "order_type",
        "table_number",
        "service_unit_id",
        "pickup_token",
        "customer_name",
        "customer_phone",
        "delivery_address",
        "delivery_landmark",
        "delivery_fee",
        "delivery_status",
        "created_by_staff_id",
        "created_by_staff_name",
        "client_session_id",
        "seating_id",
        "items",
        "note",
        "total_amount",
        "status",
        "timeline",
        "idempotency_key",
        "created_at",
        "updated_at",
      ]
    );

    rebuildTable(
      db,
      "service_calls",
      `CREATE TABLE "service_calls__m2_new" (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL DEFAULT 'rest_default' REFERENCES restaurants(id) ON DELETE CASCADE,
        table_number TEXT NOT NULL,
        call_type TEXT NOT NULL,
        status TEXT NOT NULL,
        acknowledged_by TEXT,
        acknowledged_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL
      );`,
      [
        "id",
        "restaurant_id",
        "table_number",
        "call_type",
        "status",
        "acknowledged_by",
        "acknowledged_at",
        "completed_at",
        "created_at",
      ]
    );

    rebuildTable(
      db,
      "payments",
      `CREATE TABLE "payments__m2_new" (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL DEFAULT 'rest_default' REFERENCES restaurants(id) ON DELETE CASCADE,
        seating_id TEXT NOT NULL REFERENCES table_seatings(id) ON DELETE CASCADE,
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
      );`,
      [
        "id",
        "restaurant_id",
        "seating_id",
        "table_number",
        "payer",
        "amount",
        "tip",
        "mode",
        "split_type",
        "status",
        "handled_by",
        "created_at",
        "settled_at",
      ]
    );

    rebuildTable(
      db,
      "coupons",
      `CREATE TABLE "coupons__m2_new" (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL DEFAULT 'rest_default' REFERENCES restaurants(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'pct',
        value REAL NOT NULL,
        min_bill REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE (restaurant_id, code)
      );`,
      ["id", "restaurant_id", "code", "kind", "value", "min_bill", "active", "created_at"]
    );

    rebuildTable(
      db,
      "loyalty_accounts",
      `CREATE TABLE "loyalty_accounts__m2_new" (
        restaurant_id TEXT NOT NULL DEFAULT 'rest_default' REFERENCES restaurants(id) ON DELETE CASCADE,
        phone TEXT NOT NULL,
        points INTEGER NOT NULL DEFAULT 0,
        total_spent REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (restaurant_id, phone)
      );`,
      ["restaurant_id", "phone", "points", "total_spent", "updated_at"]
    );

    rebuildTable(
      db,
      "staff",
      `CREATE TABLE "staff__m2_new" (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL DEFAULT 'rest_default' REFERENCES restaurants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        pin TEXT,
        section TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE (restaurant_id, pin)
      );`,
      ["id", "restaurant_id", "name", "role", "pin", "section", "active", "created_at"]
    );

    rebuildTable(
      db,
      "activity_log",
      `CREATE TABLE "activity_log__m2_new" (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL DEFAULT 'rest_default' REFERENCES restaurants(id) ON DELETE CASCADE,
        staff_name TEXT NOT NULL,
        action TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );`,
      ["id", "restaurant_id", "staff_name", "action", "details_json", "created_at"]
    );

    rebuildTable(
      db,
      "feedback",
      `CREATE TABLE "feedback__m2_new" (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL DEFAULT 'rest_default' REFERENCES restaurants(id) ON DELETE CASCADE,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        seating_id TEXT REFERENCES table_seatings(id) ON DELETE SET NULL,
        table_number TEXT NOT NULL,
        rating INTEGER NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );`,
      ["id", "restaurant_id", "order_id", "seating_id", "table_number", "rating", "comment", "created_at"]
    );

    // 4. Backfill normalized order_items from orders.items JSON
    const validMenuIds = new Set(db.prepare("SELECT id FROM menu_items").all().map((m) => m.id));
    const ordersToMigrate = db.prepare("SELECT id, restaurant_id, items, created_at FROM orders").all();
    const insertOrderItem = db.prepare(`
      INSERT INTO order_items (
        id, restaurant_id, order_id, menu_item_id, item_name_snapshot,
        base_unit_price, addons_unit_total, unit_price_snapshot, quantity,
        selected_variant, modifiers_json, discount_amount, tax_rate, tax_amount,
        line_total, station, note, image_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const ord of ordersToMigrate) {
      const existingCount = Number(
        db.prepare("SELECT COUNT(*) AS cnt FROM order_items WHERE order_id = ?").get(ord.id)?.cnt || 0
      );
      if (existingCount > 0) continue;

      const parsedItems = safeJsonParse(ord.items, []);
      if (!Array.isArray(parsedItems)) continue;
      migratedOrders++;
      const gstRate = gstByRest.get(ord.restaurant_id) ?? 0;

      for (let idx = 0; idx < parsedItems.length; idx++) {
        const line = parsedItems[idx] || {};
        const menuItemId = line.id && validMenuIds.has(line.id) ? String(line.id) : null;
        const unitPrice = Math.max(0, Number(line.price || 0));
        const addons = Array.isArray(line.addons) ? line.addons : [];
        const addonsUnitTotal = addons.reduce((s, a) => s + Math.max(0, Number(a?.price || 0)), 0);
        const baseUnitPrice = Math.max(0, Math.round((unitPrice - addonsUnitTotal) * 100) / 100);
        const qty = Math.max(1, Number(line.quantity || 1));
        const discountAmt = Math.max(0, Number(line.discount_amount || 0));
        const lineTotal = Math.max(0, Math.round((unitPrice * qty - discountAmt) * 100) / 100);

        insertOrderItem.run(
          `${ord.id}::item::${idx}`,
          ord.restaurant_id,
          ord.id,
          menuItemId,
          String(line.name || "Menu Item"),
          baseUnitPrice,
          Math.round(addonsUnitTotal * 100) / 100,
          unitPrice,
          qty,
          line.selectedSize ?? line.selected_variant ?? null,
          JSON.stringify(addons),
          discountAmt,
          gstRate,
          0,
          lineTotal,
          String(line.station || ""),
          line.note ?? null,
          line.image_url ?? null,
          ord.created_at || now
        );
        migratedOrderItems++;
      }
    }

    // 5. Indexes + schema_migrations version 2
    ensureM2Indexes(db);
    db.prepare(
      `INSERT INTO schema_migrations (version, name, applied_at, details_json)
       VALUES (2, 'm002_normalized_order_items_service_units_fks_and_audit_logs', ?, ?)
       ON CONFLICT(version) DO UPDATE SET applied_at = excluded.applied_at, details_json = excluded.details_json`
    ).run(
      now,
      JSON.stringify({
        seededServiceUnits,
        migratedOrders,
        migratedOrderItems,
        backupPath: backupPath || null,
      })
    );

    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    db.exec("PRAGMA foreign_keys = ON;");
    throw err;
  }

  db.exec("PRAGMA foreign_keys = ON;");
  const fkViolations = db.prepare("PRAGMA foreign_key_check").all();
  if (fkViolations.length > 0) {
    throw new Error(`Foreign key integrity check failed after M2 migration: ${JSON.stringify(fkViolations.slice(0, 5))}`);
  }

  return verifyMigrationM2(db);
}

export function rollbackMigrationM2(db) {
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("BEGIN IMMEDIATE;");
  try {
    // Re-sync orders.items JSON from order_items before dropping order_items
    if (tableExists(db, "order_items") && tableExists(db, "orders")) {
      const orders = db.prepare("SELECT id FROM orders").all();
      const upd = db.prepare("UPDATE orders SET items = ? WHERE id = ?");
      const getItems = db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC");
      for (const ord of orders) {
        const lines = getItems.all(ord.id);
        if (lines.length > 0) {
          const jsonLines = lines.map((li) => ({
            id: li.menu_item_id || li.id,
            name: li.item_name_snapshot,
            price: Number(li.unit_price_snapshot),
            quantity: Number(li.quantity),
            selectedSize: li.selected_variant ?? null,
            addons: safeJsonParse(li.modifiers_json, []),
            note: li.note ?? null,
            station: li.station || "",
            image_url: li.image_url ?? null,
          }));
          upd.run(JSON.stringify(jsonLines), ord.id);
        }
      }
    }

    db.exec(`
      DROP TABLE IF EXISTS order_items;
      DROP TABLE IF EXISTS platform_audit_logs;
    `);

    if (tableExists(db, "orders")) {
      rebuildTable(
        db,
        "orders",
        `CREATE TABLE "orders__m2_new" (
          id TEXT PRIMARY KEY,
          restaurant_id TEXT NOT NULL DEFAULT 'rest_default',
          order_number TEXT NOT NULL,
          seq_num INTEGER NOT NULL,
          order_type TEXT NOT NULL DEFAULT 'dine_in',
          table_number TEXT NOT NULL,
          pickup_token TEXT,
          customer_name TEXT,
          customer_phone TEXT,
          delivery_address TEXT,
          delivery_landmark TEXT,
          delivery_fee REAL NOT NULL DEFAULT 0,
          delivery_status TEXT,
          created_by_staff_id TEXT,
          created_by_staff_name TEXT,
          client_session_id TEXT NOT NULL,
          seating_id TEXT,
          items TEXT NOT NULL,
          note TEXT,
          total_amount REAL NOT NULL,
          status TEXT NOT NULL,
          timeline TEXT NOT NULL,
          idempotency_key TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        [
          "id",
          "restaurant_id",
          "order_number",
          "seq_num",
          "order_type",
          "table_number",
          "pickup_token",
          "customer_name",
          "customer_phone",
          "delivery_address",
          "delivery_landmark",
          "delivery_fee",
          "delivery_status",
          "created_by_staff_id",
          "created_by_staff_name",
          "client_session_id",
          "seating_id",
          "items",
          "note",
          "total_amount",
          "status",
          "timeline",
          "idempotency_key",
          "created_at",
          "updated_at",
        ]
      );
    }

    db.exec("DROP TABLE IF EXISTS service_units;");
    db.prepare("DELETE FROM schema_migrations WHERE version = 2").run();
    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    db.exec("PRAGMA foreign_keys = ON;");
    throw err;
  }
  db.exec("PRAGMA foreign_keys = ON;");
  return verifyMigrationM2(db);
}

export function verifyMigrationM2(db) {
  const migRow = tableExists(db, "schema_migrations")
    ? db.prepare("SELECT * FROM schema_migrations WHERE version = 2").get()
    : null;
  const fkCheck = db.prepare("PRAGMA foreign_key_check").all();
  const orderItemsCount = tableExists(db, "order_items")
    ? Number(db.prepare("SELECT COUNT(*) AS cnt FROM order_items").get().cnt || 0)
    : 0;
  const serviceUnitsCount = tableExists(db, "service_units")
    ? Number(db.prepare("SELECT COUNT(*) AS cnt FROM service_units").get().cnt || 0)
    : 0;
  const ordersFkCount = tableExists(db, "orders")
    ? db.prepare("PRAGMA foreign_key_list(orders)").all().length
    : 0;

  return {
    version: migRow ? Number(migRow.version) : 0,
    hasOrderItemsTable: tableExists(db, "order_items"),
    hasServiceUnitsTable: tableExists(db, "service_units"),
    hasPlatformAuditLogsTable: tableExists(db, "platform_audit_logs"),
    orderItemsCount,
    serviceUnitsCount,
    ordersFkCount,
    fkViolationsCount: fkCheck.length,
  };
}
