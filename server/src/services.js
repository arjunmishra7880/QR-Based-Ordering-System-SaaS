import crypto from "node:crypto";
import { calculateBill } from "./billMath.js";
import {
  db,
  DEFAULT_RESTAURANT_ID,
  getPlatformSettings,
  getSettings,
  listMenuItems,
  listRestaurants,
  listServiceCalls,
  listStaff,
  mapOrder,
} from "./db.js";

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function normalizeTableNumber(raw) {
  return String(raw ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 10);
}

export function getActiveTableNumbers(cfg) {
  const total = Math.max(1, Number(cfg?.total || 12));
  const skip = new Set((cfg?.skip || []).map(Number));
  const nums = [];
  for (let i = 1; i <= total; i++) {
    if (!skip.has(i)) nums.push(String(i));
  }
  return nums;
}

export function validateTableForOrder(settings, tableNumber) {
  if (!tableNumber) {
    return { ok: false, code: "bad_table", message: "Please select or enter a valid table number." };
  }
  const cfg = settings.table_config || { total: 12, skip: [], disabled: [] };
  const skipSet = new Set((cfg.skip || []).map(Number));
  const disabledSet = new Set((cfg.disabled || []).map(Number));
  const num = Number.parseInt(tableNumber, 10);
  if (Number.isFinite(num)) {
    if (disabledSet.has(num)) {
      return {
        ok: false,
        code: "table_disabled",
        message: `Table ${num} QR ordering is temporarily disabled. Please ask staff.`,
      };
    }
    if (skipSet.has(num) || num < 1 || num > Number(cfg.total || 12)) {
      return {
        ok: false,
        code: "bad_table",
        message: `Table ${tableNumber} is not active.`,
      };
    }
  }
  return { ok: true };
}

export function generateFourDigitPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function resolveOpenSeatingRow(tableNumber, restaurantId = DEFAULT_RESTAURANT_ID) {
  let row = db
    .prepare(
      "SELECT * FROM table_seatings WHERE restaurant_id = ? AND table_number = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1"
    )
    .get(restaurantId, String(tableNumber));
  if (!row) return null;

  const seen = new Set([row.table_number]);
  while (row.merged_into && !seen.has(row.merged_into)) {
    seen.add(row.merged_into);
    const parent = db
      .prepare(
        "SELECT * FROM table_seatings WHERE restaurant_id = ? AND table_number = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1"
      )
      .get(restaurantId, String(row.merged_into));
    if (!parent) break;
    row = parent;
  }
  return row;
}

export function ensureOpenSeating(tableNumber, openedBy = "Guest", restaurantId = DEFAULT_RESTAURANT_ID) {
  const existing = resolveOpenSeatingRow(tableNumber, restaurantId);
  if (existing) return existing;

  const settings = getSettings({ restaurantId });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const pin = settings.require_table_pin ? generateFourDigitPin() : null;

  db.prepare(
    `INSERT INTO table_seatings (
      id, restaurant_id, table_number, status, table_pin, pin_tries, opened_by, opened_at
    ) VALUES (?, ?, ?, 'open', ?, 0, ?, ?)`
  ).run(id, restaurantId, String(tableNumber), pin, openedBy, now);

  db.prepare(
    `INSERT INTO table_states (restaurant_id, table_number, status, section, activated_by, updated_at)
     VALUES (?, ?, 'open', '', ?, ?)
     ON CONFLICT(restaurant_id, table_number) DO UPDATE SET status = 'open', activated_by = excluded.activated_by, updated_at = excluded.updated_at`
  ).run(restaurantId, String(tableNumber), openedBy, now);

  return db.prepare("SELECT * FROM table_seatings WHERE id = ?").get(id);
}

export function mapPayment(row) {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id || DEFAULT_RESTAURANT_ID,
    seating_id: row.seating_id,
    table_number: row.table_number,
    payer: row.payer || "",
    amount: Number(row.amount),
    tip: Number(row.tip || 0),
    mode: row.mode,
    split_type: row.split_type || "full",
    status: row.status,
    handled_by: row.handled_by ?? null,
    created_at: row.created_at,
    settled_at: row.settled_at ?? null,
  };
}

