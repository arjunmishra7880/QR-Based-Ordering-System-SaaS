# BILL_CALCULATION_SPEC.md — Unified `billMath.js` Specification

**Single Source of Truth:** `shared/billMath.js` (re-exported by `server/src/billMath.js` and `client/src/lib/billMath.ts`)

---

## 1. Precision & Rounding Rules
- All currency values are converted to integer **paise** (`1 INR = 100 paise`) via `toPaise(val) = Math.round(Number(val || 0) * 100)` to eliminate IEEE-754 floating-point drift.
- Percentage calculations use half-up rounding via `roundInt(val) = Math.round(Number(val || 0) + 1e-9)`.
- Final table payable total (`calculateBill.total`) rounds to the nearest whole rupee (`roundInt((afterDiscount + servicePaise + gstPaise) / 100) * 100`), preserving existing QuickMenu POS/UPI billing behavior.

## 2. Line-Item Pricing (`calculateItemPricing`)
For each ordered line item:
- `base_unit_price` = menu base price or selected size-variant price.
- `addons_unit_total` = sum of selected modifier/add-on prices.
- `unit_price` = `base_unit_price + addons_unit_total`.
- `subtotal` = `unit_price * quantity`.
- `line_total` = `max(0, subtotal - discount_amount)`.

## 3. Order Totals & Delivery Fee (`calculateDeliveryFee` & `calculateOrderTotals`)
- **Dine-In & Takeaway**: `delivery_fee = 0`.
- **Delivery**: If `freeDeliveryMin > 0 && subtotal >= freeDeliveryMin`, `delivery_fee = 0`; otherwise `delivery_fee = settings.delivery_fee`.
- Authoritative order `total_amount` stored in `orders.total_amount`:
  - `subtotal - discount + service + gst + delivery_fee` (`includeTaxes = false` when order lines store pre-tax menu prices and seating/checkout applies GST & service charge uniformly).

## 4. Seating / Multi-Order Bill Calculation (`calculateBill`)
1. Exclude orders with status `cancelled` or `rejected`.
2. Sum active line totals into `subtotalPaise` (`unit_price_snapshot * quantity - discount_amount`).
3. Apply bill-level `discount` (only if `subtotalPaise >= toPaise(discount.min_bill)`):
   - `kind === "pct"`: `roundInt((subtotalPaise * value) / 100)` clamped to `subtotalPaise`.
   - `kind === "flat"`: `min(toPaise(value), subtotalPaise)`.
4. `afterDiscount = max(0, subtotalPaise - discountPaise)`.
5. `servicePaise = roundInt((afterDiscount * servicePct) / 100)`.
6. `gstPaise = roundInt(((afterDiscount + servicePaise) * gstRate) / 100)`.
7. `totalPaise = roundInt((afterDiscount + servicePaise + gstPaise) / 100) * 100`.
8. `due = max(0, totalPaise - confirmedPaidPaise) / 100`.

## 5. Server Authority vs. Client Preview
- `MenuPage.tsx` and `WaiterPage.tsx` use `shared/billMath.js` (`calculateOrderTotals`) to display live cart previews and split amounts (`BillModal.tsx`).
- The backend (`resolveAuthoritativeLines` in `server/src/security.js` + `POST /api/public/orders`, `POST /api/admin/orders`, `PATCH /api/admin/orders/:id`, `buildSeatingView`) independently resolves menu prices/modifiers from SQLite and recomputes authoritative totals via `shared/billMath.js`, never trusting client-submitted prices or totals.
