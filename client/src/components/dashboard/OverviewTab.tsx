import { Link } from "react-router-dom";
import {
  ChefHat,
  Eye,
  Flame,
  IndianRupee,
  MessageSquare,
  QrCode,
  Send,
  ShoppingBag,
  Star,
  TrendingDown,
  TrendingUp,
  UtensilsCrossed,
  Volume2,
} from "lucide-react";
import { formatINR, formatTimeShort } from "../../lib/api";
import { playOrderChime } from "../../lib/sound";
import type { DashboardOverview } from "../../types";

interface OverviewTabProps {
  overview: DashboardOverview | null;
  onGoToTab: (tab: string) => void;
}

function pctChange(today: number, yesterday: number): number {
  if (yesterday === 0) return today > 0 ? 100 : 0;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

export function OverviewTab({ overview, onGoToTab }: OverviewTabProps) {
  const stats = overview?.stats || {
    todayRevenue: 0,
    todayOrders: 0,
    yesterdayRevenue: 0,
    yesterdayOrders: 0,
    activeOrders: 0,
    menuViews: 0,
    avgOrderValue: 0,
    pendingCalls: 0,
    totalMenuItems: 0,
    totalOrders: 0,
    avgRating: 0,
    totalFeedback: 0,
  };
  const topItems = overview?.topItems || [];

  const revDelta = pctChange(stats.todayRevenue, stats.yesterdayRevenue);
  const ordDelta = pctChange(stats.todayOrders, stats.yesterdayOrders);

  const sendWhatsappReport = () => {
    const dateLabel = new Date().toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const lines = [
      `📊 *Sales Report – ${dateLabel}*`,
      "",
      `💰 Revenue: *${formatINR(stats.todayRevenue)}*${
        stats.yesterdayRevenue
          ? ` (${revDelta >= 0 ? "▲" : "▼"} ${Math.abs(revDelta)}% vs yesterday)`
          : ""
      }`,
      `🧾 Orders: *${stats.todayOrders}*`,
      `🛒 Avg order: ${formatINR(stats.avgOrderValue)}`,
      ...(topItems.length
        ? [
            "",
            "🔥 *Top items*",
            ...topItems.slice(0, 3).map((it, idx) => `${idx + 1}. ${it.name} × ${it.count}`),
          ]
        : []),
      ...(stats.avgRating > 0
        ? [
            "",
            `⭐ Rating: ${stats.avgRating}/5 (${stats.totalFeedback} review${
              stats.totalFeedback === 1 ? "" : "s"
            })`,
          ]
        : []),
    ];
    window.open(
      `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const mainCards = [
    { label: "Today's revenue", value: formatINR(stats.todayRevenue), icon: IndianRupee, delta: revDelta },
    { label: "Today's orders", value: String(stats.todayOrders), icon: ShoppingBag, delta: ordDelta },
    { label: "Active orders", value: String(stats.activeOrders), icon: ChefHat, live: stats.activeOrders > 0 },
    { label: "Menu views", value: String(stats.menuViews), icon: Eye },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl">Overview</h2>
          <p className="text-sm text-[var(--qm-muted)]">How today is going, at a glance</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={sendWhatsappReport}
            className="h-10 px-4 rounded-xl bg-white border border-[var(--qm-line)] text-sm font-medium inline-flex items-center gap-2 hover:border-[#49332A]"
          >
            <Send className="h-4 w-4 text-[#49332A]" />
            Send today&apos;s report
          </button>
          <button
            type="button"
            onClick={() => playOrderChime()}
            className="h-10 px-4 rounded-xl bg-white border border-[var(--qm-line)] text-sm font-medium inline-flex items-center gap-2 hover:border-[#49332A]"
          >
            <Volume2 className="h-4 w-4 text-[#49332A]" />
            Test order alert
          </button>
          <Link
            to="/kitchen"
            className="h-10 px-4 rounded-xl bg-[#49332A] hover:bg-[#38261F] text-[#FAF8F5] text-sm font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <ChefHat className="h-4 w-4 text-[#FAF8F5]" />
            Open Kitchen Display
          </Link>
          <Link
            to="/scan?table=4"
            target="_blank"
            className="h-10 px-4 rounded-xl bg-[var(--qm-tint)] hover:bg-[#E4DDD5] text-[#49332A] text-sm font-semibold inline-flex items-center gap-2"
          >
            <QrCode className="h-4 w-4" />
            Preview Guest Menu
          </Link>
        </div>
      </div>

      {/* Primary KPIs */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {mainCards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.label}
              className="rounded-2xl bg-white border border-[var(--qm-line)] p-5 shadow-xs"
            >
              <div className="flex items-center justify-between">
                <span className="h-9 w-9 rounded-xl bg-[var(--qm-tint)] text-[#49332A] flex items-center justify-center">
                  <Icon className="h-4 w-4" />
                </span>
                {c.delta !== undefined && c.delta !== 0 && (
                  <span
                    className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                      c.delta > 0
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {c.delta > 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {Math.abs(c.delta)}%
                  </span>
                )}
                {c.live && <span className="h-2.5 w-2.5 rounded-full bg-[#49332A] animate-pulse" />}
              </div>
              <p className="font-display text-3xl mt-3 tabular-nums">{c.value}</p>
              <p className="text-xs font-medium text-[var(--qm-muted)] mt-0.5">{c.label}</p>
            </div>
          );
        })}
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="rounded-2xl bg-white border border-[var(--qm-line)] p-4">
          <p className="text-xs text-[var(--qm-muted)] font-medium">Yesterday&apos;s revenue</p>
          <p className="text-lg font-bold tabular-nums mt-1">{formatINR(stats.yesterdayRevenue)}</p>
        </div>
        <div className="rounded-2xl bg-white border border-[var(--qm-line)] p-4">
          <p className="text-xs text-[var(--qm-muted)] font-medium">Yesterday&apos;s orders</p>
          <p className="text-lg font-bold tabular-nums mt-1">{stats.yesterdayOrders}</p>
        </div>
        <div className="rounded-2xl bg-white border border-[var(--qm-line)] p-4">
          <p className="text-xs text-[var(--qm-muted)] font-medium">Avg order value</p>
          <p className="text-lg font-bold tabular-nums mt-1">{formatINR(stats.avgOrderValue)}</p>
        </div>
        <div className="rounded-2xl bg-white border border-[var(--qm-line)] p-4">
          <p className="text-xs text-[var(--qm-muted)] font-medium">Avg rating</p>
          {stats.avgRating > 0 ? (
            <p className="text-lg font-bold tabular-nums mt-1 inline-flex items-center gap-1 text-[#49332A]">
              <Star className="h-4 w-4 fill-[#49332A]" />
              {stats.avgRating}
            </p>
          ) : (
            <p className="text-sm text-[var(--qm-muted)] mt-1">No ratings yet</p>
          )}
        </div>
      </div>

      {/* Recent Orders + Top Selling Items */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-xl">Recent orders today</h3>
            <button
              type="button"
              onClick={() => onGoToTab("orders")}
              className="text-xs font-semibold text-[#49332A] hover:underline"
            >
              View all orders →
            </button>
          </div>

          {!overview || overview.recentOrders.length === 0 ? (
            <p className="text-sm text-[var(--qm-muted)] py-6 text-center">
              No orders today yet.
            </p>
          ) : (
            <div className="space-y-2">
              {overview.recentOrders.slice(0, 5).map((order) => (
                <div
                  key={order.id}
                  className="p-2.5 rounded-xl bg-[var(--qm-bg)] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{order.order_number}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white border border-[var(--qm-line)] font-medium">
                        Table {order.table_number}
                      </span>
                      <span className="text-xs text-[var(--qm-muted)] capitalize">{order.status}</span>
                    </div>
                    <p className="text-xs text-[var(--qm-muted)] truncate mt-0.5">
                      {order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold tabular-nums">{formatINR(order.total_amount)}</p>
                    <p className="text-[11px] text-[var(--qm-muted)]">{formatTimeShort(order.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-xl flex items-center gap-2">
              <Flame className="h-4 w-4 text-[#49332A]" />
              Top selling items
            </h3>
            <button
              type="button"
              onClick={() => onGoToTab("reports")}
              className="text-xs font-semibold text-[#49332A] hover:underline"
            >
              Full reports →
            </button>
          </div>

          {topItems.length === 0 ? (
            <p className="text-sm text-[var(--qm-muted)] py-6 text-center">No sales data yet.</p>
          ) : (
            <ol className="space-y-2">
              {topItems.map((it, idx) => (
                <li
                  key={it.name}
                  className="p-2.5 rounded-xl bg-[var(--qm-bg)] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold tabular-nums flex-shrink-0 ${
                        idx === 0 ? "bg-[#49332A] text-[#FAF8F5]" : "bg-[var(--qm-tint)] text-[#49332A]"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span className="text-sm font-semibold truncate">{it.name}</span>
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-[var(--qm-muted)] flex-shrink-0">
                    {it.count} sold
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Bottom Total Summary Cards */}
      <div className="grid grid-cols-3 gap-3.5">
        <button
          type="button"
          onClick={() => onGoToTab("menu")}
          className="text-left rounded-2xl bg-white border border-[var(--qm-line)] hover:border-[#49332A]/40 p-4 transition-colors"
        >
          <UtensilsCrossed className="h-4 w-4 text-[#49332A]" />
          <p className="font-display text-2xl mt-2 tabular-nums">{stats.totalMenuItems}</p>
          <p className="text-xs text-[var(--qm-muted)]">Menu items</p>
        </button>
        <button
          type="button"
          onClick={() => onGoToTab("orders")}
          className="text-left rounded-2xl bg-white border border-[var(--qm-line)] hover:border-[#49332A]/40 p-4 transition-colors"
        >
          <ShoppingBag className="h-4 w-4 text-[#49332A]" />
          <p className="font-display text-2xl mt-2 tabular-nums">{stats.totalOrders}</p>
          <p className="text-xs text-[var(--qm-muted)]">Total orders</p>
        </button>
        <button
          type="button"
          onClick={() => onGoToTab("feedback")}
          className="text-left rounded-2xl bg-white border border-[var(--qm-line)] hover:border-[#49332A]/40 p-4 transition-colors"
        >
          <MessageSquare className="h-4 w-4 text-[#49332A]" />
          <p className="font-display text-2xl mt-2 tabular-nums">{stats.totalFeedback}</p>
          <p className="text-xs text-[var(--qm-muted)]">Feedback</p>
        </button>
      </div>
    </div>
  );
}
