import { useEffect, useRef, useState } from "react";

export interface WsMessage {
  type: string;
  payload: unknown;
  restaurantId?: string;
  ts?: number;
}

export function useRealtimeSocket(
  role: "guest" | "staff" | "super",
  table: string | null,
  onMessage: (msg: WsMessage) => void,
  restaurantId?: string | null,
  extra?: { sessionId?: string | null; pinToken?: string | null }
) {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  const sessionId = extra?.sessionId || null;
  const pinToken = extra?.pinToken || null;

  useEffect(() => {
    if (role === "guest" && !table && !sessionId) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams({ role });
      if (table) params.set("table", table);
      if (restaurantId) params.set("restaurant", restaurantId);
      if (sessionId) params.set("session", sessionId);
      if (pinToken) params.set("pinToken", pinToken);
      ws = new WebSocket(`${proto}//${window.location.host}/ws?${params.toString()}`);

      ws.onclose = () => {
        setConnected(false);
        if (!closed) {
          retryTimer = setTimeout(connect, 2500);
        }
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data) as WsMessage;
          if (parsed.type === "connected") {
            setConnected(true);
          }
          handlerRef.current(parsed);
        } catch {
          // ignore malformed event
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [role, table, restaurantId, sessionId, pinToken]);

  return { connected };
}
