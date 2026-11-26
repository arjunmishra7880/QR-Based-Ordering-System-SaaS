import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  BarChart3,
  Bell,
  CalendarClock,
  ChefHat,
  ChevronDown,
  Home,
  KeyRound,
  LayoutGrid,
  LogOut,
  QrCode,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Users,
  UtensilsCrossed,
  Volume2,
} from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { ShiftModal } from "../components/ShiftModal";
import { useToast } from "../components/Toast";
import { CallsTab } from "../components/dashboard/CallsTab";
import { FloorTab } from "../components/dashboard/FloorTab";
import { MenuTab } from "../components/dashboard/MenuTab";
import { OrdersTab } from "../components/dashboard/OrdersTab";
import { OverviewTab } from "../components/dashboard/OverviewTab";
import { QrTab } from "../components/dashboard/QrTab";
import { ReportsTab } from "../components/dashboard/ReportsTab";
import { ReservationsTab } from "../components/dashboard/ReservationsTab";
import { SettingsTab } from "../components/dashboard/SettingsTab";
import { StaffTab } from "../components/dashboard/StaffTab";
import { apiJson, buildVenueThemeStyle } from "../lib/api";
import { playCallPing, playOrderChime } from "../lib/sound";
import { useShift } from "../lib/useShift";
import { useRealtimeSocket } from "../lib/useWebSocket";
import type {
  AuthRestaurantOption,
  AuthUser,
  CallStatus,
  Category,
  DashboardOverview,
  FeedbackItem,
  FloorState,
  MenuItem,
  Order,
  OrderStatus,
  RestaurantSettings,
  ServiceCall,
} from "../types";

const SERVICE_TABS = [
  { id: "stats", label: "Home", icon: Home },
  { id: "floor", label: "Floor", icon: LayoutGrid },
  { id: "orders", label: "Orders", icon: ShoppingBag },
  { id: "reservations", label: "Bookings", icon: CalendarClock },
  { id: "calls", label: "Service calls", icon: Bell },
] as const;

const SETUP_TABS = [
  { id: "menu", label: "Menu", icon: UtensilsCrossed },
  { id: "qr", label: "QR codes", icon: QrCode },
  { id: "staff", label: "Staff", icon: Users },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "profile", label: "Settings", icon: Settings },
] as const;

