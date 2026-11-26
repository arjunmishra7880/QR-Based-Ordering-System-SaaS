import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Check,
  ChevronDown,
  Clock,
  CreditCard,
  Gift,
  KeyRound,
  LayoutGrid,
  Sparkles,
  X,
} from "lucide-react";
import { useToast } from "../Toast";
import { apiJson, formatINR } from "../../lib/api";
import { elapsedLabel, getRemainingDue } from "../../lib/billMath";
import { handleDishImageError, resolveDishImage } from "../../lib/dishMedia";
import type { FloorState, FloorTable, PaymentMode, PaymentRecord } from "../../types";

interface FloorTabProps {
  actorName: string;
  onSyncExternal?: () => void;
}

const TILE_META: Record<FloorTable["status"], { label: string; dot: string; tile: string }> = {
  free: {
    label: "Free",
    dot: "bg-emerald-500",
    tile: "bg-white border-[var(--qm-line)]",
  },
  open: {
    label: "Seated",
    dot: "bg-amber-500",
    tile: "bg-amber-50/70 border-amber-300",
  },
  bill: {
    label: "Waiting to pay",
    dot: "bg-[#49332A]",
    tile: "bg-[#FAF8F5] border-[#49332A]/50 ring-1 ring-[#49332A]/20",
  },
  cleaning: {
    label: "Cleaning",
    dot: "bg-sky-500",
    tile: "bg-sky-50/60 border-sky-200",
  },
};

const MODE_LABEL: Record<PaymentMode, string> = {
  upi: "UPI",
  card: "Card",
  cash: "Cash",
};

