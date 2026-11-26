import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, BellOff, ChefHat, Maximize2, Minimize2, ShieldCheck } from "lucide-react";
import { useToast } from "../components/Toast";
import { apiJson, buildVenueThemeStyle, elapsedMinutes, formatTimeShort } from "../lib/api";
import { playOrderChime } from "../lib/sound";
import { useRealtimeSocket } from "../lib/useWebSocket";
import type { AuthUser, Order, OrderStatus, RestaurantSettings } from "../types";

const STATUS_TABS: Array<{ key: string; label: string; statuses: OrderStatus[] }> = [
  { key: "all", label: "All", statuses: ["pending", "accepted", "preparing", "ready"] },
  { key: "new", label: "New", statuses: ["pending"] },
  { key: "preparing", label: "Preparing", statuses: ["accepted", "preparing"] },
  { key: "ready", label: "Ready", statuses: ["ready"] },
];

const SORT_PRIORITY: Record<OrderStatus, number> = {
  pending: 0,
  ready: 1,
  accepted: 2,
  preparing: 3,
  completed: 4,
  cancelled: 5,
  rejected: 6,
};

function getKdsNextAction(order: Order): { next: OrderStatus; label: string; tone: string } | null {
  if (order.status === "pending") {
    return { next: "accepted", label: "Accept Order", tone: "bg-[#FAF8F5] hover:bg-[#EDE6DE] text-[#49332A]" };
  }
  if (order.status === "accepted") {
    return { next: "preparing", label: "Start Preparing", tone: "bg-[#FAF8F5]/90 hover:bg-[#FAF8F5] text-[#49332A]" };
  }
  if (order.status === "preparing") {
    const label =
      order.order_type === "takeaway"
        ? "Ready for Pickup"
        : order.order_type === "delivery"
          ? "Out for Delivery"
          : "Mark Ready";
    return { next: "ready", label, tone: "bg-emerald-600 hover:bg-emerald-500 text-white" };
  }
  if (order.status === "ready") {
    const label =
      order.order_type === "takeaway"
        ? "Mark Picked Up"
        : order.order_type === "delivery"
          ? "Mark Delivered"
          : "Mark Served";
    return { next: "completed", label, tone: "bg-[#FAF8F5] hover:bg-white text-[#49332A]" };
  }
  return null;
}