const MOBILE_TABS = [
  { id: "stats", label: "Home", icon: Home },
  { id: "floor", label: "Floor", icon: LayoutGrid },
  { id: "orders", label: "Orders", icon: ShoppingBag },
  { id: "calls", label: "Calls", icon: Bell },
  { id: "menu", label: "Menu", icon: UtensilsCrossed },
  { id: "profile", label: "More", icon: Settings },
] as const;

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { actor, actorName, unlockWithPin, endShift } = useShift();

  const activeTab = params.get("tab") || "stats";
  const setTab = (tab: string) => {
    setParams(tab === "stats" ? {} : { tab });
  };

  const [loading, setLoading] = useState(true);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [superVenues, setSuperVenues] = useState<AuthRestaurantOption[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [calls, setCalls] = useState<ServiceCall[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [pendingPayCount, setPendingPayCount] = useState(0);
  const [setupOpen, setSetupOpen] = useState(true);
  const [shiftModalOpen, setShiftModalOpen] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const me = await apiJson<{ user: AuthUser; restaurants?: AuthRestaurantOption[] }>(
        "/api/auth/me"
      );
      setAuthUser(me.user);
      setSuperVenues(me.restaurants || []);
      const [ov, ord, cl, mn, st, fl] = await Promise.all([
        apiJson<DashboardOverview>("/api/admin/overview"),
        apiJson<{ orders: Order[] }>("/api/admin/orders"),
        apiJson<{ calls: ServiceCall[] }>("/api/admin/service-calls"),
        apiJson<{ categories: Category[]; items: MenuItem[] }>("/api/admin/menu"),
        apiJson<{ settings: RestaurantSettings }>("/api/admin/settings"),
        apiJson<FloorState>("/api/admin/floor"),
      ]);
      setOverview(ov);
      setOrders(ord.orders);
      setCalls(cl.calls);
      setCategories(mn.categories);
      setItems(mn.items);
      setSettings(st.settings);
      setPendingPayCount(fl.pendingPayments.length);
      setLoading(false);
    } catch {
      navigate("/auth", { replace: true });
    }
  }, [navigate]);

  const switchSuperVenue = async (restaurantId: string) => {
    try {
      await apiJson("/api/super/select-restaurant", {
        method: "POST",
        body: JSON.stringify({ restaurantId }),
      });
      await loadAll();
      toast({ title: "Switched active venue" });
    } catch {
      toast({ title: "Could not switch venue", variant: "destructive" });
    }
  };

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const refreshOverview = useCallback(() => {
    apiJson<DashboardOverview>("/api/admin/overview").then(setOverview).catch(() => {});
  }, []);

  const refreshFloorBadge = useCallback(() => {
    apiJson<FloorState>("/api/admin/floor")
      .then((f) => setPendingPayCount(f.pendingPayments.length))
      .catch(() => {});
  }, []);

  const refreshMenu = useCallback(async () => {
    const mn = await apiJson<{ categories: Category[]; items: MenuItem[] }>("/api/admin/menu");
    setCategories(mn.categories);
    setItems(mn.items);
  }, []);

  const { connected } = useRealtimeSocket("staff", null, (msg) => {
    if (msg.type === "order:created") {
      const order = msg.payload as Order;
      setOrders((prev) => (prev.some((o) => o.id === order.id) ? prev : [order, ...prev]));
      refreshOverview();
      playOrderChime();
      toast({
        title: `New order ${order.order_number}`,
        description: `Table ${order.table_number} · ${order.items.length} item(s)`,
      });
    } else if (msg.type === "order:updated") {
      const order = msg.payload as Order;
      setOrders((prev) => prev.map((o) => (o.id === order.id ? order : o)));
      refreshOverview();
    } else if (msg.type === "call:created") {
      const call = msg.payload as ServiceCall;
      setCalls((prev) => (prev.some((c) => c.id === call.id) ? prev : [call, ...prev]));
      refreshOverview();
      playCallPing();
      toast({
        title: `Table ${call.table_number} called staff`,
        description: `Request: ${call.call_type}`,
      });
    } else if (msg.type === "call:updated") {
      const call = msg.payload as ServiceCall;
      setCalls((prev) => prev.map((c) => (c.id === call.id ? call : c)));
      refreshOverview();
    } else if (msg.type === "payment:created") {
      refreshFloorBadge();
      playCallPing();
      toast({ title: "Payment submitted", description: "Confirm on Floor or table bill." });
    } else if (msg.type === "floor:updated" || msg.type === "payment:updated") {
      refreshFloorBadge();
      refreshOverview();
    } else if (msg.type === "feedback:created") {
      const fb = msg.payload as FeedbackItem;
      refreshOverview();
      if (fb.rating <= 2) {
        toast({
          title: `${fb.rating}-star review from Table ${fb.table_number}`,
          description: fb.comment ? `"${fb.comment}" — Worth visiting the table now.` : "Worth checking on Table now.",
          variant: "destructive",
        });
      }
    } else if (msg.type === "views:updated") {
      const p = msg.payload as { menu_views: number };
      setOverview((prev) =>
        prev ? { ...prev, stats: { ...prev.stats, menuViews: p.menu_views } } : prev
      );
    } else if (msg.type === "reservation:created") {
      const resv = msg.payload as { booking_code: string; customer_name: string; party_size: number };
      playCallPing();
      toast({
        title: `New reservation ${resv.booking_code}`,
        description: `${resv.customer_name} · ${resv.party_size} guests`,
      });
    }
  }, settings?.id || authUser?.active_restaurant_id);

  const changeOrderStatus = async (orderId: string, status: OrderStatus) => {
    await apiJson(`/api/admin/orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, by: actorName }),
    });
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)));
    refreshOverview();
  };

  const updateCallStatus = async (id: string, status: Exclude<CallStatus, "pending">) => {
    const res = await apiJson<{ call: ServiceCall }>(`/api/admin/service-calls/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, by: actorName }),
    });
    setCalls((prev) => prev.map((c) => (c.id === id ? res.call : c)));
    refreshOverview();
  };

  const handleLogout = async () => {
    await apiJson("/api/auth/logout", { method: "POST" }).catch(() => {});
    navigate("/", { replace: true });
  };

  const pendingOrderCount = orders.filter((o) => o.status === "pending").length;
  const pendingCallCount = calls.filter((c) => c.status !== "completed").length;

  const isNavActive = (id: string) => {
    if (id === "reports") return activeTab === "reports" || activeTab === "feedback";
    if (id === "profile") return activeTab === "profile" || activeTab === "setup" || activeTab === "social";
    return activeTab === id;
  };

  const themeStyle = buildVenueThemeStyle(
    settings?.brand_bg,
    settings?.primary_color || settings?.brand_accent,
    settings?.secondary_color || settings?.brand_secondary
  );

  if (loading || !settings) {
    return (
      <div className="min-h-screen bg-[var(--qm-bg)] flex items-center justify-center">
        <p className="font-display text-2xl text-[var(--qm-muted)]">Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div style={themeStyle} className="min-h-screen bg-[var(--qm-bg)] flex flex-col md:flex-row pb-20 md:pb-0">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:sticky md:top-0 md:h-screen bg-white border-r border-[var(--qm-line)] p-4 justify-between overflow-y-auto">
        <div>
          <div className="flex items-center gap-2.5 px-2">
            <BrandMark
              accent={themeStyle["--qm-accent"]}
              logoUrl={settings.logo_url}
              alt={settings.name}
            />
            <div className="min-w-0">
              <p className="font-display text-lg leading-tight truncate">{settings.name}</p>
              <p className="text-[11px] text-emerald-700 font-medium">
                {connected ? "● Live synced" : "Connecting..."}
              </p>
            </div>
          </div>

          {authUser?.role === "super_admin" && (
            <div className="mt-3 rounded-2xl bg-[var(--qm-tint)] border border-[var(--qm-line)] p-2.5 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-[var(--qm-accent)]">
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Super Admin
                </span>
                <Link to="/super-admin" className="underline hover:opacity-80">
                  Platform →
                </Link>
              </div>
              {superVenues.length > 0 && (
                <select
                  aria-label="Switch active venue"
                  value={settings.id}
                  onChange={(e) => switchSuperVenue(e.target.value)}
                  className="w-full h-8 px-2 rounded-lg border border-[var(--qm-line)] bg-white text-xs font-semibold text-[var(--qm-accent)]"
                >
                  {superVenues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShiftModalOpen(true)}
            className="mt-4 w-full h-9 px-3 rounded-full border border-[var(--qm-line)] bg-[var(--qm-bg)] hover:border-[var(--qm-accent)] text-xs font-semibold flex items-center gap-2 text-[var(--qm-accent)]"
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span className="truncate">{actor ? `${actor.name} · ${actor.role}` : "Who's on shift?"}</span>
          </button>

          <p className="mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--qm-muted)]">
            During service
          </p>
          <nav className="mt-1.5 space-y-1">
            {SERVICE_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = isNavActive(tab.id);
              const badge =
                tab.id === "orders"
                  ? pendingOrderCount
                  : tab.id === "calls"
                    ? pendingCallCount
                    : tab.id === "floor"
                      ? pendingPayCount
                      : 0;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTab(tab.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    active
                      ? "bg-[var(--qm-tint)] text-[#49332A] font-semibold"
                      : "text-[var(--qm-muted)] hover:bg-[var(--qm-surface)] hover:text-[#49332A]"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </span>
                  {badge > 0 && (
                    <span className="h-5 min-w-5 px-1.5 rounded-full bg-[#49332A] text-[#FAF8F5] text-[11px] font-bold flex items-center justify-center">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}

            <Link
              to="/kitchen"
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-[var(--qm-muted)] hover:bg-[var(--qm-surface)] hover:text-[#49332A]"
            >
              <ChefHat className="h-4 w-4" />
              Kitchen Display
            </Link>
          </nav>

          <button
            type="button"
            onClick={() => setSetupOpen((v) => !v)}
            className="mt-5 w-full px-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--qm-muted)]"
          >
            <span>Set up &amp; review</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${setupOpen ? "rotate-180" : ""}`} />
          </button>

          {setupOpen && (
            <nav className="mt-1.5 space-y-1">
              {SETUP_TABS.map((tab) => {
                const Icon = tab.icon;
                const active = isNavActive(tab.id);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTab(tab.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                      active
                        ? "bg-[var(--qm-tint)] text-[#49332A] font-semibold"
                        : "text-[var(--qm-muted)] hover:bg-[var(--qm-surface)] hover:text-[#49332A]"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          )}
        </div>

        <div className="pt-4 border-t border-[var(--qm-line)] space-y-1">
          <button
            type="button"
            onClick={() => {
              playOrderChime();
              toast({ title: "Bell chime tested" });
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-[var(--qm-muted)] hover:bg-[var(--qm-surface)]"
          >
            <Volume2 className="h-4 w-4" />
            Test order alert
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header className="md:hidden sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-[var(--qm-line)] px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <BrandMark size="sm" />
          <span className="font-display text-lg truncate">{settings.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShiftModalOpen(true)}
            className="h-8 px-2.5 rounded-full border border-[var(--qm-line)] bg-[var(--qm-bg)] text-[11px] font-semibold"
          >
            {actor ? actor.name.split(" ")[0] : "Shift PIN"}
          </button>
          <Link
            to="/kitchen"
            className="h-8 px-3 rounded-full bg-[#49332A] text-[#FAF8F5] text-xs font-semibold inline-flex items-center gap-1"
          >
            <ChefHat className="h-3.5 w-3.5 text-[#FAF8F5]" />
            KDS
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Log out"
            className="p-2 text-red-600"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-8 max-w-6xl w-full mx-auto">
        {activeTab === "stats" && <OverviewTab overview={overview} onGoToTab={setTab} />}
        {activeTab === "floor" && (
          <FloorTab
            actorName={actorName}
            onSyncExternal={() => {
              refreshOverview();
              refreshFloorBadge();
            }}
          />
        )}
        {activeTab === "orders" && (
          <OrdersTab
            orders={orders}
            menuItems={items}
            onChangeStatus={changeOrderStatus}
            onOrderUpdated={(updated) => {
              setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
              refreshOverview();
            }}
          />
        )}
        {activeTab === "reservations" && (
          <ReservationsTab
            actorName={actorName}
            onSyncExternal={() => {
              refreshOverview();
              refreshFloorBadge();
            }}
          />
        )}
        {activeTab === "calls" && <CallsTab calls={calls} onUpdateCall={updateCallStatus} />}
        {activeTab === "menu" && (
          <MenuTab categories={categories} items={items} onRefresh={refreshMenu} />
        )}
        {activeTab === "qr" && <QrTab settings={settings} onSettingsUpdated={setSettings} />}
        {activeTab === "staff" && <StaffTab actorName={actorName} />}
        {(activeTab === "reports" || activeTab === "feedback") && (
          <ReportsTab
            initialSection={activeTab === "feedback" ? "reviews" : "sales"}
            onChangeSection={(sec) => setTab(sec === "reviews" ? "feedback" : "reports")}
          />
        )}
        {(activeTab === "profile" || activeTab === "setup" || activeTab === "social") && (
          <SettingsTab
            section={activeTab as "profile" | "setup" | "social"}
            onChangeSection={(sec) => setTab(sec)}
            settings={settings}
            onSettingsUpdated={setSettings}
          />
        )}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[var(--qm-line)] grid grid-cols-6 h-16">
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = isNavActive(tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                active ? "text-[#49332A] font-bold" : "text-[var(--qm-muted)]"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {shiftModalOpen && (
        <ShiftModal
          actor={actor}
          onUnlock={unlockWithPin}
          onEndShift={endShift}
          onClose={() => setShiftModalOpen(false)}
        />
      )}
    </div>
  );
}
