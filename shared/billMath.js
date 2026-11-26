// Shared authoritative bill, order, line-item, and fee calculation module (pure ESM).
// Used by both the backend (authoritative validation/computation) and frontend (live previews/splits).

const toPaise = (val) => Math.round(Number(val || 0) * 100);
const fromPaise = (paise) => Math.round(Number(paise || 0)) / 100;
const roundInt = (val) => Math.round(Number(val || 0) + 1e-9);

export function calculateItemPricing({
  basePrice = 0,
  addons = [],
  quantity = 1,
  discountAmount = 0,
  taxRate = 0,
} = {}) {
  const qty = Math.max(1, Math.floor(Number(quantity || 1)));
  const basePaise = Math.max(0, toPaise(basePrice));
  const addonsPaise = Array.isArray(addons)
    ? addons.reduce((sum, a) => sum + Math.max(0, toPaise(a?.price || 0)), 0)
    : 0;
  const unitPaise = basePaise + addonsPaise;
  const subtotalPaise = unitPaise * qty;
  const discountPaise = Math.min(subtotalPaise, Math.max(0, toPaise(discountAmount)));
  const taxablePaise = Math.max(0, subtotalPaise - discountPaise);
  const taxPaise = taxRate > 0 ? roundInt((taxablePaise * Number(taxRate)) / 100) : 0;

  return {
    base_unit_price: fromPaise(basePaise),
    addons_unit_total: fromPaise(addonsPaise),
    unit_price: fromPaise(unitPaise),
    quantity: qty,
    subtotal: fromPaise(subtotalPaise),
    discount_amount: fromPaise(discountPaise),
    tax_rate: Math.max(0, Number(taxRate || 0)),
    tax_amount: fromPaise(taxPaise),
    line_total: fromPaise(taxablePaise),
  };
}

export function calculateDeliveryFee(
  subtotalAmount,
  { orderType = "dine_in", deliveryFee = 0, freeDeliveryMin = 0 } = {}
) {
  if (orderType !== "delivery") return 0;
  const subPaise = Math.max(0, toPaise(subtotalAmount));
  const freeMinPaise = Math.max(0, toPaise(freeDeliveryMin));
  if (freeMinPaise > 0 && subPaise >= freeMinPaise) return 0;
  return fromPaise(Math.max(0, toPaise(deliveryFee)));
}

export function calculateDiscountPaise(subtotalPaise, discount = null) {
  if (!discount || subtotalPaise <= 0) return 0;
  if (subtotalPaise < toPaise(discount.min_bill || 0)) return 0;
  if (discount.kind === "pct") {
    return Math.min(subtotalPaise, Math.max(0, roundInt((subtotalPaise * Number(discount.value || 0)) / 100)));
  }
  return Math.min(subtotalPaise, Math.max(0, toPaise(discount.value || 0)));
}

export function calculateOrderTotals(
  items = [],
  {
    orderType = "dine_in",
    deliveryFee = 0,
    freeDeliveryMin = 0,
    explicitDeliveryFee = null,
    discount = null,
    gstRate = 0,
    servicePct = 0,
    includeTaxes = false,
  } = {}
) {
  const safeItems = Array.isArray(items) ? items : [];
  const subtotalPaise = safeItems.reduce((sum, line) => {
    const qty = Math.max(1, Number(line?.quantity || 1));
    const unitP = toPaise(line?.unit_price_snapshot ?? line?.price ?? 0);
    const itemDiscP = Math.max(0, toPaise(line?.discount_amount || 0));
    return sum + Math.max(0, unitP * qty - itemDiscP);
  }, 0);

  const subtotal = fromPaise(subtotalPaise);
  const resolvedDeliveryFee =
    explicitDeliveryFee !== null && explicitDeliveryFee !== undefined
      ? fromPaise(Math.max(0, toPaise(explicitDeliveryFee)))
      : calculateDeliveryFee(subtotal, { orderType, deliveryFee, freeDeliveryMin });
  const deliveryPaise = toPaise(resolvedDeliveryFee);

  const discountPaise = calculateDiscountPaise(subtotalPaise, discount);
  const afterDiscountPaise = Math.max(0, subtotalPaise - discountPaise);

  const servicePaise = includeTaxes ? roundInt((afterDiscountPaise * Number(servicePct || 0)) / 100) : 0;
  const gstPaise = includeTaxes ? roundInt(((afterDiscountPaise + servicePaise) * Number(gstRate || 0)) / 100) : 0;

  const rawTotalPaise = afterDiscountPaise + servicePaise + gstPaise + deliveryPaise;
  const totalPaise = includeTaxes ? roundInt(rawTotalPaise / 100) * 100 : rawTotalPaise;

  return {
    subtotal,
    discount: fromPaise(discountPaise),
    service: fromPaise(servicePaise),
    gst: fromPaise(gstPaise),
    delivery_fee: fromPaise(deliveryPaise),
    total_amount: fromPaise(totalPaise),
  };
}

export function calculateBill(orders = [], { discount = null, gstRate = 5, servicePct = 0, payments = [] } = {}) {
  const activeOrders = (Array.isArray(orders) ? orders : []).filter(
    (o) => !["cancelled", "rejected"].includes(o?.status)
  );
  const subtotalPaise = activeOrders.reduce((sum, order) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    const orderSub = items.reduce((s, line) => {
      const unitP = toPaise(line?.unit_price_snapshot ?? line?.price ?? 0);
      const qty = Math.max(1, Number(line?.quantity || 1));
      const itemDiscP = Math.max(0, toPaise(line?.discount_amount || 0));
      return s + Math.max(0, unitP * qty - itemDiscP);
    }, 0);
    return sum + orderSub;
  }, 0);

  const discountPaise = calculateDiscountPaise(subtotalPaise, discount);
  const afterDiscount = Math.max(0, subtotalPaise - discountPaise);
  const servicePaise = roundInt((afterDiscount * Number(servicePct || 0)) / 100);
  const gstPaise = roundInt(((afterDiscount + servicePaise) * Number(gstRate || 0)) / 100);
  // Match QuickMenu rupee rounding on payable total
  const totalPaise = roundInt((afterDiscount + servicePaise + gstPaise) / 100) * 100;

  const safePayments = Array.isArray(payments) ? payments : [];
  const sumPayments = (status, field) =>
    safePayments
      .filter((p) => p?.status === status)
      .reduce((acc, p) => acc + toPaise(p?.[field] || 0), 0);

  const paidPaise = sumPayments("confirmed", "amount");
  const pendingPaise = sumPayments("pending", "amount");
  const tipsPaise = sumPayments("confirmed", "tip");

  return {
    subtotal: fromPaise(subtotalPaise),
    discount: fromPaise(discountPaise),
    service: fromPaise(servicePaise),
    gst: fromPaise(gstPaise),
    gst_rate: Number(gstRate || 0),
    service_pct: Number(servicePct || 0),
    total: fromPaise(totalPaise),
    paid: fromPaise(paidPaise),
    pending: fromPaise(pendingPaise),
    tips: fromPaise(tipsPaise),
    due: fromPaise(Math.max(totalPaise - paidPaise, 0)),
  };
}
