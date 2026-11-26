import type { BillSummary } from "../types";
export {
  calculateBill,
  calculateDeliveryFee,
  calculateDiscountPaise,
  calculateItemPricing,
  calculateOrderTotals,
} from "../../../shared/billMath.js";

const toPaise = (v: number) => Math.round(Number(v || 0) * 100);
const roundInt = (v: number) => Math.round(v + 1e-9);

export function getRemainingDue(bill: BillSummary): number {
  return Math.max(0, toPaise(bill.due) - toPaise(bill.pending)) / 100;
}

export function splitEqualAmount(bill: BillSummary, people: number, alreadySplitPaid: number): number {
  const n = Math.max(2, Math.floor(people));
  const totalP = toPaise(bill.total);
  const perP = Math.floor(totalP / n / 100) * 100;
  const remCents = (totalP - perP * n) % 100;
  let extraRupees = (totalP - perP * n - remCents) / 100;
  const shares: number[] = [];
  for (let i = 0; i < n; i++) {
    const bonus = extraRupees > 0 ? 100 : 0;
    if (bonus) extraRupees -= 1;
    shares.push((perP + bonus + (i === 0 ? remCents : 0)) / 100);
  }
  const idx = Math.min(alreadySplitPaid, shares.length - 1);
  return Math.min(shares[idx] || 0, getRemainingDue(bill));
}

export function splitByItemsAmount(
  bill: BillSummary,
  selectedLines: Array<{ price: number; quantity: number }>
): number {
  const subP = toPaise(bill.subtotal);
  if (subP <= 0) return 0;
  const pickedP = selectedLines.reduce((s, l) => s + toPaise(l.price) * l.quantity, 0);
  const ratioAmt = roundInt((pickedP * toPaise(bill.total)) / subP / 100);
  return Math.min(ratioAmt, getRemainingDue(bill));
}

export function computeTipAmount(payAmount: number, tipPct: number | "custom", customStr: string): number {
  if (tipPct === "custom") {
    const num = Math.round(Number(customStr.replace(/\D/g, "")) || 0);
    return Math.min(Math.max(0, num), Math.max(0, payAmount));
  }
  return roundInt((toPaise(payAmount) * tipPct) / 10000);
}

export function elapsedLabel(iso: string, nowMs = Date.now()): string {
  const mins = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

export function compactINR(amount: number): string {
  if (amount >= 100000) {
    const l = amount / 100000;
    return `₹${amount >= 1000000 ? l.toFixed(0) : l.toFixed(1)}L`;
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: Math.round(amount * 100) % 100 ? 2 : 0,
  }).format(Number(amount || 0));
}
