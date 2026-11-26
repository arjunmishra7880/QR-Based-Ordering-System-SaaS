export interface AddonLike {
  name?: string;
  price?: number;
}

export interface ItemPricingInput {
  basePrice?: number;
  addons?: AddonLike[];
  quantity?: number;
  discountAmount?: number;
  taxRate?: number;
}

export interface ItemPricingResult {
  base_unit_price: number;
  addons_unit_total: number;
  unit_price: number;
  quantity: number;
  subtotal: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
}

export interface OrderDiscount {
  kind?: "pct" | "flat";
  value?: number;
  min_bill?: number;
}

export interface OrderTotalsOptions {
  orderType?: "dine_in" | "takeaway" | "delivery" | string;
  deliveryFee?: number;
  freeDeliveryMin?: number;
  explicitDeliveryFee?: number | null;
  discount?: OrderDiscount | null;
  gstRate?: number;
  servicePct?: number;
  includeTaxes?: boolean;
}

export interface OrderTotalsResult {
  subtotal: number;
  discount: number;
  service: number;
  gst: number;
  delivery_fee: number;
  total_amount: number;
}

export function calculateItemPricing(input?: ItemPricingInput): ItemPricingResult;
export function calculateDeliveryFee(
  subtotalAmount: number,
  options?: { orderType?: string; deliveryFee?: number; freeDeliveryMin?: number }
): number;
export function calculateDiscountPaise(subtotalPaise: number, discount?: OrderDiscount | null): number;
export function calculateOrderTotals(items?: Array<Record<string, any>>, options?: OrderTotalsOptions): OrderTotalsResult;
export function calculateBill(
  orders?: Array<Record<string, any>>,
  options?: {
    discount?: OrderDiscount | null;
    gstRate?: number;
    servicePct?: number;
    payments?: Array<Record<string, any>>;
  }
): {
  subtotal: number;
  discount: number;
  service: number;
  gst: number;
  gst_rate: number;
  service_pct: number;
  total: number;
  paid: number;
  pending: number;
  tips: number;
  due: number;
};
