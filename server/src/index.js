import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import multer from "multer";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  getSessionUser,
  hashPassword,
  requireAuth,
  requireSuperAdmin,
  revokeOtherUserSessions,
  setSessionCookie,
  signTablePinToken,
  updateSessionRestaurant,
  verifyPassword,
  verifyTablePinToken,
} from "./auth.js";
import {
  db,
  DEFAULT_LOYALTY,
  DEFAULT_QR_STYLE,
  DEFAULT_RESTAURANT_ID,
  DEFAULT_SPIN_PRIZES,
  extractHostname,
  getPlatformSettings,
  getSettings,
  insertOrderItemsForOrder,
  isPlatformHost,
  listCategories,
  listCoupons,
  listMenuItems,
  listOrders,
  listPlatformAuditLogs,
  listReservations,
  listRestaurants,
  listServiceCalls,
  listStaff,
  logActivity,
  logPlatformAudit,
  mapOrder,
  mapReservation,
  resolveRestaurant,
  resolveRestaurantContext,
  resolveServiceUnitId,
  SERVER_ROOT,
  slugify,
  syncServiceUnitsForRestaurant,
  updatePlatformSettings,
  UPLOADS_DIR,
  validateCustomDomainAvailable,
} from "./db.js";
import { calculateOrderTotals } from "./billMath.js";
import { seedIfEmpty, seedStarterCatalogForRestaurant } from "./seed.js";
import {
  buildFloorState,
  buildPlatformOverview,
  buildReports,
  buildSeatingView,
  creditLoyaltyIfPaid,
  ensureOpenSeating,
  generateFourDigitPin,
  normalizeTableNumber,
  resolveOpenSeatingRow,
  startOfPeriodIso,
  validateTableForOrder,
} from "./services.js";
import {
  checkLoginRateLimit,
  clearFailedLogins,
  generateBookingCode,
  getClientIp,
  getRequestPinToken,
  hasValidImageMagicBytes,
  isTimeWithinHours,
  publicWriteRateLimitMiddleware,
  recordFailedLogin,
  resolveAuthoritativeLines,
  sameOriginMutationMiddleware,
  securityHeadersMiddleware,
  verifyGuestTableAccess,
} from "./security.js";
import {
  attachWebSocketServer,
  broadcastAll,
  broadcastPlatform,
  broadcastToStaff,
  broadcastToTable,
} from "./ws.js";

seedIfEmpty();

const app = express();
app.disable("x-powered-by");
app.use(securityHeadersMiddleware);
app.use(express.json({ limit: "256kb" }));
app.use("/api/public", publicWriteRateLimitMiddleware);
app.use(
  ["/api/admin", "/api/super", "/api/auth/logout", "/api/auth/change-password"],
  sameOriginMutationMiddleware
);
app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "1h" }));

const ALLOWED_IMAGE_MIME = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = ALLOWED_IMAGE_MIME.get(file.mimetype) || ".bin";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed."));
    }
    cb(null, true);
  },
});

const VALID_CALL_TYPES = new Set(["water", "bill", "waiter", "help", "clean"]);
const VALID_ORDER_STATUSES = new Set([
  "pending",
  "accepted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
  "rejected",
]);
const VALID_PAY_MODES = new Set(["upi", "card", "cash"]);
const VALID_STAFF_ROLES = new Set(["waiter", "kitchen", "cashier", "manager"]);
const VALID_PLANS = new Set(["Starter", "Pro", "Enterprise"]);

function broadcastFloorSync(restaurantId, tableNumber = null) {
  broadcastToStaff(restaurantId, "floor:updated", { table: tableNumber });
  if (tableNumber) {
    broadcastToTable(restaurantId, tableNumber, "seating:updated", { table: tableNumber });
  }
}

function actorName(req) {
  const raw = String(req.body?.by || req.user?.name || "Owner").trim();
  return raw.slice(0, 60) || "Owner";
}

function resolvePublicRestaurant(req, res) {
  const requested =
    req.query?.restaurant ||
    req.query?.slug ||
    req.query?.r ||
    req.body?.restaurant ||
    req.body?.restaurantSlug ||
    req.body?.restaurantId ||
    "";
  const clean = String(requested).trim();
  const ctx = resolveRestaurantContext({
    identifier: clean || null,
    host: req.headers.host || null,
  });
  if (!ctx.ok) {
    res.status(ctx.status || 404).json({ code: ctx.code || "venue_not_found", error: ctx.error });
    return null;
  }
  return ctx.restaurant.id;
}

function mapPublicVenueSummary(v) {
  const primary = v.brand_accent || v.primary_color || "#49332A";
  const secondary = v.brand_secondary || v.secondary_color || "#766158";
  return {
    id: v.id,
    slug: v.slug,
    name: v.name,
    description: v.description,
    logo_url: v.logo_url ?? null,
    cover_url: v.cover_url ?? null,
    qr_mode: v.qr_mode === "single" ? "single" : "per_table",
    table_count: v.table_config?.total || 12,
    takeaway_enabled: v.takeaway_enabled !== false,
    delivery_enabled: Boolean(v.delivery_enabled),
    opening_time: v.opening_time || "09:00",
    closing_time: v.closing_time || "23:00",
    white_label: Boolean(v.white_label),
    brand_bg: v.brand_bg || "#FAF8F5",
    brand_accent: primary,
    brand_secondary: secondary,
    primary_color: primary,
    secondary_color: secondary,
  };
}

function serializeAuthUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === "super_admin" ? "super_admin" : "admin",
    restaurant_id: user.role === "super_admin" ? null : user.restaurant_id || DEFAULT_RESTAURANT_ID,
    active_restaurant_id:
      user.role === "super_admin"
        ? user.active_restaurant_id || DEFAULT_RESTAURANT_ID
        : user.restaurant_id || DEFAULT_RESTAURANT_ID,
  };
}

// ---------- Health & Public Venues Directory ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/public/platform", (_req, res) => {
  res.json({ platform: getPlatformSettings({ includeSecret: false }) });
});

app.get("/api/public/context", (req, res) => {
  const hostHeader = req.headers.host || null;
  if (isPlatformHost(hostHeader)) {
    return res.json({
      ok: true,
      mode: "platform",
      verified: true,
      platform: getPlatformSettings({ includeSecret: false }),
      tenant: null,
    });
  }
  const ctx = resolveRestaurantContext({ host: hostHeader });
  if (!ctx.ok) {
    return res.status(ctx.status || 404).json({
      ok: false,
      mode: ctx.code || "domain_error",
      verified: false,
      code: ctx.code,
      error: ctx.error,
    });
  }
  const settings = getSettings({ restaurantId: ctx.restaurant.id, includePrivate: false });
  return res.json({
    ok: true,
    mode: "tenant",
    verified: true,
    tenant: mapPublicVenueSummary(settings),
  });
});

app.get("/api/public/venues", (req, res) => {
  const hostHeader = req.headers.host || null;
  if (!isPlatformHost(hostHeader)) {
    const ctx = resolveRestaurantContext({ host: hostHeader });
    if (!ctx.ok) {
      return res.status(ctx.status || 404).json({ code: ctx.code, error: ctx.error });
    }
    const settings = getSettings({ restaurantId: ctx.restaurant.id, includePrivate: false });
    return res.json({ venues: [mapPublicVenueSummary(settings)] });
  }
  const venues = listRestaurants({ activeOnly: true })
    .filter((v) => v.plan_status !== "paused")
    .map(mapPublicVenueSummary);
  res.json({ venues });
});

// ---------- Public Guest Endpoints ----------
app.get("/api/public/menu", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  if (req.query.trackView === "1") {
    db.prepare("UPDATE restaurants SET menu_views = menu_views + 1 WHERE id = ?").run(restaurantId);
    const updated = getSettings({ restaurantId });
    broadcastToStaff(restaurantId, "views:updated", { menu_views: updated.menu_views });
  }
  const settings = getSettings({ restaurantId, includePrivate: false });
  const categories = listCategories(restaurantId);
  const items = listMenuItems({ restaurantId, availableOnly: true });
  res.json({ settings, categories, items });
});

app.get("/api/public/table-status", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const settings = getSettings({ restaurantId, includePrivate: false });
  const tableNumber = normalizeTableNumber(req.query.table);
  const venueSummary = {
    id: settings.id,
    slug: settings.slug,
    name: settings.name,
    logo_url: settings.logo_url,
    white_label: settings.white_label,
    brand_bg: settings.brand_bg,
    brand_accent: settings.brand_accent,
    brand_secondary: settings.brand_secondary,
    primary_color: settings.primary_color,
    secondary_color: settings.secondary_color,
    opening_time: settings.opening_time,
    closing_time: settings.closing_time,
    takeaway_enabled: settings.takeaway_enabled,
    delivery_enabled: settings.delivery_enabled,
  };
  if (!tableNumber) {
    return res.json({
      ok: true,
      restaurant: venueSummary,
      table: null,
      qr_mode: settings.qr_mode,
      table_config: settings.table_config,
      require_table_pin: settings.require_table_pin,
    });
  }
  const check = validateTableForOrder(settings, tableNumber);
  if (!check.ok) {
    return res.status(403).json({ ok: false, code: check.code, error: check.message });
  }
  const seating = resolveOpenSeatingRow(tableNumber, restaurantId);
  const pinToken = getRequestPinToken(req);
  const tokenValid =
    seating && pinToken
      ? verifyTablePinToken(pinToken, restaurantId, tableNumber, seating.id)
      : false;
  res.json({
    ok: true,
    restaurant: venueSummary,
    table: tableNumber,
    qr_mode: settings.qr_mode,
    table_config: settings.table_config,
    require_table_pin: settings.require_table_pin,
    has_open_seating: Boolean(seating),
    needs_pin: Boolean(settings.require_table_pin && seating?.table_pin && !tokenValid),
  });
});

app.post("/api/public/seating/join", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const settings = getSettings({ restaurantId });
  const tableNumber = normalizeTableNumber(req.body?.tableNumber);
  const pin = String(req.body?.pin || "").trim();
  const check = validateTableForOrder(settings, tableNumber);
  if (!check.ok) {
    return res.status(403).json({ code: check.code, error: check.message });
  }

  let row = resolveOpenSeatingRow(tableNumber, restaurantId);
  if (settings.require_table_pin) {
    if (!row) {
      return res.status(403).json({
        code: "inactive",
        error: `Table ${tableNumber} isn't open yet. Ask staff to seat your table.`,
      });
    }
    if (row.table_pin) {
      if (row.pin_tries >= 5) {
        return res.status(403).json({
          code: "locked",
          error: "Too many wrong PINs. Ask a member of staff to reset this table.",
        });
      }
      if (pin !== row.table_pin) {
        const nextTries = Number(row.pin_tries || 0) + 1;
        db.prepare("UPDATE table_seatings SET pin_tries = ? WHERE id = ?").run(nextTries, row.id);
        return res.status(403).json({
          code: "bad_pin",
          tries_left: Math.max(0, 5 - nextTries),
          error: `That PIN didn't match. ${Math.max(0, 5 - nextTries)} tries left.`,
        });
      }
    }
  } else if (!row) {
    row = ensureOpenSeating(tableNumber, "Guest", restaurantId);
    broadcastFloorSync(restaurantId, tableNumber);
  }

  const pinToken = signTablePinToken(restaurantId, tableNumber, row.id);
  res.json({
    ok: true,
    pinToken,
    seating: buildSeatingView(row.id, { requestedTable: tableNumber }),
  });
});

app.get("/api/public/seating", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const settings = getSettings({ restaurantId, includePrivate: false });
  const tableNumber = normalizeTableNumber(req.query.table);
  if (!tableNumber) return res.status(400).json({ error: "Table number is required" });
  const check = validateTableForOrder(settings, tableNumber);
  if (!check.ok) return res.status(403).json({ code: check.code, error: check.message });

  const pinAccess = verifyGuestTableAccess(req, restaurantId, settings, tableNumber);
  if (!pinAccess.ok) {
    return res.status(pinAccess.status).json({ code: pinAccess.code, error: pinAccess.error });
  }

  const row = resolveOpenSeatingRow(tableNumber, restaurantId);
  res.json({
    seating: row ? buildSeatingView(row.id, { requestedTable: tableNumber }) : null,
  });
});

app.get("/api/public/orders", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const settings = getSettings({ restaurantId, includePrivate: false });
  const sessionId = String(req.query.session || "").trim();
  const rawMode = String(req.query.mode || req.query.orderType || "").trim();
  const tableNumber = normalizeTableNumber(req.query.table);

  if (rawMode === "takeaway" || rawMode === "delivery" || (!tableNumber && sessionId)) {
    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required for takeaway/delivery tracking" });
    }
    const rows = db
      .prepare(
        `SELECT * FROM orders
         WHERE restaurant_id = ? AND client_session_id = ? AND order_type IN ('takeaway', 'delivery')
         ORDER BY created_at DESC LIMIT 30`
      )
      .all(restaurantId, sessionId);
    return res.json({ orders: rows.map(mapOrder), calls: [], seating: null });
  }

  if (!tableNumber) {
    return res.status(400).json({ error: "Table number is required" });
  }
  const pinAccess = verifyGuestTableAccess(req, restaurantId, settings, tableNumber);
  if (!pinAccess.ok) {
    return res.status(pinAccess.status).json({ code: pinAccess.code, error: pinAccess.error });
  }

  const activeSeating = resolveOpenSeatingRow(tableNumber, restaurantId);
  const rows = activeSeating
    ? db
        .prepare("SELECT * FROM orders WHERE seating_id = ? ORDER BY created_at DESC LIMIT 40")
        .all(activeSeating.id)
    : sessionId
      ? db
          .prepare(
            `SELECT * FROM orders
             WHERE restaurant_id = ? AND table_number = ? AND client_session_id = ? AND created_at >= ?
             ORDER BY created_at DESC LIMIT 30`
          )
          .all(restaurantId, tableNumber, sessionId, startOfPeriodIso("today"))
      : db
          .prepare(
            `SELECT * FROM orders
             WHERE restaurant_id = ? AND table_number = ? AND created_at >= ?
             ORDER BY created_at DESC LIMIT 30`
          )
          .all(restaurantId, tableNumber, startOfPeriodIso("today"));

  const calls = db
    .prepare(
      `SELECT * FROM service_calls
       WHERE restaurant_id = ? AND table_number = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 10`
    )
    .all(restaurantId, tableNumber, startOfPeriodIso("today"));

  res.json({
    orders: rows.map(mapOrder),
    calls,
    seating: activeSeating
      ? buildSeatingView(activeSeating.id, { requestedTable: tableNumber })
      : null,
  });
});