export function FloorTab({ actorName, onSyncExternal }: FloorTabProps) {
  const { toast } = useToast();
  const [floor, setFloor] = useState<FloorState | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const [takingPay, setTakingPay] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState<PaymentMode>("cash");
  const [moveTarget, setMoveTarget] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [closeReason, setCloseReason] = useState("");

  const loadFloor = useCallback(async () => {
    try {
      const data = await apiJson<FloorState>("/api/admin/floor");
      setFloor(data);
    } catch {
      // handled on mount
    }
  }, []);

  useEffect(() => {
    loadFloor();
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [loadFloor]);

  const activeRow = floor?.tables.find((t) => t.number === selectedTable) || null;
  const activeSeating = activeRow?.seating || null;
  const activeBill = activeSeating?.bill || null;
  const remainingDue = activeBill ? getRemainingDue(activeBill) : 0;

  useEffect(() => {
    setPayAmount(remainingDue > 0 ? String(remainingDue) : "");
    setTakingPay(false);
    setMoveTarget("");
    setMergeTarget("");
    setCloseReason("");
  }, [selectedTable, remainingDue]);

  const runAction = async (key: string, fn: () => Promise<unknown>, successMsg?: string) => {
    setBusyKey(key);
    try {
      await fn();
      if (successMsg) toast({ title: successMsg, variant: "success" });
      await loadFloor();
      onSyncExternal?.();
      return true;
    } catch (err) {
      toast({
        title: "Couldn't complete action",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const handleSettle = (p: PaymentRecord, accept: boolean) =>
    runAction(
      `${accept ? "ok" : "no"}-${p.id}`,
      () =>
        apiJson(`/api/admin/payments/${p.id}/settle`, {
          method: "POST",
          body: JSON.stringify({ accept, by: actorName }),
        }),
      accept ? "Payment confirmed" : "Marked not received"
    );

  const handleCall = (callId: string, status: "acknowledged" | "completed") =>
    runAction(
      `call-${callId}`,
      () =>
        apiJson(`/api/admin/service-calls/${callId}`, {
          method: "PATCH",
          body: JSON.stringify({ status, by: actorName }),
        }),
      status === "acknowledged" ? `${actorName} is on the way` : "Request completed"
    );

  const tables = floor?.tables || [];
  const seatedCount = tables.filter((t) => t.status === "open" || t.status === "bill").length;
  const billCount = tables.filter((t) => t.status === "bill").length;
  const summaryLine =
    [seatedCount && `${seatedCount} seated`, billCount && `${billCount} waiting to pay`]
      .filter(Boolean)
      .join(" · ") || "All tables are free";

  const freeTargets = tables.filter((t) => !t.seating && t.number !== selectedTable);
  const mergeTargets = tables.filter(
    (t) => t.seating && !t.mergedInto && t.number !== selectedTable
  );

  const renderPaymentRow = (p: PaymentRecord, showTable = false) => (
    <div key={p.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
      <div className="min-w-0">
        <p className="font-semibold text-[#49332A]">
          {showTable ? `Table ${p.table_number} · ` : ""}
          {formatINR(p.amount)} · {MODE_LABEL[p.mode]}
          {p.tip > 0 && <span className="text-xs text-[var(--qm-muted)]"> (+{formatINR(p.tip)} tip)</span>}
        </p>
        {p.payer && <p className="text-xs text-[var(--qm-muted)]">From {p.payer}</p>}
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={!!busyKey}
          onClick={() => handleSettle(p, true)}
          className="h-8 px-3 rounded-lg bg-[#49332A] text-[#FAF8F5] text-xs font-semibold hover:bg-[#38261F]"
        >
          Confirm
        </button>
        <button
          type="button"
          disabled={!!busyKey}
          onClick={() => handleSettle(p, false)}
          className="h-8 px-3 rounded-lg border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50"
        >
          Not received
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-[var(--qm-tint)] text-[#49332A] flex items-center justify-center">
          <LayoutGrid className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-3xl leading-none">Tables</h2>
          <p className="text-sm text-[var(--qm-muted)] mt-1">{floor ? summaryLine : "Loading floor..."}</p>
        </div>
      </div>

      {/* Live Guests Calling Banner */}
      {floor && floor.calls.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/70 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5 mb-2">
            <Bell className="h-3.5 w-3.5" />
            Guests calling
          </p>
          <div className="divide-y divide-amber-200/70">
            {floor.calls.map((c) => (
              <div key={c.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <strong className="font-display text-base mr-2">Table {c.table_number}</strong>
                  <span className="capitalize">{c.call_type}</span>
                  <span className="text-xs text-[var(--qm-muted)]">
                    {" "}
                    · {c.status === "acknowledged" ? `${c.acknowledged_by || "Staff"} on the way` : `${elapsedLabel(c.created_at, nowMs)} ago`}
                  </span>
                </span>
                <div className="flex gap-1.5">
                  {c.status === "pending" && (
                    <button
                      type="button"
                      disabled={!!busyKey}
                      onClick={() => handleCall(c.id, "acknowledged")}
                      className="h-8 px-3 rounded-lg border border-amber-300 bg-white text-xs font-semibold"
                    >
                      On my way
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!!busyKey}
                    onClick={() => handleCall(c.id, "completed")}
                    className="h-8 px-3 rounded-lg bg-[#49332A] text-[#FAF8F5] text-xs font-semibold"
                  >
                    Done
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending Guest Payments Banner */}
      {floor && floor.pendingPayments.length > 0 && (
        <div className="rounded-2xl border border-[#49332A]/35 bg-[#FAF8F5] px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wider text-[#49332A] flex items-center gap-1.5 mb-1">
            <CreditCard className="h-3.5 w-3.5" />
            Payments to confirm
          </p>
          <div className="divide-y divide-[var(--qm-line)]">
            {floor.pendingPayments.map((p) => renderPaymentRow(p, true))}
          </div>
        </div>
      )}

      {/* Tables Floor Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {tables.map((t) => {
          const meta = TILE_META[t.status];
          return (
            <button
              key={t.number}
              type="button"
              onClick={() => setSelectedTable(t.number)}
              aria-label={`Table ${t.number}: ${meta.label}`}
              className={`relative text-left rounded-2xl border p-4 min-h-[118px] flex flex-col justify-between transition-all hover:border-[#49332A] ${meta.tile}`}
            >
              <div className="flex items-start justify-between gap-2 w-full">
                <span className="font-display text-3xl leading-none tabular-nums text-[#49332A]">
                  {t.number}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#49332A]/85">
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                  {meta.label}
                </span>
              </div>

              <div className="mt-3 text-xs text-[var(--qm-muted)] space-y-0.5">
                {t.mergedInto ? (
                  <p>One bill with Table {t.mergedInto}</p>
                ) : t.seating ? (
                  <>
                    <p className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {elapsedLabel(t.seating.opened_at, nowMs)}
                    </p>
                    {t.seating.bill.total > 0 && (
                      <p className="text-sm font-bold text-[#49332A] tabular-nums">
                        {formatINR(t.seating.bill.due)} due
                      </p>
                    )}
                  </>
                ) : null}
              </div>

              {(t.calls > 0 || t.pendingPay > 0) && (
                <span className="absolute -top-2 -right-2 flex gap-1">
                  {t.calls > 0 && (
                    <span className="h-6 min-w-6 px-1.5 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center justify-center gap-0.5 shadow-sm">
                      <Bell className="h-3 w-3" />
                      {t.calls}
                    </span>
                  )}
                  {t.pendingPay > 0 && (
                    <span className="h-6 min-w-6 px-1.5 rounded-full bg-[#49332A] text-[#FAF8F5] text-[11px] font-bold flex items-center justify-center gap-0.5 shadow-sm">
                      <CreditCard className="h-3 w-3" />
                      {t.pendingPay}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-[var(--qm-muted)]">
        Tap a table to seat guests, check live bill, or record payment.
      </p>

      {/* Slide-Over Table Inspector Drawer */}
      {activeRow && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex justify-end">
          <div className="bg-white w-full sm:max-w-md h-full overflow-y-auto shadow-2xl border-l border-[var(--qm-line)] p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5">
                  <h3 className="font-display text-3xl text-[#49332A]">Table {activeRow.number}</h3>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--qm-surface)]">
                    <span className={`h-2 w-2 rounded-full ${TILE_META[activeRow.status].dot}`} />
                    {TILE_META[activeRow.status].label}
                  </span>
                </div>
                <p className="text-xs text-[var(--qm-muted)] mt-1">
                  {activeSeating
                    ? `Seated ${elapsedLabel(activeSeating.opened_at, nowMs)} ago${
                        activeSeating.opened_by ? ` · opened by ${activeSeating.opened_by}` : ""
                      }`
                    : activeRow.status === "cleaning"
                      ? "Bill closed. Clean before seating next guests."
                      : "No guests seated right now."}
                  {activeRow.mergedInto && ` · shares bill of Table ${activeRow.mergedInto}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTable(null)}
                aria-label="Close drawer"
                className="h-8 w-8 rounded-full hover:bg-[var(--qm-surface)] flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!activeSeating &&
              (activeRow.status === "cleaning" ? (
                <button
                  type="button"
                  disabled={!!busyKey}
                  onClick={() =>
                    runAction(
                      "clean",
                      () =>
                        apiJson(`/api/admin/floor/${activeRow.number}/clean`, {
                          method: "POST",
                          body: JSON.stringify({ by: actorName }),
                        }),
                      `Table ${activeRow.number} is ready`
                    )
                  }
                  className="w-full h-11 rounded-2xl bg-[#49332A] hover:bg-[#38261F] text-[#FAF8F5] text-sm font-semibold inline-flex items-center justify-center gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  Mark cleaned
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!!busyKey}
                  onClick={() =>
                    runAction(
                      "open",
                      () =>
                        apiJson(`/api/admin/floor/${activeRow.number}/open`, {
                          method: "POST",
                          body: JSON.stringify({ by: actorName }),
                        }),
                      `Table ${activeRow.number} opened`
                    )
                  }
                  className="w-full h-11 rounded-2xl bg-[#49332A] hover:bg-[#38261F] text-[#FAF8F5] text-sm font-semibold"
                >
                  Seat guests
                </button>
              ))}

            {activeSeating && activeBill && (
              <>
                {/* Optional Table PIN Box */}
                <div className="rounded-2xl bg-[var(--qm-bg)] border border-[var(--qm-line)] px-4 py-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <KeyRound className="h-4 w-4 text-[#49332A]" />
                    <span>
                      Table PIN:{" "}
                      <strong className="font-mono text-sm text-[#49332A]">
                        {activeSeating.table_pin || "Not set"}
                      </strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={!!busyKey}
                    onClick={() =>
                      runAction(
                        "pin",
                        () =>
                          apiJson(`/api/admin/floor/${activeRow.number}/pin`, {
                            method: "POST",
                            body: JSON.stringify({ by: actorName }),
                          }),
                        "New 4-digit table PIN generated"
                      )
                    }
                    className="text-xs font-semibold text-[#49332A] hover:underline"
                  >
                    {activeSeating.table_pin ? "Reset PIN" : "Generate PIN"}
                  </button>
                </div>

                {/* Bill Balance */}
                {activeBill.total === 0 ? (
                  <p className="rounded-2xl border border-dashed border-[var(--qm-line)] p-4 text-sm text-[var(--qm-muted)]">
                    Nothing ordered yet. Guests order directly from their phone.
                  </p>
                ) : (
                  <div className="rounded-2xl border border-[var(--qm-line)] bg-[var(--qm-bg)] p-4 flex items-baseline justify-between">
                    <span className="text-sm text-[var(--qm-muted)]">
                      {activeBill.due > 0 ? "Due balance" : "Paid in full"}
                    </span>
                    <span className="font-display text-3xl text-[#49332A] tabular-nums">
                      {formatINR(activeBill.due > 0 ? activeBill.due : activeBill.total)}
                    </span>
                  </div>
                )}

                {/* Pending Customer Payments */}
                {activeSeating.payments.filter((p) => p.status === "pending").length > 0 && (
                  <div className="rounded-2xl border border-[#49332A]/30 bg-[#FAF8F5] p-3.5">
                    <p className="text-xs font-bold uppercase tracking-wider text-[#49332A] mb-1">
                      Confirm these payments
                    </p>
                    <div className="divide-y divide-[var(--qm-line)]">
                      {activeSeating.payments
                        .filter((p) => p.status === "pending")
                        .map((p) => renderPaymentRow(p, false))}
                    </div>
                  </div>
                )}

                {/* Take Counter Payment */}
                {remainingDue > 0 &&
                  (takingPay ? (
                    <div className="rounded-2xl border border-[var(--qm-line)] p-4 space-y-3 bg-[var(--qm-bg)]">
                      {activeBill.pending > 0 && (
                        <p className="text-xs text-[var(--qm-muted)]">
                          {formatINR(activeBill.pending)} is pending confirmation above; this covers remaining {formatINR(remainingDue)}.
                        </p>
                      )}
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--qm-muted)] text-sm">
                            ₹
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                            aria-label="Payment amount"
                            className="w-full h-10 pl-7 pr-3 rounded-xl border border-[var(--qm-line)] bg-white text-sm tabular-nums"
                          />
                        </div>
                        <div className="flex rounded-xl border border-[var(--qm-line)] bg-white overflow-hidden">
                          {(["cash", "upi", "card"] as PaymentMode[]).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setPayMode(m)}
                              className={`px-3 text-xs font-semibold ${
                                payMode === m
                                  ? "bg-[#49332A] text-[#FAF8F5]"
                                  : "text-[var(--qm-muted)] hover:bg-[var(--qm-surface)]"
                              }`}
                            >
                              {MODE_LABEL[m]}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!!busyKey || !(Number(payAmount) > 0)}
                        onClick={() =>
                          runAction(
                            "take-pay",
                            () =>
                              apiJson(`/api/admin/floor/${activeSeating.table_number}/payment`, {
                                method: "POST",
                                body: JSON.stringify({
                                  amount: Number(payAmount),
                                  mode: payMode,
                                  by: actorName,
                                }),
                              }),
                            `${formatINR(Number(payAmount))} recorded`
                          )
                        }
                        className="w-full h-10 rounded-xl bg-[#49332A] text-[#FAF8F5] text-sm font-semibold"
                      >
                        Record {formatINR(Number(payAmount) || 0)} {MODE_LABEL[payMode]}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setTakingPay(true)}
                      className="w-full h-11 rounded-2xl bg-[#49332A] hover:bg-[#38261F] text-[#FAF8F5] text-sm font-semibold"
                    >
                      Take payment
                    </button>
                  ))}

                {/* Close Bill Button */}
                {activeBill.due === 0 && (
                  <button
                    type="button"
                    disabled={!!busyKey}
                    onClick={async () => {
                      const ok = await runAction(
                        "close",
                        () =>
                          apiJson(`/api/admin/floor/${activeSeating.table_number}/close`, {
                            method: "POST",
                            body: JSON.stringify({ by: actorName }),
                          }),
                        `Table ${activeRow.number} bill closed`
                      );
                      if (ok) setSelectedTable(null);
                    }}
                    className="w-full h-11 rounded-2xl border border-[#49332A] bg-white hover:bg-[#FAF8F5] text-[#49332A] text-sm font-semibold inline-flex items-center justify-center gap-2"
                  >
                    <Check className="h-4 w-4" />
                    {activeBill.total === 0 ? "Free this table" : "Close bill & free table"}
                  </button>
                )}

                {/* Bill Breakdown */}
                <details open className="group rounded-2xl border border-[var(--qm-line)]">
                  <summary className="flex cursor-pointer items-center justify-between p-4 text-sm font-semibold">
                    <span>Bill details</span>
                    <ChevronDown className="h-4 w-4 text-[var(--qm-muted)] group-open:rotate-180 transition-transform" />
                  </summary>
                  <div className="border-t border-[var(--qm-line)] divide-y divide-[var(--qm-line)] text-sm">
                    {activeSeating.orders.some((o) => !["cancelled", "rejected"].includes(o.status)) && (
                      <div className="p-4 space-y-2">
                        {activeSeating.orders
                          .filter((o) => !["cancelled", "rejected"].includes(o.status))
                          .flatMap((o) => o.items)
                          .map((item, i) => (
                            <div key={`${item.id}-${i}`} className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 min-w-0">
                                <img
                                  src={resolveDishImage(item.image_url)}
                                  onError={handleDishImageError}
                                  alt=""
                                  className="h-7 w-7 rounded-lg object-cover border border-[var(--qm-line)] flex-shrink-0"
                                />
                                <span className="truncate text-xs">
                                  <strong>{item.quantity}×</strong> {item.name}
                                </span>
                              </span>
                              <span className="tabular-nums text-xs font-medium">
                                {formatINR(item.price * item.quantity)}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}

                    <div className="p-4 space-y-1 text-xs text-[var(--qm-muted)]">
                      <div className="flex justify-between">
                        <span>Subtotal</span>
                        <span className="tabular-nums">{formatINR(activeBill.subtotal)}</span>
                      </div>
                      {activeBill.discount > 0 && (
                        <div className="flex justify-between text-emerald-700 font-medium">
                          <span>Discount {activeSeating.discount?.label ? `(${activeSeating.discount.label})` : ""}</span>
                          <span className="tabular-nums">−{formatINR(activeBill.discount)}</span>
                        </div>
                      )}
                      {activeBill.service > 0 && (
                        <div className="flex justify-between">
                          <span>Service charge ({activeBill.service_pct}%)</span>
                          <span className="tabular-nums">{formatINR(activeBill.service)}</span>
                        </div>
                      )}
                      {activeBill.gst > 0 && (
                        <div className="flex justify-between">
                          <span>GST ({activeBill.gst_rate}%)</span>
                          <span className="tabular-nums">{formatINR(activeBill.gst)}</span>
                        </div>
                      )}
                      <div className="flex justify-between pt-1.5 text-sm font-bold text-[#49332A]">
                        <span>Total</span>
                        <span className="tabular-nums">{formatINR(activeBill.total)}</span>
                      </div>
                      {activeBill.paid > 0 && (
                        <div className="flex justify-between text-emerald-700 font-semibold">
                          <span>Paid</span>
                          <span className="tabular-nums">−{formatINR(activeBill.paid)}</span>
                        </div>
                      )}
                    </div>

                    {activeSeating.guest_phone && (
                      <div className="p-4 flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5">
                          <Gift className="h-4 w-4 text-[#49332A]" />
                          Loyalty · ******{activeSeating.guest_phone.slice(-4)} ·{" "}
                          <strong className="tabular-nums">{activeSeating.loyalty_points} pts</strong>
                        </span>
                        {floor &&
                          activeSeating.loyalty_points >= (floor.config.loyalty.goal || 200) && (
                            <button
                              type="button"
                              disabled={!!busyKey}
                              onClick={() =>
                                runAction(
                                  "redeem",
                                  () =>
                                    apiJson("/api/admin/loyalty/redeem", {
                                      method: "POST",
                                      body: JSON.stringify({
                                        phone: activeSeating.guest_phone,
                                        tableNumber: activeRow.number,
                                        by: actorName,
                                      }),
                                    }),
                                  "Loyalty reward redeemed"
                                )
                              }
                              className="h-7 px-3 rounded-lg bg-[#49332A] text-[#FAF8F5] font-semibold"
                            >
                              Give reward
                            </button>
                          )}
                      </div>
                    )}
                  </div>
                </details>

                {/* More: Transfer / Merge / Force Close */}
                <details className="group rounded-2xl border border-[var(--qm-line)]">
                  <summary className="flex cursor-pointer items-center justify-between p-4 text-sm font-semibold">
                    <span>Move table, merge bill &amp; close options</span>
                    <ChevronDown className="h-4 w-4 text-[var(--qm-muted)] group-open:rotate-180 transition-transform" />
                  </summary>
                  <div className="border-t border-[var(--qm-line)] p-4 space-y-3">
                    <div className="flex gap-2">
                      <select
                        value={moveTarget}
                        onChange={(e) => setMoveTarget(e.target.value)}
                        className="flex-1 h-9 px-3 rounded-xl border border-[var(--qm-line)] bg-white text-xs"
                      >
                        <option value="">Move guests to…</option>
                        {freeTargets.map((t) => (
                          <option key={t.number} value={t.number}>
                            Table {t.number}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!moveTarget || !!busyKey}
                        onClick={async () => {
                          const ok = await runAction(
                            "move",
                            () =>
                              apiJson(`/api/admin/floor/${activeRow.number}/transfer`, {
                                method: "POST",
                                body: JSON.stringify({ toTable: moveTarget, by: actorName }),
                              }),
                            `Moved to Table ${moveTarget}`
                          );
                          if (ok) setSelectedTable(null);
                        }}
                        className="h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs font-semibold hover:border-[#49332A]"
                      >
                        Move
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <select
                        value={mergeTarget}
                        onChange={(e) => setMergeTarget(e.target.value)}
                        className="flex-1 h-9 px-3 rounded-xl border border-[var(--qm-line)] bg-white text-xs"
                      >
                        <option value="">Join bill with…</option>
                        {mergeTargets.map((t) => (
                          <option key={t.number} value={t.number}>
                            Table {t.number}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!mergeTarget || !!busyKey}
                        onClick={() =>
                          runAction(
                            "merge",
                            () =>
                              apiJson(`/api/admin/floor/${activeRow.number}/merge`, {
                                method: "POST",
                                body: JSON.stringify({ intoTable: mergeTarget, by: actorName }),
                              }),
                            `Merged with Table ${mergeTarget}`
                          )
                        }
                        className="h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs font-semibold hover:border-[#49332A]"
                      >
                        Join
                      </button>
                    </div>

                    {activeBill.due > 0 && (
                      <div className="pt-2 border-t border-[var(--qm-line)] space-y-2">
                        <label className="block text-[11px] text-[var(--qm-muted)]">
                          Close with {formatINR(activeBill.due)} still due (reason logged)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={closeReason}
                            onChange={(e) => setCloseReason(e.target.value.slice(0, 120))}
                            placeholder="e.g. Paid at reception"
                            className="flex-1 h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs"
                          />
                          <button
                            type="button"
                            disabled={!closeReason.trim() || !!busyKey}
                            onClick={async () => {
                              const ok = await runAction(
                                "force-close",
                                () =>
                                  apiJson(`/api/admin/floor/${activeSeating.table_number}/close`, {
                                    method: "POST",
                                    body: JSON.stringify({
                                      note: closeReason.trim(),
                                      by: actorName,
                                    }),
                                  }),
                                "Bill closed with note"
                              );
                              if (ok) setSelectedTable(null);
                            }}
                            className="h-9 px-3 rounded-xl bg-red-600 text-white text-xs font-semibold"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
