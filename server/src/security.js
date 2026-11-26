import crypto from "node:crypto";
import fs from "node:fs";
import { listCategories, listMenuItems } from "./db.js";
import { calculateItemPricing, calculateOrderTotals } from "./billMath.js";
import { verifyTablePinToken } from "./auth.js";
import { resolveOpenSeatingRow } from "./services.js";

const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 15;
const failedLoginBuckets = new Map();

const PUBLIC_WRITE_WINDOW_MS = 60 * 1000;
const MAX_PUBLIC_WRITES_PER_MIN = 60;
const publicWriteBuckets = new Map();

export function securityHeadersMiddleware(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
  );
  next();
}

export function publicWriteRateLimitMiddleware(req, res, next) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  const ip = getClientIp(req);
  const now = Date.now();
  const recent = (publicWriteBuckets.get(ip) || []).filter((ts) => now - ts < PUBLIC_WRITE_WINDOW_MS);
  if (recent.length >= MAX_PUBLIC_WRITES_PER_MIN) {
    const retryAfterSec = Math.max(1, Math.ceil((PUBLIC_WRITE_WINDOW_MS - (now - recent[0])) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({
      code: "rate_limited",
      error: "Too many requests. Please wait a moment and try again.",
    });
  }
  recent.push(now);
  publicWriteBuckets.set(ip, recent);
  next();
}

export function sameOriginMutationMiddleware(req, res, next) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    const originHost = new URL(origin).hostname.toLowerCase();
    const reqHost = String(req.headers.host || "").trim().toLowerCase().split(":")[0];
    if (reqHost && originHost !== reqHost) {
      return res.status(403).json({
        code: "csrf_origin_mismatch",
        error: "Cross-origin state-changing requests are not allowed.",
      });
    }
  } catch {
    return res.status(403).json({
      code: "csrf_origin_mismatch",
      error: "Invalid request origin.",
    });
  }
  next();
}

export function getClientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket?.remoteAddress || "local";
}

export function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = failedLoginBuckets.get(ip);
  if (!entry) return { allowed: true };
  const recent = entry.filter((ts) => now - ts < LOGIN_WINDOW_MS);
  if (recent.length === 0) {
    failedLoginBuckets.delete(ip);
    return { allowed: true };
  }
  failedLoginBuckets.set(ip, recent);
  if (recent.length >= MAX_LOGIN_ATTEMPTS) {
    const oldest = recent[0];
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - oldest)) / 1000)),
    };
  }
  return { allowed: true };
}

export function recordFailedLogin(ip) {
  const now = Date.now();
  const recent = (failedLoginBuckets.get(ip) || []).filter((ts) => now - ts < LOGIN_WINDOW_MS);
  recent.push(now);
  failedLoginBuckets.set(ip, recent);
}

export function clearFailedLogins(ip) {
  failedLoginBuckets.delete(ip);
}

export function hasValidImageMagicBytes(filePath, mimetype) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, buf, 0, 12, 0);
    if (bytesRead < 4) return false;
    if (mimetype === "image/jpeg") {
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    }
    if (mimetype === "image/png") {
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    }
    if (mimetype === "image/gif") {
      const hdr = buf.subarray(0, 6).toString("ascii");
      return hdr === "GIF87a" || hdr === "GIF89a";
    }
    if (mimetype === "image/webp") {
      return (
        bytesRead >= 12 &&
        buf.subarray(0, 4).toString("ascii") === "RIFF" &&
        buf.subarray(8, 12).toString("ascii") === "WEBP"
      );
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close error
      }
    }
  }
}

export function getRequestPinToken(req) {
  return String(
    req.headers["x-table-pin-token"] || req.query?.pinToken || req.body?.pinToken || ""
  ).trim();
}

export function verifyGuestTableAccess(req, restaurantId, settings, tableNumber) {
  if (!settings?.require_table_pin) return { ok: true };
  const seating = resolveOpenSeatingRow(tableNumber, restaurantId);
  if (!seating) {
    return {
      ok: false,
      status: 403,
      code: "inactive",
      error: `Table ${tableNumber} isn't open yet. Ask staff to open your table.`,
    };
  }
  if (!seating.table_pin) return { ok: true, seating };
  const token = getRequestPinToken(req);
  if (!verifyTablePinToken(token, restaurantId, tableNumber, seating.id)) {
    return {
      ok: false,
      status: 403,
      code: "pin_required",
      error: "Please scan the table QR and enter your 4-digit table PIN first.",
    };
  }
  return { ok: true, seating };
}