app.post("/api/public/orders", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const settings = getSettings({ restaurantId });
  if (!settings.orders_enabled) {
    return res.status(403).json({
      code: "orders_off",
      error: "Ordering is currently paused. Please speak with restaurant staff.",
    });
  }

  const rawOrderType = String(req.body?.orderType || "dine_in").trim().toLowerCase();
  const orderType = ["dine_in", "takeaway", "delivery"].includes(rawOrderType)
    ? rawOrderType
    : "dine_in";

  if (orderType === "takeaway" && settings.takeaway_enabled === false) {
    return res.status(403).json({ code: "takeaway_off", error: "Takeaway ordering is currently disabled." });
  }
  if (orderType === "delivery" && !settings.delivery_enabled) {
    return res.status(403).json({ code: "delivery_off", error: "Delivery ordering is currently disabled." });
  }

  const sessionId = String(req.body?.sessionId || "").trim().slice(0, 80);
  if (!sessionId) {
    return res.status(400).json({ code: "bad_session", error: "Session ID is required." });
  }

  const idempotencyKey = String(req.body?.clientRequestId || "").trim().slice(0, 80) || null;
  if (idempotencyKey) {
    const existingDup = db
      .prepare("SELECT * FROM orders WHERE restaurant_id = ? AND idempotency_key = ? LIMIT 1")
      .get(restaurantId, idempotencyKey);
    if (existingDup) {
      const mapped = mapOrder(existingDup);
      return res.status(200).json({
        order: mapped,
        duplicate: true,
        seating: mapped.seating_id
          ? buildSeatingView(mapped.seating_id, { requestedTable: mapped.table_number })
          : null,
      });
    }
  }

  const note = String(req.body?.note || "").trim().slice(0, 200) || null;
  let tableNumber = "";
  let customerName = null;
  let customerPhone = null;
  let deliveryAddress = null;
  let deliveryLandmark = null;
  let deliveryStatus = null;

  if (orderType === "dine_in") {
    tableNumber = normalizeTableNumber(req.body?.tableNumber);
    const tableCheck = validateTableForOrder(settings, tableNumber);
    if (!tableCheck.ok) {
      return res.status(400).json({ code: tableCheck.code, error: tableCheck.message });
    }
    const pinAccess = verifyGuestTableAccess(req, restaurantId, settings, tableNumber);
    if (!pinAccess.ok) {
      return res.status(pinAccess.status).json({ code: pinAccess.code, error: pinAccess.error });
    }
    const pendingCountRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM orders
         WHERE restaurant_id = ? AND table_number = ? AND status = 'pending' AND created_at >= ?`
      )
      .get(restaurantId, tableNumber, startOfPeriodIso("today"));
    if ((pendingCountRow?.cnt || 0) >= 6) {
      return res.status(429).json({
        code: "too_many",
        error: "You have several orders waiting. Please give the kitchen a moment.",
      });
    }
  } else {
    customerName = String(req.body?.customerName || "").trim().slice(0, 80);
    customerPhone = String(req.body?.customerPhone || "")
      .replace(/[^\d+]/g, "")
      .slice(0, 15);
    if (customerName.length < 2) {
      return res.status(400).json({ code: "bad_customer", error: "Please enter your name." });
    }
    if (customerPhone.replace(/\D/g, "").length < 8) {
      return res.status(400).json({ code: "bad_phone", error: "Please enter a valid phone number." });
    }
    if (orderType === "takeaway") {
      tableNumber = "TAKEAWAY";
    } else {
      deliveryAddress = String(req.body?.deliveryAddress || "").trim().slice(0, 240);
      deliveryLandmark = String(req.body?.deliveryLandmark || "").trim().slice(0, 120) || null;
      if (deliveryAddress.length < 6) {
        return res.status(400).json({
          code: "bad_address",
          error: "Please enter a full delivery address.",
        });
      }
      tableNumber = "DELIVERY";
      deliveryStatus = "pending";
    }
  }

  const linesResult = resolveAuthoritativeLines(req.body?.items, restaurantId);
  if (!linesResult.ok) {
    return res
      .status(linesResult.status)
      .json({ code: linesResult.code, error: linesResult.error });
  }

  const orderTotals = calculateOrderTotals(linesResult.resolvedLines, {
    orderType,
    deliveryFee: settings.delivery_fee,
    freeDeliveryMin: settings.free_delivery_min,
  });
  const deliveryFee = orderTotals.delivery_fee;
  const totalAmount = orderTotals.total_amount;

  const serviceUnitId = resolveServiceUnitId(restaurantId, tableNumber, orderType);
  const seating =
    orderType === "dine_in" ? ensureOpenSeating(tableNumber, "Guest", restaurantId) : null;
  const now = new Date().toISOString();
  const orderId = crypto.randomUUID();

  let createdOrder;
  db.exec("BEGIN IMMEDIATE");
  try {
    const seqRow = db
      .prepare(
        "SELECT COALESCE(MAX(seq_num), 0) AS max_seq FROM orders WHERE restaurant_id = ? AND created_at >= ?"
      )
      .get(restaurantId, startOfPeriodIso("today"));
    const seqNum = Number(seqRow?.max_seq || 0) + 1;
    const orderNumber = `#${seqNum}`;
    const pickupToken = orderType === "takeaway" ? `PK-${100 + seqNum}` : null;
    const timeline = { pending: now };

    db.prepare(
      `INSERT INTO orders (
        id, restaurant_id, order_number, seq_num, order_type, table_number, service_unit_id, pickup_token,
        customer_name, customer_phone, delivery_address, delivery_landmark, delivery_fee,
        delivery_status, client_session_id, seating_id, items, note, total_amount, status,
        timeline, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    ).run(
      orderId,
      restaurantId,
      orderNumber,
      seqNum,
      orderType,
      tableNumber,
      serviceUnitId,
      pickupToken,
      customerName,
      customerPhone,
      deliveryAddress,
      deliveryLandmark,
      deliveryFee,
      deliveryStatus,
      sessionId,
      seating ? seating.id : null,
      JSON.stringify(linesResult.resolvedLines),
      note,
      totalAmount,
      JSON.stringify(timeline),
      idempotencyKey,
      now,
      now
    );
    insertOrderItemsForOrder(orderId, restaurantId, linesResult.resolvedLines, {
      gstRate: settings.gst_rate,
      createdAt: now,
    });
    db.exec("COMMIT");

    createdOrder = mapOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId));
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  broadcastToStaff(restaurantId, "order:created", createdOrder);
  broadcastToTable(
    restaurantId,
    orderType === "dine_in" ? tableNumber : null,
    "order:updated",
    createdOrder
  );
  if (orderType === "dine_in") {
    broadcastFloorSync(restaurantId, tableNumber);
  }
  res.status(201).json({
    order: createdOrder,
    seating: seating ? buildSeatingView(seating.id, { requestedTable: tableNumber }) : null,
  });
});

app.post("/api/public/orders/:id/cancel", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const sessionId = String(req.body?.sessionId || "").trim();
  const orderRow = db
    .prepare("SELECT * FROM orders WHERE id = ? AND restaurant_id = ?")
    .get(req.params.id, restaurantId);
  if (!orderRow) return res.status(404).json({ error: "Order not found" });
  if (orderRow.client_session_id !== sessionId) {
    return res.status(403).json({ error: "Not permitted to cancel this order" });
  }
  if (orderRow.status !== "pending") {
    return res.status(409).json({
      code: "not_editable",
      error: "The kitchen has already started on this order.",
    });
  }
  if ((orderRow.order_type || "dine_in") === "dine_in") {
    const restSettings = getSettings({ restaurantId: orderRow.restaurant_id });
    const pinAccess = verifyGuestTableAccess(req, orderRow.restaurant_id, restSettings, orderRow.table_number);
    if (!pinAccess.ok) {
      return res.status(pinAccess.status).json({ code: pinAccess.code, error: pinAccess.error });
    }
  }

  const now = new Date().toISOString();
  const order = mapOrder(orderRow);
  const timeline = { ...order.timeline, cancelled: now };
  db.prepare("UPDATE orders SET status = 'cancelled', timeline = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(timeline),
    now,
    order.id
  );
  const updated = mapOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id));
  broadcastToStaff(updated.restaurant_id, "order:updated", updated);
  broadcastToTable(
    updated.restaurant_id,
    updated.order_type === "dine_in" ? updated.table_number : null,
    "order:updated",
    updated
  );
  if (updated.order_type === "dine_in") {
    broadcastFloorSync(updated.restaurant_id, updated.table_number);
  }
  res.json({ order: updated });
});

app.post("/api/public/seating/coupon", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const settings = getSettings({ restaurantId });
  const tableNumber = normalizeTableNumber(req.body?.tableNumber);
  const code = String(req.body?.code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!tableNumber || !code) {
    return res.status(400).json({ code: "bad_code", error: "Invalid coupon code." });
  }
  const pinAccess = verifyGuestTableAccess(req, restaurantId, settings, tableNumber);
  if (!pinAccess.ok) {
    return res.status(pinAccess.status).json({ code: pinAccess.code, error: pinAccess.error });
  }

  const seating = resolveOpenSeatingRow(tableNumber, restaurantId);
  if (!seating) {
    return res.status(404).json({ code: "seat_closed", error: "No open bill for this table." });
  }

  const view = buildSeatingView(seating.id);
  if (view.bill.paid > 0 || view.bill.pending > 0) {
    return res.status(409).json({
      code: "already_paying",
      error: "Codes can't be added once someone has started paying.",
    });
  }

  const coupon = db
    .prepare("SELECT * FROM coupons WHERE restaurant_id = ? AND code = ? AND active = 1")
    .get(restaurantId, code);
  if (!coupon) {
    return res.status(404).json({ code: "bad_code", error: "That code didn't work. Check the spelling." });
  }
  if (view.bill.subtotal < Number(coupon.min_bill || 0)) {
    return res.status(400).json({
      code: "min_bill",
      error: `This code needs a bill of at least ₹${coupon.min_bill}.`,
    });
  }

  const discount = {
    code: coupon.code,
    kind: coupon.kind,
    value: Number(coupon.value),
    min_bill: Number(coupon.min_bill || 0),
    label:
      coupon.kind === "pct"
        ? `${coupon.code} (${coupon.value}% off)`
        : `${coupon.code} (₹${coupon.value} off)`,
  };
  db.prepare("UPDATE table_seatings SET discount_json = ? WHERE id = ?").run(
    JSON.stringify(discount),
    seating.id
  );
  broadcastFloorSync(restaurantId, seating.table_number);
  res.json({ seating: buildSeatingView(seating.id, { requestedTable: tableNumber }) });
});

app.post("/api/public/seating/spin", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const settings = getSettings({ restaurantId });
  const tableNumber = normalizeTableNumber(req.body?.tableNumber);
  if (!tableNumber) return res.status(400).json({ error: "Table number required" });
  const pinAccess = verifyGuestTableAccess(req, restaurantId, settings, tableNumber);
  if (!pinAccess.ok) {
    return res.status(pinAccess.status).json({ code: pinAccess.code, error: pinAccess.error });
  }

  const seating = resolveOpenSeatingRow(tableNumber, restaurantId);
  if (!seating) return res.status(404).json({ code: "seat_closed", error: "Table is not open." });

  if (seating.spin_json) {
    return res.json({
      spin: JSON.parse(seating.spin_json),
      seating: buildSeatingView(seating.id, { requestedTable: tableNumber }),
    });
  }

  const view = buildSeatingView(seating.id);
  if (!view.orders.some((o) => !["cancelled", "rejected"].includes(o.status))) {
    return res.status(400).json({
      code: "order_first",
      error: "Spin & Win opens after your first order.",
    });
  }

  const prizes = Array.isArray(view.spin_prizes) ? view.spin_prizes : [];
  if (prizes.length === 0) {
    return res.status(400).json({ code: "no_spin", error: "Spin & Win is currently disabled." });
  }

  const index = Math.floor(Math.random() * prizes.length);
  const chosen = prizes[index];
  const spinResult = { ...chosen, index };
  db.prepare("UPDATE table_seatings SET spin_json = ? WHERE id = ?").run(
    JSON.stringify(spinResult),
    seating.id
  );

  if (!seating.discount_json && (chosen.kind === "pct" || chosen.kind === "flat") && chosen.value > 0) {
    const discount = {
      code: "SPIN",
      kind: chosen.kind,
      value: Number(chosen.value),
      min_bill: 0,
      label: chosen.label,
    };
    db.prepare("UPDATE table_seatings SET discount_json = ? WHERE id = ?").run(
      JSON.stringify(discount),
      seating.id
    );
  }

  broadcastFloorSync(restaurantId, seating.table_number);
  res.json({
    spin: spinResult,
    seating: buildSeatingView(seating.id, { requestedTable: tableNumber }),
  });
});

app.post("/api/public/seating/loyalty", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const settings = getSettings({ restaurantId });
  if (!settings.loyalty.enabled) {
    return res.status(400).json({ code: "no_loyalty", error: "Rewards aren't running right now." });
  }

  const tableNumber = normalizeTableNumber(req.body?.tableNumber);
  const pinAccess = verifyGuestTableAccess(req, restaurantId, settings, tableNumber);
  if (!pinAccess.ok) {
    return res.status(pinAccess.status).json({ code: pinAccess.code, error: pinAccess.error });
  }
  const phone = String(req.body?.phone || "")
    .replace(/\D/g, "")
    .slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ code: "bad_phone", error: "Enter a 10-digit mobile number." });
  }

  const seating = resolveOpenSeatingRow(tableNumber, restaurantId);
  if (!seating) return res.status(404).json({ code: "seat_closed", error: "No open bill found." });

  db.prepare("UPDATE table_seatings SET guest_phone = ? WHERE id = ?").run(phone, seating.id);
  db.prepare(
    `INSERT INTO loyalty_accounts (restaurant_id, phone, points, total_spent, updated_at)
     VALUES (?, ?, 0, 0, ?) ON CONFLICT(restaurant_id, phone) DO NOTHING`
  ).run(restaurantId, phone, new Date().toISOString());

  broadcastFloorSync(restaurantId, seating.table_number);
  res.json({ seating: buildSeatingView(seating.id, { requestedTable: tableNumber }) });
});

app.post("/api/public/seating/payment", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const settings = getSettings({ restaurantId });
  const tableNumber = normalizeTableNumber(req.body?.tableNumber);
  const pinAccess = verifyGuestTableAccess(req, restaurantId, settings, tableNumber);
  if (!pinAccess.ok) {
    return res.status(pinAccess.status).json({ code: pinAccess.code, error: pinAccess.error });
  }
  const mode = String(req.body?.mode || "").trim();
  const splitType = ["full", "equal", "items", "custom"].includes(req.body?.split)
    ? req.body.split
    : "full";
  const payer = String(req.body?.payer || "").trim().slice(0, 40);
  const amount = Math.round(Number(req.body?.amount || 0) * 100) / 100;
  const tip = Math.round(Math.max(0, Number(req.body?.tip || 0)));

  if (!VALID_PAY_MODES.has(mode)) {
    return res.status(400).json({ code: "bad_mode", error: "Select UPI, Card, or Cash." });
  }
  const seating = resolveOpenSeatingRow(tableNumber, restaurantId);
  if (!seating) {
    return res.status(404).json({ code: "seat_closed", error: "This table's bill is closed." });
  }

  const view = buildSeatingView(seating.id);
  const remaining = Math.max(0, Math.round((view.bill.due - view.bill.pending) * 100) / 100);
  if (!(amount > 0) || amount > remaining + 0.01) {
    return res.status(400).json({
      code: "over_due",
      error: "That's more than what's left on the bill.",
    });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO payments (id, restaurant_id, seating_id, table_number, payer, amount, tip, mode, split_type, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(id, restaurantId, seating.id, seating.table_number, payer, amount, tip, mode, splitType, now);

  const created = db.prepare("SELECT * FROM payments WHERE id = ?").get(id);
  broadcastToStaff(restaurantId, "payment:created", created);
  broadcastFloorSync(restaurantId, seating.table_number);
  res.status(201).json({
    payment: created,
    seating: buildSeatingView(seating.id, { requestedTable: tableNumber }),
  });
});

app.post("/api/public/feedback", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const orderId = String(req.body?.orderId || "").trim();
  const tableNumber = normalizeTableNumber(req.body?.tableNumber);
  const rating = Number.parseInt(req.body?.rating, 10);
  const comment = String(req.body?.comment || "").trim().slice(0, 500);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Rating must be between 1 and 5." });
  }
  const order = orderId
    ? db.prepare("SELECT * FROM orders WHERE id = ? AND restaurant_id = ?").get(orderId, restaurantId)
    : null;
  const resolvedTable = tableNumber || order?.table_number || "";
  if (!resolvedTable) return res.status(400).json({ error: "Table number required." });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO feedback (id, restaurant_id, order_id, seating_id, table_number, rating, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    restaurantId,
    order?.id || crypto.randomUUID(),
    order?.seating_id || null,
    resolvedTable,
    rating,
    comment,
    now
  );

  const item = {
    id,
    restaurant_id: restaurantId,
    order_id: order?.id || null,
    order_number: order?.order_number || null,
    table_number: resolvedTable,
    rating,
    comment,
    created_at: now,
  };
  broadcastToStaff(restaurantId, "feedback:created", item);
  res.status(201).json({ feedback: item });
});

app.post("/api/public/service-calls", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const settings = getSettings({ restaurantId });
  if (!settings.waiter_call_enabled) {
    return res.status(403).json({
      code: "calls_off",
      error: "Calling staff from the table is currently switched off.",
    });
  }

  const tableNumber = normalizeTableNumber(req.body?.tableNumber);
  const callType = String(req.body?.callType || "").trim();
  const tableCheck = validateTableForOrder(settings, tableNumber);
  if (!tableCheck.ok) {
    return res.status(400).json({ code: tableCheck.code, error: tableCheck.message });
  }
  const pinAccess = verifyGuestTableAccess(req, restaurantId, settings, tableNumber);
  if (!pinAccess.ok) {
    return res.status(pinAccess.status).json({ code: pinAccess.code, error: pinAccess.error });
  }
  if (!VALID_CALL_TYPES.has(callType)) {
    return res.status(400).json({ error: "Invalid service call type" });
  }

  const lastCall = db
    .prepare(
      `SELECT created_at FROM service_calls
       WHERE restaurant_id = ? AND table_number = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(restaurantId, tableNumber);
  if (lastCall) {
    const elapsedSec = (Date.now() - new Date(lastCall.created_at).getTime()) / 1000;
    if (elapsedSec < 30) {
      return res.status(429).json({
        code: "too_soon",
        retryAfterSec: Math.ceil(30 - elapsedSec),
        error: `Staff were just called. You can call again in ${Math.ceil(30 - elapsedSec)}s.`,
      });
    }
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO service_calls (id, restaurant_id, table_number, call_type, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(id, restaurantId, tableNumber, callType, now);

  const created = db.prepare("SELECT * FROM service_calls WHERE id = ?").get(id);
  broadcastToStaff(restaurantId, "call:created", created);
  broadcastToTable(restaurantId, tableNumber, "call:updated", created);
  broadcastFloorSync(restaurantId, tableNumber);
  res.status(201).json({ call: created });
});

// ---------- Public Restaurant Table Reservations ----------
app.post("/api/public/reservations", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const settings = getSettings({ restaurantId });
  const activeTablesCount = Math.max(
    0,
    Number(settings.table_config?.total || 12) -
      (settings.table_config?.skip?.length || 0) -
      (settings.table_config?.disabled?.length || 0)
  );
  if (activeTablesCount <= 0) {
    return res.status(400).json({ error: "No bookable dining tables are currently configured." });
  }

  const customerName = String(req.body?.customerName || "").trim().slice(0, 80);
  const customerPhone = String(req.body?.customerPhone || "")
    .replace(/[^\d+]/g, "")
    .slice(0, 15);
  const partySize = Number.parseInt(req.body?.partySize ?? 2, 10);
  const reservationDate = String(req.body?.reservationDate || "").trim();
  const reservationTime = String(req.body?.reservationTime || "").trim();
  const notes = String(req.body?.notes || "").trim().slice(0, 240);

  if (customerName.length < 2) {
    return res.status(400).json({ error: "Please enter the guest's full name." });
  }
  if (customerPhone.replace(/\D/g, "").length < 8) {
    return res.status(400).json({ error: "Please enter a valid contact phone number." });
  }
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) {
    return res.status(400).json({ error: "Party size must be between 1 and 20 guests." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reservationDate)) {
    return res.status(400).json({ error: "Please choose a valid reservation date (YYYY-MM-DD)." });
  }
  const todayDate = new Date().toISOString().slice(0, 10);
  if (reservationDate < todayDate) {
    return res.status(400).json({ error: "Reservation date cannot be in the past." });
  }
  if (
    !isTimeWithinHours(
      reservationTime,
      settings.opening_time || "09:00",
      settings.closing_time || "23:00"
    )
  ) {
    return res.status(400).json({
      error: `Preferred time must fall within restaurant hours (${settings.opening_time || "09:00"} – ${settings.closing_time || "23:00"}).`,
    });
  }

  const slotCount = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM reservations
       WHERE restaurant_id = ? AND reservation_date = ? AND reservation_time = ? AND status IN ('pending', 'confirmed', 'seated')`
    )
    .get(restaurantId, reservationDate, reservationTime).cnt;
  if (Number(slotCount || 0) >= activeTablesCount) {
    return res.status(409).json({
      error: "All tables for this time slot are already booked. Please pick another time.",
    });
  }

  const id = crypto.randomUUID();
  const bookingCode = generateBookingCode();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO reservations (
      id, restaurant_id, booking_code, customer_name, customer_phone, party_size,
      reservation_date, reservation_time, status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(
    id,
    restaurantId,
    bookingCode,
    customerName,
    customerPhone,
    partySize,
    reservationDate,
    reservationTime,
    notes,
    now,
    now
  );

  const created = mapReservation(db.prepare("SELECT * FROM reservations WHERE id = ?").get(id));
  broadcastToStaff(restaurantId, "reservation:created", created);
  res.status(201).json({ reservation: created });
});

app.get("/api/public/reservations", (req, res) => {
  const restaurantId = resolvePublicRestaurant(req, res);
  if (!restaurantId) return;

  const code = String(req.query.code || "").trim().toUpperCase();
  const phone = String(req.query.phone || "")
    .replace(/[^\d+]/g, "")
    .trim();

  if (!code && phone.length < 6) {
    return res.status(400).json({ error: "Provide a booking code or phone number to check status." });
  }

  const rows = code
    ? db
        .prepare("SELECT * FROM reservations WHERE restaurant_id = ? AND UPPER(booking_code) = ? LIMIT 5")
        .all(restaurantId, code)
    : db
        .prepare(
          "SELECT * FROM reservations WHERE restaurant_id = ? AND customer_phone LIKE ? ORDER BY created_at DESC LIMIT 10"
        )
        .all(restaurantId, `%${phone.slice(-8)}`);

  res.json({ reservations: rows.map(mapReservation) });
});

// ---------- Auth Endpoints ----------
app.post("/api/auth/login", (req, res) => {
  const hostHeader = req.headers.host || null;
  let hostTenant = null;
  if (!isPlatformHost(hostHeader)) {
    const ctx = resolveRestaurantContext({ host: hostHeader });
    if (ctx.code === "domain_not_found") {
      return res.status(404).json({ code: ctx.code, error: ctx.error });
    }
    hostTenant = ctx.restaurant || null;
  }

  const ip = getClientIp(req);
  const limitCheck = checkLoginRateLimit(ip);
  if (!limitCheck.allowed) {
    return res.status(429).json({
      error: `Too many failed login attempts. Try again in ${limitCheck.retryAfterSec}s.`,
      retryAfterSec: limitCheck.retryAfterSec,
    });
  }

  const email = String(req.body?.email || req.body?.id || req.body?.username || "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) {
    return res.status(400).json({ error: "Login ID / Email and password are required." });
  }
  const user = db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFailedLogin(ip);
    return res.status(401).json({ error: "Invalid login ID or password." });
  }
  if (hostTenant && user.role !== "super_admin" && user.restaurant_id !== hostTenant.id) {
    return res.status(403).json({
      code: "cross_tenant_forbidden",
      error: "This account is not authorized for this domain.",
    });
  }
  clearFailedLogins(ip);
  const initialRestaurant =
    user.role === "super_admin"
      ? resolveRestaurant(null)?.id || DEFAULT_RESTAURANT_ID
      : user.restaurant_id || DEFAULT_RESTAURANT_ID;
  const session = createSession(user.id, initialRestaurant);
  setSessionCookie(res, session.token);
  res.json({
    user: serializeAuthUser({
      ...user,
      active_restaurant_id: initialRestaurant,
    }),
  });
});

app.post("/api/auth/logout", (req, res) => {
  const user = getSessionUser(req);
  if (user) deleteSession(user.token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const serialized = serializeAuthUser(user);
  const restaurants =
    serialized.role === "super_admin"
      ? listRestaurants({ activeOnly: false }).map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          plan: r.plan,
          is_active: r.is_active,
        }))
      : undefined;
  res.json({ user: serialized, restaurants });
});

app.post("/api/auth/change-password", requireAuth, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: "Current password is incorrect." });
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(newPassword),
    user.id
  );
  revokeOtherUserSessions(user.id, req.user.token);
  res.json({ ok: true });
});

// ---------- Super Admin Platform & Agency Endpoints ----------
app.get("/api/super/overview", requireAuth, requireSuperAdmin, (_req, res) => {
  res.json(buildPlatformOverview());
});

app.get("/api/super/audit-logs", requireAuth, requireSuperAdmin, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query.limit || "50"), 10) || 50));
  res.json({ logs: listPlatformAuditLogs(limit) });
});

app.get("/api/super/platform", requireAuth, requireSuperAdmin, (_req, res) => {
  res.json({ platform: getPlatformSettings({ includeSecret: false }) });
});

app.patch("/api/super/platform", requireAuth, requireSuperAdmin, (req, res) => {
  const updated = updatePlatformSettings(req.body || {});
  logPlatformAudit({
    actorUserId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: "platform.config_updated",
    targetType: "platform",
    targetId: "1",
    metadata: {
      platform_name: updated.platform_name,
      agency_name: updated.agency_name,
    },
  });
  broadcastPlatform("platform:updated", { agency: updated.platform_name });
  res.json({ platform: updated });
});

app.post("/api/super/select-restaurant", requireAuth, requireSuperAdmin, (req, res) => {
  const target = resolveRestaurant(req.body?.restaurantId);
  if (!target) return res.status(404).json({ error: "Restaurant not found." });
  updateSessionRestaurant(req.user.token, target.id);
  res.json({
    active_restaurant_id: target.id,
    settings: getSettings({ restaurantId: target.id }),
  });
});

app.get("/api/super/restaurants/:id", requireAuth, requireSuperAdmin, (req, res) => {
  const existing = db.prepare("SELECT id FROM restaurants WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Restaurant not found." });
  res.json({ restaurant: getSettings({ restaurantId: existing.id }) });
});

app.post("/api/super/restaurants", requireAuth, requireSuperAdmin, (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "Restaurant name is required." });

  const requestedSlug = slugify(req.body?.slug || name) || `venue-${Date.now().toString(36)}`;
  const existingSlug = db.prepare("SELECT id FROM restaurants WHERE slug = ?").get(requestedSlug);
  const finalSlug = existingSlug ? `${requestedSlug}-${Math.random().toString(36).slice(2, 5)}` : requestedSlug;

  const ownerEmail = String(req.body?.ownerEmail || "").trim().toLowerCase();
  const ownerPassword = String(req.body?.ownerPassword || "");
  const ownerName = String(req.body?.ownerName || `${name} Owner`).trim().slice(0, 60);
  if (ownerEmail) {
    if (ownerPassword.length < 6) {
      return res.status(400).json({ error: "Admin password must be at least 6 characters." });
    }
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(ownerEmail)) {
      return res.status(409).json({ error: `Email ${ownerEmail} is already registered.` });
    }
  }

  const domainCheck = validateCustomDomainAvailable(req.body?.custom_domain, null);
  if (!domainCheck.ok) {
    return res.status(domainCheck.status || 400).json({
      code: domainCheck.code || "invalid_domain",
      error: domainCheck.error,
    });
  }
  const customDomain = domainCheck.domain;
  const customDomainVerified =
    customDomain && req.body?.custom_domain_verified === true ? 1 : 0;

  const description =
    String(req.body?.description || "").trim().slice(0, 500) ||
    `${name} — freshly prepared menu & seamless QR ordering.`;
  const plan = VALID_PLANS.has(req.body?.plan) ? req.body.plan : "Pro";
  const planStatus = ["trial", "active", "past_due", "paused"].includes(req.body?.plan_status)
    ? req.body.plan_status
    : "active";
  const planExpiresAt = String(req.body?.plan_expires_at || "").trim().slice(0, 40);
  const tablesTotal = Math.max(1, Math.min(200, Number.parseInt(req.body?.tables ?? 12, 10) || 12));
  const gstRate = Math.max(0, Math.min(28, Number(req.body?.gst_rate ?? 5) || 0));
  const upiId = String(req.body?.upi_id || "").trim().slice(0, 100);
  const sampleMenu = req.body?.sampleMenu !== false;
  const whiteLabel = req.body?.white_label ? 1 : 0;
  const brandBg = /^#[0-9a-fA-F]{6}$/.test(String(req.body?.brand_bg || ""))
    ? String(req.body.brand_bg).toUpperCase()
    : "#FAF8F5";
  const rawPrimary = req.body?.primary_color ?? req.body?.brand_accent;
  const brandAccent = /^#[0-9a-fA-F]{6}$/.test(String(rawPrimary || ""))
    ? String(rawPrimary).toUpperCase()
    : "#49332A";
  const rawSecondary = req.body?.secondary_color ?? req.body?.brand_secondary;
  const brandSecondary = /^#[0-9a-fA-F]{6}$/.test(String(rawSecondary || ""))
    ? String(rawSecondary).toUpperCase()
    : "#766158";
  const takeawayEnabled = req.body?.takeaway_enabled === false ? 0 : 1;
  const deliveryEnabled = req.body?.delivery_enabled ? 1 : 0;
  const deliveryFee = Math.max(0, Number(req.body?.delivery_fee ?? 40) || 0);
  const freeDeliveryMin = Math.max(0, Number(req.body?.free_delivery_min ?? 500) || 0);
  const openingTime = /^\d{1,2}:\d{2}$/.test(String(req.body?.opening_time || ""))
    ? String(req.body.opening_time)
    : "09:00";
  const closingTime = /^\d{1,2}:\d{2}$/.test(String(req.body?.closing_time || ""))
    ? String(req.body.closing_time)
    : "23:00";

  const id = `rest_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO restaurants (
      id, slug, name, description, logo_url, cover_url,
      orders_enabled, waiter_call_enabled, qr_mode, table_config, qr_style, menu_views,
      upi_id, gst_rate, service_charge_pct, require_table_pin, loyalty_config, spin_prizes,
      social_links, wifi_ssid, wifi_password, plan, plan_status, plan_expires_at, is_active,
      white_label, brand_bg, brand_accent, brand_secondary, custom_domain, custom_domain_verified,
      opening_time, closing_time, takeaway_enabled, delivery_enabled, delivery_fee, free_delivery_min,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, '/food/brand-logo.svg', '/food/hero-cover.jpg', 1, 1, 'per_table', ?, ?, 0, ?, ?, 0, 0, ?, ?, '{}', '', '', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    finalSlug,
    name,
    description,
    JSON.stringify({ total: tablesTotal, skip: [], disabled: [] }),
    JSON.stringify(DEFAULT_QR_STYLE),
    upiId,
    gstRate,
    JSON.stringify(DEFAULT_LOYALTY),
    JSON.stringify(DEFAULT_SPIN_PRIZES),
    plan,
    planStatus,
    planExpiresAt,
    whiteLabel,
    brandBg,
    brandAccent,
    brandSecondary,
    customDomain,
    customDomainVerified,
    openingTime,
    closingTime,
    takeawayEnabled,
    deliveryEnabled,
    deliveryFee,
    freeDeliveryMin,
    now,
    now
  );

  seedStarterCatalogForRestaurant(id, { sampleMenu });
  syncServiceUnitsForRestaurant(id);

  let createdAdmin = null;
  if (ownerEmail) {
    const adminId = crypto.randomUUID();
    db.prepare(
      "INSERT INTO users (id, email, password_hash, name, role, restaurant_id, created_at) VALUES (?, ?, ?, ?, 'admin', ?, ?)"
    ).run(adminId, ownerEmail, hashPassword(ownerPassword), ownerName, id, now);
    createdAdmin = { id: adminId, email: ownerEmail, name: ownerName, restaurant_id: id };
  }

  logActivity(id, req.user.name, "venue_created", { name, slug: finalSlug, plan });
  logPlatformAudit({
    actorUserId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: "restaurant.created",
    targetType: "restaurant",
    targetId: id,
    targetRestaurantId: id,
    metadata: {
      slug: finalSlug,
      plan,
      plan_status: planStatus,
      custom_domain: customDomain || null,
      custom_domain_verified: Boolean(customDomainVerified),
    },
  });
  broadcastPlatform("platform:updated", { restaurantId: id });
  res.status(201).json({
    restaurant: getSettings({ restaurantId: id }),
    admin: createdAdmin,
  });
});

app.patch("/api/super/restaurants/:id", requireAuth, requireSuperAdmin, (req, res) => {
  const existing = db.prepare("SELECT * FROM restaurants WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Restaurant not found." });

  const body = req.body || {};
  const name = body.name !== undefined ? String(body.name).trim().slice(0, 80) || existing.name : existing.name;
  const description =
    body.description !== undefined
      ? String(body.description).trim().slice(0, 500)
      : existing.description;
  const plan = VALID_PLANS.has(body.plan) ? body.plan : existing.plan || "Pro";
  const plan_status = ["trial", "active", "past_due", "paused"].includes(body.plan_status)
    ? body.plan_status
    : existing.plan_status || "active";
  const plan_expires_at =
    body.plan_expires_at !== undefined
      ? String(body.plan_expires_at || "").trim().slice(0, 40)
      : existing.plan_expires_at || "";
  const is_active =
    body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active ?? 1;
  const orders_enabled =
    body.orders_enabled !== undefined
      ? body.orders_enabled
        ? 1
        : 0
      : existing.orders_enabled ?? 1;
  const upi_id = body.upi_id !== undefined ? String(body.upi_id).trim().slice(0, 100) : existing.upi_id;
  const gst_rate =
    body.gst_rate !== undefined
      ? Math.max(0, Math.min(28, Number(body.gst_rate) || 0))
      : existing.gst_rate;
  const white_label =
    body.white_label !== undefined ? (body.white_label ? 1 : 0) : existing.white_label ? 1 : 0;
  const brand_bg = /^#[0-9a-fA-F]{6}$/.test(String(body.brand_bg || ""))
    ? String(body.brand_bg).toUpperCase()
    : existing.brand_bg || "#FAF8F5";
  const rawPrimary = body.primary_color ?? body.brand_accent;
  const brand_accent = /^#[0-9a-fA-F]{6}$/.test(String(rawPrimary || ""))
    ? String(rawPrimary).toUpperCase()
    : existing.brand_accent || "#49332A";
  const rawSecondary = body.secondary_color ?? body.brand_secondary;
  const brand_secondary = /^#[0-9a-fA-F]{6}$/.test(String(rawSecondary || ""))
    ? String(rawSecondary).toUpperCase()
    : existing.brand_secondary || "#766158";

  let custom_domain = existing.custom_domain || "";
  if (body.custom_domain !== undefined) {
    const domainCheck = validateCustomDomainAvailable(body.custom_domain, existing.id);
    if (!domainCheck.ok) {
      return res.status(domainCheck.status || 400).json({
        code: domainCheck.code || "invalid_domain",
        error: domainCheck.error,
      });
    }
    custom_domain = domainCheck.domain;
  }
  const domainChanged = custom_domain !== (existing.custom_domain || "");
  const custom_domain_verified = !custom_domain
    ? 0
    : body.custom_domain_verified !== undefined
      ? body.custom_domain_verified
        ? 1
        : 0
      : domainChanged
        ? 0
        : existing.custom_domain_verified
          ? 1
          : 0;

  const opening_time = /^\d{1,2}:\d{2}$/.test(String(body.opening_time || ""))
    ? String(body.opening_time)
    : existing.opening_time || "09:00";
  const closing_time = /^\d{1,2}:\d{2}$/.test(String(body.closing_time || ""))
    ? String(body.closing_time)
    : existing.closing_time || "23:00";
  const takeaway_enabled =
    body.takeaway_enabled !== undefined
      ? body.takeaway_enabled
        ? 1
        : 0
      : existing.takeaway_enabled ?? 1;
  const delivery_enabled =
    body.delivery_enabled !== undefined
      ? body.delivery_enabled
        ? 1
        : 0
      : existing.delivery_enabled ?? 0;
  const delivery_fee =
    body.delivery_fee !== undefined
      ? Math.max(0, Number(body.delivery_fee || 0))
      : Number(existing.delivery_fee ?? 40);
  const free_delivery_min =
    body.free_delivery_min !== undefined
      ? Math.max(0, Number(body.free_delivery_min || 0))
      : Number(existing.free_delivery_min ?? 500);

  let tableCfg = JSON.parse(existing.table_config || '{"total":12,"skip":[],"disabled":[]}');
  if (body.tables !== undefined) {
    tableCfg = {
      ...tableCfg,
      total: Math.max(1, Math.min(200, Number.parseInt(body.tables, 10) || tableCfg.total || 12)),
    };
  }

  let slug = existing.slug;
  if (body.slug !== undefined) {
    const cleanSlug = slugify(body.slug);
    if (cleanSlug && cleanSlug !== existing.slug) {
      const clash = db
        .prepare("SELECT id FROM restaurants WHERE slug = ? AND id != ?")
        .get(cleanSlug, existing.id);
      if (clash) return res.status(409).json({ error: `Slug '${cleanSlug}' is already in use.` });
      slug = cleanSlug;
    }
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE restaurants SET
      name = ?, slug = ?, description = ?, plan = ?, plan_status = ?, plan_expires_at = ?, is_active = ?,
      orders_enabled = ?, upi_id = ?, gst_rate = ?, table_config = ?,
      white_label = ?, brand_bg = ?, brand_accent = ?, brand_secondary = ?,
      custom_domain = ?, custom_domain_verified = ?,
      opening_time = ?, closing_time = ?, takeaway_enabled = ?, delivery_enabled = ?,
      delivery_fee = ?, free_delivery_min = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    name,
    slug,
    description,
    plan,
    plan_status,
    plan_expires_at,
    is_active,
    orders_enabled,
    upi_id,
    gst_rate,
    JSON.stringify(tableCfg),
    white_label,
    brand_bg,
    brand_accent,
    brand_secondary,
    custom_domain,
    custom_domain_verified,
    opening_time,
    closing_time,
    takeaway_enabled,
    delivery_enabled,
    delivery_fee,
    free_delivery_min,
    now,
    existing.id
  );

  syncServiceUnitsForRestaurant(existing.id, tableCfg);
  logActivity(existing.id, req.user.name, "venue_updated", { name, is_active: Boolean(is_active), plan });

  const auditBase = {
    actorUserId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    targetType: "restaurant",
    targetId: existing.id,
    targetRestaurantId: existing.id,
  };
  logPlatformAudit({
    ...auditBase,
    action: "restaurant.updated",
    metadata: { slug, name, is_active: Boolean(is_active), plan, plan_status },
  });
  if (Boolean(is_active) !== Boolean(existing.is_active ?? 1)) {
    logPlatformAudit({
      ...auditBase,
      action: is_active ? "restaurant.reactivated" : "restaurant.suspended",
      metadata: { is_active: Boolean(is_active) },
    });
  }
  if (domainChanged) {
    logPlatformAudit({
      ...auditBase,
      action: "domain.updated",
      metadata: { previous_domain: existing.custom_domain || "", custom_domain },
    });
  }
  if (Boolean(custom_domain_verified) !== Boolean(existing.custom_domain_verified)) {
    logPlatformAudit({
      ...auditBase,
      action: "domain.verification_changed",
      metadata: { custom_domain, verified: Boolean(custom_domain_verified) },
    });
  }
  if (
    plan !== (existing.plan || "Pro") ||
    plan_status !== (existing.plan_status || "active") ||
    plan_expires_at !== (existing.plan_expires_at || "")
  ) {
    logPlatformAudit({
      ...auditBase,
      action: "subscription.updated",
      metadata: { plan, plan_status, plan_expires_at },
    });
  }

  broadcastAll(existing.id, "settings:updated", getSettings({ restaurantId: existing.id, includePrivate: false }));
  broadcastPlatform("platform:updated", { restaurantId: existing.id });
  res.json({ restaurant: getSettings({ restaurantId: existing.id }) });
});

app.post("/api/super/admins", requireAuth, requireSuperAdmin, (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const name = String(req.body?.name || "").trim().slice(0, 60);
  const password = String(req.body?.password || "");
  const restaurantId = String(req.body?.restaurantId || DEFAULT_RESTAURANT_ID).trim();

  if (!email || !name || password.length < 6) {
    return res.status(400).json({ error: "Name, valid email, and 6+ char password are required." });
  }
  const rest = db.prepare("SELECT id FROM restaurants WHERE id = ?").get(restaurantId);
  if (!rest) return res.status(404).json({ error: "Target restaurant not found." });
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, name, role, restaurant_id, created_at) VALUES (?, ?, ?, ?, 'admin', ?, ?)"
  ).run(id, email, hashPassword(password), name, rest.id, now);
  logPlatformAudit({
    actorUserId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: "admin.created",
    targetType: "user",
    targetId: id,
    targetRestaurantId: rest.id,
    metadata: { admin_id: id, restaurant_id: rest.id },
  });
  broadcastPlatform("platform:updated", { adminId: id });
  res.status(201).json({
    admin: db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.restaurant_id, u.created_at, r.name AS restaurant_name, r.slug AS restaurant_slug
         FROM users u LEFT JOIN restaurants r ON r.id = u.restaurant_id WHERE u.id = ?`
      )
      .get(id),
  });
});

app.patch("/api/super/admins/:id", requireAuth, requireSuperAdmin, (req, res) => {
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "User not found." });

  const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 60) || existing.name : existing.name;
  let restaurantId = existing.restaurant_id;
  if (existing.role !== "super_admin" && req.body?.restaurantId) {
    const rest = db.prepare("SELECT id FROM restaurants WHERE id = ?").get(req.body.restaurantId);
    if (!rest) return res.status(404).json({ error: "Restaurant not found." });
    restaurantId = rest.id;
  }

  let passwordHash = existing.password_hash;
  if (req.body?.newPassword) {
    if (String(req.body.newPassword).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }
    passwordHash = hashPassword(String(req.body.newPassword));
  }

  db.prepare("UPDATE users SET name = ?, restaurant_id = ?, password_hash = ? WHERE id = ?").run(
    name,
    restaurantId,
    passwordHash,
    existing.id
  );
  logPlatformAudit({
    actorUserId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action: "admin.updated",
    targetType: "user",
    targetId: existing.id,
    targetRestaurantId: restaurantId || null,
    metadata: {
      admin_id: existing.id,
      restaurant_id: restaurantId || null,
      password_rotated: Boolean(req.body?.newPassword),
    },
  });
  broadcastPlatform("platform:updated", { adminId: existing.id });
  res.json({ ok: true });
});

// ---------- Protected Admin & Kitchen Endpoints ----------
app.get("/api/admin/overview", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const todayIso = startOfPeriodIso("today");
  const yesterdayIso = startOfPeriodIso("yesterday");
  const settings = getSettings({ restaurantId });

  const todayOrders = db
    .prepare("SELECT * FROM orders WHERE restaurant_id = ? AND created_at >= ? ORDER BY created_at DESC")
    .all(restaurantId, todayIso)
    .map(mapOrder);
  const yesterdayOrders = db
    .prepare(
      "SELECT * FROM orders WHERE restaurant_id = ? AND created_at >= ? AND created_at < ?"
    )
    .all(restaurantId, yesterdayIso, todayIso)
    .map(mapOrder);

  const nonCancelled = todayOrders.filter((o) => !["cancelled", "rejected"].includes(o.status));
  const yNonCancelled = yesterdayOrders.filter((o) => !["cancelled", "rejected"].includes(o.status));
  const todayRevenue = nonCancelled.reduce((sum, o) => sum + o.total_amount, 0);
  const yesterdayRevenue = yNonCancelled.reduce((sum, o) => sum + o.total_amount, 0);

  const activeOrders = todayOrders.filter((o) =>
    ["pending", "accepted", "preparing", "ready"].includes(o.status)
  ).length;
  const pendingCalls = db
    .prepare(
      "SELECT COUNT(*) AS cnt FROM service_calls WHERE restaurant_id = ? AND status IN ('pending', 'acknowledged')"
    )
    .get(restaurantId).cnt;
  const totalMenuItems = db
    .prepare("SELECT COUNT(*) AS cnt FROM menu_items WHERE restaurant_id = ?")
    .get(restaurantId).cnt;
  const totalOrders = db
    .prepare("SELECT COUNT(*) AS cnt FROM orders WHERE restaurant_id = ?")
    .get(restaurantId).cnt;
  const fbStats = db
    .prepare("SELECT COUNT(*) AS cnt, AVG(rating) AS avg_r FROM feedback WHERE restaurant_id = ?")
    .get(restaurantId);

  const topMap = new Map();
  for (const o of nonCancelled) {
    for (const line of o.items || []) {
      topMap.set(line.name, (topMap.get(line.name) || 0) + Math.max(1, Number(line.quantity || 1)));
    }
  }
  const topItems = [...topMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  res.json({
    stats: {
      todayRevenue,
      todayOrders: nonCancelled.length,
      yesterdayRevenue,
      yesterdayOrders: yNonCancelled.length,
      activeOrders,
      menuViews: settings.menu_views,
      avgOrderValue: nonCancelled.length ? Math.round(todayRevenue / nonCancelled.length) : 0,
      pendingCalls: Number(pendingCalls || 0),
      totalMenuItems: Number(totalMenuItems || 0),
      totalOrders: Number(totalOrders || 0),
      avgRating: fbStats?.avg_r ? Math.round(Number(fbStats.avg_r) * 10) / 10 : 0,
      totalFeedback: Number(fbStats?.cnt || 0),
    },
    recentOrders: todayOrders.slice(0, 8),
    topItems,
  });
});

app.get("/api/admin/orders", requireAuth, (req, res) => {
  res.json({ orders: listOrders({ restaurantId: req.restaurantId, limit: 300 }) });
});

app.post("/api/admin/orders", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const settings = getSettings({ restaurantId });
  const rawType = String(req.body?.orderType || "dine_in").trim().toLowerCase();
  const orderType = rawType === "takeaway" ? "takeaway" : "dine_in";
  const note = String(req.body?.note || "").trim().slice(0, 200) || null;
  const staffId = String(req.body?.staffId || "").trim();

  let waiterName = actorName(req);
  let resolvedStaffId = null;
  if (staffId) {
    const st = db
      .prepare("SELECT id, name, role, active FROM staff WHERE id = ? AND restaurant_id = ?")
      .get(staffId, restaurantId);
    if (!st || !st.active) {
      return res.status(400).json({ error: "Selected waiter/staff member is inactive or missing." });
    }
    waiterName = st.name;
    resolvedStaffId = st.id;
  }

  let tableNumber = "TAKEAWAY";
  let customerName = String(req.body?.customerName || "").trim().slice(0, 80) || null;
  let customerPhone = String(req.body?.customerPhone || "").replace(/[^\d+]/g, "").slice(0, 15) || null;

  if (orderType === "dine_in") {
    tableNumber = normalizeTableNumber(req.body?.tableNumber);
    const tblCheck = validateTableForOrder(settings, tableNumber);
    if (!tblCheck.ok) {
      return res.status(400).json({ code: tblCheck.code, error: tblCheck.message });
    }
  }

  const linesResult = resolveAuthoritativeLines(req.body?.items, restaurantId);
  if (!linesResult.ok) {
    return res.status(linesResult.status).json({ error: linesResult.error });
  }

  const serviceUnitId = resolveServiceUnitId(restaurantId, tableNumber, orderType);
  const orderTotals = calculateOrderTotals(linesResult.resolvedLines, { orderType });
  const seating =
    orderType === "dine_in" ? ensureOpenSeating(tableNumber, waiterName, restaurantId) : null;
  const now = new Date().toISOString();
  const orderId = crypto.randomUUID();
  const sessionId = `staff:${resolvedStaffId || req.user.id}:${orderId.slice(0, 8)}`;

  let createdOrder;
  db.exec("BEGIN IMMEDIATE");
  try {
    const seqRow = db
      .prepare(
        "SELECT COALESCE(MAX(seq_num), 0) AS max_seq FROM orders WHERE restaurant_id = ? AND created_at >= ?"
      )
      .get(restaurantId, startOfPeriodIso("today"));
    const seqNum = Number(seqRow?.max_seq || 0) + 1;
    const orderNumber = `#${seqNum}`;
    const pickupToken = orderType === "takeaway" ? `PK-${100 + seqNum}` : null;
    const timeline = { pending: now, accepted: now };

    db.prepare(
      `INSERT INTO orders (
        id, restaurant_id, order_number, seq_num, order_type, table_number, service_unit_id, pickup_token,
        customer_name, customer_phone, created_by_staff_id, created_by_staff_name,
        client_session_id, seating_id, items, note, total_amount, status, timeline,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)`
    ).run(
      orderId,
      restaurantId,
      orderNumber,
      seqNum,
      orderType,
      tableNumber,
      serviceUnitId,
      pickupToken,
      customerName,
      customerPhone,
      resolvedStaffId,
      waiterName,
      sessionId,
      seating ? seating.id : null,
      JSON.stringify(linesResult.resolvedLines),
      note,
      orderTotals.total_amount,
      JSON.stringify(timeline),
      now,
      now
    );
    insertOrderItemsForOrder(orderId, restaurantId, linesResult.resolvedLines, {
      gstRate: settings.gst_rate,
      createdAt: now,
    });
    db.exec("COMMIT");
    createdOrder = mapOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId));
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  logActivity(restaurantId, waiterName, "waiter_order_created", {
    table: tableNumber,
    order_number: createdOrder.order_number,
    amount: createdOrder.total_amount,
  });
  broadcastToStaff(restaurantId, "order:created", createdOrder);
  if (orderType === "dine_in") {
    broadcastToTable(restaurantId, tableNumber, "order:updated", createdOrder);
    broadcastFloorSync(restaurantId, tableNumber);
  }
  res.status(201).json({ order: createdOrder });
});