export function buildSeatingView(seatingId, { includePin = false, requestedTable = null } = {}) {
  const seating = db.prepare("SELECT * FROM table_seatings WHERE id = ?").get(seatingId);
  if (!seating) return null;

  const restaurantId = seating.restaurant_id || DEFAULT_RESTAURANT_ID;
  const settings = getSettings({ restaurantId });
  const orders = db
    .prepare("SELECT * FROM orders WHERE seating_id = ? ORDER BY created_at DESC")
    .all(seating.id)
    .map(mapOrder);
  const payments = db
    .prepare("SELECT * FROM payments WHERE seating_id = ? ORDER BY created_at DESC")
    .all(seating.id)
    .map(mapPayment);

  const discount = seating.discount_json ? parseJson(seating.discount_json, null) : null;
  const spin = seating.spin_json ? parseJson(seating.spin_json, null) : null;
  const bill = calculateBill(orders, {
    discount,
    gstRate: settings.gst_rate,
    servicePct: settings.service_charge_pct,
    payments,
  });

  let loyalty = null;
  if (settings.loyalty.enabled) {
    let points = null;
    if (seating.guest_phone) {
      const acct = db
        .prepare("SELECT points FROM loyalty_accounts WHERE restaurant_id = ? AND phone = ?")
        .get(restaurantId, seating.guest_phone);
      points = acct ? Number(acct.points || 0) : 0;
    }
    loyalty = {
      ...settings.loyalty,
      phone_linked: Boolean(seating.guest_phone),
      points,
    };
  }

  const wifi =
    settings.wifi_ssid && settings.wifi_ssid.trim()
      ? { ssid: settings.wifi_ssid, password: settings.wifi_password || "" }
      : null;

  return {
    id: seating.id,
    restaurant_id: restaurantId,
    table: requestedTable || seating.table_number,
    table_number: seating.table_number,
    bill_table: seating.table_number,
    status: seating.status,
    opened_by: seating.opened_by ?? null,
    opened_at: seating.opened_at,
    closed_at: seating.closed_at ?? null,
    table_pin: includePin ? seating.table_pin : undefined,
    guest_phone: seating.guest_phone ?? null,
    loyalty_points: loyalty?.points ?? 0,
    discount,
    spin,
    spin_prizes: Array.isArray(settings.spin_prizes) ? settings.spin_prizes : [],
    loyalty,
    wifi,
    orders,
    payments,
    bill,
  };
}

export function creditLoyaltyIfPaid(seatingId) {
  const seating = db.prepare("SELECT * FROM table_seatings WHERE id = ?").get(seatingId);
  if (!seating || !seating.guest_phone || seating.loyalty_awarded) return 0;

  const restaurantId = seating.restaurant_id || DEFAULT_RESTAURANT_ID;
  const settings = getSettings({ restaurantId });
  if (!settings.loyalty.enabled) return 0;

  const view = buildSeatingView(seating.id);
  if (!view || view.bill.total <= 0 || view.bill.due > 0) return 0;

  const earned = Math.floor(view.bill.total / Math.max(1, settings.loyalty.rupees_per_point));
  const now = new Date().toISOString();
  if (earned > 0) {
    db.prepare(
      `INSERT INTO loyalty_accounts (restaurant_id, phone, points, total_spent, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(restaurant_id, phone) DO UPDATE SET
         points = loyalty_accounts.points + excluded.points,
         total_spent = loyalty_accounts.total_spent + excluded.total_spent,
         updated_at = excluded.updated_at`
    ).run(restaurantId, seating.guest_phone, earned, view.bill.total, now);
  }
  db.prepare("UPDATE table_seatings SET loyalty_awarded = 1 WHERE id = ?").run(seating.id);
  return earned;
}

