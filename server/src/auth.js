import crypto from "node:crypto";
import { db, DEFAULT_RESTAURANT_ID, getPlatformSettings } from "./db.js";

const COOKIE_NAME = "qm_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [salt, keyHex] = String(storedHash || "").split(":");
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(keyHex, "hex");
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}

export function createSession(userId, activeRestaurantId = DEFAULT_RESTAURANT_ID) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    "INSERT INTO sessions (token, user_id, active_restaurant_id, expires_at) VALUES (?, ?, ?, ?)"
  ).run(token, userId, activeRestaurantId || DEFAULT_RESTAURANT_ID, expiresAt);
  return { token, expiresAt };
}

export function updateSessionRestaurant(token, restaurantId) {
  if (!token || !restaurantId) return;
  db.prepare("UPDATE sessions SET active_restaurant_id = ? WHERE token = ?").run(restaurantId, token);
}

export function deleteSession(token) {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function revokeOtherUserSessions(userId, keepToken = null) {
  if (!userId) return;
  if (keepToken) {
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(userId, keepToken);
  } else {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
}

export function extractTokenFromHeaders(cookieHeader, authHeader = null) {
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (typeof cookieHeader === "string") {
    for (const part of cookieHeader.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (key === COOKIE_NAME) return decodeURIComponent(val);
    }
  }
  return null;
}

export function getSessionUserFromToken(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.restaurant_id, s.active_restaurant_id, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    deleteSession(token);
    return null;
  }
  const role = row.role === "super_admin" ? "super_admin" : "admin";
  const assignedRestaurant = row.restaurant_id || DEFAULT_RESTAURANT_ID;
  const activeRestaurant =
    role === "super_admin"
      ? row.active_restaurant_id || DEFAULT_RESTAURANT_ID
      : assignedRestaurant;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role,
    restaurant_id: role === "super_admin" ? null : assignedRestaurant,
    active_restaurant_id: activeRestaurant,
    token,
  };
}

export function getSessionUserFromHeaders(cookieHeader, authHeader = null) {
  return getSessionUserFromToken(extractTokenFromHeaders(cookieHeader, authHeader));
}

export function getSessionUser(req) {
  return getSessionUserFromHeaders(req.headers.cookie, req.headers.authorization);
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  req.user = user;
  req.restaurantId =
    user.role === "super_admin"
      ? user.active_restaurant_id || DEFAULT_RESTAURANT_ID
      : user.restaurant_id || DEFAULT_RESTAURANT_ID;
  next();
}

export function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== "super_admin") {
    return res.status(403).json({ error: "Super admin access required" });
  }
  next();
}

export function signTablePinToken(restaurantId, tableNumber, seatingId) {
  const secret = getPlatformSettings({ includeSecret: true }).pin_hmac_secret;
  const payload = `${restaurantId}:${tableNumber}:${seatingId}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${seatingId}.${sig}`;
}

export function verifyTablePinToken(token, restaurantId, tableNumber, seatingId) {
  if (!token || !seatingId) return false;
  const parts = String(token).split(".");
  if (parts.length !== 2 || parts[0] !== seatingId) return false;
  const expected = signTablePinToken(restaurantId, tableNumber, seatingId).split(".")[1];
  const a = Buffer.from(parts[1], "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