app.patch("/api/admin/orders/:id/status", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const existingRow = db
    .prepare("SELECT * FROM orders WHERE id = ? AND restaurant_id = ?")
    .get(req.params.id, restaurantId);
  if (!existingRow) return res.status(404).json({ error: "Order not found" });

  const existing = mapOrder(existingRow);
  const status =
    req.body?.status !== undefined ? String(req.body.status).trim() : existing.status;
  if (!VALID_ORDER_STATUSES.has(status)) {
    return res.status(400).json({ error: "Invalid order status" });
  }

  let deliveryStatus = existing.delivery_status;
  if (existing.order_type === "delivery") {
    if (req.body?.delivery_status !== undefined) {
      const ds = String(req.body.delivery_status).trim();
      if (!["pending", "preparing", "out_for_delivery", "delivered"].includes(ds)) {
        return res.status(400).json({ error: "Invalid delivery status" });
      }
      deliveryStatus = ds;
    } else if (status === "preparing") {
      deliveryStatus = "preparing";
    } else if (status === "ready") {
      deliveryStatus = "out_for_delivery";
    } else if (status === "completed") {
      deliveryStatus = "delivered";
    }
  }

  const now = new Date().toISOString();
  const timeline = { ...existing.timeline, [status]: now };
  if (deliveryStatus && existing.order_type === "delivery") {
    timeline[`delivery_${deliveryStatus}`] = now;
  }
  db.prepare(
    "UPDATE orders SET status = ?, delivery_status = ?, timeline = ?, updated_at = ? WHERE id = ?"
  ).run(status, deliveryStatus, JSON.stringify(timeline), now, existing.id);
  logActivity(restaurantId, actorName(req), "order_status", { table: existing.table_number, status });

  const updated = mapOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(existing.id));
  broadcastToStaff(restaurantId, "order:updated", updated);
  broadcastToTable(
    restaurantId,
    updated.order_type === "dine_in" ? updated.table_number : null,
    "order:updated",
    updated
  );
  if (updated.order_type === "dine_in") {
    broadcastFloorSync(restaurantId, updated.table_number);
  }
  res.json({ order: updated });
});

