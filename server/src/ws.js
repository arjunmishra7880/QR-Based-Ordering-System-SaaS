import { WebSocketServer } from "ws";
import { getSessionUserFromHeaders, verifyTablePinToken } from "./auth.js";
import { DEFAULT_RESTAURANT_ID, getSettings, resolveRestaurantContext } from "./db.js";
import { resolveOpenSeatingRow } from "./services.js";

let wss = null;

export function attachWebSocketServer(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (socket, req) => {
    const url = new URL(req.url || "/ws", "http://localhost");
    const rawRole = url.searchParams.get("role");
    const role = rawRole === "super" ? "super" : rawRole === "staff" ? "staff" : "guest";
    const requestedRest = url.searchParams.get("restaurant") || "";
    const table = url.searchParams.get("table") || null;
    const clientSession = url.searchParams.get("session") || null;
    const pinToken = url.searchParams.get("pinToken") || null;

    let restaurantId = DEFAULT_RESTAURANT_ID;

    if (role === "super") {
      const user = getSessionUserFromHeaders(req.headers.cookie, req.headers.authorization);
      if (!user || user.role !== "super_admin") {
        socket.close(4403, "Forbidden");
        return;
      }
      socket.meta = { role: "super", restaurantId: null, table: null, userId: user.id };
    } else if (role === "staff") {
      const user = getSessionUserFromHeaders(req.headers.cookie, req.headers.authorization);
      if (!user) {
        socket.close(4401, "Unauthorized");
        return;
      }
      const staffCtx = resolveRestaurantContext({
        identifier: requestedRest || user.active_restaurant_id || user.restaurant_id,
        host: req.headers.host || null,
      });
      restaurantId =
        user.role === "super_admin"
          ? requestedRest || user.active_restaurant_id || DEFAULT_RESTAURANT_ID
          : user.restaurant_id || DEFAULT_RESTAURANT_ID;
      if (!staffCtx.ok && staffCtx.code === "domain_not_found") {
        socket.close(4404, "Domain not found");
        return;
      }
      if (user.role !== "super_admin" && user.restaurant_id !== restaurantId) {
        socket.close(4401, "Unauthorized");
        return;
      }
      socket.meta = { role: "staff", restaurantId, table: null, userId: user.id };
    } else {
      const ctx = resolveRestaurantContext({
        identifier: requestedRest || null,
        host: req.headers.host || null,
      });
      if (!ctx.ok) {
        socket.close(ctx.status === 404 ? 4404 : 4403, ctx.code || "Forbidden");
        return;
      }
      restaurantId = ctx.restaurant.id;
      const settings = getSettings({ restaurantId });
      if (settings?.require_table_pin && table) {
        const seating = resolveOpenSeatingRow(table, restaurantId);
        if (!seating || !verifyTablePinToken(pinToken, restaurantId, table, seating.id)) {
          socket.close(4401, "Table PIN required");
          return;
        }
      }
      socket.meta = { role: "guest", restaurantId, table, session: clientSession };
    }

    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.send(
      JSON.stringify({
        type: "connected",
        role: socket.meta.role,
        restaurantId: socket.meta.restaurantId,
        table: socket.meta.table,
      })
    );
  });

  const interval = setInterval(() => {
    if (!wss) return;
    for (const client of wss.clients) {
      if (!client.isAlive) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 30000);

  wss.on("close", () => clearInterval(interval));
  return wss;
}

function sendJson(client, data) {
  if (client.readyState === 1) {
    client.send(JSON.stringify(data));
  }
}

export function broadcastToStaff(restaurantId, type, payload) {
  if (!wss) return;
  const target = restaurantId || DEFAULT_RESTAURANT_ID;
  const msg = { type, restaurantId: target, payload, ts: Date.now() };
  for (const client of wss.clients) {
    if (
      (client.meta?.role === "staff" && client.meta.restaurantId === target) ||
      client.meta?.role === "super"
    ) {
      sendJson(client, msg);
    }
  }
}

export function broadcastToTable(restaurantId, tableNumber, type, payload) {
  if (!wss) return;
  const target = restaurantId || DEFAULT_RESTAURANT_ID;
  const msg = { type, restaurantId: target, payload, ts: Date.now() };
  for (const client of wss.clients) {
    if (client.meta?.role !== "guest" || client.meta.restaurantId !== target) continue;
    const matchesTable = !tableNumber || client.meta.table === String(tableNumber);
    const matchesSession =
      payload?.client_session_id && client.meta.session === payload.client_session_id;
    if (matchesTable || matchesSession) {
      sendJson(client, msg);
    }
  }
}

export function broadcastAll(restaurantId, type, payload) {
  if (!wss) return;
  const target = restaurantId || DEFAULT_RESTAURANT_ID;
  const msg = { type, restaurantId: target, payload, ts: Date.now() };
  for (const client of wss.clients) {
    if (client.meta?.restaurantId === target || client.meta?.role === "super") {
      sendJson(client, msg);
    }
  }
}

export function broadcastPlatform(type, payload) {
  if (!wss) return;
  const msg = { type, payload, ts: Date.now() };
  for (const client of wss.clients) {
    if (client.meta?.role === "super") {
      sendJson(client, msg);
    }
  }
}