export function resolveAuthoritativeLines(
  rawLines,
  restaurantId,
  { allowUnavailableExisting = false, existingLines = [] } = {}
) {
  if (!Array.isArray(rawLines) || rawLines.length === 0 || rawLines.length > 50) {
    return { ok: false, status: 400, code: "bad_items", error: "Order must contain 1 to 50 items." };
  }

  const categories = new Map(listCategories(restaurantId).map((c) => [c.id, c]));
  const allItems = new Map(
    listMenuItems({ restaurantId, availableOnly: false }).map((i) => [i.id, i])
  );
  const existingMap = new Map((existingLines || []).map((l) => [l.id, l]));

  const resolvedLines = [];

  for (const rawLine of rawLines) {
    const qty = Number(rawLine?.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      return { ok: false, status: 400, code: "bad_items", error: "Invalid item quantity." };
    }

    const itemId = String(rawLine?.itemId || rawLine?.id || "");
    const item = allItems.get(itemId);
    const existingLine = existingMap.get(itemId);

    if (!item) {
      if (allowUnavailableExisting && existingLine) {
        const fallbackUnitPrice = Math.max(0, Number(existingLine.unit_price_snapshot ?? existingLine.price ?? 0));
        const fallbackAddons = Array.isArray(existingLine.addons) ? existingLine.addons : [];
        const fallbackAddonsTotal = fallbackAddons.reduce((s, a) => s + Math.max(0, Number(a?.price || 0)), 0);
        const fallbackBase = Math.max(0, Math.round((fallbackUnitPrice - fallbackAddonsTotal) * 100) / 100);
        const pricing = calculateItemPricing({
          basePrice: fallbackBase,
          addons: fallbackAddons,
          quantity: qty,
        });
        resolvedLines.push({
          ...existingLine,
          base_unit_price: pricing.base_unit_price,
          addons_unit_total: pricing.addons_unit_total,
          price: pricing.unit_price,
          line_total: pricing.line_total,
          quantity: qty,
          note:
            rawLine?.note !== undefined
              ? String(rawLine.note || "").trim().slice(0, 120) || null
              : existingLine.note ?? null,
        });
        continue;
      }
      return {
        ok: false,
        status: 400,
        code: "item_gone",
        error: "One of the selected items is no longer on the menu.",
      };
    }

    if (!item.is_available && !allowUnavailableExisting) {
      return {
        ok: false,
        status: 409,
        code: "item_unavailable",
        error: `${item.name} is currently sold out. Please remove it from your cart.`,
      };
    }

    let basePrice = Number(item.price);
    let selectedSize = null;
    const reqSize = rawLine?.size ?? rawLine?.selectedSize ?? null;
    if (item.size_variants.length > 0) {
      const matchSize = item.size_variants.find((s) => s.name === reqSize);
      if (!matchSize) {
        return {
          ok: false,
          status: 400,
          code: "bad_size",
          error: `Please select a valid size for ${item.name}.`,
        };
      }
      basePrice = Number(matchSize.price);
      selectedSize = matchSize.name;
    }

    const selectedAddons = [];
    const reqAddonNames = Array.isArray(rawLine?.addons)
      ? [
          ...new Set(
            rawLine.addons.map((a) => (typeof a === "string" ? a : String(a?.name || ""))).filter(Boolean)
          ),
        ]
      : [];
    for (const addonName of reqAddonNames) {
      const matchAddon = item.addons.find((a) => a.name === addonName);
      if (!matchAddon) {
        return {
          ok: false,
          status: 400,
          code: "bad_addon",
          error: `Invalid add-on selected for ${item.name}.`,
        };
      }
      selectedAddons.push({ name: matchAddon.name, price: Number(matchAddon.price) });
    }

    const pricing = calculateItemPricing({
      basePrice,
      addons: selectedAddons,
      quantity: qty,
    });
    const itemNote = String(rawLine?.note || "").trim().slice(0, 120) || null;
    const category = categories.get(item.category_id);

    resolvedLines.push({
      id: item.id,
      name: item.name,
      base_unit_price: pricing.base_unit_price,
      addons_unit_total: pricing.addons_unit_total,
      price: pricing.unit_price,
      line_total: pricing.line_total,
      quantity: pricing.quantity,
      selectedSize,
      addons: selectedAddons,
      note: itemNote,
      station: category?.station || "",
      prep_minutes: item.prep_minutes,
      image_url: item.image_url,
    });
  }

  const totals = calculateOrderTotals(resolvedLines);
  return {
    ok: true,
    resolvedLines,
    subtotalAmount: totals.subtotal,
  };
}

export function isTimeWithinHours(timeStr, openStr = "09:00", closeStr = "23:00") {
  const toMins = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  };
  const t = toMins(timeStr);
  const o = toMins(openStr) ?? 9 * 60;
  const c = toMins(closeStr) ?? 23 * 60;
  if (t === null) return false;
  if (o <= c) return t >= o && t <= c;
  // Overnight operating hours (e.g. 18:00 to 02:00)
  return t >= o || t <= c;
}

export function generateBookingCode() {
  return `BK-${crypto.randomBytes(2).toString("hex").toUpperCase()}${Math.floor(10 + Math.random() * 90)}`;
}