app.patch("/api/admin/orders/:id", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const existingRow = db
    .prepare("SELECT * FROM orders WHERE id = ? AND restaurant_id = ?")
    .get(req.params.id, restaurantId);
  if (!existingRow) return res.status(404).json({ error: "Order not found" });
  if (["completed", "cancelled", "rejected"].includes(existingRow.status)) {
    return res.status(409).json({ error: "Completed or cancelled orders cannot be edited." });
  }

  const existing = mapOrder(existingRow);
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : existing.items;
  const linesResult = resolveAuthoritativeLines(rawItems, restaurantId, {
    allowUnavailableExisting: true,
    existingLines: existing.items,
  });
  if (!linesResult.ok) {
    return res.status(linesResult.status).json({ error: linesResult.error });
  }

  const note =
    req.body?.note !== undefined
      ? String(req.body.note || "").trim().slice(0, 200) || null
      : existing.note;
  const settings = getSettings({ restaurantId });
  const orderTotals = calculateOrderTotals(linesResult.resolvedLines, {
    orderType: existing.order_type,
    explicitDeliveryFee: Number(existing.delivery_fee || 0),
  });
  const totalAmount = orderTotals.total_amount;
  const now = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "UPDATE orders SET items = ?, note = ?, total_amount = ?, updated_at = ? WHERE id = ?"
    ).run(JSON.stringify(linesResult.resolvedLines), note, totalAmount, now, existing.id);
    insertOrderItemsForOrder(existing.id, restaurantId, linesResult.resolvedLines, {
      gstRate: settings.gst_rate,
      createdAt: now,
      replaceExisting: true,
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const updated = mapOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(existing.id));
  broadcastToStaff(restaurantId, "order:updated", updated);
  broadcastToTable(
    restaurantId,
    updated.order_type === "dine_in" ? updated.table_number : null,
    "order:updated",
    updated
  );
  if (updated.order_type === "dine_in") {
    broadcastFloorSync(restaurantId, updated.table_number);
  }
  res.json({ order: updated });
});

