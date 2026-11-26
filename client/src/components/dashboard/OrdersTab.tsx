import { useMemo, useState } from "react";
import { Minus, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useToast } from "../Toast";
import { apiJson, formatINR, formatTimeShort } from "../../lib/api";
import { handleDishImageError, resolveDishImage } from "../../lib/dishMedia";
import type { MenuItem, Order, OrderLineItem, OrderStatus } from "../../types";

interface OrdersTabProps {
  orders: Order[];
  menuItems?: MenuItem[];
  onChangeStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  onOrderUpdated?: (order: Order) => void;
}

const NEXT_STEP: Partial<Record<OrderStatus, { next: OrderStatus; label: string }>> = {
  pending: { next: "accepted", label: "Accept" },
  accepted: { next: "preparing", label: "Prepare" },
  preparing: { next: "ready", label: "Mark Ready" },
  ready: { next: "completed", label: "Mark Served" },
};

export function OrdersTab({
  orders,
  menuItems = [],
  onChangeStatus,
  onOrderUpdated,
}: OrdersTabProps) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [search, setSearch] = useState("");
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [draftItems, setDraftItems] = useState<OrderLineItem[]>([]);
  const [draftNote, setDraftNote] = useState("");
  const [addItemId, setAddItemId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const itemPhotoById = useMemo(
    () => new Map(menuItems.map((m) => [m.id, m.image_url])),
    [menuItems]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter === "active" && ["completed", "cancelled"].includes(o.status)) return false;
      if (
        q &&
        !o.order_number.toLowerCase().includes(q) &&
        !o.table_number.toLowerCase().includes(q) &&
        !o.items.some((i) => i.name.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });
  }, [orders, filter, search]);

  const openEditOrder = (order: Order) => {
    setEditingOrder(order);
    setDraftItems(order.items.map((l) => ({ ...l })));
    setDraftNote(order.note || "");
    setAddItemId(menuItems[0]?.id || "");
  };

  const changeDraftQty = (idx: number, delta: number) => {
    setDraftItems((prev) =>
      prev
        .map((line, i) => (i === idx ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0)
    );
  };

  const addMenuDishToDraft = () => {
    const dish = menuItems.find((m) => m.id === addItemId);
    if (!dish) return;
    const basePrice =
      dish.size_variants.length > 0 ? dish.size_variants[0].price : dish.price;
    const defaultSize =
      dish.size_variants.length > 0 ? dish.size_variants[0].name : null;

    setDraftItems((prev) => {
      const idx = prev.findIndex(
        (l) => l.id === dish.id && l.selectedSize === defaultSize && l.addons.length === 0
      );
      if (idx >= 0) {
        return prev.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          id: dish.id,
          name: dish.name,
          price: basePrice,
          quantity: 1,
          selectedSize: defaultSize,
          addons: [],
          note: null,
          station: "",
          prep_minutes: dish.prep_minutes,
          image_url: dish.image_url,
        },
      ];
    });
  };

  const saveOrderEdit = async () => {
    if (!editingOrder || draftItems.length === 0) return;
    setSavingEdit(true);
    try {
      const res = await apiJson<{ order: Order }>(`/api/admin/orders/${editingOrder.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          items: draftItems,
          note: draftNote.trim() || null,
        }),
      });
      onOrderUpdated?.(res.order);
      setEditingOrder(null);
      toast({ title: `Order ${res.order.order_number} updated`, variant: "success" });
    } catch (err) {
      toast({
        title: "Could not update order",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const draftTotal = draftItems.reduce((sum, l) => sum + l.price * l.quantity, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl">Orders</h2>
          <p className="text-sm text-[var(--qm-muted)]">
            Live Dine-In, Takeaway, Delivery &amp; Waiter orders synced with Kitchen
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl bg-white border border-[var(--qm-line)] p-1">
            {(["active", "all"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                  filter === tab
                    ? "bg-[var(--qm-accent)] text-white"
                    : "text-[var(--qm-muted)] hover:text-[var(--qm-ink)]"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="h-4 w-4 text-[var(--qm-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order #, table, customer, or dish..."
          className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-[var(--qm-line)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--qm-accent)]"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-10 text-center text-sm text-[var(--qm-muted)]">
          No {filter === "active" ? "active " : ""}orders right now.
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {filtered.map((order) => {
            const baseAction = NEXT_STEP[order.status];
            const actionLabel =
              order.status === "preparing" && order.order_type === "takeaway"
                ? "Ready for Pickup"
                : order.status === "preparing" && order.order_type === "delivery"
                  ? "Out for Delivery"
                  : order.status === "ready" && order.order_type === "takeaway"
                    ? "Mark Picked Up"
                    : order.status === "ready" && order.order_type === "delivery"
                      ? "Mark Delivered"
                      : baseAction?.label;
            const action = baseAction ? { ...baseAction, label: actionLabel || baseAction.label } : undefined;
            const editable = !["completed", "cancelled"].includes(order.status);
            const channelBadge =
              order.order_type === "takeaway"
                ? `Takeaway · ${order.pickup_token || "Pickup"}`
                : order.order_type === "delivery"
                  ? "Delivery"
                  : `Table ${order.table_number}`;
            return (
              <div
                key={order.id}
                className="rounded-2xl bg-white border border-[var(--qm-line)] p-5 shadow-xs flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-2xl">{order.order_number}</span>
                      <span className="px-2.5 py-0.5 rounded-full bg-[var(--qm-tint)] text-[var(--qm-accent)] text-xs font-bold">
                        {channelBadge}
                      </span>
                      {order.created_by_staff_name && (
                        <span className="px-2 py-0.5 rounded-full bg-[var(--qm-surface)] text-[var(--qm-muted)] text-[11px] font-medium">
                          Waiter: {order.created_by_staff_name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--qm-muted)]">
                        {order.status}
                      </span>
                      {editable && (
                        <button
                          type="button"
                          onClick={() => openEditOrder(order)}
                          aria-label={`Edit order ${order.order_number}`}
                          className="h-7 px-2.5 rounded-lg border border-[var(--qm-line)] bg-[var(--qm-bg)] hover:border-[var(--qm-accent)] text-[11px] font-semibold inline-flex items-center gap-1"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-[var(--qm-muted)] mt-1">
                    {formatTimeShort(order.created_at)} · {formatINR(order.total_amount)}
                    {order.customer_name ? ` · ${order.customer_name}` : ""}
                    {order.customer_phone ? ` (${order.customer_phone})` : ""}
                  </p>
                  {order.delivery_address && (
                    <p className="text-xs text-[var(--qm-accent)] bg-[var(--qm-bg)] rounded-lg px-2.5 py-1.5 mt-2 border border-[var(--qm-line)]">
                      Deliver to: {order.delivery_address}
                      {order.delivery_landmark ? ` (${order.delivery_landmark})` : ""}
                    </p>
                  )}

                  <ul className="mt-3 space-y-2 text-sm">
                    {order.items.map((item, idx) => (
                      <li key={`${item.id}-${idx}`} className="flex items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={resolveDishImage(item.image_url || itemPhotoById.get(item.id))}
                            onError={handleDishImageError}
                            alt={item.name}
                            className="h-9 w-9 rounded-xl object-cover bg-[var(--qm-surface)] border border-[var(--qm-line)] flex-shrink-0"
                          />
                          <span className="min-w-0 truncate">
                            <strong>{item.quantity}×</strong> {item.name}
                            {item.selectedSize ? ` (${item.selectedSize})` : ""}
                            {item.addons.length > 0
                              ? ` + ${item.addons.map((a) => a.name).join(", ")}`
                              : ""}
                          </span>
                        </div>
                        <span className="tabular-nums text-[var(--qm-muted)] flex-shrink-0">
                          {formatINR(item.price * item.quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {order.note && (
                    <p className="mt-2.5 text-xs rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
                      Note: {order.note}
                    </p>
                  )}
                </div>

                {action && (
                  <div className="flex items-center gap-2 pt-3 border-t border-[var(--qm-line)]">
                    <button
                      type="button"
                      onClick={() => onChangeStatus(order.id, action.next)}
                      className="flex-1 h-9 rounded-xl bg-[var(--qm-accent)] hover:bg-[var(--qm-accent-hover)] text-white text-xs font-semibold transition-colors"
                    >
                      {action.label}
                    </button>
                    {order.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => onChangeStatus(order.id, "cancelled")}
                        className="h-9 px-3 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-semibold"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Active Order Modal */}
      {editingOrder && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-3xl border border-[var(--qm-line)] shadow-xl max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--qm-line)]">
              <div>
                <h3 className="font-display text-2xl">
                  Edit Order {editingOrder.order_number}
                </h3>
                <p className="text-xs text-[var(--qm-muted)]">
                  Table {editingOrder.table_number} · Adjust items, quantities & kitchen note
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingOrder(null)}
                className="p-1.5 rounded-full hover:bg-[var(--qm-surface)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="space-y-2.5">
                {draftItems.map((line, idx) => (
                  <div
                    key={`${line.id}-${idx}`}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--qm-line)] bg-[var(--qm-bg)] p-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={resolveDishImage(line.image_url || itemPhotoById.get(line.id))}
                        onError={handleDishImageError}
                        alt={line.name}
                        className="h-12 w-12 rounded-xl object-cover border border-[var(--qm-line)] bg-white flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{line.name}</p>
                        {(line.selectedSize || line.addons.length > 0) && (
                          <p className="text-xs text-[var(--qm-muted)] truncate">
                            {[line.selectedSize, ...line.addons.map((a) => a.name)]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        <p className="text-xs font-semibold text-[var(--qm-accent)] tabular-nums mt-0.5">
                          {formatINR(line.price * line.quantity)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="inline-flex items-center h-8 rounded-full border border-[var(--qm-line)] bg-white">
                        <button
                          type="button"
                          onClick={() => changeDraftQty(idx, -1)}
                          aria-label="Decrease quantity"
                          className="px-2 h-full text-[var(--qm-accent)]"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="px-1.5 text-xs font-bold tabular-nums">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeDraftQty(idx, 1)}
                          aria-label="Increase quantity"
                          className="px-2 h-full text-[var(--qm-accent)]"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      {draftItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setDraftItems((prev) => prev.filter((_, i) => i !== idx))
                          }
                          aria-label="Remove item"
                          className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {menuItems.length > 0 && (
                <div className="flex gap-2 pt-2 border-t border-[var(--qm-line)]">
                  <select
                    value={addItemId}
                    onChange={(e) => setAddItemId(e.target.value)}
                    className="flex-1 h-9 px-3 rounded-xl border border-[var(--qm-line)] bg-white text-xs"
                  >
                    {menuItems.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({formatINR(m.price)})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={addMenuDishToDraft}
                    className="h-9 px-3.5 rounded-xl bg-[var(--qm-surface)] border border-[var(--qm-line)] hover:border-[var(--qm-accent)] text-xs font-semibold inline-flex items-center gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Dish
                  </button>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--qm-muted)] mb-1">
                  Kitchen Note
                </label>
                <input
                  type="text"
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  maxLength={200}
                  placeholder="Optional note for kitchen..."
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] bg-[var(--qm-surface)] text-sm"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[var(--qm-line)] bg-[var(--qm-surface)] flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] text-[var(--qm-muted)]">Updated Total</p>
                <p className="font-display text-xl text-[var(--qm-accent)] tabular-nums">
                  {formatINR(draftTotal)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingOrder(null)}
                  className="h-10 px-4 rounded-xl border border-[var(--qm-line)] bg-white text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingEdit || draftItems.length === 0}
                  onClick={saveOrderEdit}
                  className="h-10 px-5 rounded-xl bg-[var(--qm-accent)] hover:bg-[var(--qm-accent-hover)] text-white text-sm font-semibold"
                >
                  {savingEdit ? "Saving..." : "Save Order"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