export function buildFloorState(restaurantId = DEFAULT_RESTAURANT_ID) {
  const settings = getSettings({ restaurantId });
  const numbers = getActiveTableNumbers(settings.table_config);
  const states = new Map(
    db
      .prepare("SELECT * FROM table_states WHERE restaurant_id = ?")
      .all(restaurantId)
      .map((r) => [String(r.table_number), r])
  );
  const rawOpenSeatings = db
    .prepare(
      "SELECT * FROM table_seatings WHERE restaurant_id = ? AND status = 'open' ORDER BY opened_at DESC"
    )
    .all(restaurantId);

  const directSeatingByTable = new Map();
  for (const s of rawOpenSeatings) {
    if (!directSeatingByTable.has(s.table_number)) {
      directSeatingByTable.set(s.table_number, s);
    }
  }

  const activeCalls = listServiceCalls({ restaurantId, limit: 100 }).filter(
    (c) => c.status !== "completed"
  );
  const callsByTable = new Map();
  for (const c of activeCalls) {
    callsByTable.set(c.table_number, (callsByTable.get(c.table_number) || 0) + 1);
  }

  const viewCache = new Map();
  const getView = (sid) => {
    if (!viewCache.has(sid)) {
      viewCache.set(sid, buildSeatingView(sid, { includePin: true }));
    }
    return viewCache.get(sid);
  };

  const tables = numbers.map((num) => {
    const direct = directSeatingByTable.get(num) || null;
    const primary = direct ? resolveOpenSeatingRow(num, restaurantId) : null;
    const view = primary ? getView(primary.id) : null;
    const stRow = states.get(num);
    const pendingPay = view
      ? view.payments.filter((p) => p.status === "pending").length
      : 0;
    const callsCount = callsByTable.get(num) || 0;

    let status = "free";
    if (primary && view) {
      status = pendingPay > 0 ? "bill" : "open";
    } else if (stRow?.status === "cleaning") {
      status = "cleaning";
    }

    return {
      number: num,
      status,
      section: stRow?.section || "",
      activated_by: stRow?.activated_by || primary?.opened_by || null,
      mergedInto: direct?.merged_into || null,
      calls: callsCount,
      pendingPay,
      seating: view,
    };
  });

  const pendingPayments = [...viewCache.values()]
    .flatMap((v) => v.payments.filter((p) => p.status === "pending"))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  return {
    config: {
      numbers,
      require_pin: settings.require_table_pin,
      loyalty: settings.loyalty,
    },
    tables,
    calls: activeCalls,
    pendingPayments,
  };
}

export function startOfPeriodIso(period = "today") {
  const d = new Date();
  if (period === "yesterday") {
    d.setDate(d.getDate() - 1);
  } else if (period === "7d") {
    d.setDate(d.getDate() - 6);
  } else if (period === "30d") {
    d.setDate(d.getDate() - 29);
  }
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function buildReports(period = "today", restaurantId = DEFAULT_RESTAURANT_ID) {
  const sinceIso = startOfPeriodIso(period);
  const allOrders = db
    .prepare(
      "SELECT * FROM orders WHERE restaurant_id = ? AND created_at >= ? ORDER BY created_at ASC"
    )
    .all(restaurantId, sinceIso)
    .map(mapOrder);
  const payments = db
    .prepare("SELECT * FROM payments WHERE restaurant_id = ? AND created_at >= ?")
    .all(restaurantId, sinceIso)
    .map(mapPayment);
  const feedbacks = db
    .prepare(
      `SELECT f.*, o.order_number FROM feedback f
       LEFT JOIN orders o ON o.id = f.order_id
       WHERE f.restaurant_id = ? AND f.created_at >= ? ORDER BY f.created_at DESC`
    )
    .all(restaurantId, sinceIso);

  const validOrders = allOrders.filter((o) => !["cancelled", "rejected"].includes(o.status));
  const voided = allOrders.length - validOrders.length;

  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, sales: 0 }));
  const itemMap = new Map();
  const tableMap = new Map();
  const billSet = new Set();
  const prepTimes = [];
  let sales = 0;

  for (const ord of validOrders) {
    const rev = Number(ord.total_amount || 0);
    sales += rev;
    billSet.add(ord.seating_id || ord.id);

    for (const line of ord.items || []) {
      const qty = Math.max(1, Number(line.quantity || 1));
      const lineRev = Number(line.price || 0) * qty;
      const cur = itemMap.get(line.name) || { name: line.name, qty: 0, revenue: 0 };
      cur.qty += qty;
      cur.revenue += lineRev;
      itemMap.set(line.name, cur);
    }

    const tblCur = tableMap.get(ord.table_number) || { table: ord.table_number, sales: 0, orders: 0 };
    tblCur.sales += rev;
    tblCur.orders += 1;
    tableMap.set(ord.table_number, tblCur);

    const h = new Date(ord.created_at).getHours();
    if (hours[h]) {
      hours[h].orders += 1;
      hours[h].sales += rev;
    }

    const readyTs = ord.timeline?.ready || ord.timeline?.completed;
    if (readyTs) {
      const mins = (new Date(readyTs).getTime() - new Date(ord.created_at).getTime()) / 60000;
      if (Number.isFinite(mins) && mins >= 0 && mins <= 360) prepTimes.push(mins);
    }
  }

  const peakBucket = hours.reduce(
    (best, cur) => (cur.sales > (best?.sales ?? 0) ? cur : best),
    null
  );
  const confirmedPays = payments.filter((p) => p.status === "confirmed");
  const modeTotals = new Map();
  let tips = 0;
  for (const p of confirmedPays) {
    modeTotals.set(p.mode, (modeTotals.get(p.mode) || 0) + p.amount);
    tips += p.tip || 0;
  }

  const itemsSorted = [...itemMap.values()]
    .map((x) => ({ ...x, revenue: Math.round(x.revenue * 100) / 100 }))
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);

  const tablesSorted = [...tableMap.values()]
    .map((x) => ({ ...x, sales: Math.round(x.sales * 100) / 100 }))
    .sort((a, b) => b.sales - a.sales);

  const payModes = [...modeTotals.entries()].map(([mode, amount]) => ({
    mode,
    amount: Math.round(amount * 100) / 100,
  }));

  const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratingSum = 0;
  for (const f of feedbacks) {
    const r = Math.min(5, Math.max(1, Number(f.rating)));
    ratingCounts[r] += 1;
    ratingSum += r;
  }

  return {
    period,
    sales: Math.round(sales * 100) / 100,
    tips: Math.round(tips * 100) / 100,
    orders: validOrders.length,
    voided,
    bills: billSet.size,
    avgBill: billSet.size ? Math.round(sales / billSet.size) : 0,
    kitchenMinutes: prepTimes.length
      ? Math.round(prepTimes.reduce((s, n) => s + n, 0) / prepTimes.length)
      : null,
    peakHour: peakBucket && peakBucket.sales > 0 ? peakBucket.hour : null,
    hours: hours.map((h) => ({ ...h, sales: Math.round(h.sales * 100) / 100 })),
    items: itemsSorted,
    payModes,
    tables: tablesSorted,
    feedback: {
      totalReviews: feedbacks.length,
      avgRating: feedbacks.length ? Math.round((ratingSum / feedbacks.length) * 10) / 10 : 0,
      ratingCounts,
      reviews: feedbacks.slice(0, 100),
    },
  };
}