app.get("/api/admin/reservations", requireAuth, (req, res) => {
  res.json({ reservations: listReservations(req.restaurantId, 200) });
});

app.patch("/api/admin/reservations/:id", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const existing = db
    .prepare("SELECT * FROM reservations WHERE id = ? AND restaurant_id = ?")
    .get(req.params.id, restaurantId);
  if (!existing) return res.status(404).json({ error: "Reservation not found." });

  const settings = getSettings({ restaurantId });
  const body = req.body || {};
  const nextStatus = body.status !== undefined ? String(body.status).trim() : existing.status;
  if (!["pending", "confirmed", "seated", "rejected", "cancelled"].includes(nextStatus)) {
    return res.status(400).json({ error: "Invalid reservation status." });
  }

  const reservationDate =
    body.reservation_date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(body.reservation_date))
      ? String(body.reservation_date)
      : existing.reservation_date;
  const reservationTime =
    body.reservation_time !== undefined &&
    isTimeWithinHours(
      String(body.reservation_time),
      settings.opening_time || "09:00",
      settings.closing_time || "23:00"
    )
      ? String(body.reservation_time)
      : existing.reservation_time;
  const partySize =
    body.party_size !== undefined
      ? Math.max(1, Math.min(20, Number.parseInt(body.party_size, 10) || existing.party_size))
      : Number(existing.party_size);
  const adminNote =
    body.admin_note !== undefined ? String(body.admin_note || "").trim().slice(0, 200) : existing.admin_note || "";

  let assignedTable =
    body.assigned_table !== undefined
      ? normalizeTableNumber(body.assigned_table) || null
      : existing.assigned_table || null;
  if (assignedTable) {
    const check = validateTableForOrder(settings, assignedTable);
    if (!check.ok) return res.status(400).json({ error: check.message });
  }
  if (nextStatus === "seated" && assignedTable) {
    ensureOpenSeating(assignedTable, existing.customer_name, restaurantId);
    broadcastFloorSync(restaurantId, assignedTable);
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE reservations SET
      status = ?, reservation_date = ?, reservation_time = ?, party_size = ?,
      assigned_table = ?, admin_note = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    nextStatus,
    reservationDate,
    reservationTime,
    partySize,
    assignedTable,
    adminNote,
    now,
    existing.id
  );

  logActivity(restaurantId, actorName(req), "reservation_updated", {
    code: existing.booking_code,
    status: nextStatus,
    table: assignedTable,
  });
  const updated = mapReservation(db.prepare("SELECT * FROM reservations WHERE id = ?").get(existing.id));
  broadcastToStaff(restaurantId, "reservation:updated", updated);
  res.json({ reservation: updated });
});