export function KitchenPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [isSuper, setIsSuper] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState("all");
  const [stationFilter, setStationFilter] = useState<string>(() => {
    try {
      return localStorage.getItem("kds-station") || "";
    } catch {
      return "";
    }
  });
  const [soundOn, setSoundOn] = useState(false);
  const soundOnRef = useRef(false);
  soundOnRef.current = soundOn;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    try {
      const me = await apiJson<{ user: AuthUser }>("/api/auth/me");
      setIsSuper(me.user.role === "super_admin");
      const [settingsRes, ordersRes] = await Promise.all([
        apiJson<{ settings: RestaurantSettings }>("/api/admin/settings"),
        apiJson<{ orders: Order[] }>("/api/admin/orders"),
      ]);
      setSettings(settingsRes.settings);
      setOrders(ordersRes.orders);
      setLoading(false);
    } catch {
      navigate("/auth", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const { connected } = useRealtimeSocket(
    "staff",
    null,
    (msg) => {
      if (msg.type === "order:created") {
        const order = msg.payload as Order;
        setOrders((prev) => (prev.some((o) => o.id === order.id) ? prev : [order, ...prev]));
        setFlashIds((prev) => new Set(prev).add(order.id));
        setTimeout(() => {
          setFlashIds((prev) => {
            const next = new Set(prev);
            next.delete(order.id);
            return next;
          });
        }, 15000);
        if (soundOnRef.current) {
          playOrderChime();
        }
        if ("vibrate" in navigator) {
          navigator.vibrate([200, 100, 200]);
        }
        const sourceLabel =
          order.order_type === "takeaway"
            ? `Takeaway ${order.pickup_token || ""}`
            : order.order_type === "delivery"
              ? "Delivery"
              : `Table ${order.table_number}`;
        toast({
          title: `New Order ${order.order_number}`,
          description: `${sourceLabel} · ${order.items.length} item(s)`,
        });
      } else if (msg.type === "order:updated") {
        const updated = msg.payload as Order;
        setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      }
    },
    settings?.id || null
  );

  const selectStation = (station: string) => {
    setStationFilter(station);
    try {
      localStorage.setItem("kds-station", station);
    } catch {
      // ignore
    }
  };

  const toggleSound = () => {
    if (!soundOn) {
      playOrderChime();
      setSoundOn(true);
    } else {
      setSoundOn(false);
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  const advanceOrder = async (orderId: string, nextStatus: OrderStatus) => {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o)));
    try {
      await apiJson(`/api/admin/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Could not update order.",
        variant: "destructive",
      });
      loadData();
    }
  };

  const activePool = useMemo(
    () => orders.filter((o) => ["pending", "accepted", "preparing", "ready"].includes(o.status)),
    [orders]
  );

  const stations = useMemo(() => {
    const set = new Set<string>();
    for (const o of activePool) {
      for (const item of o.items) {
        if (item.station) set.add(item.station);
      }
    }
    if (stationFilter) set.add(stationFilter);
    return [...set];
  }, [activePool, stationFilter]);

  const stationFiltered = useMemo(() => {
    if (!stationFilter) return activePool;
    return activePool.filter((o) => o.items.some((i) => !i.station || i.station === stationFilter));
  }, [activePool, stationFilter]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        STATUS_TABS.map((tab) => [
          tab.key,
          stationFiltered.filter((o) => tab.statuses.includes(o.status)).length,
        ])
      ),
    [stationFiltered]
  );

  const visibleOrders = useMemo(() => {
    const tab = STATUS_TABS.find((t) => t.key === activeTab) || STATUS_TABS[0];
    return stationFiltered
      .filter((o) => tab.statuses.includes(o.status))
      .sort(
        (a, b) =>
          SORT_PRIORITY[a.status] - SORT_PRIORITY[b.status] ||
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
  }, [stationFiltered, activeTab]);

  const themeStyle = buildVenueThemeStyle(
    settings?.brand_bg,
    settings?.primary_color || settings?.brand_accent,
    settings?.secondary_color || settings?.brand_secondary
  );
  const accentBg = themeStyle["--qm-accent"];
  const darkSurface = themeStyle["--qm-accent-hover"];

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--qm-accent-hover)] text-[var(--qm-accent-ink)] flex items-center justify-center">
        <p className="font-display text-2xl opacity-75">Loading Kitchen Display...</p>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: darkSurface }} className="min-h-screen text-[#FAF8F5] flex flex-col">
      <header
        style={{ backgroundColor: accentBg }}
        className="sticky top-0 z-20 border-b border-white/15 backdrop-blur-md"
      >
        <div className="flex items-center gap-3 px-4 sm:px-6 h-16">
          <Link
            to="/dashboard"
            aria-label="Back to dashboard"
            className="h-9 w-9 rounded-full flex items-center justify-center text-[#FAF8F5]/75 hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <span className="h-10 w-10 rounded-full bg-white/15 text-[#FAF8F5] flex items-center justify-center flex-shrink-0">
            <ChefHat className="h-5 w-5" />
          </span>

          <div className="min-w-0">
            <h1 className="font-display text-lg leading-tight truncate">
              {settings?.name || "Restaurant"}
            </h1>
            <p className="text-xs text-[#FAF8F5]/70">
              {settings?.white_label ? "Kitchen Display System" : "BROTOCOL ServeOS · Kitchen Display"}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {isSuper && (
              <Link
                to="/super-admin"
                className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white/15 hover:bg-white/25 text-xs font-semibold"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Super Admin
              </Link>
            )}
            <span className="hidden sm:block text-sm tabular-nums text-[#FAF8F5]/75 mr-1">
              {new Date(nowMs).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
            </span>
            <span
              className={`flex items-center gap-2 h-8 px-3 rounded-full text-xs font-medium ${
                connected ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  connected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
                }`}
              />
              {connected ? "Live" : "Reconnecting"}
            </span>

            <button
              type="button"
              onClick={toggleSound}
              aria-label={soundOn ? "Mute bell" : "Turn on bell"}
              className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors ${
                soundOn ? "text-emerald-300 bg-emerald-500/20" : "text-[#FAF8F5]/70 hover:bg-white/10"
              }`}
            >
              {soundOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label="Toggle fullscreen"
              className="h-9 w-9 rounded-full flex items-center justify-center text-[#FAF8F5]/70 hover:bg-white/10"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <nav className="flex gap-2 px-4 sm:px-6 pb-3 overflow-x-auto no-scrollbar">
          {STATUS_TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`h-9 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? "bg-[#FAF8F5] text-[#49332A]"
                    : "bg-white/10 text-[#FAF8F5]/75 hover:text-[#FAF8F5]"
                }`}
              >
                {tab.label} ({counts[tab.key] || 0})
              </button>
            );
          })}
        </nav>

        {stations.length > 0 && (
          <nav className="flex gap-2 px-4 sm:px-6 pb-3 overflow-x-auto no-scrollbar">
            {["", ...stations].map((st) => (
              <button
                key={st || "all"}
                type="button"
                onClick={() => selectStation(st)}
                className={`h-7 px-3.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors ${
                  stationFilter === st
                    ? "border-[#FAF8F5] text-[#FAF8F5] bg-white/15"
                    : "border-white/15 text-[#FAF8F5]/65 hover:text-[#FAF8F5]"
                }`}
              >
                {st || "All stations"}
              </button>
            ))}
          </nav>
        )}
      </header>

      {!soundOn && (
        <button
          type="button"
          onClick={toggleSound}
          className="w-full bg-white/10 border-b border-white/15 px-4 py-2 text-xs font-medium text-[#FAF8F5] hover:bg-white/15 transition-colors"
        >
          Tap here to enable kitchen bell sound alerts for new orders
        </button>
      )}

      <main className="flex-1 p-4 sm:p-6">
        {visibleOrders.length === 0 ? (
          <div className="h-[55vh] flex flex-col items-center justify-center text-center text-[#FAF8F5]/60">
            <ChefHat className="h-12 w-12 mb-3 opacity-45" />
            <p className="font-display text-2xl text-[#FAF8F5]/85">All caught up</p>
            <p className="text-sm mt-1">
              New dine-in, takeaway, delivery, and waiter orders will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleOrders.map((order) => {
              const action = getKdsNextAction(order);
              const isNew = flashIds.has(order.id) || order.status === "pending";
              const mins = elapsedMinutes(order.created_at);
              const ticketChannel =
                order.order_type === "takeaway"
                  ? `Takeaway · ${order.pickup_token || "Pickup"}`
                  : order.order_type === "delivery"
                    ? "Delivery"
                    : `Table ${order.table_number}`;

              return (
                <article
                  key={order.id}
                  style={{ backgroundColor: accentBg }}
                  className={`rounded-2xl border p-4 flex flex-col justify-between ${
                    isNew ? "border-[#FAF8F5] ring-1 ring-[#FAF8F5]/40" : "border-white/15"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 pb-3 border-b border-white/15">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-display text-2xl leading-none">
                            {order.order_number}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/15 text-[#FAF8F5] capitalize">
                            {order.status}
                          </span>
                        </div>
                        <p className="text-xs text-[#FAF8F5]/65 mt-1">
                          {formatTimeShort(order.created_at)} · {order.items.length} item(s)
                          {order.created_by_staff_name ? ` · Waiter: ${order.created_by_staff_name}` : ""}
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="inline-block px-2.5 py-1 rounded-xl bg-white/15 text-[#FAF8F5] text-xs font-bold">
                          {ticketChannel}
                        </span>
                        <p className="text-[11px] text-[#FAF8F5]/65 mt-1 tabular-nums">{mins} min</p>
                      </div>
                    </div>

                    <ul className="mt-3 space-y-2.5">
                      {order.items
                        .filter((it) => !stationFilter || !it.station || it.station === stationFilter)
                        .map((item, idx) => (
                          <li key={`${item.id}-${idx}`} className="text-sm">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-semibold">
                                <span className="text-[#FAF8F5]/75 mr-1.5">{item.quantity}×</span>
                                {item.name}
                              </span>
                              {item.station && (
                                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/15 text-[#FAF8F5]/80">
                                  {item.station}
                                </span>
                              )}
                            </div>
                            {(item.selectedSize || item.addons.length > 0 || item.note) && (
                              <p className="text-xs text-[#FAF8F5]/70 mt-0.5 pl-5">
                                {[
                                  item.selectedSize,
                                  ...item.addons.map((a) => `+${a.name}`),
                                  item.note ? `"${item.note}"` : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            )}
                          </li>
                        ))}
                    </ul>

                    {order.note && (
                      <div className="mt-3 rounded-xl bg-white/15 border border-white/25 px-3 py-2 text-xs text-[#FAF8F5]">
                        Note: {order.note}
                      </div>
                    )}
                  </div>

                  {action && (
                    <div className="mt-4 pt-3 border-t border-white/15 flex gap-2">
                      <button
                        type="button"
                        onClick={() => advanceOrder(order.id, action.next)}
                        className={`flex-1 h-10 rounded-xl font-semibold text-sm transition-colors ${action.tone}`}
                      >
                        {action.label}
                      </button>
                      {order.status === "pending" && (
                        <button
                          type="button"
                          onClick={() => advanceOrder(order.id, "rejected")}
                          className="h-10 px-3 rounded-xl bg-white/10 hover:bg-red-600/80 text-xs font-semibold text-[#FAF8F5]/85 hover:text-white transition-colors"
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
