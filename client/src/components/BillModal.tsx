import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Banknote, Check, CreditCard, Minus, Plus, Smartphone, Star, Tag, X } from "lucide-react";
import { useToast } from "./Toast";
import { apiJson, formatINR, getStoredPinToken } from "../lib/api";
import { computeTipAmount, getRemainingDue, splitByItemsAmount, splitEqualAmount } from "../lib/billMath";
import type { PaymentMode, SeatingView, SplitType } from "../types";

interface BillModalProps {
  tableNumber: string;
  restaurantSlug?: string;
  seating: SeatingView;
  restaurantName: string;
  upiId: string;
  whiteLabel?: boolean;
  brandAccent?: string;
  onSeatingUpdated: (seating: SeatingView) => void;
  onRateOrder: () => void;
  onClose: () => void;
}

const TIP_OPTIONS: Array<0 | 5 | 10 | 15 | "custom"> = [0, 5, 10, 15, "custom"];

export function BillModal({
  tableNumber,
  restaurantSlug,
  seating,
  restaurantName,
  upiId,
  whiteLabel,
  brandAccent,
  onSeatingUpdated,
  onRateOrder,
  onClose,
}: BillModalProps) {
  const { toast } = useToast();
  const bill = seating.bill;
  const remaining = getRemainingDue(bill);
  const settled = seating.status === "closed" || (bill.total > 0 && bill.due === 0);

  const paidEqualCount = seating.payments.filter(
    (p) => p.split_type === "equal" && p.status !== "rejected"
  ).length;

  const [splitMode, setSplitMode] = useState<SplitType>(paidEqualCount > 0 ? "equal" : "full");
  const [splitPeople, setSplitPeople] = useState(() => Math.max(2, paidEqualCount + 1));
  const [pickedItems, setPickedItems] = useState<Record<string, number>>({});
  const [customAmount, setCustomAmount] = useState("");
  const [tipChoice, setTipChoice] = useState<0 | 5 | 10 | 15 | "custom">(0);
  const [customTip, setCustomTip] = useState("");
  const [payer, setPayer] = useState(() => {
    try {
      return (
        localStorage.getItem("brotocol_payer_name") ||
        localStorage.getItem("qserve_payer_name") ||
        ""
      );
    } catch {
      return "";
    }
  });
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [upiQrUrl, setUpiQrUrl] = useState("");
  const [showUpiQr, setShowUpiQr] = useState(false);

  const lineEntries = useMemo(() => {
    const activeOrders = seating.orders.filter(
      (o) => !["cancelled", "rejected"].includes(o.status)
    );
    return activeOrders.flatMap((o) =>
      o.items.map((it, idx) => ({
        key: `${o.id}:${idx}`,
        name: it.name,
        price: it.price,
        quantity: it.quantity || 1,
      }))
    );
  }, [seating.orders]);

  const payAmount = useMemo(() => {
    if (splitMode === "full") return remaining;
    if (splitMode === "equal") return splitEqualAmount(bill, splitPeople, paidEqualCount);
    if (splitMode === "items") {
      const picked = lineEntries
        .filter((l) => (pickedItems[l.key] || 0) > 0)
        .map((l) => ({ price: l.price, quantity: pickedItems[l.key] }));
      return splitByItemsAmount(bill, picked);
    }
    const clean = Math.round(Number(customAmount.replace(/[^0-9.]/g, "")) * 100) / 100 || 0;
    return Math.min(Math.max(0, clean), remaining);
  }, [splitMode, remaining, bill, splitPeople, paidEqualCount, lineEntries, pickedItems, customAmount]);

  const tipAmount = computeTipAmount(payAmount, tipChoice, customTip);
  const finalPay = Math.round((payAmount + tipAmount) * 100) / 100;

  const upiLink =
    upiId && finalPay > 0
      ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
          restaurantName
        )}&am=${finalPay.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Table ${tableNumber}`)}`
      : "";

  useEffect(() => {
    if (!upiLink || !showUpiQr) {
      setUpiQrUrl("");
      return;
    }
    QRCode.toDataURL(upiLink, {
      width: 220,
      margin: 2,
      color: { dark: brandAccent || "#49332A", light: "#FFFFFF" },
    })
      .then(setUpiQrUrl)
      .catch(() => {});
  }, [upiLink, showUpiQr, brandAccent]);

  const applyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponCode.trim()) return;
    setBusy("coupon");
    try {
      const pinToken = getStoredPinToken(restaurantSlug || "", tableNumber);
      const res = await apiJson<{ seating: SeatingView }>("/api/public/seating/coupon", {
        method: "POST",
        headers: pinToken ? { "X-Table-Pin-Token": pinToken } : undefined,
        body: JSON.stringify({
          tableNumber,
          code: couponCode.trim(),
          ...(restaurantSlug ? { restaurant: restaurantSlug } : {}),
        }),
      });
      onSeatingUpdated(res.seating);
      setCouponCode("");
      setCouponOpen(false);
      toast({ title: "Discount applied!", variant: "success" });
    } catch (err) {
      toast({
        title: "Code not applied",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const requestPayment = async (mode: PaymentMode) => {
    if (payAmount <= 0) return;
    setBusy(mode);
    try {
      try {
        localStorage.setItem("brotocol_payer_name", payer.trim());
      } catch {}
      const pinToken = getStoredPinToken(restaurantSlug || "", tableNumber);
      const res = await apiJson<{ seating: SeatingView }>("/api/public/seating/payment", {
        method: "POST",
        headers: pinToken ? { "X-Table-Pin-Token": pinToken } : undefined,
        body: JSON.stringify({
          tableNumber,
          amount: payAmount,
          tip: tipAmount,
          mode,
          payer: payer.trim(),
          split: splitMode,
          ...(restaurantSlug ? { restaurant: restaurantSlug } : {}),
        }),
      });
      onSeatingUpdated(res.seating);
      setShowUpiQr(false);
      toast({
        title:
          mode === "upi"
            ? "UPI payment sent for cashier confirmation"
            : mode === "cash"
              ? "Staff are coming for cash"
              : "Card machine is on the way",
        description: `${formatINR(finalPay)} · Table ${tableNumber}`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Could not record payment",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[3px] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-[var(--qm-card)] w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-[var(--qm-line)] shadow-2xl max-h-[92dvh] flex flex-col overflow-hidden">
        {/* Branded Receipt Header */}
        <div
          style={{
            backgroundColor: "var(--qm-accent)",
            color: "var(--qm-accent-ink)",
          }}
          className="px-6 py-4 flex items-center justify-between"
        >
          <div>
            <p className="text-[11px] uppercase tracking-wider opacity-80 font-semibold">
              {restaurantName}
            </p>
            <div className="flex items-center gap-2.5">
              <h2 className="font-display text-2xl">Table {tableNumber} Bill</h2>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/15">
                {settled
                  ? "Paid in full"
                  : bill.pending > 0
                    ? "Confirming payment"
                    : bill.paid > 0
                      ? "Part paid"
                      : "Open"}
              </span>
            </div>
            {seating.bill_table !== tableNumber && (
              <p className="text-xs opacity-80">Merged with Table {seating.bill_table}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bill"
            className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Bill Summary Receipt */}
          <div className="rounded-2xl bg-[var(--qm-bg)] border border-[var(--qm-line)] p-4 space-y-1.5 text-sm">
            {lineEntries.map((l) => (
              <div key={l.key} className="flex justify-between gap-2 text-xs">
                <span className="truncate text-[var(--qm-accent)]">
                  <strong>{l.quantity}×</strong> {l.name}
                </span>
                <span className="tabular-nums text-[var(--qm-muted)]">
                  {formatINR(l.price * l.quantity)}
                </span>
              </div>
            ))}

            <div className="pt-2.5 mt-2 border-t border-dashed border-[var(--qm-line)] space-y-1 text-xs text-[var(--qm-muted)]">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatINR(bill.subtotal)}</span>
              </div>
              {bill.discount > 0 && (
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>Discount {seating.discount?.label ? `· ${seating.discount.label}` : ""}</span>
                  <span className="tabular-nums">−{formatINR(bill.discount)}</span>
                </div>
              )}
              {bill.service > 0 && (
                <div className="flex justify-between">
                  <span>Service charge ({bill.service_pct}%)</span>
                  <span className="tabular-nums">{formatINR(bill.service)}</span>
                </div>
              )}
              {bill.gst > 0 && (
                <div className="flex justify-between">
                  <span>GST ({bill.gst_rate}%)</span>
                  <span className="tabular-nums">{formatINR(bill.gst)}</span>
                </div>
              )}
              <div className="flex justify-between pt-1.5 text-base font-bold text-[var(--qm-accent)]">
                <span>Total</span>
                <span className="tabular-nums font-display text-xl">{formatINR(bill.total)}</span>
              </div>
              {bill.paid > 0 && (
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>Paid</span>
                  <span className="tabular-nums">−{formatINR(bill.paid)}</span>
                </div>
              )}
              {bill.paid > 0 && !settled && (
                <div className="flex justify-between font-bold text-[var(--qm-accent)]">
                  <span>Left to pay</span>
                  <span className="tabular-nums">{formatINR(bill.due)}</span>
                </div>
              )}
            </div>
            <p className="pt-2 border-t border-[var(--qm-line)]/60 text-[10px] text-center text-[var(--qm-muted)]">
              {whiteLabel
                ? `Official receipt · ${restaurantName}`
                : `${restaurantName} · Powered by BROTOCOL ServeOS`}
            </p>
          </div>

          {/* Discount Coupon Input */}
          {!seating.discount && bill.paid === 0 && bill.pending === 0 && !settled && (
            <div>
              {couponOpen ? (
                <form onSubmit={applyCoupon} className="flex gap-2">
                  <input
                    type="text"
                    autoFocus
                    value={couponCode}
                    onChange={(e) =>
                      setCouponCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))
                    }
                    placeholder="Enter code (e.g. FLAT10)"
                    className="flex-1 h-10 px-3.5 rounded-xl border border-[var(--qm-line)] bg-[var(--qm-bg)] text-sm uppercase font-mono"
                  />
                  <button
                    type="submit"
                    disabled={couponCode.length < 3 || busy === "coupon"}
                    style={{
                      backgroundColor: "var(--qm-accent)",
                      color: "var(--qm-accent-ink)",
                    }}
                    className="h-10 px-4 rounded-xl text-xs font-semibold disabled:opacity-40"
                  >
                    {busy === "coupon" ? "Applying..." : "Apply"}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setCouponOpen(true)}
                  className="text-xs font-semibold text-[var(--qm-accent)] inline-flex items-center gap-1.5 hover:underline"
                >
                  <Tag className="h-3.5 w-3.5" />
                  Have a discount code?
                </button>
              )}
            </div>
          )}

          {/* Recorded / Pending Payments List */}
          {seating.payments.length > 0 && (
            <div className="space-y-1.5 text-xs">
              <p className="font-bold uppercase tracking-wider text-[var(--qm-muted)] text-[10px]">
                Payments
              </p>
              {seating.payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl border border-[var(--qm-line)] px-3 py-2 bg-white"
                >
                  <span>
                    <strong>{p.payer || "Guest"}</strong> · {p.mode.toUpperCase()}{" "}
                    <span className="text-[var(--qm-muted)]">({p.status})</span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatINR(p.amount + p.tip)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Settled Thank You + Rate Meal */}
          {settled ? (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-center space-y-3">
              <p className="font-display text-xl text-emerald-950">Thank you for dining with us!</p>
              <p className="text-xs text-emerald-800">
                Your bill is settled in full. We hope you enjoyed every dish.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRateOrder();
                }}
                style={{
                  backgroundColor: "var(--qm-accent)",
                  color: "var(--qm-accent-ink)",
                }}
                className="h-10 px-5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Star className="h-3.5 w-3.5 fill-current" />
                Rate your meal
              </button>
            </div>
          ) : remaining <= 0 ? (
            <p className="text-sm text-center text-[var(--qm-muted)] py-2">
              {formatINR(bill.pending)} is being confirmed by the cashier. This updates automatically.
            </p>
          ) : (
            /* Split & Payment Section */
            <div className="space-y-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--qm-muted)] mb-2">
                  How would you like to pay?
                </p>
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                  {(
                    [
                      { id: "full", label: bill.paid + bill.pending > 0 ? "What's left" : "Whole bill" },
                      { id: "equal", label: "Split equally" },
                      { id: "items", label: "My items" },
                      { id: "custom", label: "Amount" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSplitMode(opt.id)}
                      style={
                        splitMode === opt.id
                          ? { backgroundColor: "var(--qm-accent)", color: "var(--qm-accent-ink)" }
                          : undefined
                      }
                      className={`h-9 px-3.5 rounded-full text-xs font-semibold flex-shrink-0 transition-colors ${
                        splitMode === opt.id
                          ? ""
                          : "bg-[var(--qm-tint)] text-[var(--qm-accent)]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {splitMode === "equal" && (
                <div className="flex items-center justify-between rounded-2xl border border-[var(--qm-line)] p-3 bg-[var(--qm-bg)]">
                  <div>
                    <p className="text-xs font-semibold text-[var(--qm-accent)]">People at the table</p>
                    <p className="text-[11px] text-[var(--qm-muted)]">
                      {formatINR(bill.total)} ÷ {splitPeople}
                      {paidEqualCount > 0 ? ` · ${paidEqualCount} paid` : ""}
                    </p>
                  </div>
                  <div className="inline-flex items-center h-9 rounded-full border border-[var(--qm-line)] bg-white">
                    <button
                      type="button"
                      onClick={() => setSplitPeople((p) => Math.max(Math.max(2, paidEqualCount + 1), p - 1))}
                      className="px-2.5 text-[var(--qm-accent)]"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="px-2 text-sm font-bold tabular-nums">{splitPeople}</span>
                    <button
                      type="button"
                      onClick={() => setSplitPeople((p) => Math.min(20, p + 1))}
                      className="px-2.5 text-[var(--qm-accent)]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {splitMode === "items" && (
                <div className="rounded-2xl border border-[var(--qm-line)] divide-y divide-[var(--qm-line)] bg-white">
                  {lineEntries.map((l) => {
                    const count = pickedItems[l.key] || 0;
                    return (
                      <div key={l.key} className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
                        <div>
                          <p className="font-semibold text-[var(--qm-accent)]">{l.name}</p>
                          <p className="text-[var(--qm-muted)]">
                            {formatINR(l.price)}
                            {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setPickedItems((prev) => ({
                              ...prev,
                              [l.key]: prev[l.key] ? 0 : l.quantity,
                            }))
                          }
                          style={
                            count > 0
                              ? {
                                  backgroundColor: "var(--qm-accent)",
                                  color: "var(--qm-accent-ink)",
                                  borderColor: "var(--qm-accent)",
                                }
                              : undefined
                          }
                          className={`h-7 px-3 rounded-full border font-semibold inline-flex items-center gap-1 ${
                            count > 0 ? "" : "border-[var(--qm-line)] text-[var(--qm-accent)]"
                          }`}
                        >
                          {count > 0 && <Check className="h-3 w-3" />}
                          {count > 0 ? "Selected" : "Select"}
                        </button>
                      </div>
                    );
                  })}
                  <p className="px-3.5 py-2 text-[11px] text-[var(--qm-muted)]">
                    Tax and service charge are split proportionally.
                  </p>
                </div>
              )}

              {splitMode === "custom" && (
                <div>
                  <label className="block text-xs font-semibold mb-1">Amount you&apos;re paying</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--qm-muted)]">₹</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder={String(Math.floor(remaining))}
                      className="w-full h-11 pl-8 pr-3 rounded-xl border border-[var(--qm-line)] bg-[var(--qm-bg)] text-base font-semibold tabular-nums"
                    />
                  </div>
                </div>
              )}

              {/* Tip Selector */}
              <div>
                <p className="text-xs font-semibold mb-2">Tip for the team</p>
                <div className="flex gap-1.5 flex-wrap">
                  {TIP_OPTIONS.map((t) => (
                    <button
                      key={String(t)}
                      type="button"
                      onClick={() => setTipChoice(t)}
                      style={
                        tipChoice === t
                          ? {
                              backgroundColor: "var(--qm-accent)",
                              color: "var(--qm-accent-ink)",
                              borderColor: "var(--qm-accent)",
                            }
                          : undefined
                      }
                      className={`h-8 px-3 rounded-full text-xs font-semibold border transition-colors ${
                        tipChoice === t
                          ? ""
                          : "border-[var(--qm-line)] bg-white text-[var(--qm-accent)]"
                      }`}
                    >
                      {t === 0 ? "No tip" : t === "custom" ? "Other" : `${t}%`}
                    </button>
                  ))}
                </div>
                {tipChoice === "custom" && (
                  <input
                    type="text"
                    inputMode="numeric"
                    value={customTip}
                    onChange={(e) => setCustomTip(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    placeholder="Enter tip in ₹"
                    className="mt-2 w-full h-9 px-3 rounded-xl border border-[var(--qm-line)] bg-[var(--qm-bg)] text-sm"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">
                  Your name <span className="font-normal text-[var(--qm-muted)]">(optional)</span>
                </label>
                <input
                  type="text"
                  maxLength={40}
                  value={payer}
                  onChange={(e) => setPayer(e.target.value)}
                  placeholder="So staff know who paid"
                  className="w-full h-9 px-3 rounded-xl border border-[var(--qm-line)] bg-[var(--qm-bg)] text-sm"
                />
              </div>

              {/* Scannable UPI QR Drawer if toggled */}
              {showUpiQr && upiLink && (
                <div className="rounded-2xl border border-[var(--qm-accent)]/30 bg-[var(--qm-bg)] p-4 text-center space-y-2.5">
                  <p className="text-xs font-semibold text-[var(--qm-accent)]">
                    Scan with any UPI app or tap below · {formatINR(finalPay)}
                  </p>
                  {upiQrUrl && (
                    <img
                      src={upiQrUrl}
                      alt="UPI Payment QR"
                      className="h-40 w-40 mx-auto rounded-xl border border-[var(--qm-line)]"
                    />
                  )}
                  <div className="flex gap-2">
                    <a
                      href={upiLink}
                      className="flex-1 h-9 rounded-xl border border-[var(--qm-accent)] text-[var(--qm-accent)] text-xs font-semibold inline-flex items-center justify-center"
                    >
                      Open UPI App
                    </a>
                    <button
                      type="button"
                      disabled={busy === "upi"}
                      onClick={() => requestPayment("upi")}
                      style={{
                        backgroundColor: "var(--qm-accent)",
                        color: "var(--qm-accent-ink)",
                      }}
                      className="flex-1 h-9 rounded-xl text-xs font-semibold"
                    >
                      {busy === "upi" ? "Sending..." : "I've Paid · Notify Staff"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Payment CTA Footer */}
        {!settled && remaining > 0 && payAmount > 0 && (
          <div className="p-4 border-t border-[var(--qm-line)] bg-[var(--qm-bg)] space-y-2">
            {upiId && !showUpiQr && (
              <button
                type="button"
                onClick={() => setShowUpiQr(true)}
                style={{
                  backgroundColor: "var(--qm-accent)",
                  color: "var(--qm-accent-ink)",
                }}
                className="w-full h-11 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 shadow-md hover:opacity-95 transition-opacity"
              >
                <Smartphone className="h-4 w-4" />
                Pay {formatINR(finalPay)} with UPI
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => requestPayment("cash")}
                className="h-10 rounded-xl border border-[var(--qm-line)] bg-white hover:border-[var(--qm-accent)] text-xs font-semibold inline-flex items-center justify-center gap-1.5 text-[var(--qm-accent)]"
              >
                <Banknote className="h-3.5 w-3.5" />
                Cash at table
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => requestPayment("card")}
                className="h-10 rounded-xl border border-[var(--qm-line)] bg-white hover:border-[var(--qm-accent)] text-xs font-semibold inline-flex items-center justify-center gap-1.5 text-[var(--qm-accent)]"
              >
                <CreditCard className="h-3.5 w-3.5" />
                Card machine
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