app.get("/api/admin/service-calls", requireAuth, (req, res) => {
  res.json({ calls: listServiceCalls({ restaurantId: req.restaurantId, limit: 150 }) });
});

app.patch("/api/admin/service-calls/:id", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const status = String(req.body?.status || "").trim();
  if (!["acknowledged", "completed"].includes(status)) {
    return res.status(400).json({ error: "Invalid call status" });
  }
  const existing = db
    .prepare("SELECT * FROM service_calls WHERE id = ? AND restaurant_id = ?")
    .get(req.params.id, restaurantId);
  if (!existing) return res.status(404).json({ error: "Service call not found" });

  const by = actorName(req);
  const now = new Date().toISOString();
  if (status === "acknowledged") {
    db.prepare(
      "UPDATE service_calls SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = ? WHERE id = ?"
    ).run(by, now, existing.id);
  } else {
    db.prepare(
      "UPDATE service_calls SET status = 'completed', acknowledged_by = COALESCE(acknowledged_by, ?), acknowledged_at = COALESCE(acknowledged_at, ?), completed_at = ? WHERE id = ?"
    ).run(by, now, now, existing.id);
  }
  logActivity(restaurantId, by, "call_answered", {
    table: existing.table_number,
    status: status === "acknowledged" ? "on the way" : "done",
  });

  const updated = db.prepare("SELECT * FROM service_calls WHERE id = ?").get(existing.id);
  broadcastToStaff(restaurantId, "call:updated", updated);
  broadcastToTable(restaurantId, updated.table_number, "call:updated", updated);
  broadcastFloorSync(restaurantId, updated.table_number);
  res.json({ call: updated });
});

// ---------- Floor / Table POS / Payments / Loyalty ----------
app.get("/api/admin/floor", requireAuth, (req, res) => {
  res.json(buildFloorState(req.restaurantId));
});

app.post("/api/admin/floor/:table/open", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const tableNumber = normalizeTableNumber(req.params.table);
  const by = actorName(req);
  if (!tableNumber) return res.status(400).json({ error: "Invalid table number" });

  const existing = resolveOpenSeatingRow(tableNumber, restaurantId);
  if (existing) {
    return res.json({ seating: buildSeatingView(existing.id, { includePin: true }) });
  }
  const created = ensureOpenSeating(tableNumber, by, restaurantId);
  logActivity(restaurantId, by, "table_opened", { table: tableNumber });
  broadcastFloorSync(restaurantId, tableNumber);
  res.status(201).json({ seating: buildSeatingView(created.id, { includePin: true }) });
});

app.post("/api/admin/floor/:table/pin", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const tableNumber = normalizeTableNumber(req.params.table);
  const by = actorName(req);
  const rawPin = req.body?.pin ? String(req.body.pin).trim() : generateFourDigitPin();
  if (!/^\d{4}$/.test(rawPin)) {
    return res.status(400).json({ error: "Table PIN must be 4 digits." });
  }
  const seating = resolveOpenSeatingRow(tableNumber, restaurantId);
  if (!seating) return res.status(404).json({ error: "No open bill on this table." });

  db.prepare("UPDATE table_seatings SET table_pin = ?, pin_tries = 0 WHERE id = ?").run(
    rawPin,
    seating.id
  );
  logActivity(restaurantId, by, "pin_changed", { table: tableNumber });
  broadcastFloorSync(restaurantId, tableNumber);
  res.json({ seating: buildSeatingView(seating.id, { includePin: true }) });
});

app.post("/api/admin/floor/:table/clean", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const tableNumber = normalizeTableNumber(req.params.table);
  const by = actorName(req);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO table_states (restaurant_id, table_number, status, section, activated_by, updated_at)
     VALUES (?, ?, 'free', '', ?, ?)
     ON CONFLICT(restaurant_id, table_number) DO UPDATE SET status = 'free', activated_by = NULL, updated_at = excluded.updated_at`
  ).run(restaurantId, tableNumber, by, now);
  broadcastFloorSync(restaurantId, tableNumber);
  res.json({ ok: true });
});

app.post("/api/admin/floor/:table/close", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const tableNumber = normalizeTableNumber(req.params.table);
  const by = actorName(req);
  const note = String(req.body?.note || "").trim().slice(0, 120) || null;
  const seating = resolveOpenSeatingRow(tableNumber, restaurantId);
  if (!seating) return res.status(404).json({ error: "That table has no open bill." });

  const view = buildSeatingView(seating.id);
  if (view.bill.due > 0 && !note) {
    return res.status(409).json({
      error: "There's still money due. Take payment first, or enter a close reason.",
    });
  }

  creditLoyaltyIfPaid(seating.id);
  const now = new Date().toISOString();
  const childRows = db
    .prepare(
      "SELECT table_number FROM table_seatings WHERE restaurant_id = ? AND status = 'open' AND (id = ? OR merged_into = ?)"
    )
    .all(restaurantId, seating.id, seating.table_number);

  db.prepare(
    "UPDATE table_seatings SET status = 'closed', close_note = ?, closed_at = ? WHERE restaurant_id = ? AND status = 'open' AND (id = ? OR merged_into = ?)"
  ).run(note, now, restaurantId, seating.id, seating.table_number);

  const upsertClean = db.prepare(
    `INSERT INTO table_states (restaurant_id, table_number, status, section, activated_by, updated_at)
     VALUES (?, ?, 'cleaning', '', NULL, ?)
     ON CONFLICT(restaurant_id, table_number) DO UPDATE SET status = 'cleaning', activated_by = NULL, updated_at = excluded.updated_at`
  );
  for (const r of childRows) {
    upsertClean.run(restaurantId, r.table_number, now);
    broadcastToTable(restaurantId, r.table_number, "seating:updated", { table: r.table_number });
  }

  logActivity(restaurantId, by, note && view.bill.due > 0 ? "bill_closed_unpaid" : "bill_closed", {
    table: seating.table_number,
    amount: view.bill.total,
    note,
  });
  broadcastFloorSync(restaurantId, seating.table_number);
  res.json({ ok: true });
});

app.post("/api/admin/floor/:table/transfer", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const fromTable = normalizeTableNumber(req.params.table);
  const toTable = normalizeTableNumber(req.body?.toTable);
  const by = actorName(req);
  if (!fromTable || !toTable || fromTable === toTable) {
    return res.status(400).json({ error: "Pick a different destination table." });
  }
  const seating = resolveOpenSeatingRow(fromTable, restaurantId);
  if (!seating) return res.status(404).json({ error: "Source table has no open seating." });
  if (resolveOpenSeatingRow(toTable, restaurantId)) {
    return res.status(409).json({ error: "That table already has guests. Merge instead." });
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE table_seatings SET table_number = ? WHERE id = ?").run(toTable, seating.id);
  db.prepare("UPDATE orders SET table_number = ? WHERE seating_id = ?").run(toTable, seating.id);
  db.prepare("UPDATE payments SET table_number = ? WHERE seating_id = ?").run(toTable, seating.id);
  db.prepare(
    "UPDATE table_states SET status = 'free', updated_at = ? WHERE restaurant_id = ? AND table_number = ?"
  ).run(now, restaurantId, fromTable);
  db.prepare(
    `INSERT INTO table_states (restaurant_id, table_number, status, section, activated_by, updated_at)
     VALUES (?, ?, 'open', '', ?, ?)
     ON CONFLICT(restaurant_id, table_number) DO UPDATE SET status = 'open', updated_at = excluded.updated_at`
  ).run(restaurantId, toTable, by, now);

  logActivity(restaurantId, by, "table_moved", { from: fromTable, to: toTable });
  broadcastFloorSync(restaurantId, fromTable);
  broadcastFloorSync(restaurantId, toTable);
  res.json({ ok: true });
});

app.post("/api/admin/floor/:table/merge", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const fromTable = normalizeTableNumber(req.params.table);
  const intoTable = normalizeTableNumber(req.body?.intoTable);
  const by = actorName(req);
  if (!fromTable || !intoTable || fromTable === intoTable) {
    return res.status(400).json({ error: "Pick another seated table to join bills with." });
  }
  const fromSeating = db
    .prepare(
      "SELECT * FROM table_seatings WHERE restaurant_id = ? AND table_number = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1"
    )
    .get(restaurantId, fromTable);
  const intoSeating = resolveOpenSeatingRow(intoTable, restaurantId);
  if (!fromSeating || !intoSeating || fromSeating.id === intoSeating.id) {
    return res.status(400).json({ error: "Both tables need active seatings." });
  }
  const pending = db
    .prepare("SELECT COUNT(*) AS cnt FROM payments WHERE seating_id = ? AND status = 'pending'")
    .get(fromSeating.id).cnt;
  if (pending > 0) {
    return res.status(409).json({ error: "Settle pending payments on this table before merging." });
  }

  db.prepare("UPDATE orders SET seating_id = ? WHERE seating_id = ?").run(
    intoSeating.id,
    fromSeating.id
  );
  db.prepare("UPDATE payments SET seating_id = ? WHERE seating_id = ?").run(
    intoSeating.id,
    fromSeating.id
  );
  db.prepare("UPDATE table_seatings SET merged_into = ? WHERE id = ?").run(
    intoSeating.table_number,
    fromSeating.id
  );

  logActivity(restaurantId, by, "tables_merged", {
    from: fromTable,
    into: intoSeating.table_number,
  });
  broadcastFloorSync(restaurantId, fromTable);
  broadcastFloorSync(restaurantId, intoSeating.table_number);
  res.json({ ok: true });
});

app.post("/api/admin/floor/:table/payment", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const tableNumber = normalizeTableNumber(req.params.table);
  const mode = String(req.body?.mode || "cash").trim();
  const by = actorName(req);
  const amount = Math.round(Number(req.body?.amount || 0) * 100) / 100;
  const tip = Math.round(Math.max(0, Number(req.body?.tip || 0)));

  if (!VALID_PAY_MODES.has(mode)) return res.status(400).json({ error: "Invalid payment mode." });
  const seating = resolveOpenSeatingRow(tableNumber, restaurantId);
  if (!seating) return res.status(404).json({ error: "That table has no open bill." });

  const view = buildSeatingView(seating.id);
  const maxPayable = Math.max(0, Math.round((view.bill.due - view.bill.pending) * 100) / 100);
  if (!(amount > 0) || amount > maxPayable + 0.01) {
    return res.status(400).json({ error: "That's more than what's left on the bill." });
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO payments (
      id, restaurant_id, seating_id, table_number, payer, amount, tip, mode, split_type, status, handled_by, created_at, settled_at
    ) VALUES (?, ?, ?, ?, 'Counter', ?, ?, ?, 'full', 'confirmed', ?, ?, ?)`
  ).run(id, restaurantId, seating.id, seating.table_number, amount, tip, mode, by, now, now);

  creditLoyaltyIfPaid(seating.id);
  logActivity(restaurantId, by, "payment_taken", { table: seating.table_number, amount, mode });
  broadcastFloorSync(restaurantId, seating.table_number);
  res.status(201).json({ seating: buildSeatingView(seating.id, { includePin: true }) });
});