export function buildPlatformOverview() {
  const restaurants = listRestaurants({ activeOnly: false });
  const todayIso = startOfPeriodIso("today");

  const venues = restaurants.map((rest) => {
    const allOrders = db
      .prepare("SELECT status, total_amount, created_at FROM orders WHERE restaurant_id = ?")
      .all(rest.id);
    const valid = allOrders.filter((o) => !["cancelled", "rejected"].includes(o.status));
    const todayValid = valid.filter((o) => o.created_at >= todayIso);
    const activeOrders = allOrders.filter((o) =>
      ["pending", "accepted", "preparing", "ready"].includes(o.status)
    ).length;
    const openSeatings = db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM table_seatings WHERE restaurant_id = ? AND status = 'open' AND merged_into IS NULL"
      )
      .get(rest.id).cnt;
    const menuCount = listMenuItems({ restaurantId: rest.id, availableOnly: false }).length;
    const staffCount = listStaff(rest.id).filter((s) => s.active).length;
    const fb = db
      .prepare(
        "SELECT COUNT(*) AS cnt, AVG(rating) AS avg FROM feedback WHERE restaurant_id = ?"
      )
      .get(rest.id);

    const todayRevenue =
      Math.round(todayValid.reduce((s, o) => s + Number(o.total_amount || 0), 0) * 100) / 100;
    const totalRevenue =
      Math.round(valid.reduce((s, o) => s + Number(o.total_amount || 0), 0) * 100) / 100;

    return {
      id: rest.id,
      slug: rest.slug,
      name: rest.name,
      description: rest.description,
      logo_url: rest.logo_url,
      cover_url: rest.cover_url,
      plan: rest.plan,
      plan_status: rest.plan_status,
      plan_expires_at: rest.plan_expires_at,
      is_active: rest.is_active,
      white_label: rest.white_label,
      brand_bg: rest.brand_bg,
      brand_accent: rest.brand_accent,
      brand_secondary: rest.brand_secondary,
      primary_color: rest.primary_color,
      secondary_color: rest.secondary_color,
      custom_domain: rest.custom_domain,
      custom_domain_verified: rest.custom_domain_verified,
      gst_rate: rest.gst_rate,
      takeaway_enabled: rest.takeaway_enabled,
      delivery_enabled: rest.delivery_enabled,
      tables_total: Number(rest.table_config?.total || 12),
      created_at: rest.created_at,
      updated_at: rest.updated_at,
      metrics: {
        tablesCount: getActiveTableNumbers(rest.table_config).length,
        activeTables: Number(openSeatings || 0),
        todayOrders: todayValid.length,
        totalOrders: valid.length,
        activeOrders,
        todayRevenue,
        totalRevenue,
        menuCount,
        staffCount,
        totalReviews: Number(fb?.cnt || 0),
        avgRating: fb?.cnt ? Math.round(Number(fb.avg || 0) * 10) / 10 : 0,
      },
    };
  });

  const activeVenueIds = new Set(venues.filter((v) => v.is_active).map((v) => v.id));
  const adminRows = db
    .prepare("SELECT role, restaurant_id FROM users WHERE role = 'admin'")
    .all();
  const activeAdmins = adminRows.filter(
    (a) => !a.restaurant_id || activeVenueIds.has(a.restaurant_id)
  ).length;

  const recentActivity = db
    .prepare(
      `SELECT a.id, a.restaurant_id, a.staff_name, a.action, a.created_at, r.name AS restaurant_name
       FROM activity_log a
       LEFT JOIN restaurants r ON r.id = a.restaurant_id
       ORDER BY a.created_at DESC
       LIMIT 35`
    )
    .all()
    .map((r) => ({
      id: r.id,
      restaurant_id: r.restaurant_id,
      restaurant_name: r.restaurant_name || "Default Venue",
      staff_name: r.staff_name,
      action: r.action,
      created_at: r.created_at,
    }));

  const validAllOrders = db
    .prepare(
      "SELECT order_type, total_amount, created_at FROM orders WHERE status NOT IN ('cancelled', 'rejected')"
    )
    .all();

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const nowDate = new Date();
  const monthBuckets = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    monthBuckets.push({
      month: key,
      label: `${monthNames[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(-2)}`,
      orders: 0,
      revenue: 0,
    });
  }
  const bucketMap = new Map(monthBuckets.map((b) => [b.month, b]));

  const typeCounts = { dine_in: 0, takeaway: 0, delivery: 0 };
  for (const o of validAllOrders) {
    const t = o.order_type === "takeaway" || o.order_type === "delivery" ? o.order_type : "dine_in";
    typeCounts[t]++;
    const mKey = String(o.created_at || "").slice(0, 7);
    const bucket = bucketMap.get(mKey);
    if (bucket) {
      bucket.orders++;
      bucket.revenue = Math.round((bucket.revenue + Number(o.total_amount || 0)) * 100) / 100;
    }
  }

  const totalTypeCount = Math.max(1, validAllOrders.length);
  const orderTypeBreakdown = [
    {
      type: "dine_in",
      label: "Dine-In",
      count: typeCounts.dine_in,
      pct: validAllOrders.length ? Math.round((typeCounts.dine_in * 100) / totalTypeCount) : 0,
    },
    {
      type: "takeaway",
      label: "Takeaway",
      count: typeCounts.takeaway,
      pct: validAllOrders.length ? Math.round((typeCounts.takeaway * 100) / totalTypeCount) : 0,
    },
    {
      type: "delivery",
      label: "Delivery",
      count: typeCounts.delivery,
      pct: validAllOrders.length ? Math.round((typeCounts.delivery * 100) / totalTypeCount) : 0,
    },
  ];

  const stats = {
    totalVenues: venues.length,
    activeVenues: venues.filter((v) => v.is_active).length,
    pausedVenues: venues.filter((v) => !v.is_active).length,
    totalTables: venues.reduce((s, v) => s + v.metrics.tablesCount, 0),
    activeTables: venues.reduce((s, v) => s + v.metrics.activeTables, 0),
    todayOrders: venues.reduce((s, v) => s + v.metrics.todayOrders, 0),
    totalOrders: venues.reduce((s, v) => s + v.metrics.totalOrders, 0),
    activeOrders: venues.reduce((s, v) => s + v.metrics.activeOrders, 0),
    todayRevenue:
      Math.round(venues.reduce((s, v) => s + v.metrics.todayRevenue, 0) * 100) / 100,
    totalRevenue:
      Math.round(venues.reduce((s, v) => s + v.metrics.totalRevenue, 0) * 100) / 100,
    activeAdmins,
  };

  return {
    platform: getPlatformSettings({ includeSecret: false }),
    stats,
    venues,
    recentActivity,
    monthlyStats: monthBuckets,
    orderTypeBreakdown,
  };
}
