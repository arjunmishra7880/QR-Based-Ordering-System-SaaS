import { useEffect, useState } from "react";
import { BarChart3, Star } from "lucide-react";
import { apiJson, formatINR } from "../../lib/api";
import { compactINR, formatHourLabel } from "../../lib/billMath";
import type { PaymentMode, ReportsData } from "../../types";

interface ReportsTabProps {
  initialSection?: "sales" | "reviews";
  onChangeSection: (section: "sales" | "reviews") => void;
}

const MODE_LABELS: Record<PaymentMode, string> = {
  upi: "UPI",
  card: "Card",
  cash: "Cash",
};

function MetricBarCard({
  title,
  sub,
  rows,
  emptyText,
  footer,
}: {
  title: string;
  sub: string;
  rows: Array<{ name: string; value: number; right: string }>;
  emptyText?: string;
  footer?: string;
}) {
  const maxVal = Math.max(...rows.map((r) => r.value), 1);
  return (
    <section className="rounded-3xl border border-[var(--qm-line)] bg-white p-5">
      <h3 className="font-display text-xl">{title}</h3>
      <p className="text-xs text-[var(--qm-muted)]">{sub}</p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--qm-muted)]">{emptyText || "Nothing yet."}</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.name}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate font-medium">{r.name}</span>
                <span className="text-[var(--qm-muted)] tabular-nums whitespace-nowrap">
                  {r.right}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 rounded-full bg-[var(--qm-surface)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#49332A]"
                  style={{ width: `${Math.max(4, (r.value / maxVal) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
      {footer && <p className="mt-4 text-xs text-[var(--qm-muted)]">{footer}</p>}
    </section>
  );
}

export function ReportsTab({ initialSection = "sales", onChangeSection }: ReportsTabProps) {
  const [period, setPeriod] = useState<"today" | "7d" | "30d">("today");
  const [data, setData] = useState<ReportsData | null>(null);

  useEffect(() => {
    let active = true;
    apiJson<ReportsData>(`/api/admin/reports?period=${period}`)
      .then((res) => active && setData(res))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [period]);

  const maxHourSales = data ? Math.max(...data.hours.map((h) => h.sales), 1) : 1;
  const topDishes = data ? data.items.slice(0, 8) : [];
  const slowest = data && data.items.length > 8 ? data.items.slice(-3).reverse() : [];

  return (
    <div className="space-y-6">
      {/* Section Pill Nav */}
      <nav className="flex gap-2">
        {(
          [
            { id: "sales", label: "Sales" },
            { id: "reviews", label: "Reviews" },
          ] as const
        ).map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onChangeSection(s.id)}
            className={`h-9 px-4 rounded-full text-sm font-semibold transition-colors ${
              initialSection === s.id
                ? "bg-[#49332A] text-[#FAF8F5]"
                : "bg-[var(--qm-tint)] text-[#49332A] hover:bg-[#E4DDD5]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {initialSection === "sales" ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[var(--qm-tint)] text-[#49332A] flex items-center justify-center">
                <BarChart3 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-3xl leading-none">Reports</h2>
                <p className="text-sm text-[var(--qm-muted)] mt-1">
                  Declined and cancelled orders aren&apos;t counted.
                </p>
              </div>
            </div>

            <div className="inline-flex rounded-full bg-[var(--qm-tint)] p-1">
              {(
                [
                  { id: "today", label: "Today" },
                  { id: "7d", label: "7 days" },
                  { id: "30d", label: "30 days" },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  className={`h-8 px-4 rounded-full text-xs font-semibold transition-colors ${
                    period === p.id ? "bg-white text-[#49332A] shadow-xs" : "text-[var(--qm-muted)]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="rounded-2xl border border-[var(--qm-line)] bg-white p-4">
              <p className="text-xs text-[var(--qm-muted)] font-medium">Sales</p>
              <p className="font-display text-3xl mt-1 tabular-nums text-[#49332A]">
                {data ? compactINR(data.sales) : "–"}
              </p>
              <p className="text-xs text-[var(--qm-muted)] mt-1">
                {data?.tips ? `+ ${formatINR(data.tips)} tips` : "Before tips"}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--qm-line)] bg-white p-4">
              <p className="text-xs text-[var(--qm-muted)] font-medium">Orders</p>
              <p className="font-display text-3xl mt-1 tabular-nums text-[#49332A]">
                {data ? data.orders : "–"}
              </p>
              <p className="text-xs text-[var(--qm-muted)] mt-1">
                {data?.voided ? `${data.voided} declined or cancelled` : "Sent to kitchen"}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--qm-line)] bg-white p-4">
              <p className="text-xs text-[var(--qm-muted)] font-medium">Average bill per table</p>
              <p className="font-display text-3xl mt-1 tabular-nums text-[#49332A]">
                {data ? formatINR(data.avgBill) : "–"}
              </p>
              <p className="text-xs text-[var(--qm-muted)] mt-1">
                {data ? `${data.bills} ${data.bills === 1 ? "bill" : "bills"}` : ""}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--qm-line)] bg-white p-4">
              <p className="text-xs text-[var(--qm-muted)] font-medium">Kitchen time</p>
              <p className="font-display text-3xl mt-1 tabular-nums text-[#49332A]">
                {data ? (data.kitchenMinutes === null ? "–" : `${data.kitchenMinutes} min`) : "–"}
              </p>
              <p className="text-xs text-[var(--qm-muted)] mt-1">Order to ready, average</p>
            </div>
          </div>

          {data && data.orders === 0 ? (
            <div className="rounded-3xl border border-dashed border-[var(--qm-line)] bg-white p-8 text-center text-sm text-[var(--qm-muted)]">
              No orders {period === "today" ? "yet today" : "in this period"}. Reports populate automatically as guests order.
            </div>
          ) : (
            data && (
              <>
                {/* Busiest Hours Bar Chart */}
                <section className="rounded-3xl border border-[var(--qm-line)] bg-white p-5">
                  <h3 className="font-display text-xl">Busiest hours</h3>
                  <p className="text-xs text-[var(--qm-muted)]">
                    {data.peakHour !== null
                      ? `Most sales around ${formatHourLabel(data.peakHour)}`
                      : "Sales by hour"}
                  </p>
                  <div className="mt-5 h-36 flex items-end gap-1 border-b border-[var(--qm-line)]">
                    {data.hours.map((h) => (
                      <div key={h.hour} className="group relative flex-1 h-full flex items-end justify-center">
                        <div
                          className={`w-full max-w-[20px] rounded-t-sm transition-colors ${
                            h.hour === data.peakHour
                              ? "bg-[#49332A]"
                              : "bg-[#49332A]/30 group-hover:bg-[#49332A]/60"
                          }`}
                          style={{
                            height: h.sales ? `${Math.max(4, (h.sales / maxHourSales) * 100)}%` : "0%",
                          }}
                        />
                        <span className="pointer-events-none hidden group-hover:block absolute bottom-full mb-1.5 whitespace-nowrap rounded-lg bg-[#49332A] text-[#FAF8F5] px-2 py-1 text-[11px] shadow-md z-10">
                          {formatHourLabel(h.hour)} · {formatINR(h.sales)} ({h.orders})
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5 flex text-[10px] text-[var(--qm-muted)] tabular-nums">
                    {data.hours.map((h) => (
                      <span key={h.hour} className="flex-1 text-center">
                        {h.hour % 6 === 0 ? formatHourLabel(h.hour).replace(" ", "") : ""}
                      </span>
                    ))}
                  </div>
                </section>

                <div className="grid gap-5 lg:grid-cols-2">
                  <MetricBarCard
                    title="Bestsellers"
                    sub="By quantity"
                    rows={topDishes.map((d) => ({
                      name: d.name,
                      value: d.qty,
                      right: `${d.qty} · ${compactINR(d.revenue)}`,
                    }))}
                    footer={
                      slowest.length > 0
                        ? `Slowest: ${slowest.map((s) => `${s.name} (${s.qty})`).join(", ")}`
                        : undefined
                    }
                  />

                  <div className="space-y-5">
                    <MetricBarCard
                      title="Payments"
                      sub="Confirmed by payment mode"
                      rows={data.payModes.map((m) => ({
                        name: MODE_LABELS[m.mode] || m.mode,
                        value: m.amount,
                        right: formatINR(m.amount),
                      }))}
                      emptyText="No confirmed payments in this period yet."
                    />

                    <MetricBarCard
                      title="Top tables"
                      sub="By sales"
                      rows={data.tables.slice(0, 5).map((t) => ({
                        name: `Table ${t.table}`,
                        value: t.sales,
                        right: `${compactINR(t.sales)} · ${t.orders} ${t.orders === 1 ? "order" : "orders"}`,
                      }))}
                    />
                  </div>
                </div>

                {data.items.length > 0 && (
                  <details className="rounded-3xl border border-[var(--qm-line)] bg-white p-5 text-sm">
                    <summary className="cursor-pointer font-semibold">Every dish as a table</summary>
                    <table className="mt-3 w-full">
                      <thead className="text-xs text-[var(--qm-muted)]">
                        <tr>
                          <th className="text-left font-medium py-1.5">Dish</th>
                          <th className="text-right font-medium py-1.5">Sold</th>
                          <th className="text-right font-medium py-1.5">Sales</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--qm-line)]">
                        {data.items.map((d) => (
                          <tr key={d.name}>
                            <td className="py-1.5">{d.name}</td>
                            <td className="py-1.5 text-right tabular-nums">{d.qty}</td>
                            <td className="py-1.5 text-right tabular-nums">{formatINR(d.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </>
            )
          )}
        </div>
      ) : (
        /* Reviews Sub-tab */
        <div className="space-y-5">
          <div>
            <h2 className="font-display text-3xl leading-none">Guest Reviews</h2>
            <p className="text-sm text-[var(--qm-muted)] mt-1">
              Direct dining ratings submitted from table bills (ratings ≤ 2 alert staff live)
            </p>
          </div>

          <div className="grid sm:grid-cols-[240px_1fr] gap-4">
            <div className="rounded-3xl border border-[var(--qm-line)] bg-white p-6 text-center flex flex-col justify-center">
              <div className="inline-flex items-center justify-center gap-1.5 font-display text-4xl text-[#49332A]">
                <Star className="h-7 w-7 fill-[#49332A]" />
                {data?.feedback.avgRating || "–"}
              </div>
              <p className="text-xs text-[var(--qm-muted)] mt-1">
                {data?.feedback.totalReviews || 0} reviews in selected period
              </p>
            </div>

            <div className="rounded-3xl border border-[var(--qm-line)] bg-white p-5 space-y-2">
              {[5, 4, 3, 2, 1].map((stars) => {
                const count = data?.feedback.ratingCounts[stars] || 0;
                const total = Math.max(1, data?.feedback.totalReviews || 0);
                return (
                  <div key={stars} className="flex items-center gap-3 text-xs">
                    <span className="w-10 font-semibold text-[#49332A]">{stars} ★</span>
                    <div className="flex-1 h-2.5 rounded-full bg-[var(--qm-surface)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#49332A]"
                        style={{ width: `${(count / total) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 text-right tabular-nums text-[var(--qm-muted)]">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {!data || data.feedback.reviews.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[var(--qm-line)] bg-white p-8 text-center text-sm text-[var(--qm-muted)]">
              No guest reviews in this period yet.
            </div>
          ) : (
            <div className="space-y-2.5">
              {data.feedback.reviews.map((rev) => (
                <div
                  key={rev.id}
                  className="rounded-2xl border border-[var(--qm-line)] bg-white p-4 flex items-start justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[#49332A]">
                        Table {rev.table_number}
                      </span>
                      {rev.order_number && (
                        <span className="text-xs text-[var(--qm-muted)]">{rev.order_number}</span>
                      )}
                      <span className="inline-flex items-center gap-0.5 text-xs font-bold text-[#49332A]">
                        {rev.rating} <Star className="h-3 w-3 fill-[#49332A]" />
                      </span>
                    </div>
                    {rev.comment && (
                      <p className="text-sm text-[var(--qm-ink)] mt-1">&ldquo;{rev.comment}&rdquo;</p>
                    )}
                  </div>
                  <span className="text-xs text-[var(--qm-muted)] whitespace-nowrap">
                    {new Date(rev.created_at).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