app.post("/api/admin/payments/:id/settle", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const accept = Boolean(req.body?.accept);
  const by = actorName(req);
  const payRow = db
    .prepare("SELECT * FROM payments WHERE id = ? AND restaurant_id = ?")
    .get(req.params.id, restaurantId);
  if (!payRow) return res.status(404).json({ error: "Payment not found." });
  if (payRow.status !== "pending") {
    return res.status(409).json({ error: "That payment was already handled." });
  }

  const now = new Date().toISOString();
  const nextStatus = accept ? "confirmed" : "rejected";
  db.prepare("UPDATE payments SET status = ?, handled_by = ?, settled_at = ? WHERE id = ?").run(
    nextStatus,
    by,
    now,
    payRow.id
  );

  if (accept) creditLoyaltyIfPaid(payRow.seating_id);
  logActivity(restaurantId, by, accept ? "payment_confirmed" : "payment_rejected", {
    table: payRow.table_number,
    amount: payRow.amount,
    mode: payRow.mode,
  });

  const view = buildSeatingView(payRow.seating_id, { includePin: true });
  broadcastToStaff(restaurantId, "payment:updated", { id: payRow.id, status: nextStatus });
  broadcastFloorSync(restaurantId, payRow.table_number);
  res.json({ due: view?.bill?.due ?? 0, seating: view });
});

app.post("/api/admin/loyalty/redeem", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const phone = String(req.body?.phone || "").replace(/\D/g, "").slice(-10);
  const tableNumber = normalizeTableNumber(req.body?.tableNumber);
  const by = actorName(req);
  const settings = getSettings({ restaurantId });
  const goal = settings.loyalty.goal || 200;

  const acct = db
    .prepare("SELECT * FROM loyalty_accounts WHERE restaurant_id = ? AND phone = ?")
    .get(restaurantId, phone);
  if (!acct || Number(acct.points || 0) < goal) {
    return res.status(400).json({ error: "Not enough points for the reward yet." });
  }
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE loyalty_accounts SET points = points - ?, updated_at = ? WHERE restaurant_id = ? AND phone = ?"
  ).run(goal, now, restaurantId, phone);
  logActivity(restaurantId, by, "reward_redeemed", { table: tableNumber, note: settings.loyalty.reward });
  broadcastFloorSync(restaurantId, tableNumber);
  res.json({ ok: true, remainingPoints: Number(acct.points) - goal });
});

// ---------- Staff & Activity ----------
app.get("/api/admin/staff", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const logs = db
    .prepare(
      "SELECT id, staff_name, action, details_json, created_at FROM activity_log WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT 200"
    )
    .all(restaurantId)
    .map((r) => ({
      id: r.id,
      staff_name: r.staff_name,
      action: r.action,
      details: JSON.parse(r.details_json || "{}"),
      created_at: r.created_at,
    }));
  res.json({ staff: listStaff(restaurantId), logs });
});

app.post("/api/admin/staff", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const name = String(req.body?.name || "").trim().slice(0, 40);
  const role = String(req.body?.role || "waiter").trim();
  const pin = req.body?.pin ? String(req.body.pin).trim() : "";
  const section = String(req.body?.section || "").trim().slice(0, 30);
  const active = req.body?.active === false ? 0 : 1;

  if (!name) return res.status(400).json({ error: "Staff name is required." });
  if (!VALID_STAFF_ROLES.has(role)) return res.status(400).json({ error: "Invalid staff role." });
  if (!/^\d{4,6}$/.test(pin)) {
    return res.status(400).json({ error: "PINs are 4 to 6 digits." });
  }
  if (
    db.prepare("SELECT id FROM staff WHERE restaurant_id = ? AND pin = ?").get(restaurantId, pin)
  ) {
    return res.status(409).json({ error: "Another staff member already uses that PIN." });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO staff (id, restaurant_id, name, role, pin, section, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, restaurantId, name, role, pin, section, active, now);
  logActivity(restaurantId, actorName(req), "staff_added", { name });
  res.status(201).json({ member: listStaff(restaurantId).find((m) => m.id === id) });
});

app.patch("/api/admin/staff/:id", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const existing = db
    .prepare("SELECT * FROM staff WHERE id = ? AND restaurant_id = ?")
    .get(req.params.id, restaurantId);
  if (!existing) return res.status(404).json({ error: "Staff member not found." });

  const name =
    req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 40) : existing.name;
  const role =
    req.body?.role !== undefined && VALID_STAFF_ROLES.has(req.body.role)
      ? req.body.role
      : existing.role;
  const section =
    req.body?.section !== undefined ? String(req.body.section).trim().slice(0, 30) : existing.section;
  const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : existing.active;
  let pin = existing.pin;

  if (req.body?.pin && String(req.body.pin).trim()) {
    const cleanPin = String(req.body.pin).trim();
    if (!/^\d{4,6}$/.test(cleanPin)) {
      return res.status(400).json({ error: "PINs are 4 to 6 digits." });
    }
    const dupe = db
      .prepare("SELECT id FROM staff WHERE restaurant_id = ? AND pin = ? AND id != ?")
      .get(restaurantId, cleanPin, existing.id);
    if (dupe) return res.status(409).json({ error: "Another staff member already uses that PIN." });
    pin = cleanPin;
  }

  db.prepare("UPDATE staff SET name = ?, role = ?, pin = ?, section = ?, active = ? WHERE id = ?").run(
    name,
    role,
    pin,
    section,
    active,
    existing.id
  );
  logActivity(restaurantId, actorName(req), "staff_updated", { name });
  res.json({ member: listStaff(restaurantId).find((m) => m.id === existing.id) });
});

app.post("/api/admin/staff/unlock", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const pin = String(req.body?.pin || "").trim();
  const staffRow = db
    .prepare(
      "SELECT id, name, role, section FROM staff WHERE restaurant_id = ? AND pin = ? AND active = 1"
    )
    .get(restaurantId, pin);
  if (!staffRow) return res.status(401).json({ error: "That PIN didn't match an active staff member." });
  logActivity(restaurantId, staffRow.name, "shift_started", { name: staffRow.name });
  res.json({ staff: staffRow });
});

// ---------- Coupons ----------
app.get("/api/admin/coupons", requireAuth, (req, res) => {
  res.json({ coupons: listCoupons({ restaurantId: req.restaurantId }) });
});

app.post("/api/admin/coupons", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const code = String(req.body?.code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
  const kind = req.body?.kind === "flat" ? "flat" : "pct";
  const value = Number(req.body?.value);
  const minBill = Math.max(0, Number(req.body?.min_bill || 0));

  if (!/^[A-Z0-9]{3,16}$/.test(code) || !(value > 0) || (kind === "pct" && value > 100)) {
    return res.status(400).json({ error: "Use a 3-16 character code and valid discount value." });
  }
  if (
    db
      .prepare("SELECT id FROM coupons WHERE restaurant_id = ? AND code = ?")
      .get(restaurantId, code)
  ) {
    return res.status(409).json({ error: `${code} already exists.` });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO coupons (id, restaurant_id, code, kind, value, min_bill, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)"
  ).run(id, restaurantId, code, kind, value, minBill, now);
  res.status(201).json({ coupon: listCoupons({ restaurantId }).find((c) => c.id === id) });
});

app.patch("/api/admin/coupons/:id", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const row = db
    .prepare("SELECT * FROM coupons WHERE id = ? AND restaurant_id = ?")
    .get(req.params.id, restaurantId);
  if (!row) return res.status(404).json({ error: "Coupon not found." });
  const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : row.active ? 0 : 1;
  db.prepare("UPDATE coupons SET active = ? WHERE id = ?").run(active, row.id);
  res.json({ coupon: listCoupons({ restaurantId }).find((c) => c.id === row.id) });
});

app.delete("/api/admin/coupons/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM coupons WHERE id = ? AND restaurant_id = ?").run(
    req.params.id,
    req.restaurantId
  );
  res.json({ ok: true });
});

// ---------- Reports ----------
app.get("/api/admin/reports", requireAuth, (req, res) => {
  const period = ["today", "7d", "30d"].includes(req.query.period) ? req.query.period : "today";
  res.json(buildReports(period, req.restaurantId));
});

// ---------- Menu CRUD ----------
app.get("/api/admin/menu", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  res.json({
    categories: listCategories(restaurantId),
    items: listMenuItems({ restaurantId, availableOnly: false }),
  });
});

app.post("/api/admin/categories", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const name = String(req.body?.name || "").trim().slice(0, 60);
  const station = String(req.body?.station || "").trim().slice(0, 30);
  if (!name) return res.status(400).json({ error: "Category name is required" });

  const maxRow = db
    .prepare(
      "SELECT COALESCE(MAX(display_order), -1) AS max_order FROM categories WHERE restaurant_id = ?"
    )
    .get(restaurantId);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const displayOrder = Number(maxRow?.max_order ?? -1) + 1;

  db.prepare(
    "INSERT INTO categories (id, restaurant_id, name, station, display_order, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, restaurantId, name, station, displayOrder, now);

  const created = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  res.status(201).json({ category: created });
});

app.patch("/api/admin/categories/:id", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const existing = db
    .prepare("SELECT * FROM categories WHERE id = ? AND restaurant_id = ?")
    .get(req.params.id, restaurantId);
  if (!existing) return res.status(404).json({ error: "Category not found" });

  const name =
    req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 60) : existing.name;
  const station =
    req.body?.station !== undefined
      ? String(req.body.station).trim().slice(0, 30)
      : existing.station;
  const displayOrder =
    req.body?.display_order !== undefined
      ? Number(req.body.display_order)
      : existing.display_order;

  if (!name) return res.status(400).json({ error: "Category name cannot be empty" });

  db.prepare("UPDATE categories SET name = ?, station = ?, display_order = ? WHERE id = ?").run(
    name,
    station,
    displayOrder,
    existing.id
  );
  res.json({ category: db.prepare("SELECT * FROM categories WHERE id = ?").get(existing.id) });
});

app.delete("/api/admin/categories/:id", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const existing = db
    .prepare("SELECT * FROM categories WHERE id = ? AND restaurant_id = ?")
    .get(req.params.id, restaurantId);
  if (!existing) return res.status(404).json({ error: "Category not found" });
  db.prepare("DELETE FROM categories WHERE id = ?").run(existing.id);
  res.json({ ok: true });
});

function sanitizeItemPayload(body) {
  const name = String(body?.name || "").trim().slice(0, 100);
  const description = String(body?.description || "").trim().slice(0, 400);
  const price = Number(body?.price);
  const category_id = body?.category_id ? String(body.category_id) : null;
  const image_url = body?.image_url ? String(body.image_url).trim().slice(0, 500) : null;
  const is_veg = [0, 1, 2].includes(Number(body?.is_veg)) ? Number(body.is_veg) : 1;
  const is_bestseller = body?.is_bestseller ? 1 : 0;
  const is_chef_special = body?.is_chef_special ? 1 : 0;
  const is_available = body?.is_available === false ? 0 : 1;
  const prep_minutes = Math.max(
    1,
    Math.min(180, Number.parseInt(body?.prep_minutes ?? 10, 10) || 10)
  );

  const size_variants = Array.isArray(body?.size_variants)
    ? body.size_variants
        .map((s) => ({
          name: String(s?.name || "").trim().slice(0, 40),
          price: Number(s?.price),
        }))
        .filter((s) => s.name && Number.isFinite(s.price) && s.price >= 0)
    : [];

  const addons = Array.isArray(body?.addons)
    ? body.addons
        .map((a) => ({
          name: String(a?.name || "").trim().slice(0, 50),
          price: Number(a?.price),
        }))
        .filter((a) => a.name && Number.isFinite(a.price) && a.price >= 0)
    : [];

  return {
    name,
    description,
    price,
    category_id,
    image_url,
    is_veg,
    is_bestseller,
    is_chef_special,
    is_available,
    prep_minutes,
    size_variants,
    addons,
  };
}

app.post("/api/admin/items", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const data = sanitizeItemPayload(req.body);
  if (!data.name) return res.status(400).json({ error: "Dish name is required" });
  if (!Number.isFinite(data.price) || data.price < 0) {
    return res.status(400).json({ error: "Valid price is required" });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO menu_items (
      id, restaurant_id, category_id, name, description, price, image_url,
      is_veg, is_bestseller, is_chef_special, is_available, prep_minutes,
      size_variants, addons, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    restaurantId,
    data.category_id,
    data.name,
    data.description,
    data.price,
    data.image_url,
    data.is_veg,
    data.is_bestseller,
    data.is_chef_special,
    data.is_available,
    data.prep_minutes,
    JSON.stringify(data.size_variants),
    JSON.stringify(data.addons),
    now
  );

  const created = listMenuItems({ restaurantId }).find((i) => i.id === id);
  res.status(201).json({ item: created });
});

