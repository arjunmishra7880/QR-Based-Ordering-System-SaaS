import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  Building2,
  ChefHat,
  ExternalLink,
  IndianRupee,
  LayoutDashboard,
  LogOut,
  PauseCircle,
  PlayCircle,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Star,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { useToast } from "../components/Toast";
import { apiJson, buildVenueThemeStyle, formatINR, formatTimeShort } from "../lib/api";
import { resolveCoverImage } from "../lib/dishMedia";
import { useRealtimeSocket } from "../lib/useWebSocket";
import type {
  AuthUser,
  PlatformOverviewResponse,
  RestaurantSettings,
  SuperVenueSummary,
} from "../types";

type SuperTab = "overview" | "venues" | "admins" | "activity";

export function SuperAdminPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const tab = (params.get("tab") as SuperTab) || "overview";
  const setTab = (next: SuperTab) => setParams(next === "overview" ? {} : { tab: next });

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [data, setData] = useState<PlatformOverviewResponse | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");

  // Modals
  const [createVenueOpen, setCreateVenueOpen] = useState(false);
  const [venueForm, setVenueForm] = useState({
    name: "",
    slug: "",
    description: "",
    plan: "Pro" as "Starter" | "Pro" | "Enterprise",
    plan_status: "active" as "trial" | "active" | "past_due" | "paused",
    plan_expires_at: "",
    tables: 12,
    gst_rate: 5,
    upi_id: "",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
    sampleMenu: true,
    white_label: false,
    brand_bg: "#FAF8F5",
    brand_accent: "#49332A",
    brand_secondary: "#766158",
    custom_domain: "",
    custom_domain_verified: false,
    takeaway_enabled: true,
    delivery_enabled: false,
  });
  const [submittingVenue, setSubmittingVenue] = useState(false);

  const [editingVenue, setEditingVenue] = useState<SuperVenueSummary | null>(null);
  const [editVenueForm, setEditVenueForm] = useState({
    name: "",
    slug: "",
    plan: "Pro" as "Starter" | "Pro" | "Enterprise",
    plan_status: "active" as "trial" | "active" | "past_due" | "paused",
    plan_expires_at: "",
    tables: 12,
    gst_rate: 5,
    upi_id: "",
    white_label: false,
    brand_bg: "#FAF8F5",
    brand_accent: "#49332A",
    brand_secondary: "#766158",
    custom_domain: "",
    custom_domain_verified: false,
    takeaway_enabled: true,
    delivery_enabled: false,
  });

  const [agencyOpen, setAgencyOpen] = useState(false);
  const [agencyForm, setAgencyForm] = useState({
    platform_name: "Khao Piyo",
    agency_name: "Khao Piyo",
    agency_tagline: "White-Label Restaurant QR Menu, Ordering & Kitchen Operations SaaS",
    support_email: "support@brotocol.local",
    default_brand_bg: "#FAF8F5",
    default_brand_accent: "#49332A",
    default_brand_secondary: "#766158",
  });

  const [createAdminOpen, setCreateAdminOpen] = useState(false);
  const [adminForm, setAdminForm] = useState({
    name: "",
    email: "",
    password: "",
    restaurantId: "",
  });

  const loadAll = useCallback(async () => {
    try {
      const me = await apiJson<{ user: AuthUser }>("/api/auth/me");
      if (me.user.role !== "super_admin") {
        navigate("/dashboard", { replace: true });
        return;
      }
      setUser(me.user);
      const ov = await apiJson<PlatformOverviewResponse>("/api/super/overview");
      setData(ov);
      if (ov.platform) {
        setAgencyForm({
          platform_name: ov.platform.platform_name,
          agency_name: ov.platform.agency_name,
          agency_tagline: ov.platform.agency_tagline,
          support_email: ov.platform.support_email,
          default_brand_bg: ov.platform.default_brand_bg,
          default_brand_accent: ov.platform.default_brand_accent,
          default_brand_secondary: ov.platform.default_brand_secondary || "#766158",
        });
      }
      if (ov.venues.length && !adminForm.restaurantId) {
        setAdminForm((f) => ({ ...f, restaurantId: ov.venues[0].id }));
      }
      setLoading(false);
    } catch {
      navigate("/auth", { replace: true });
    }
  }, [navigate, adminForm.restaurantId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const { connected } = useRealtimeSocket("super", null, (msg) => {
    if (
      ["platform:updated", "order:created", "order:updated", "floor:updated"].includes(msg.type)
    ) {
      apiJson<PlatformOverviewResponse>("/api/super/overview").then(setData).catch(() => {});
    }
  });

  const filteredVenues = useMemo(() => {
    const venues = data?.venues || [];
    const q = query.trim().toLowerCase();
    return venues.filter((v) => {
      if (statusFilter === "active" && !v.is_active) return false;
      if (statusFilter === "paused" && v.is_active) return false;
      if (
        q &&
        !v.name.toLowerCase().includes(q) &&
        !v.slug.toLowerCase().includes(q) &&
        !(v.custom_domain || "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [data, query, statusFilter]);

  const openVenueConsole = async (restaurantId: string, destination: "/dashboard" | "/kitchen") => {
    try {
      await apiJson("/api/super/select-restaurant", {
        method: "POST",
        body: JSON.stringify({ restaurantId }),
      });
      navigate(destination);
    } catch (err) {
      toast({
        title: "Could not switch workspace",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const toggleVenueStatus = async (venue: SuperVenueSummary) => {
    try {
      await apiJson(`/api/super/restaurants/${venue.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !venue.is_active }),
      });
      toast({
        title: venue.is_active ? `${venue.name} paused` : `${venue.name} activated`,
        variant: venue.is_active ? "default" : "success",
      });
      const ov = await apiJson<PlatformOverviewResponse>("/api/super/overview");
      setData(ov);
    } catch (err) {
      toast({
        title: "Failed to update status",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleCreateVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingVenue(true);
    try {
      await apiJson("/api/super/restaurants", {
        method: "POST",
        body: JSON.stringify(venueForm),
      });
      toast({
        title: "Venue provisioned",
        description: `${venueForm.name} is live with QR menu, POS floor & KDS.`,
        variant: "success",
      });
      setCreateVenueOpen(false);
      setVenueForm({
        name: "",
        slug: "",
        description: "",
        plan: "Pro",
        plan_status: "active",
        plan_expires_at: "",
        tables: 12,
        gst_rate: 5,
        upi_id: "",
        ownerName: "",
        ownerEmail: "",
        ownerPassword: "",
        sampleMenu: true,
        white_label: false,
        brand_bg: agencyForm.default_brand_bg || "#FAF8F5",
        brand_accent: agencyForm.default_brand_accent || "#49332A",
        brand_secondary: agencyForm.default_brand_secondary || "#766158",
        custom_domain: "",
        custom_domain_verified: false,
        takeaway_enabled: true,
        delivery_enabled: false,
      });
      const ov = await apiJson<PlatformOverviewResponse>("/api/super/overview");
      setData(ov);
    } catch (err) {
      toast({
        title: "Failed to create venue",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmittingVenue(false);
    }
  };

  const startEditVenue = (v: SuperVenueSummary) => {
    setEditingVenue(v);
    setEditVenueForm({
      name: v.name,
      slug: v.slug,
      plan: v.plan || "Pro",
      plan_status: v.plan_status || "active",
      plan_expires_at: v.plan_expires_at || "",
      tables: v.tables_total || 12,
      gst_rate: v.gst_rate ?? 5,
      upi_id: "",
      white_label: Boolean(v.white_label),
      brand_bg: v.brand_bg || "#FAF8F5",
      brand_accent: v.primary_color || v.brand_accent || "#49332A",
      brand_secondary: v.secondary_color || v.brand_secondary || "#766158",
      custom_domain: v.custom_domain || "",
      custom_domain_verified: Boolean(v.custom_domain_verified),
      takeaway_enabled: v.takeaway_enabled !== false,
      delivery_enabled: Boolean(v.delivery_enabled),
    });
    apiJson<{ restaurant: RestaurantSettings }>(`/api/super/restaurants/${v.id}`)
      .then((res) => {
        const r = res.restaurant;
        setEditVenueForm((prev) => ({
          ...prev,
          upi_id: r.upi_id || "",
          tables: r.table_config?.total || prev.tables,
          brand_secondary: r.secondary_color || r.brand_secondary || prev.brand_secondary,
          custom_domain_verified: Boolean(r.custom_domain_verified),
        }));
      })
      .catch(() => {});
  };

  const handleSaveAgency = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiJson("/api/super/platform", {
        method: "PATCH",
        body: JSON.stringify(agencyForm),
      });
      toast({ title: "Agency platform branding updated", variant: "success" });
      setAgencyOpen(false);
      const ov = await apiJson<PlatformOverviewResponse>("/api/super/overview");
      setData(ov);
    } catch (err) {
      toast({
        title: "Failed to save agency settings",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleSaveEditVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVenue) return;
    try {
      await apiJson(`/api/super/restaurants/${editingVenue.id}`, {
        method: "PATCH",
        body: JSON.stringify(editVenueForm),
      });
      toast({ title: "Venue updated", variant: "success" });
      setEditingVenue(null);
      const ov = await apiJson<PlatformOverviewResponse>("/api/super/overview");
      setData(ov);
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiJson("/api/super/admins", {
        method: "POST",
        body: JSON.stringify(adminForm),
      });
      toast({ title: "Admin account created", variant: "success" });
      setCreateAdminOpen(false);
      setAdminForm((f) => ({ ...f, name: "", email: "", password: "" }));
      const ov = await apiJson<PlatformOverviewResponse>("/api/super/overview");
      setData(ov);
    } catch (err) {
      toast({
        title: "Failed to add admin",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleLogout = async () => {
    await apiJson("/api/auth/logout", { method: "POST" });
    navigate("/auth", { replace: true });
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-[var(--qm-bg)] flex items-center justify-center">
        <p className="font-display text-2xl text-[#49332A]">Loading Khao Piyo...</p>
      </div>
    );
  }

  const stats = data.stats;
  const platformName = data.platform?.platform_name || "Khao Piyo";
  const themeStyle = buildVenueThemeStyle(
    data.platform?.default_brand_bg || "#FAF8F5",
    data.platform?.default_brand_accent || "#49332A",
    data.platform?.default_brand_secondary || "#766158"
  );

  return (
    <div style={themeStyle} className="min-h-screen bg-[var(--qm-bg)] flex flex-col md:flex-row pb-16 md:pb-0">
      {/* Sidebar */}
      <aside
        style={{ backgroundColor: "var(--qm-accent)", color: "var(--qm-accent-ink)" }}
        className="hidden md:flex w-68 flex-col justify-between sticky top-0 h-screen p-5"
      >
        <div>
          <div className="flex items-center gap-2.5 pb-4 border-b border-[#FAF8F5]/15">
            <BrandMark />
            <div className="min-w-0">
              <p className="font-display text-xl leading-none truncate">{platformName}</p>
              <p className="text-[11px] text-[#FAF8F5]/75 mt-1 flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    connected ? "bg-emerald-400" : "bg-amber-300"
                  }`}
                />
                Super Admin Console
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-[#FAF8F5]/10 px-3.5 py-2.5 text-xs">
            <p className="font-semibold flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
              {user?.name || "Platform Super Admin"}
            </p>
            <p className="text-[#FAF8F5]/70 text-[11px] mt-0.5 truncate">{user?.email}</p>
          </div>

          <p className="mt-6 px-2 text-[11px] font-semibold uppercase tracking-wider text-[#FAF8F5]/55">
            Platform Control
          </p>
          <nav className="mt-2 space-y-1">
            {(
              [
                { id: "overview", label: "Platform Overview", icon: LayoutDashboard },
                { id: "venues", label: "Venues & Restaurants", icon: Building2 },
                { id: "admins", label: "Active Admins", icon: Users },
                { id: "activity", label: "Global Live Feed", icon: Activity },
              ] as const
            ).map((navItem) => {
              const Icon = navItem.icon;
              const active = tab === navItem.id;
              return (
                <button
                  key={navItem.id}
                  type="button"
                  onClick={() => setTab(navItem.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    active
                      ? "bg-[#FAF8F5] text-[#49332A] font-semibold"
                      : "text-[#FAF8F5]/80 hover:bg-[#FAF8F5]/10"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4" />
                    {navItem.label}
                  </span>
                  {(navItem.id === "venues" || navItem.id === "admins") && (
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        active ? "bg-[#49332A] text-[#FAF8F5]" : "bg-[#FAF8F5]/15 text-[#FAF8F5]"
                      }`}
                    >
                      {navItem.id === "venues" ? stats.totalVenues : stats.activeAdmins}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mt-6 pt-4 border-t border-[#FAF8F5]/15">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-[#FAF8F5]/55">
              Quick Jump to Venue Admin
            </p>
            <div className="mt-2 space-y-1 max-h-44 overflow-y-auto pr-1">
              {data.venues.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => openVenueConsole(v.id, "/dashboard")}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs bg-[#FAF8F5]/5 hover:bg-[#FAF8F5]/15 text-left transition-colors"
                >
                  <span className="truncate font-medium">{v.name}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 opacity-70 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-[#FAF8F5]/15 space-y-1">
          <Link
            to="/"
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-[#FAF8F5]/80 hover:bg-[#FAF8F5]/10"
          >
            <ExternalLink className="h-4 w-4" />
            Platform Showcase Home
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-red-200 hover:bg-red-500/20"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile Top Bar */}
      <header className="md:hidden sticky top-0 z-30 bg-[#49332A] text-[#FAF8F5] px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BrandMark size="sm" />
          <span className="font-display text-lg truncate">{platformName}</span>
        </div>
        <button type="button" onClick={handleLogout} aria-label="Log out" className="p-2">
          <LogOut className="h-4 w-4" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-8 max-w-6xl w-full mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--qm-muted)]">
              White-Label Multi-Venue Platform
            </p>
            <h1 className="font-display text-3xl text-[#49332A] mt-0.5">
              {tab === "overview"
                ? "Platform Control Tower"
                : tab === "venues"
                  ? "Venues & Restaurants"
                  : tab === "admins"
                    ? "Active Admins"
                    : "Global Live Feed"}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                loadAll();
                toast({ title: "Data refreshed", description: "Latest platform metrics loaded." });
              }}
              className="h-10 px-4 rounded-xl bg-white border border-[var(--qm-line)] hover:border-[#49332A] text-[#49332A] text-sm font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Data
            </button>
            <button
              type="button"
              onClick={() => setAgencyOpen(true)}
              className="h-10 px-4 rounded-xl bg-white border border-[var(--qm-line)] hover:border-[#49332A] text-[#49332A] text-sm font-semibold transition-colors"
            >
              Agency Branding
            </button>
            <button
              type="button"
              onClick={() => setCreateVenueOpen(true)}
              className="h-10 px-4 rounded-xl bg-[#49332A] hover:bg-[#38261F] text-[#FAF8F5] text-sm font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add Venue / Restaurant
            </button>
            <button
              type="button"
              onClick={() => setCreateAdminOpen(true)}
              className="h-10 px-4 rounded-xl bg-white border border-[var(--qm-line)] hover:border-[#49332A] text-[#49332A] text-sm font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <UserPlus className="h-4 w-4" />
              Add Admin
            </button>
          </div>
        </div>

        {/* Platform KPIs */}
        {tab === "overview" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "Total Restaurants",
                  value: `${stats.activeVenues} / ${stats.totalVenues}`,
                  sub: `${stats.totalVenues - stats.activeVenues} paused venue(s)`,
                  icon: Building2,
                },
                {
                  label: "Active Admins",
                  value: String(stats.activeAdmins),
                  sub: `Across ${stats.activeVenues} active venue(s)`,
                  icon: Users,
                },
                {
                  label: "Active Orders",
                  value: String(stats.activeOrders ?? stats.todayOrders),
                  sub: `Today ${stats.todayOrders} · All-time ${stats.totalOrders}`,
                  icon: ShoppingBag,
                },
                {
                  label: "Total Revenue",
                  value: formatINR(stats.totalRevenue),
                  sub: `Today ${formatINR(stats.todayRevenue)}`,
                  icon: IndianRupee,
                },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.label}
                    className="rounded-3xl bg-white border border-[var(--qm-line)] p-5 shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="h-9 w-9 rounded-xl bg-[var(--qm-tint)] text-[#49332A] flex items-center justify-center">
                        <Icon className="h-4 w-4" />
                      </span>
                    </div>
                    <p className="font-display text-3xl text-[#49332A] mt-3 tabular-nums">
                      {card.value}
                    </p>
                    <p className="text-xs font-semibold text-[#49332A] mt-1">{card.label}</p>
                    <p className="text-[11px] text-[var(--qm-muted)] mt-0.5">{card.sub}</p>
                  </div>
                );
              })}
            </div>

            {/* Platform Analytics (Monthly Revenue & Order Types) */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-xl text-[#49332A]">Monthly Orders &amp; Revenue</h2>
                    <p className="text-xs text-[var(--qm-muted)]">
                      Last 6 months performance across {platformName} restaurants
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[var(--qm-tint)] text-[#49332A]">
                    {stats.totalOrders} orders
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-6 gap-2.5 items-end h-36">
                  {(() => {
                    const rows = data.monthlyStats || [];
                    const maxRev = Math.max(1, ...rows.map((r) => r.revenue));
                    return rows.map((m) => {
                      const pct = m.revenue > 0 ? Math.max(10, Math.round((m.revenue * 100) / maxRev)) : 6;
                      return (
                        <div key={m.month} className="flex flex-col items-center gap-1.5 h-full justify-end">
                          <span className="text-[10px] font-semibold text-[var(--qm-muted)] tabular-nums">
                            {m.orders > 0 ? formatINR(m.revenue) : "₹0"}
                          </span>
                          <div className="w-full max-w-[34px] flex-1 flex items-end">
                            <div
                              style={{
                                height: `${pct}%`,
                                backgroundColor: m.revenue > 0 ? "var(--qm-accent)" : "var(--qm-line)",
                              }}
                              className="w-full rounded-t-lg transition-all"
                              title={`${m.label}: ${m.orders} orders, ${formatINR(m.revenue)}`}
                            />
                          </div>
                          <span className="text-[11px] font-medium text-[#49332A]">{m.label.split(" ")[0]}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <h2 className="font-display text-xl text-[#49332A]">Order Types Distribution</h2>
                  <p className="text-xs text-[var(--qm-muted)]">
                    Channel breakdown across active restaurant orders
                  </p>
                </div>
                <div className="mt-5 space-y-4">
                  {(data.orderTypeBreakdown || []).map((row) => (
                    <div key={row.type} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#49332A]">{row.label}</span>
                        <span className="text-[var(--qm-muted)] tabular-nums">
                          {row.count} orders ({row.pct}%)
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-[var(--qm-tint)] overflow-hidden">
                        <div
                          style={{
                            width: `${row.pct}%`,
                            backgroundColor:
                              row.type === "dine_in"
                                ? "var(--qm-accent)"
                                : row.type === "takeaway"
                                  ? "var(--qm-secondary)"
                                  : "#059669",
                          }}
                          className="h-full rounded-full transition-all"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Venues Quick Management Grid */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl text-[#49332A]">All Managed Venues</h2>
                <button
                  type="button"
                  onClick={() => setTab("venues")}
                  className="text-xs font-semibold text-[#49332A] hover:underline"
                >
                  Manage all →
                </button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {data.venues.map((v) => {
                  const customerUrl = `/r/${v.slug}/scan?table=1`;
                  return (
                    <article
                      key={v.id}
                      className="rounded-3xl bg-white border border-[var(--qm-line)] overflow-hidden shadow-xs flex flex-col justify-between"
                    >
                      <div>
                        <div className="relative h-28 bg-[#49332A]">
                          <img
                            src={resolveCoverImage(v.cover_url)}
                            alt={v.name}
                            className="w-full h-full object-cover opacity-55"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-[#241610]/90 via-transparent to-transparent" />
                          <div className="absolute top-3 right-3 flex items-center gap-1.5">
                            {v.white_label && (
                              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#49332A] text-[#FAF8F5] border border-white/25">
                                White-Label
                              </span>
                            )}
                            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#FAF8F5] text-[#49332A]">
                              {v.plan || "Pro"}
                            </span>
                            <span
                              className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                                v.is_active
                                  ? "bg-emerald-500 text-white"
                                  : "bg-red-500 text-white"
                              }`}
                            >
                              {v.is_active ? "Active" : "Paused"}
                            </span>
                          </div>
                          <div className="absolute bottom-3 left-4 right-4 text-[#FAF8F5]">
                            <h3 className="font-display text-2xl leading-none">{v.name}</h3>
                            <p className="text-[11px] text-[#FAF8F5]/75 mt-1 font-mono">
                              /r/{v.slug}/scan
                            </p>
                          </div>
                        </div>

                        <div className="p-4 grid grid-cols-3 gap-2 text-center border-b border-[var(--qm-line)]">
                          <div>
                            <p className="text-base font-bold text-[#49332A] tabular-nums">
                              {formatINR(v.metrics.todayRevenue)}
                            </p>
                            <p className="text-[11px] text-[var(--qm-muted)]">Today</p>
                          </div>
                          <div>
                            <p className="text-base font-bold text-[#49332A] tabular-nums">
                              {v.metrics.todayOrders}
                            </p>
                            <p className="text-[11px] text-[var(--qm-muted)]">Orders</p>
                          </div>
                          <div>
                            <p className="text-base font-bold text-[#49332A] inline-flex items-center justify-center gap-1">
                              <Star className="h-3.5 w-3.5 fill-[#49332A]" />
                              {v.metrics.avgRating || "—"}
                            </p>
                            <p className="text-[11px] text-[var(--qm-muted)]">Rating</p>
                          </div>
                        </div>
                      </div>

                      <div className="p-3.5 flex flex-wrap items-center gap-2 bg-[#FAF8F5]">
                        <button
                          type="button"
                          onClick={() => openVenueConsole(v.id, "/dashboard")}
                          className="h-9 px-3.5 rounded-xl bg-[#49332A] hover:bg-[#38261F] text-[#FAF8F5] text-xs font-semibold inline-flex items-center gap-1.5"
                        >
                          <LayoutDashboard className="h-3.5 w-3.5" />
                          Open Admin
                        </button>
                        <button
                          type="button"
                          onClick={() => openVenueConsole(v.id, "/kitchen")}
                          className="h-9 px-3 rounded-xl bg-white border border-[var(--qm-line)] hover:border-[#49332A] text-xs font-semibold inline-flex items-center gap-1"
                        >
                          <ChefHat className="h-3.5 w-3.5" />
                          KDS
                        </button>
                        <a
                          href={customerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="h-9 px-3 rounded-xl bg-white border border-[var(--qm-line)] hover:border-[#49332A] text-xs font-semibold inline-flex items-center gap-1"
                        >
                          <QrCode className="h-3.5 w-3.5" />
                          Customer UI
                        </a>
                        <button
                          type="button"
                          onClick={() => toggleVenueStatus(v)}
                          className="ml-auto h-9 px-3 rounded-xl bg-white border border-[var(--qm-line)] text-xs font-semibold inline-flex items-center gap-1"
                        >
                          {v.is_active ? (
                            <>
                              <PauseCircle className="h-3.5 w-3.5 text-amber-700" />
                              Pause
                            </>
                          ) : (
                            <>
                              <PlayCircle className="h-3.5 w-3.5 text-emerald-700" />
                              Resume
                            </>
                          )}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Venues Directory Tab */}
        {tab === "venues" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="h-4 w-4 text-[var(--qm-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search venue name, slug, or custom domain..."
                  className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-[var(--qm-line)] text-sm"
                />
              </div>
              <div className="flex rounded-xl bg-white border border-[var(--qm-line)] p-1 text-xs font-semibold">
                {(["all", "active", "paused"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg capitalize ${
                      statusFilter === s
                        ? "bg-[#49332A] text-[#FAF8F5]"
                        : "text-[var(--qm-muted)]"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-3xl bg-white border border-[var(--qm-line)] overflow-x-auto shadow-xs">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-[var(--qm-line)] text-xs uppercase text-[var(--qm-muted)] bg-[#FAF8F5]">
                    <th className="py-3 px-4">Venue</th>
                    <th className="py-3 px-4">Plan &amp; Status</th>
                    <th className="py-3 px-4">Menu</th>
                    <th className="py-3 px-4">Today Sales</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--qm-line)]">
                  {filteredVenues.map((v) => (
                    <tr key={v.id} className="hover:bg-[#FAF8F5]/60">
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-[#49332A]">{v.name}</p>
                        <p className="text-xs text-[var(--qm-muted)] font-mono">/r/{v.slug}/scan</p>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-[var(--qm-tint)] text-[#49332A]">
                            {v.plan || "Pro"}
                          </span>
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              v.is_active
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {v.is_active ? "Active" : "Paused"}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 tabular-nums">{v.metrics.menuCount} dishes</td>
                      <td className="py-3.5 px-4 font-semibold tabular-nums">
                        {formatINR(v.metrics.todayRevenue)} ({v.metrics.todayOrders})
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openVenueConsole(v.id, "/dashboard")}
                            className="h-8 px-3 rounded-lg bg-[#49332A] text-[#FAF8F5] text-xs font-semibold"
                          >
                            Manage
                          </button>
                          <button
                            type="button"
                            onClick={() => startEditVenue(v)}
                            className="h-8 px-3 rounded-lg border border-[var(--qm-line)] bg-white text-xs font-semibold"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleVenueStatus(v)}
                            className="h-8 px-3 rounded-lg border border-[var(--qm-line)] bg-white text-xs font-semibold"
                          >
                            {v.is_active ? "Pause" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Active Admins Count Summary (No table details exposed) */}
        {tab === "admins" && (
          <div className="max-w-md rounded-3xl bg-white border border-[var(--qm-line)] p-7 shadow-xs space-y-5">
            <div className="flex items-center justify-between">
              <span className="h-12 w-12 rounded-2xl bg-[var(--qm-tint)] text-[#49332A] flex items-center justify-center">
                <Users className="h-6 w-6" />
              </span>
              <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800">
                Active
              </span>
            </div>
            <div>
              <p className="font-display text-5xl text-[#49332A] tabular-nums">
                {stats.activeAdmins}
              </p>
              <p className="text-sm font-semibold text-[#49332A] mt-2">Active Admins</p>
              <p className="text-xs text-[var(--qm-muted)] mt-0.5">
                Across {stats.activeVenues} active venue(s)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateAdminOpen(true)}
              className="w-full h-11 rounded-xl bg-[#49332A] hover:bg-[#38261F] text-[#FAF8F5] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <UserPlus className="h-4 w-4" />
              Add Admin
            </button>
          </div>
        )}

        {/* Global Activity Feed Tab */}
        {tab === "activity" && (
          <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-5 shadow-xs space-y-2.5">
            {data.recentActivity.length === 0 ? (
              <p className="text-sm text-[var(--qm-muted)] py-6 text-center">
                No cross-venue activity recorded yet.
              </p>
            ) : (
              data.recentActivity.map((act) => (
                <div
                  key={act.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 px-3 rounded-2xl bg-[#FAF8F5] border border-[var(--qm-line)]/60 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold px-2 py-0.5 rounded-full bg-[#49332A] text-[#FAF8F5]">
                      {act.restaurant_name}
                    </span>
                    <span className="font-semibold text-[#49332A]">{act.staff_name}</span>
                    <span className="text-[var(--qm-muted)]">
                      {act.action.replace(/_/g, " ")}
                    </span>
                  </div>
                  <span className="text-[var(--qm-muted)] tabular-nums">
                    {formatTimeShort(act.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* Mobile Nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[var(--qm-line)] grid grid-cols-4 h-16">
        {(
          [
            { id: "overview", label: "Overview", icon: LayoutDashboard },
            { id: "venues", label: "Venues", icon: Building2 },
            { id: "admins", label: "Admins", icon: Users },
            { id: "activity", label: "Activity", icon: Activity },
          ] as const
        ).map((m) => {
          const Icon = m.icon;
          const active = tab === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setTab(m.id)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${
                active ? "text-[#49332A]" : "text-[var(--qm-muted)]"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{m.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Create Venue Modal */}
      {createVenueOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateVenue}
            className="bg-white w-full max-w-lg rounded-3xl border border-[var(--qm-line)] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl text-[#49332A]">Provision New Venue</h2>
              <button
                type="button"
                onClick={() => setCreateVenueOpen(false)}
                aria-label="Close"
                className="p-1.5 rounded-full hover:bg-[var(--qm-surface)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold mb-1">Restaurant / Venue Name</label>
                <input
                  required
                  value={venueForm.name}
                  onChange={(e) => setVenueForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Royal Darbar"
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">URL Slug (optional)</label>
                <input
                  value={venueForm.slug}
                  onChange={(e) => setVenueForm((f) => ({ ...f, slug: e.target.value }))}
                  placeholder="royal-darbar"
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Plan Tier</label>
                <select
                  value={venueForm.plan}
                  onChange={(e) =>
                    setVenueForm((f) => ({
                      ...f,
                      plan: e.target.value as "Starter" | "Pro" | "Enterprise",
                    }))
                  }
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm bg-white"
                >
                  <option value="Starter">Starter</option>
                  <option value="Pro">Pro</option>
                  <option value="Enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Tables Count</label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={venueForm.tables}
                  onChange={(e) =>
                    setVenueForm((f) => ({ ...f, tables: Number(e.target.value) || 12 }))
                  }
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">UPI ID</label>
                <input
                  value={venueForm.upi_id}
                  onChange={(e) => setVenueForm((f) => ({ ...f, upi_id: e.target.value }))}
                  placeholder="venue@okaxis"
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">GST (%)</label>
                <input
                  type="number"
                  min={0}
                  max={28}
                  value={venueForm.gst_rate}
                  onChange={(e) =>
                    setVenueForm((f) => ({ ...f, gst_rate: Number(e.target.value) || 0 }))
                  }
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--qm-line)] space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--qm-muted)]">
                Venue Admin Account (Optional)
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <input
                  value={venueForm.ownerName}
                  onChange={(e) => setVenueForm((f) => ({ ...f, ownerName: e.target.value }))}
                  placeholder="Owner Name"
                  className="h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
                <input
                  type="email"
                  value={venueForm.ownerEmail}
                  onChange={(e) => setVenueForm((f) => ({ ...f, ownerEmail: e.target.value }))}
                  placeholder="admin@venue.local"
                  className="h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
                <input
                  type="password"
                  value={venueForm.ownerPassword}
                  onChange={(e) => setVenueForm((f) => ({ ...f, ownerPassword: e.target.value }))}
                  placeholder="Password (6+ chars)"
                  className="h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-[#49332A]">
              <input
                type="checkbox"
                checked={venueForm.sampleMenu}
                onChange={(e) => setVenueForm((f) => ({ ...f, sampleMenu: e.target.checked }))}
                className="rounded"
              />
              Seed starter menu catalog &amp; promo coupons automatically
            </label>

            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              <div>
                <label className="block font-semibold mb-1">Subscription Status</label>
                <select
                  value={venueForm.plan_status}
                  onChange={(e) =>
                    setVenueForm((f) => ({
                      ...f,
                      plan_status: e.target.value as "trial" | "active" | "past_due" | "paused",
                    }))
                  }
                  className="w-full h-9 px-2.5 rounded-xl border border-[var(--qm-line)] bg-white"
                >
                  <option value="active">Active</option>
                  <option value="trial">Trial</option>
                  <option value="past_due">Past Due</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Custom Domain (optional)</label>
                <input
                  value={venueForm.custom_domain}
                  onChange={(e) => setVenueForm((f) => ({ ...f, custom_domain: e.target.value }))}
                  placeholder="menu.restaurant.com"
                  className="w-full h-9 px-2.5 rounded-xl border border-[var(--qm-line)]"
                />
              </div>
            </div>

            <div className="rounded-2xl bg-[var(--qm-bg)] border border-[var(--qm-line)] p-3.5 space-y-2.5">
              <label className="flex items-center justify-between text-xs font-semibold text-[var(--qm-accent)] cursor-pointer">
                <span>White-Label Mode (hide platform branding)</span>
                <input
                  type="checkbox"
                  checked={venueForm.white_label}
                  onChange={(e) => setVenueForm((f) => ({ ...f, white_label: e.target.checked }))}
                  className="accent-[var(--qm-accent)]"
                />
              </label>
              {venueForm.custom_domain.trim() && (
                <label className="flex items-center justify-between text-xs font-semibold text-[var(--qm-accent)] cursor-pointer">
                  <span>Verify Custom Domain Now</span>
                  <input
                    type="checkbox"
                    checked={venueForm.custom_domain_verified}
                    onChange={(e) =>
                      setVenueForm((f) => ({ ...f, custom_domain_verified: e.target.checked }))
                    }
                    className="accent-[var(--qm-accent)]"
                  />
                </label>
              )}
              <div className="grid grid-cols-3 gap-2.5 text-xs">
                <label className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={venueForm.brand_bg}
                    onChange={(e) =>
                      setVenueForm((f) => ({ ...f, brand_bg: e.target.value.toUpperCase() }))
                    }
                    className="h-7 w-8 rounded border border-[var(--qm-line)]"
                  />
                  <span>Bg</span>
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={venueForm.brand_accent}
                    onChange={(e) =>
                      setVenueForm((f) => ({ ...f, brand_accent: e.target.value.toUpperCase() }))
                    }
                    className="h-7 w-8 rounded border border-[var(--qm-line)]"
                  />
                  <span>Primary</span>
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={venueForm.brand_secondary}
                    onChange={(e) =>
                      setVenueForm((f) => ({ ...f, brand_secondary: e.target.value.toUpperCase() }))
                    }
                    className="h-7 w-8 rounded border border-[var(--qm-line)]"
                  />
                  <span>Secondary</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreateVenueOpen(false)}
                className="h-10 px-4 rounded-xl border border-[var(--qm-line)] text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingVenue}
                className="h-10 px-5 rounded-xl bg-[#49332A] text-[#FAF8F5] text-sm font-semibold"
              >
                {submittingVenue ? "Creating..." : "Create Venue"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Venue Modal */}
      {editingVenue && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveEditVenue}
            className="bg-white w-full max-w-md rounded-3xl border border-[var(--qm-line)] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl text-[#49332A]">Edit {editingVenue.name}</h2>
              <button
                type="button"
                onClick={() => setEditingVenue(null)}
                aria-label="Close"
                className="p-1.5 rounded-full hover:bg-[var(--qm-surface)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Venue Name</label>
                <input
                  required
                  value={editVenueForm.name}
                  onChange={(e) => setEditVenueForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Plan</label>
                  <select
                    value={editVenueForm.plan}
                    onChange={(e) =>
                      setEditVenueForm((f) => ({
                        ...f,
                        plan: e.target.value as "Starter" | "Pro" | "Enterprise",
                      }))
                    }
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm bg-white"
                  >
                    <option value="Starter">Starter</option>
                    <option value="Pro">Pro</option>
                    <option value="Enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Plan Status</label>
                  <select
                    value={editVenueForm.plan_status}
                    onChange={(e) =>
                      setEditVenueForm((f) => ({
                        ...f,
                        plan_status: e.target.value as "trial" | "active" | "past_due" | "paused",
                      }))
                    }
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="trial">Trial</option>
                    <option value="past_due">Past Due</option>
                    <option value="paused">Paused</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Tables</label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={editVenueForm.tables}
                    onChange={(e) =>
                      setEditVenueForm((f) => ({ ...f, tables: Number(e.target.value) || 12 }))
                    }
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Renewal / Expiry</label>
                  <input
                    type="date"
                    value={editVenueForm.plan_expires_at}
                    onChange={(e) =>
                      setEditVenueForm((f) => ({ ...f, plan_expires_at: e.target.value }))
                    }
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">UPI ID</label>
                  <input
                    value={editVenueForm.upi_id}
                    onChange={(e) => setEditVenueForm((f) => ({ ...f, upi_id: e.target.value }))}
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">GST (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={28}
                    value={editVenueForm.gst_rate}
                    onChange={(e) =>
                      setEditVenueForm((f) => ({ ...f, gst_rate: Number(e.target.value) || 0 }))
                    }
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Custom Domain (Host Route)</label>
                <input
                  value={editVenueForm.custom_domain}
                  onChange={(e) =>
                    setEditVenueForm((f) => ({ ...f, custom_domain: e.target.value }))
                  }
                  placeholder="menu.yourrestaurant.com"
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
              <div className="rounded-2xl bg-[var(--qm-bg)] border border-[var(--qm-line)] p-3 space-y-2 text-xs">
                <label className="flex items-center justify-between font-semibold text-[var(--qm-accent)] cursor-pointer">
                  <span>White-Label Mode (hide platform branding)</span>
                  <input
                    type="checkbox"
                    checked={editVenueForm.white_label}
                    onChange={(e) =>
                      setEditVenueForm((f) => ({ ...f, white_label: e.target.checked }))
                    }
                    className="accent-[var(--qm-accent)]"
                  />
                </label>
                {editVenueForm.custom_domain.trim() && (
                  <label className="flex items-center justify-between font-semibold text-[var(--qm-accent)] cursor-pointer">
                    <span>Custom Domain Verified</span>
                    <input
                      type="checkbox"
                      checked={editVenueForm.custom_domain_verified}
                      onChange={(e) =>
                        setEditVenueForm((f) => ({
                          ...f,
                          custom_domain_verified: e.target.checked,
                        }))
                      }
                      className="accent-[var(--qm-accent)]"
                    />
                  </label>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={editVenueForm.brand_bg}
                      onChange={(e) =>
                        setEditVenueForm((f) => ({ ...f, brand_bg: e.target.value.toUpperCase() }))
                      }
                      className="h-7 w-8 rounded border border-[var(--qm-line)]"
                    />
                    <span>Bg</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={editVenueForm.brand_accent}
                      onChange={(e) =>
                        setEditVenueForm((f) => ({
                          ...f,
                          brand_accent: e.target.value.toUpperCase(),
                        }))
                      }
                      className="h-7 w-8 rounded border border-[var(--qm-line)]"
                    />
                    <span>Primary</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={editVenueForm.brand_secondary}
                      onChange={(e) =>
                        setEditVenueForm((f) => ({
                          ...f,
                          brand_secondary: e.target.value.toUpperCase(),
                        }))
                      }
                      className="h-7 w-8 rounded border border-[var(--qm-line)]"
                    />
                    <span>Secondary</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingVenue(null)}
                className="h-10 px-4 rounded-xl border border-[var(--qm-line)] text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-10 px-5 rounded-xl bg-[#49332A] text-[#FAF8F5] text-sm font-semibold"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Agency & Reseller Branding Modal */}
      {agencyOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveAgency}
            className="bg-white w-full max-w-md rounded-3xl border border-[var(--qm-line)] p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl text-[#49332A]">Agency &amp; Reseller Branding</h2>
              <button
                type="button"
                onClick={() => setAgencyOpen(false)}
                aria-label="Close"
                className="p-1.5 rounded-full hover:bg-[var(--qm-surface)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Platform Product Name</label>
                <input
                  required
                  value={agencyForm.platform_name}
                  onChange={(e) => setAgencyForm((f) => ({ ...f, platform_name: e.target.value }))}
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Agency / Company</label>
                  <input
                    required
                    value={agencyForm.agency_name}
                    onChange={(e) => setAgencyForm((f) => ({ ...f, agency_name: e.target.value }))}
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Support Email</label>
                  <input
                    type="email"
                    value={agencyForm.support_email}
                    onChange={(e) => setAgencyForm((f) => ({ ...f, support_email: e.target.value }))}
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">Showcase Tagline</label>
                <textarea
                  rows={2}
                  value={agencyForm.agency_tagline}
                  onChange={(e) => setAgencyForm((f) => ({ ...f, agency_tagline: e.target.value }))}
                  className="w-full p-2.5 rounded-xl border border-[var(--qm-line)] text-sm resize-none"
                />
              </div>
              <div className="grid grid-cols-3 gap-2.5 pt-1">
                <label className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={agencyForm.default_brand_bg}
                    onChange={(e) =>
                      setAgencyForm((f) => ({ ...f, default_brand_bg: e.target.value.toUpperCase() }))
                    }
                    className="h-8 w-8 rounded border border-[var(--qm-line)]"
                  />
                  <span>Bg</span>
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={agencyForm.default_brand_accent}
                    onChange={(e) =>
                      setAgencyForm((f) => ({
                        ...f,
                        default_brand_accent: e.target.value.toUpperCase(),
                      }))
                    }
                    className="h-8 w-8 rounded border border-[var(--qm-line)]"
                  />
                  <span>Primary</span>
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={agencyForm.default_brand_secondary}
                    onChange={(e) =>
                      setAgencyForm((f) => ({
                        ...f,
                        default_brand_secondary: e.target.value.toUpperCase(),
                      }))
                    }
                    className="h-8 w-8 rounded border border-[var(--qm-line)]"
                  />
                  <span>Secondary</span>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAgencyOpen(false)}
                className="h-10 px-4 rounded-xl border border-[var(--qm-line)] text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-10 px-5 rounded-xl bg-[#49332A] text-[#FAF8F5] text-sm font-semibold"
              >
                Save Agency Brand
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Create Admin Modal */}
      {createAdminOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateAdmin}
            className="bg-white w-full max-w-md rounded-3xl border border-[var(--qm-line)] p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl text-[#49332A]">Add Venue Admin</h2>
              <button
                type="button"
                onClick={() => setCreateAdminOpen(false)}
                aria-label="Close"
                className="p-1.5 rounded-full hover:bg-[var(--qm-surface)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Assigned Venue</label>
                <select
                  required
                  value={adminForm.restaurantId}
                  onChange={(e) => setAdminForm((f) => ({ ...f, restaurantId: e.target.value }))}
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm bg-white"
                >
                  {data.venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.slug})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Full Name</label>
                <input
                  required
                  value={adminForm.name}
                  onChange={(e) => setAdminForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Manager Name"
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Email</label>
                <input
                  required
                  type="email"
                  value={adminForm.email}
                  onChange={(e) => setAdminForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="manager@venue.local"
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Password</label>
                <input
                  required
                  type="password"
                  minLength={6}
                  value={adminForm.password}
                  onChange={(e) => setAdminForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Minimum 6 characters"
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreateAdminOpen(false)}
                className="h-10 px-4 rounded-xl border border-[var(--qm-line)] text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-10 px-5 rounded-xl bg-[#49332A] text-[#FAF8F5] text-sm font-semibold"
              >
                Create Admin
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