app.patch("/api/admin/items/:id", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const existing = db
    .prepare("SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?")
    .get(req.params.id, restaurantId);
  if (!existing) return res.status(404).json({ error: "Item not found" });

  if (Object.keys(req.body || {}).length === 1 && req.body.is_available !== undefined) {
    db.prepare("UPDATE menu_items SET is_available = ? WHERE id = ?").run(
      req.body.is_available ? 1 : 0,
      existing.id
    );
    const updated = listMenuItems({ restaurantId }).find((i) => i.id === existing.id);
    return res.json({ item: updated });
  }

  const data = sanitizeItemPayload(req.body);
  if (!data.name) return res.status(400).json({ error: "Dish name is required" });
  if (!Number.isFinite(data.price) || data.price < 0) {
    return res.status(400).json({ error: "Valid price is required" });
  }

  db.prepare(
    `UPDATE menu_items SET
      category_id = ?, name = ?, description = ?, price = ?, image_url = ?,
      is_veg = ?, is_bestseller = ?, is_chef_special = ?, is_available = ?,
      prep_minutes = ?, size_variants = ?, addons = ?
     WHERE id = ?`
  ).run(
    data.category_id,
    data.name,
    data.description,
    data.price,
    data.image_url,
    data.is_veg,
    data.is_bestseller,
    data.is_chef_special,
    data.is_available,
    data.prep_minutes,
    JSON.stringify(data.size_variants),
    JSON.stringify(data.addons),
    existing.id
  );

  const updated = listMenuItems({ restaurantId }).find((i) => i.id === existing.id);
  res.json({ item: updated });
});

app.delete("/api/admin/items/:id", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const existing = db
    .prepare("SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?")
    .get(req.params.id, restaurantId);
  if (!existing) return res.status(404).json({ error: "Item not found" });
  db.prepare("DELETE FROM menu_items WHERE id = ?").run(existing.id);
  res.json({ ok: true });
});

app.post("/api/admin/upload", requireAuth, (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Image upload failed" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }
    if (!hasValidImageMagicBytes(req.file.path, req.file.mimetype)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // ignore unlink error
      }
      return res.status(400).json({ error: "Uploaded file signature does not match an image format." });
    }
    res.status(201).json({ url: `/uploads/${req.file.filename}` });
  });
});

app.get("/api/admin/settings", requireAuth, (req, res) => {
  res.json({ settings: getSettings({ restaurantId: req.restaurantId }) });
});

app.patch("/api/admin/settings", requireAuth, (req, res) => {
  const restaurantId = req.restaurantId;
  const current = getSettings({ restaurantId });
  const body = req.body || {};

  const name =
    body.name !== undefined ? String(body.name).trim().slice(0, 100) || current.name : current.name;
  const description =
    body.description !== undefined
      ? String(body.description).trim().slice(0, 500)
      : current.description;
  const logo_url = body.logo_url !== undefined ? body.logo_url || null : current.logo_url;
  const cover_url = body.cover_url !== undefined ? body.cover_url || null : current.cover_url;
  const orders_enabled =
    body.orders_enabled !== undefined ? (body.orders_enabled ? 1 : 0) : current.orders_enabled ? 1 : 0;
  const waiter_call_enabled =
    body.waiter_call_enabled !== undefined
      ? body.waiter_call_enabled
        ? 1
        : 0
      : current.waiter_call_enabled
        ? 1
        : 0;
  const qr_mode =
    body.qr_mode === "single" || body.qr_mode === "per_table" ? body.qr_mode : current.qr_mode;

  const upi_id =
    body.upi_id !== undefined ? String(body.upi_id || "").trim().slice(0, 100) : current.upi_id;
  const gst_rate =
    body.gst_rate !== undefined
      ? Math.max(0, Math.min(28, Number(body.gst_rate) || 0))
      : current.gst_rate;
  const service_charge_pct =
    body.service_charge_pct !== undefined
      ? Math.max(0, Math.min(20, Number(body.service_charge_pct) || 0))
      : current.service_charge_pct;
  const require_table_pin =
    body.require_table_pin !== undefined
      ? body.require_table_pin
        ? 1
        : 0
      : current.require_table_pin
        ? 1
        : 0;
  const wifi_ssid =
    body.wifi_ssid !== undefined ? String(body.wifi_ssid || "").trim().slice(0, 64) : current.wifi_ssid;
  const wifi_password =
    body.wifi_password !== undefined
      ? String(body.wifi_password || "").trim().slice(0, 64)
      : current.wifi_password;

  let loyalty = current.loyalty;
  if (body.loyalty && typeof body.loyalty === "object") {
    loyalty = {
      enabled: body.loyalty.enabled !== false,
      rupees_per_point: Math.max(1, Number(body.loyalty.rupees_per_point || 10)),
      goal: Math.max(1, Number(body.loyalty.goal || 200)),
      reward: String(body.loyalty.reward || "Free Dessert").trim().slice(0, 40) || "Free Dessert",
    };
  }

  let spin_prizes = current.spin_prizes;
  if (Array.isArray(body.spin_prizes)) {
    spin_prizes = body.spin_prizes
      .slice(0, 8)
      .map((p) => ({
        label: String(p?.label || "").trim().slice(0, 24),
        kind: ["pct", "flat", "item", "none"].includes(p?.kind) ? p.kind : "none",
        ...(p?.kind === "pct" || p?.kind === "flat"
          ? { value: Math.min(p.kind === "pct" ? 100 : 100000, Math.max(0, Number(p?.value || 0))) }
          : {}),
      }))
      .filter((p) => p.label);
  }

  let social_links = current.social_links;
  if (body.social_links && typeof body.social_links === "object") {
    social_links = {};
    for (const k of ["instagram", "facebook", "website", "google_review"]) {
      const val = String(body.social_links[k] || "").trim();
      if (val && !/^https?:\/\//i.test(val)) {
        return res.status(400).json({ error: `Link must start with http:// or https:// (${val})` });
      }
      if (val) social_links[k] = val.slice(0, 300);
    }
  }

  let table_config = current.table_config;
  if (body.table_config && typeof body.table_config === "object") {
    const total = Math.max(1, Math.min(200, Number.parseInt(body.table_config.total ?? 12, 10) || 12));
    const skip = Array.isArray(body.table_config.skip)
      ? [...new Set(body.table_config.skip.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
      : [];
    const disabled = Array.isArray(body.table_config.disabled)
      ? [...new Set(body.table_config.disabled.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
      : [];
    table_config = { total, skip, disabled };
  }

  let qr_style = current.qr_style || DEFAULT_QR_STYLE;
  if (body.qr_style && typeof body.qr_style === "object") {
    const s = body.qr_style;
    qr_style = {
      style: ["standard", "circle", "square", "rounded", "dots", "elegant"].includes(s.style)
        ? s.style
        : qr_style.style,
      fgColor: String(s.fgColor || qr_style.fgColor).slice(0, 32),
      bgColor: String(s.bgColor || qr_style.bgColor).slice(0, 16),
      dotScale: Math.min(1, Math.max(0.5, Number(s.dotScale ?? qr_style.dotScale))),
      frameStyle: ["none", "simple", "rounded", "fancy"].includes(s.frameStyle)
        ? s.frameStyle
        : qr_style.frameStyle,
    };
  }

  const white_label =
    body.white_label !== undefined ? (body.white_label ? 1 : 0) : current.white_label ? 1 : 0;
  const brand_bg = /^#[0-9a-fA-F]{6}$/.test(String(body.brand_bg || ""))
    ? String(body.brand_bg).toUpperCase()
    : current.brand_bg || "#FAF8F5";
  const rawPrimary = body.primary_color ?? body.brand_accent;
  const brand_accent = /^#[0-9a-fA-F]{6}$/.test(String(rawPrimary || ""))
    ? String(rawPrimary).toUpperCase()
    : current.brand_accent || "#49332A";
  const rawSecondary = body.secondary_color ?? body.brand_secondary;
  const brand_secondary = /^#[0-9a-fA-F]{6}$/.test(String(rawSecondary || ""))
    ? String(rawSecondary).toUpperCase()
    : current.brand_secondary || "#766158";

  let custom_domain = current.custom_domain || "";
  if (body.custom_domain !== undefined) {
    const domainCheck = validateCustomDomainAvailable(body.custom_domain, restaurantId);
    if (!domainCheck.ok) {
      return res.status(domainCheck.status || 400).json({
        code: domainCheck.code || "invalid_domain",
        error: domainCheck.error,
      });
    }
    custom_domain = domainCheck.domain;
  }
  // Security rule: only Super Admin verification sets custom_domain_verified=1; changing domain resets verification.
  const domainChanged = custom_domain !== (current.custom_domain || "");
  const custom_domain_verified = !custom_domain
    ? 0
    : domainChanged
      ? 0
      : current.custom_domain_verified
        ? 1
        : 0;

  const opening_time = /^\d{1,2}:\d{2}$/.test(String(body.opening_time || ""))
    ? String(body.opening_time)
    : current.opening_time || "09:00";
  const closing_time = /^\d{1,2}:\d{2}$/.test(String(body.closing_time || ""))
    ? String(body.closing_time)
    : current.closing_time || "23:00";
  const takeaway_enabled =
    body.takeaway_enabled !== undefined
      ? body.takeaway_enabled
        ? 1
        : 0
      : current.takeaway_enabled !== false
        ? 1
        : 0;
  const delivery_enabled =
    body.delivery_enabled !== undefined
      ? body.delivery_enabled
        ? 1
        : 0
      : current.delivery_enabled
        ? 1
        : 0;
  const delivery_fee =
    body.delivery_fee !== undefined
      ? Math.max(0, Number(body.delivery_fee || 0))
      : Number(current.delivery_fee ?? 40);
  const free_delivery_min =
    body.free_delivery_min !== undefined
      ? Math.max(0, Number(body.free_delivery_min || 0))
      : Number(current.free_delivery_min ?? 500);

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE restaurants SET
      name = ?, description = ?, logo_url = ?, cover_url = ?,
      orders_enabled = ?, waiter_call_enabled = ?, qr_mode = ?,
      table_config = ?, qr_style = ?, upi_id = ?, gst_rate = ?, service_charge_pct = ?,
      require_table_pin = ?, loyalty_config = ?, spin_prizes = ?,
      social_links = ?, wifi_ssid = ?, wifi_password = ?,
      white_label = ?, brand_bg = ?, brand_accent = ?, brand_secondary = ?,
      custom_domain = ?, custom_domain_verified = ?,
      opening_time = ?, closing_time = ?, takeaway_enabled = ?, delivery_enabled = ?,
      delivery_fee = ?, free_delivery_min = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    name,
    description,
    logo_url,
    cover_url,
    orders_enabled,
    waiter_call_enabled,
    qr_mode,
    JSON.stringify(table_config),
    JSON.stringify(qr_style),
    upi_id,
    gst_rate,
    service_charge_pct,
    require_table_pin,
    JSON.stringify(loyalty),
    JSON.stringify(spin_prizes),
    JSON.stringify(social_links),
    wifi_ssid,
    wifi_password,
    white_label,
    brand_bg,
    brand_accent,
    brand_secondary,
    custom_domain,
    custom_domain_verified,
    opening_time,
    closing_time,
    takeaway_enabled,
    delivery_enabled,
    delivery_fee,
    free_delivery_min,
    now,
    restaurantId
  );

  syncServiceUnitsForRestaurant(restaurantId, table_config);
  const updated = getSettings({ restaurantId });
  broadcastAll(restaurantId, "settings:updated", getSettings({ restaurantId, includePrivate: false }));
  broadcastFloorSync(restaurantId);
  res.json({ settings: updated });
});

app.all(/^\/api\/.*/, (_req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// Serve built client when present (production / preview) with strict host isolation
const clientDist = path.resolve(SERVER_ROOT, "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: "1d" }));
  app.get(/^\/(?!api|uploads|ws).*/, (req, res) => {
    const hostHeader = req.headers.host || null;
    if (!isPlatformHost(hostHeader)) {
      const ctx = resolveRestaurantContext({ host: hostHeader });
      if (!ctx.ok) {
        const status = ctx.status === 404 ? 404 : 403;
        const title = status === 404 ? "Domain Not Found" : "Domain Unavailable";
        return res
          .status(status)
          .type("html")
          .send(
            `<!doctype html><html><head><meta charset="utf-8"><title>${status} — ${title}</title></head><body style="font-family:system-ui,sans-serif;background:#FAF8F5;color:#49332A;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="background:#fff;border:1px solid #E4DDD5;border-radius:20px;padding:32px;max-width:440px;text-align:center"><h1 style="margin:0 0 8px">${status} · ${title}</h1><p style="margin:0;color:#766158">${ctx.error}</p></div></body></html>`
          );
      }
      const slugMatch = /^\/r\/([^/]+)/i.exec(req.path || "");
      if (slugMatch && slugMatch[1].toLowerCase() !== String(ctx.restaurant.slug).toLowerCase()) {
        return res
          .status(403)
          .type("html")
          .send(
            `<!doctype html><html><head><meta charset="utf-8"><title>403 — Access Denied</title></head><body style="font-family:system-ui,sans-serif;background:#FAF8F5;color:#49332A;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="background:#fff;border:1px solid #E4DDD5;border-radius:20px;padding:32px;max-width:440px;text-align:center"><h1 style="margin:0 0 8px">403 · Cross-Tenant Access Denied</h1><p style="margin:0;color:#766158">This hostname serves only its assigned property.</p></div></body></html>`
          );
      }
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = Number(process.env.PORT || 4000);
const server = http.createServer(app);
attachWebSocketServer(server);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`BROTOCOL ServeOS API + WS listening on http://127.0.0.1:${PORT}`);
});
