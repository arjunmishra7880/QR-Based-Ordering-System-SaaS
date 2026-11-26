import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChefHat,
  ChevronRight,
  Clock,
  Copy,
  Gift,
  Minus,
  Plus,
  Receipt,
  ReceiptText,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
  Truck,
  Utensils,
  Wifi,
  X,
} from "lucide-react";
import { BillModal } from "../components/BillModal";
import { calculateOrderTotals } from "../lib/billMath";
import { CallStaffModal } from "../components/CallStaffModal";
import { DishOptionModal } from "../components/DishOptionModal";
import { FeedbackModal } from "../components/FeedbackModal";
import { SpinWheelModal } from "../components/SpinWheelModal";
import { useToast } from "../components/Toast";
import { VegBadge } from "../components/VegBadge";
import {
  ApiError,
  apiJson,
  buildVenueThemeStyle,
  formatINR,
  formatTimeShort,
  getStoredPinToken,
} from "../lib/api";
import {
  handleCoverImageError,
  handleDishImageError,
  resolveCoverImage,
  resolveDishImage,
} from "../lib/dishMedia";
import { useRealtimeSocket } from "../lib/useWebSocket";
import type {
  Category,
  MenuItem,
  Order,
  OrderType,
  PlatformBrandConfig,
  RestaurantSettings,
  SeatingView,
  ServiceCall,
} from "../types";

interface CartLine {
  key: string;
  item: MenuItem;
  size: string | null;
  addons: string[];
  note: string;
  unitPrice: number;
  quantity: number;
}

const SESSION_KEY = "qm_guest_session_v1";
const ORDER_PREFS = ["Serve together", "Less spicy", "Jain prep", "Extra cutlery"];

function getGuestSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `${Date.now()}`;
  }
}

function getTrackerSteps(order: Order | null): Array<{ key: Order["status"]; label: string }> {
  if (order?.order_type === "takeaway") {
    return [
      { key: "pending", label: "Sent" },
      { key: "accepted", label: "Accepted" },
      { key: "preparing", label: "Preparing" },
      { key: "ready", label: "Ready for Pickup" },
    ];
  }
  if (order?.order_type === "delivery") {
    return [
      { key: "pending", label: "Sent" },
      { key: "accepted", label: "Accepted" },
      { key: "preparing", label: "Preparing" },
      { key: "ready", label: "Out for Delivery" },
    ];
  }
  return [
    { key: "pending", label: "Sent" },
    { key: "accepted", label: "Accepted" },
    { key: "preparing", label: "Cooking" },
    { key: "ready", label: "Ready" },
  ];
}

function getOrderStatusBadge(order: Order): { label: string; tone: string } {
  if (order.status === "ready") {
    if (order.order_type === "takeaway") {
      return { label: "Ready for Pickup", tone: "bg-emerald-100 text-emerald-900" };
    }
    if (order.order_type === "delivery") {
      return { label: "Out for Delivery", tone: "bg-emerald-100 text-emerald-900" };
    }
    return { label: "Ready · On its way!", tone: "bg-emerald-100 text-emerald-900" };
  }
  if (order.status === "completed") {
    return {
      label:
        order.order_type === "takeaway"
          ? "Picked up"
          : order.order_type === "delivery"
            ? "Delivered"
            : "Served",
      tone: "bg-stone-200 text-stone-800",
    };
  }
  const map: Record<Order["status"], { label: string; tone: string }> = {
    pending: { label: "Sent to kitchen", tone: "bg-amber-100 text-amber-900" },
    accepted: { label: "Accepted", tone: "bg-sky-100 text-sky-900" },
    preparing: { label: "Preparing", tone: "bg-orange-100 text-orange-900" },
    ready: { label: "Ready", tone: "bg-emerald-100 text-emerald-900" },
    completed: { label: "Completed", tone: "bg-stone-200 text-stone-800" },
    cancelled: { label: "Cancelled", tone: "bg-red-100 text-red-800" },
    rejected: { label: "Declined", tone: "bg-red-100 text-red-800" },
  };
  return map[order.status];
}

export function MenuPage() {
  const { slug } = useParams<{ slug?: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const tableNumber = params.get("table") || "";
  const modeParam = params.get("mode");
  const restaurantKey = slug || params.get("restaurant") || params.get("r") || "";
  const sessionId = useMemo(() => getGuestSessionId(), []);

  const [orderType, setOrderType] = useState<OrderType>(() =>
    modeParam === "takeaway" ? "takeaway" : modeParam === "delivery" ? "delivery" : "dine_in"
  );

  const [platformName, setPlatformName] = useState("BROTOCOL ServeOS");
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [calls, setCalls] = useState<ServiceCall[]>([]);
  const [seating, setSeating] = useState<SeatingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [venueError, setVenueError] = useState<string | null>(null);

  const [vegOnly, setVegOnly] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderNote, setOrderNote] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryLandmark, setDeliveryLandmark] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  const clientReqIdRef = useRef<string>("");

  const [optionItem, setOptionItem] = useState<MenuItem | null>(null);
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);
  const [billOpen, setBillOpen] = useState(false);
  const [spinOpen, setSpinOpen] = useState(false);
  const [feedbackOrderId, setFeedbackOrderId] = useState<string | null>(null);

  const [loyaltyPhone, setLoyaltyPhone] = useState("");
  const [joiningLoyalty, setJoiningLoyalty] = useState(false);
  const [copiedWifi, setCopiedWifi] = useState(false);

  const scanPath = slug ? `/r/${slug}/scan` : "/scan";
  const reserveHref = slug
    ? `/r/${slug}/reserve`
    : restaurantKey
      ? `/reserve?restaurant=${encodeURIComponent(restaurantKey)}`
      : "/reserve";

  useEffect(() => {
    if (!tableNumber && modeParam !== "takeaway" && modeParam !== "delivery") {
      navigate(
        !slug && restaurantKey ? `${scanPath}?restaurant=${encodeURIComponent(restaurantKey)}` : scanPath,
        { replace: true }
      );
    }
  }, [tableNumber, modeParam, slug, restaurantKey, scanPath, navigate]);

  const restaurantQs = restaurantKey ? `&restaurant=${encodeURIComponent(restaurantKey)}` : "";
  const pinToken = useMemo(
    () => (tableNumber ? getStoredPinToken(restaurantKey, tableNumber) : ""),
    [restaurantKey, tableNumber]
  );

  const pinHeaders = useMemo(
    () => (pinToken ? { "X-Table-Pin-Token": pinToken } : undefined),
    [pinToken]
  );

  const refreshSeating = useCallback(() => {
    if (!tableNumber || orderType !== "dine_in") return;
    apiJson<{ seating: SeatingView | null }>(
      `/api/public/seating?table=${encodeURIComponent(tableNumber)}${restaurantQs}`,
      { headers: pinHeaders }
    )
      .then((r) => setSeating(r.seating))
      .catch(() => {});
  }, [tableNumber, orderType, restaurantQs, pinHeaders]);

  const loadInitial = useCallback(async () => {
    if (!tableNumber && modeParam !== "takeaway" && modeParam !== "delivery") return;
    setLoading(true);
    setVenueError(null);
    try {
      apiJson<{ platform: PlatformBrandConfig }>("/api/public/platform")
        .then((r) => {
          if (r.platform?.platform_name) setPlatformName(r.platform.platform_name);
        })
        .catch(() => {});

      if (tableNumber) {
        const tsRes = await apiJson<{
          require_table_pin?: boolean;
          has_open_seating?: boolean;
          needs_pin?: boolean;
        }>(`/api/public/table-status?table=${encodeURIComponent(tableNumber)}${restaurantQs}`, {
          headers: pinHeaders,
        });
        if ((tsRes.require_table_pin && !tsRes.has_open_seating) || tsRes.needs_pin) {
          const targetScan = `${scanPath}?table=${encodeURIComponent(tableNumber)}${
            !slug && restaurantKey ? `&restaurant=${encodeURIComponent(restaurantKey)}` : ""
          }`;
          navigate(targetScan, { replace: true });
          return;
        }
      }

      const ordersQuery =
        tableNumber && orderType === "dine_in"
          ? `/api/public/orders?table=${encodeURIComponent(tableNumber)}&session=${encodeURIComponent(sessionId)}${restaurantQs}`
          : `/api/public/orders?mode=${orderType}&session=${encodeURIComponent(sessionId)}${restaurantQs}`;

      const [menuRes, ordersRes] = await Promise.all([
        apiJson<{
          settings: RestaurantSettings;
          categories: Category[];
          items: MenuItem[];
        }>(`/api/public/menu?trackView=1${restaurantQs}`),
        apiJson<{ orders: Order[]; calls: ServiceCall[]; seating: SeatingView | null }>(ordersQuery, {
          headers: pinHeaders,
        }),
      ]);
      setSettings(menuRes.settings);
      setCategories(menuRes.categories);
      setItems(menuRes.items);
      setOrders(ordersRes.orders);
      setCalls(ordersRes.calls);
      setSeating(ordersRes.seating);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Please refresh.";
      setVenueError(msg);
      toast({
        title: "Failed to load menu",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [
    tableNumber,
    modeParam,
    orderType,
    sessionId,
    restaurantQs,
    pinHeaders,
    scanPath,
    slug,
    restaurantKey,
    navigate,
    toast,
  ]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (settings?.name) {
      document.title = `${settings.name} — Menu & Ordering`;
    }
  }, [settings?.name]);

  useRealtimeSocket(
    "guest",
    orderType === "dine_in" ? tableNumber || null : null,
    (msg) => {
      if (msg.type === "order:updated") {
        const updated = msg.payload as Order;
        const matchesGuest =
          updated.client_session_id === sessionId ||
          (orderType === "dine_in" && updated.table_number === tableNumber);
        if (matchesGuest) {
          setOrders((prev) => {
            const exists = prev.some((o) => o.id === updated.id);
            return exists ? prev.map((o) => (o.id === updated.id ? updated : o)) : [updated, ...prev];
          });
          if (updated.status === "accepted") {
            toast({
              title: "Order confirmed",
              description: `Kitchen confirmed order ${updated.order_number}.`,
            });
          } else if (updated.status === "ready") {
            const readyText =
              updated.order_type === "takeaway"
                ? `Order ${updated.order_number} (${updated.pickup_token || "Pickup"}) is ready for pickup!`
                : updated.order_type === "delivery"
                  ? `Order ${updated.order_number} is out for delivery!`
                  : `Order ${updated.order_number} is on its way to Table ${tableNumber}.`;
            toast({
              title:
                updated.order_type === "takeaway"
                  ? "Ready for pickup!"
                  : updated.order_type === "delivery"
                    ? "Out for delivery!"
                    : "Your food is ready!",
              description: readyText,
              variant: "success",
            });
          }
        }
        refreshSeating();
      } else if (msg.type === "call:updated") {
        const updated = msg.payload as ServiceCall;
        setCalls((prev) => {
          const exists = prev.some((c) => c.id === updated.id);
          return exists ? prev.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...prev];
        });
        if (updated.status === "acknowledged") {
          toast({
            title: `${updated.acknowledged_by || "Staff"} on the way`,
            description: `Request (${updated.call_type}) acknowledged.`,
          });
        }
      } else if (msg.type === "seating:updated") {
        refreshSeating();
      } else if (msg.type === "settings:updated") {
        setSettings(msg.payload as RestaurantSettings);
        refreshSeating();
      }
    },
    settings?.id,
    { sessionId, pinToken }
  );

  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return categories
      .filter((cat) => selectedCategory === "all" || cat.id === selectedCategory)
      .map((cat) => {
        const catItems = items.filter((item) => {
          if (item.category_id !== cat.id) return false;
          if (vegOnly && item.is_veg !== 1) return false;
          if (q && !item.name.toLowerCase().includes(q) && !item.description.toLowerCase().includes(q)) {
            return false;
          }
          return true;
        });
        return { category: cat, items: catItems };
      })
      .filter((group) => group.items.length > 0);
  }, [categories, items, selectedCategory, vegOnly, searchQuery]);

  const resetReqKey = () => {
    clientReqIdRef.current = "";
  };

  const addSimpleDirect = (item: MenuItem, quantity = 1) => {
    resetReqKey();
    const key = `${item.id}::`;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + quantity } : l));
      }
      return [
        ...prev,
        { key, item, size: null, addons: [], note: "", unitPrice: item.price, quantity },
      ];
    });
  };

  const addSimpleOrOpenModal = (item: MenuItem) => {
    if (item.has_size_variants || item.addons.length > 0) {
      setOptionItem(item);
      return;
    }
    addSimpleDirect(item, 1);
  };

  const addConfiguredLine = (
    item: MenuItem,
    payload: { size: string | null; addons: string[]; note: string; unitPrice: number; quantity?: number }
  ) => {
    resetReqKey();
    const addQty = Math.max(1, payload.quantity || 1);
    const sortedAddons = [...payload.addons].sort();
    const key = `${item.id}:${payload.size || ""}:${sortedAddons.join(",")}:${payload.note}`;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + addQty } : l));
      }
      return [
        ...prev,
        {
          key,
          item,
          size: payload.size,
          addons: sortedAddons,
          note: payload.note,
          unitPrice: payload.unitPrice,
          quantity: addQty,
        },
      ];
    });
    setOptionItem(null);
  };

  const changeQty = (key: string, delta: number) => {
    resetReqKey();
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  };

  const simpleItemQty = (itemId: string) =>
    cart
      .filter((l) => l.item.id === itemId && !l.size && l.addons.length === 0 && !l.note)
      .reduce((s, l) => s + l.quantity, 0);

  const toggleOrderPref = (pref: string) => {
    const parts = orderNote
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const exists = parts.some((p) => p.toLowerCase() === pref.toLowerCase());
    const next = exists
      ? parts.filter((p) => p.toLowerCase() !== pref.toLowerCase())
      : [...parts, pref];
    setOrderNote(next.join(", "));
  };

  const joinLoyalty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableNumber) return;
    setJoiningLoyalty(true);
    try {
      const res = await apiJson<{ seating: SeatingView }>("/api/public/seating/loyalty", {
        method: "POST",
        headers: pinHeaders,
        body: JSON.stringify({
          tableNumber,
          phone: loyaltyPhone,
          ...(restaurantKey ? { restaurant: restaurantKey } : {}),
        }),
      });
      setSeating(res.seating);
      setLoyaltyPhone("");
      toast({ title: "Loyalty number linked!", variant: "success" });
    } catch (err) {
      toast({
        title: "Couldn't add number",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setJoiningLoyalty(false);
    }
  };

  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  const cartPreview = useMemo(
    () =>
      calculateOrderTotals(
        cart.map((l) => ({ price: l.unitPrice, quantity: l.quantity })),
        {
          orderType,
          deliveryFee: settings?.delivery_fee ?? 40,
          freeDeliveryMin: settings?.free_delivery_min ?? 500,
        }
      ),
    [cart, orderType, settings?.delivery_fee, settings?.free_delivery_min]
  );
  const cartTotal = cartPreview.subtotal;
  const estDeliveryFee = cartPreview.delivery_fee;
  const cartPayableTotal = cartPreview.total_amount;
  const estPrepMinutes =
    cart.length > 0 ? Math.max(...cart.map((l) => l.item.prep_minutes || 10)) : 0;

  const pairingSuggestions = useMemo(() => {
    if (cart.length === 0) return [];
    const inCartIds = new Set(cart.map((l) => l.item.id));
    return items
      .filter((m) => m.is_available && !inCartIds.has(m.id) && !m.has_size_variants)
      .filter((m) => (vegOnly ? m.is_veg === 1 : true))
      .sort((a, b) => Number(b.is_bestseller) - Number(a.is_bestseller) || a.price - b.price)
      .slice(0, 2);
  }, [cart, items, vegOnly]);

  const submitOrder = async () => {
    if (cart.length === 0) return;
    if (orderType === "dine_in" && !tableNumber) return;
    if (orderType !== "dine_in") {
      if (customerName.trim().length < 2) {
        toast({ title: "Enter your name", variant: "destructive" });
        return;
      }
      if (customerPhone.replace(/\D/g, "").length < 8) {
        toast({ title: "Enter a valid contact phone number", variant: "destructive" });
        return;
      }
      if (orderType === "delivery" && deliveryAddress.trim().length < 6) {
        toast({ title: "Enter a full delivery address", variant: "destructive" });
        return;
      }
    }

    if (!clientReqIdRef.current) {
      clientReqIdRef.current = crypto.randomUUID
        ? crypto.randomUUID()
        : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    setSubmitting(true);
    try {
      const res = await apiJson<{ order: Order; seating: SeatingView | null }>("/api/public/orders", {
        method: "POST",
        headers: pinHeaders,
        body: JSON.stringify({
          orderType,
          ...(orderType === "dine_in" ? { tableNumber } : {}),
          ...(orderType !== "dine_in"
            ? {
                customerName: customerName.trim(),
                customerPhone: customerPhone.trim(),
              }
            : {}),
          ...(orderType === "delivery"
            ? {
                deliveryAddress: deliveryAddress.trim(),
                deliveryLandmark: deliveryLandmark.trim() || undefined,
              }
            : {}),
          sessionId,
          clientRequestId: clientReqIdRef.current,
          note: orderNote.trim() || null,
          ...(restaurantKey ? { restaurant: restaurantKey } : {}),
          items: cart.map((l) => ({
            itemId: l.item.id,
            quantity: l.quantity,
            size: l.size,
            addons: l.addons,
            note: l.note || null,
          })),
        }),
      });
      setOrders((prev) =>
        prev.some((o) => o.id === res.order.id) ? prev : [res.order, ...prev]
      );
      if (res.seating) setSeating(res.seating);
      setCart([]);
      setOrderNote("");
      resetReqKey();
      setMobileCartOpen(false);
      setPlacedOrder(res.order);
    } catch (err) {
      toast({
        title: "Order couldn't be sent",
        description: err instanceof ApiError ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const cancelOrder = async (orderId: string) => {
    try {
      const res = await apiJson<{ order: Order }>(`/api/public/orders/${orderId}/cancel`, {
        method: "POST",
        headers: pinHeaders,
        body: JSON.stringify({ sessionId }),
      });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? res.order : o)));
      refreshSeating();
      toast({ title: "Order cancelled" });
    } catch (err) {
      toast({
        title: "Cannot cancel",
        description: err instanceof Error ? err.message : "Kitchen has already started.",
        variant: "destructive",
      });
    }
  };

  const latestActiveCall = calls.find((c) => c.status !== "completed") || calls[0] || null;
  const activeOrders = orders.filter((o) => !["completed", "cancelled", "rejected"].includes(o.status));
  const rateableOrder = orders.find((o) => ["ready", "completed"].includes(o.status)) || orders[0] || null;
  const hasPlacedOrder = orders.some((o) => !["cancelled", "rejected"].includes(o.status));
  const livePlacedOrder = placedOrder
    ? orders.find((o) => o.id === placedOrder.id) || placedOrder
    : null;

  const showWhileYouWait =
    orderType === "dine_in" &&
    hasPlacedOrder &&
    seating &&
    seating.status === "open" &&
    (seating.spin_prizes.length > 0 || seating.loyalty || seating.wifi);

  const renderCartBody = () => (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 pb-3 border-b border-[var(--qm-line)]">
        <div className="flex items-center gap-2.5">
          <span
            style={{
              backgroundColor: "var(--qm-accent)",
              color: "var(--qm-accent-ink)",
            }}
            className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
          >
            <ReceiptText className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-display text-xl leading-none">Your order</h3>
            <p className="text-[11px] text-[var(--qm-muted)] mt-1 flex items-center gap-1.5">
              <span>
                {orderType === "takeaway"
                  ? "Takeaway Pickup"
                  : orderType === "delivery"
                    ? "Restaurant Delivery"
                    : `Dine-In · Table ${tableNumber}`}
              </span>
              {cartCount > 0 && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 font-medium text-[var(--qm-accent)]">
                    <Clock className="h-3 w-3" /> ~{estPrepMinutes} min
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {cart.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setCart([]);
              resetReqKey();
            }}
            className="text-xs font-semibold text-red-600 hover:bg-red-50 px-2.5 py-1 rounded-lg flex items-center gap-1"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Mode Switcher when extra modes are enabled */}
      {(settings?.takeaway_enabled !== false || settings?.delivery_enabled) && (
        <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-[var(--qm-bg)] border border-[var(--qm-line)] p-1 text-xs font-semibold">
          {tableNumber && (
            <button
              type="button"
              onClick={() => setOrderType("dine_in")}
              style={
                orderType === "dine_in"
                  ? { backgroundColor: "var(--qm-accent)", color: "var(--qm-accent-ink)" }
                  : undefined
              }
              className={`h-8 rounded-xl transition-colors ${
                orderType === "dine_in" ? "" : "text-[var(--qm-muted)]"
              }`}
            >
              Dine-In
            </button>
          )}
          {settings?.takeaway_enabled !== false && (
            <button
              type="button"
              onClick={() => setOrderType("takeaway")}
              style={
                orderType === "takeaway"
                  ? { backgroundColor: "var(--qm-accent)", color: "var(--qm-accent-ink)" }
                  : undefined
              }
              className={`h-8 rounded-xl transition-colors ${
                orderType === "takeaway" ? "" : "text-[var(--qm-muted)]"
              }`}
            >
              Takeaway
            </button>
          )}
          {settings?.delivery_enabled && (
            <button
              type="button"
              onClick={() => setOrderType("delivery")}
              style={
                orderType === "delivery"
                  ? { backgroundColor: "var(--qm-accent)", color: "var(--qm-accent-ink)" }
                  : undefined
              }
              className={`h-8 rounded-xl transition-colors ${
                orderType === "delivery" ? "" : "text-[var(--qm-muted)]"
              }`}
            >
              Delivery
            </button>
          )}
        </div>
      )}

      {cart.length === 0 ? (
        <div className="py-8 px-3 text-center">
          <div className="h-12 w-12 mx-auto rounded-2xl bg-[var(--qm-tint)] text-[var(--qm-accent)] flex items-center justify-center mb-3">
            <Utensils className="h-5 w-5" />
          </div>
          <p className="font-display text-lg text-[var(--qm-accent)]">Your dining tray awaits</p>
          <p className="text-xs text-[var(--qm-muted)] mt-1 leading-relaxed">
            Tap any dish on the menu to customize spice levels, sizes, or add directly to your order.
          </p>
          {orderType === "dine_in" && seating && seating.bill.total > 0 && (
            <button
              type="button"
              onClick={() => setBillOpen(true)}
              style={{
                backgroundColor: "var(--qm-accent)",
                color: "var(--qm-accent-ink)",
              }}
              className="mt-4 h-10 px-4 rounded-full text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Receipt className="h-3.5 w-3.5" />
              View Table Bill ({formatINR(seating.bill.due > 0 ? seating.bill.due : seating.bill.total)})
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
            {cart.map((line) => (
              <div
                key={line.key}
                className="flex items-center justify-between gap-2.5 rounded-2xl bg-[var(--qm-bg)] border border-[var(--qm-line)] p-2.5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={resolveDishImage(line.item.image_url)}
                    onError={handleDishImageError}
                    alt={line.item.name}
                    className="h-11 w-11 rounded-xl object-cover border border-[var(--qm-line)] bg-white flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <VegBadge isVeg={line.item.is_veg} />
                      <p className="text-xs font-semibold leading-tight truncate text-[var(--qm-accent)]">
                        {line.item.name}
                      </p>
                    </div>
                    {(line.size || line.addons.length > 0 || line.note) && (
                      <p className="text-[11px] text-[var(--qm-muted)] mt-0.5 leading-snug truncate">
                        {[line.size, ...line.addons, line.note].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <p className="text-xs font-bold text-[var(--qm-accent)] mt-0.5 tabular-nums">
                      {formatINR(line.unitPrice * line.quantity)}
                    </p>
                  </div>
                </div>

                <div className="inline-flex items-center h-7 rounded-full border border-[var(--qm-line)] bg-white flex-shrink-0 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => changeQty(line.key, -1)}
                    aria-label="Decrease quantity"
                    className="px-2 h-full text-[var(--qm-accent)] hover:bg-[var(--qm-tint)] rounded-l-full"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="px-1.5 text-xs font-bold tabular-nums">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => changeQty(line.key, 1)}
                    aria-label="Increase quantity"
                    className="px-2 h-full text-[var(--qm-accent)] hover:bg-[var(--qm-tint)] rounded-r-full"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {pairingSuggestions.length > 0 && (
            <div className="pt-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--qm-muted)] mb-2 flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-[var(--qm-accent)]" />
                Pair with your order
              </p>
              <div className="grid grid-cols-2 gap-2">
                {pairingSuggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => addSimpleDirect(s, 1)}
                    className="flex items-center gap-2 p-2 rounded-xl border border-[var(--qm-line)] bg-white hover:border-[var(--qm-accent)] text-left transition-colors"
                  >
                    <img
                      src={resolveDishImage(s.image_url)}
                      onError={handleDishImageError}
                      alt={s.name}
                      className="h-9 w-9 rounded-lg object-cover flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold truncate text-[var(--qm-accent)]">{s.name}</p>
                      <p className="text-[10px] font-bold text-[var(--qm-muted)] tabular-nums">
                        +{formatINR(s.price)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {orderType !== "dine_in" && (
            <div className="rounded-2xl bg-[var(--qm-bg)] border border-[var(--qm-line)] p-3.5 space-y-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--qm-accent)]">
                {orderType === "takeaway" ? "Pickup Contact Details" : "Delivery Details"}
              </p>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Your full name *"
                className="w-full h-9 px-3 rounded-xl border border-[var(--qm-line)] bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[var(--qm-accent)]"
              />
              <input
                type="tel"
                required
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Contact phone number *"
                className="w-full h-9 px-3 rounded-xl border border-[var(--qm-line)] bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[var(--qm-accent)]"
              />
              {orderType === "delivery" && (
                <>
                  <textarea
                    rows={2}
                    required
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="Street address, floor, flat / house number *"
                    className="w-full p-2.5 rounded-xl border border-[var(--qm-line)] bg-white text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[var(--qm-accent)]"
                  />
                  <input
                    type="text"
                    value={deliveryLandmark}
                    onChange={(e) => setDeliveryLandmark(e.target.value)}
                    placeholder="Landmark (optional)"
                    className="w-full h-9 px-3 rounded-xl border border-[var(--qm-line)] bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[var(--qm-accent)]"
                  />
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {ORDER_PREFS.map((pref) => {
                const active = orderNote.toLowerCase().includes(pref.toLowerCase());
                return (
                  <button
                    key={pref}
                    type="button"
                    onClick={() => toggleOrderPref(pref)}
                    style={
                      active
                        ? {
                            backgroundColor: "var(--qm-accent)",
                            color: "var(--qm-accent-ink)",
                            borderColor: "var(--qm-accent)",
                          }
                        : undefined
                    }
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                      active
                        ? ""
                        : "border-[var(--qm-line)] bg-[var(--qm-bg)] text-[var(--qm-muted)] hover:border-[var(--qm-accent)]/45"
                    }`}
                  >
                    {pref}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              value={orderNote}
              onChange={(e) => setOrderNote(e.target.value)}
              maxLength={200}
              placeholder="Any kitchen or allergy note..."
              className="w-full h-9 px-3 rounded-xl bg-[var(--qm-bg)] border border-[var(--qm-line)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--qm-accent)]"
            />
          </div>

          <div className="rounded-2xl bg-[var(--qm-bg)] border border-dashed border-[var(--qm-line)] p-3.5 space-y-1.5 text-xs">
            <div className="flex justify-between text-[var(--qm-muted)]">
              <span>Items subtotal ({cartCount})</span>
              <span className="tabular-nums font-medium">{formatINR(cartTotal)}</span>
            </div>
            {orderType === "delivery" ? (
              <div className="flex justify-between text-[var(--qm-muted)]">
                <span>Restaurant delivery fee</span>
                <span className="tabular-nums font-medium">
                  {estDeliveryFee === 0 ? "Free" : formatINR(estDeliveryFee)}
                </span>
              </div>
            ) : (
              <div className="flex justify-between text-[var(--qm-muted)]">
                <span>{orderType === "takeaway" ? "Counter packing" : "Table service & plating"}</span>
                <span className="font-medium text-emerald-700">Complimentary</span>
              </div>
            )}
            <div className="flex justify-between pt-2 mt-1 border-t border-[var(--qm-line)] text-sm font-bold text-[var(--qm-accent)]">
              <span>Order Total</span>
              <span className="tabular-nums">{formatINR(cartPayableTotal)}</span>
            </div>
          </div>

          <button
            type="button"
            disabled={submitting || settings?.orders_enabled === false}
            onClick={submitOrder}
            style={{
              backgroundColor: "var(--qm-accent)",
              color: "var(--qm-accent-ink)",
            }}
            className="w-full h-12 px-5 rounded-2xl disabled:opacity-55 font-semibold text-sm flex items-center justify-between shadow-lg transition-opacity hover:opacity-95"
          >
            {settings?.orders_enabled === false ? (
              <span className="mx-auto">Ordering currently paused</span>
            ) : submitting ? (
              <span className="mx-auto">Sending to the kitchen...</span>
            ) : (
              <>
                <span className="inline-flex items-center gap-2">
                  <span>
                    {orderType === "takeaway"
                      ? "Place takeaway order"
                      : orderType === "delivery"
                        ? "Place delivery order"
                        : "Place order"}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </span>
                <span className="px-2.5 py-0.5 rounded-lg bg-white/15 tabular-nums font-bold">
                  {formatINR(cartPayableTotal)}
                </span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );

  const themeStyle = buildVenueThemeStyle(
    settings?.brand_bg,
    settings?.primary_color || settings?.brand_accent,
    settings?.secondary_color || settings?.brand_secondary
  );

  if (loading) {
    return (
      <div
        style={themeStyle}
        className="min-h-screen bg-[var(--qm-bg)] flex items-center justify-center"
      >
        <p className="font-display text-2xl text-[var(--qm-muted)]">Loading menu...</p>
      </div>
    );
  }

  if (venueError && !settings) {
    return (
      <div
        style={themeStyle}
        className="min-h-screen bg-[var(--qm-bg)] flex items-center justify-center p-6"
      >
        <div className="max-w-sm w-full bg-white rounded-3xl border border-[var(--qm-line)] p-7 text-center shadow-xs space-y-4">
          <h1 className="font-display text-2xl text-[var(--qm-accent)]">Menu Unavailable</h1>
          <p className="text-sm text-[var(--qm-muted)]">{venueError}</p>
          <Link
            to="/"
            style={{
              backgroundColor: "var(--qm-accent)",
              color: "var(--qm-accent-ink)",
            }}
            className="inline-flex items-center justify-center w-full h-11 rounded-full text-sm font-semibold"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const trackerSteps = getTrackerSteps(livePlacedOrder);
  const placedStepIndex = livePlacedOrder
    ? Math.max(0, trackerSteps.findIndex((s) => s.key === livePlacedOrder.status))
    : 0;
  const socialLinks = settings?.social_links || {};
  const hasSocial = Object.values(socialLinks).some((v) => Boolean(v && v.trim()));

  return (
    <div style={themeStyle} className="min-h-screen bg-[var(--qm-bg)] pb-28 lg:pb-12">
      {/* Landscape Restaurant Dining Hero */}
      <section className="relative text-[#FAF8F5] overflow-hidden min-h-[275px] sm:min-h-[325px] flex flex-col justify-between">
        <img
          src={resolveCoverImage(settings?.cover_url)}
          onError={handleCoverImageError}
          alt={`${settings?.name || "Restaurant"} dining interior`}
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/55 to-black/30" />

        <div className="relative max-w-6xl w-full mx-auto px-4 sm:px-6 pt-4 pb-6 flex-1 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <Link
              to="/"
              aria-label="Back to home"
              className="h-9 w-9 rounded-full bg-black/35 backdrop-blur-md border border-white/20 flex items-center justify-center hover:bg-black/55"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>

            <div className="flex items-center gap-2">
              {orderType === "dine_in" && seating && seating.bill.total > 0 && (
                <button
                  type="button"
                  onClick={() => setBillOpen(true)}
                  className="h-9 px-3.5 rounded-full bg-black/35 backdrop-blur-md border border-white/25 text-[#FAF8F5] flex items-center gap-1.5 text-xs font-bold hover:bg-black/55"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  <span>
                    Bill · {formatINR(seating.bill.due > 0 ? seating.bill.due : seating.bill.total)}
                  </span>
                </button>
              )}

              <Link
                to={reserveHref}
                className="h-9 px-3 rounded-full bg-black/35 backdrop-blur-md border border-white/20 text-[#FAF8F5] hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold hover:bg-black/55"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                <span>Book Table</span>
              </Link>

              <button
                type="button"
                onClick={() => setSearchOpen((v) => !v)}
                aria-label="Search menu"
                className="h-9 w-9 rounded-full bg-black/35 backdrop-blur-md border border-white/20 flex items-center justify-center hover:bg-black/55"
              >
                <Search className="h-4 w-4" />
              </button>

              {orderType === "dine_in" && tableNumber && (
                <button
                  type="button"
                  onClick={() => setCallModalOpen(true)}
                  aria-label="Call staff"
                  className="relative h-9 px-3.5 rounded-full bg-white/95 text-[var(--qm-accent)] shadow-md flex items-center gap-1.5 text-xs font-bold hover:bg-white transition-colors"
                >
                  <Bell className="h-3.5 w-3.5" />
                  <span>Call staff</span>
                  {latestActiveCall && latestActiveCall.status !== "completed" && (
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                  )}
                </button>
              )}
            </div>
          </div>

          {searchOpen && (
            <div className="mt-3 relative">
              <input
                type="search"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search dishes, ingredients..."
                className="w-full h-10 pl-4 pr-10 rounded-full bg-white text-[var(--qm-accent)] text-sm shadow-md focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--qm-muted)]"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          <div className="mt-8">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/95 text-[var(--qm-accent)] text-xs font-bold shadow-xs">
                {orderType === "takeaway" ? (
                  <>
                    <ShoppingBag className="h-3.5 w-3.5" />
                    <span>Takeaway Counter</span>
                  </>
                ) : orderType === "delivery" ? (
                  <>
                    <Truck className="h-3.5 w-3.5" />
                    <span>Restaurant Delivery</span>
                  </>
                ) : (
                  <span>Table {tableNumber}</span>
                )}
              </div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/35 backdrop-blur-md border border-white/20 text-[11px] font-medium text-[#FAF8F5]">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Kitchen Open · {settings?.opening_time || "09:00"}–{settings?.closing_time || "23:00"}
              </span>
            </div>

            <div className="mt-3.5 flex items-center gap-3.5">
              {settings?.logo_url && (
                <img
                  src={resolveDishImage(settings.logo_url)}
                  onError={handleDishImageError}
                  alt={settings.name}
                  className="h-14 w-14 rounded-2xl object-cover ring-2 ring-white/35 bg-white shadow-md"
                />
              )}
              <div>
                <h1 className="font-display text-3xl sm:text-5xl leading-none tracking-tight">
                  {settings?.name || "Restaurant Menu"}
                </h1>
                {settings?.description && (
                  <p className="text-xs sm:text-sm text-white/85 mt-1.5 max-w-2xl line-clamp-2">
                    {settings.description}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
              <button
                type="button"
                role="switch"
                aria-checked={vegOnly}
                onClick={() => setVegOnly((v) => !v)}
                className={`h-9 px-3.5 rounded-full text-xs font-semibold flex items-center gap-2 flex-shrink-0 border transition-colors ${
                  vegOnly
                    ? "bg-emerald-600 border-emerald-500 text-white shadow-xs"
                    : "bg-black/35 border-white/25 text-white hover:bg-black/55"
                }`}
              >
                <span className="h-3.5 w-3.5 rounded-[3px] border border-current flex items-center justify-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                </span>
                <span>Veg Only</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedCategory("all")}
                className={`h-9 px-4 rounded-full text-xs font-semibold flex-shrink-0 transition-colors ${
                  selectedCategory === "all"
                    ? "bg-white text-[var(--qm-accent)] shadow-sm"
                    : "bg-black/35 border border-white/25 text-white hover:bg-black/55"
                }`}
              >
                All
              </button>

              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`h-9 px-4 rounded-full text-xs font-semibold flex-shrink-0 transition-colors ${
                    selectedCategory === cat.id
                      ? "bg-white text-[var(--qm-accent)] shadow-sm"
                      : "bg-black/35 border border-white/25 text-white hover:bg-black/55"
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Live Orders Banner + Bill CTA */}
      {activeOrders.length > 0 && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-5">
          <div className="rounded-2xl bg-white border border-[var(--qm-line)] p-4 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--qm-muted)]">
                  {orderType === "takeaway"
                    ? "Your Takeaway Orders"
                    : orderType === "delivery"
                      ? "Your Delivery Orders"
                      : `Live Table ${tableNumber} Orders`}
                </p>
                <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live updates
                </span>
              </div>

              <div className="flex items-center gap-2">
                {rateableOrder && ["ready", "completed"].includes(rateableOrder.status) && (
                  <button
                    type="button"
                    onClick={() => setFeedbackOrderId(rateableOrder.id)}
                    className="h-8 px-3 rounded-full border border-[var(--qm-line)] text-xs font-semibold text-[var(--qm-accent)] inline-flex items-center gap-1 hover:border-[var(--qm-accent)]"
                  >
                    <Star className="h-3.5 w-3.5 fill-current" />
                    Rate meal
                  </button>
                )}
                {orderType === "dine_in" && seating && seating.bill.total > 0 && (
                  <button
                    type="button"
                    onClick={() => setBillOpen(true)}
                    style={{
                      backgroundColor: "var(--qm-accent)",
                      color: "var(--qm-accent-ink)",
                    }}
                    className="h-8 px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Receipt className="h-3.5 w-3.5" />
                    Bill &amp; Pay · {formatINR(seating.bill.due > 0 ? seating.bill.due : seating.bill.total)}
                  </button>
                )}
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              {activeOrders.map((order) => {
                const badge = getOrderStatusBadge(order);
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setPlacedOrder(order)}
                    className="w-full text-left flex items-center justify-between gap-3 rounded-xl bg-[var(--qm-bg)] border border-[var(--qm-line)] hover:border-[var(--qm-accent)]/40 px-3.5 py-2.5 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-[var(--qm-accent)]">
                          {order.order_number}
                        </span>
                        {order.pickup_token && (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white border border-[var(--qm-line)] text-[var(--qm-accent)]">
                            {order.pickup_token}
                          </span>
                        )}
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge.tone}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--qm-muted)] truncate mt-0.5">
                        {order.items.map((x) => `${x.quantity}× ${x.name}`).join(", ")} ·{" "}
                        {formatINR(order.total_amount)}
                      </p>
                    </div>
                    {order.status === "pending" ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelOrder(order.id);
                        }}
                        className="text-xs font-semibold text-red-600 hover:underline flex-shrink-0"
                      >
                        Cancel
                      </span>
                    ) : (
                      <span className="text-[11px] text-[var(--qm-muted)] flex-shrink-0">
                        {formatTimeShort(order.created_at)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* While You Wait Lounge: Spin & Win, Loyalty, Guest WiFi */}
      {showWhileYouWait && seating && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-5">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--qm-muted)] mb-2.5">
            While you wait
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {seating.spin_prizes.length > 0 && (
              <button
                type="button"
                onClick={() => setSpinOpen(true)}
                className="text-left rounded-2xl border border-[var(--qm-line)] bg-white hover:border-[var(--qm-accent)] p-4 flex items-center gap-3.5 transition-colors"
              >
                <span className="h-11 w-11 rounded-2xl bg-[var(--qm-tint)] text-[var(--qm-accent)] flex items-center justify-center flex-shrink-0">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-[var(--qm-accent)]">
                    {seating.spin ? `Won: ${seating.spin.label}` : "Spin & win"}
                  </p>
                  <p className="text-xs text-[var(--qm-muted)] truncate">
                    {seating.spin ? "Tap to view table reward" : "One free spin for your table"}
                  </p>
                </div>
              </button>
            )}

            {seating.loyalty && (
              <div className="rounded-2xl border border-[var(--qm-line)] bg-white p-4 space-y-2">
                <div className="flex items-center gap-2.5">
                  <span className="h-9 w-9 rounded-xl bg-[var(--qm-tint)] text-[var(--qm-accent)] flex items-center justify-center flex-shrink-0">
                    <Gift className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-[var(--qm-accent)]">
                      {seating.loyalty.phone_linked
                        ? `${seating.loyalty.points ?? 0} pts`
                        : "Earn loyalty points"}
                    </p>
                    <p className="text-[11px] text-[var(--qm-muted)] truncate">
                      {seating.loyalty.reward} at {seating.loyalty.goal} pts
                    </p>
                  </div>
                </div>
                {seating.loyalty.phone_linked ? (
                  <div className="h-1.5 rounded-full bg-[var(--qm-surface)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        backgroundColor: "var(--qm-accent)",
                        width: `${Math.min(
                          100,
                          ((seating.loyalty.points ?? 0) / Math.max(1, seating.loyalty.goal)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                ) : (
                  <form onSubmit={joinLoyalty} className="flex gap-1.5">
                    <input
                      type="tel"
                      inputMode="tel"
                      value={loyaltyPhone}
                      onChange={(e) => setLoyaltyPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      placeholder="10-digit mobile"
                      className="flex-1 h-8 px-2.5 rounded-lg border border-[var(--qm-line)] bg-[var(--qm-bg)] text-xs"
                    />
                    <button
                      type="submit"
                      disabled={joiningLoyalty || loyaltyPhone.length < 10}
                      style={{
                        backgroundColor: "var(--qm-accent)",
                        color: "var(--qm-accent-ink)",
                      }}
                      className="h-8 px-3 rounded-lg text-xs font-semibold disabled:opacity-40"
                    >
                      Join
                    </button>
                  </form>
                )}
              </div>
            )}

            {seating.wifi && (
              <div className="rounded-2xl border border-[var(--qm-line)] bg-white p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="h-10 w-10 rounded-xl bg-[var(--qm-tint)] text-[var(--qm-accent)] flex items-center justify-center flex-shrink-0">
                    <Wifi className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-[var(--qm-accent)] truncate">
                      {seating.wifi.ssid}
                    </p>
                    <p className="text-xs text-[var(--qm-muted)] truncate">
                      Pass: {seating.wifi.password || "Open"}
                    </p>
                  </div>
                </div>
                {seating.wifi.password && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(seating.wifi!.password);
                      setCopiedWifi(true);
                      setTimeout(() => setCopiedWifi(false), 1800);
                    }}
                    className="h-8 px-2.5 rounded-lg border border-[var(--qm-line)] text-xs font-semibold inline-flex items-center gap-1 flex-shrink-0"
                  >
                    {copiedWifi ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    {copiedWifi ? "Copied" : "Copy"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Menu Grid + Desktop Order Placing Tray */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-6 grid gap-6 lg:grid-cols-[1fr_360px] items-start">
        <main className="space-y-8">
          {filteredCategories.length === 0 ? (
            <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-10 text-center">
              <p className="font-display text-xl">No dishes match your filter</p>
              <button
                type="button"
                onClick={() => {
                  setVegOnly(false);
                  setSelectedCategory("all");
                  setSearchQuery("");
                }}
                className="mt-4 px-5 py-2 rounded-full bg-[var(--qm-tint)] text-[var(--qm-accent)] text-sm font-semibold"
              >
                Reset filters
              </button>
            </div>
          ) : (
            filteredCategories.map(({ category, items: catItems }) => (
              <section key={category.id}>
                <div className="flex items-baseline justify-between mb-3.5">
                  <div>
                    <h2 className="font-display text-2xl leading-tight">{category.name}</h2>
                    <p className="text-xs text-[var(--qm-muted)] mt-0.5">
                      {catItems.length} {catItems.length === 1 ? "dish" : "dishes"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3.5 sm:grid-cols-2">
                  {catItems.map((item) => {
                    const priceRange =
                      item.size_variants.length > 0
                        ? `${formatINR(Math.min(...item.size_variants.map((v) => v.price)))} – ${formatINR(
                            Math.max(...item.size_variants.map((v) => v.price))
                          )}`
                        : formatINR(item.price);
                    const qty = simpleItemQty(item.id);
                    const hasOptions = item.has_size_variants || item.addons.length > 0;

                    return (
                      <article
                        key={item.id}
                        className="rounded-2xl bg-white border border-[var(--qm-line)] p-4 shadow-xs flex justify-between gap-3.5 hover:shadow-md hover:border-[var(--qm-accent)]/30 transition-all"
                      >
                        <button
                          type="button"
                          onClick={() => setOptionItem(item)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <VegBadge isVeg={item.is_veg} />
                            {item.is_bestseller && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--qm-tint)] text-[var(--qm-accent)]">
                                <Sparkles className="h-2.5 w-2.5" />
                                Bestseller
                              </span>
                            )}
                            {item.is_chef_special && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                                Chef&apos;s pick
                              </span>
                            )}
                          </div>

                          <h3 className="font-display text-lg leading-snug mt-1.5 text-[var(--qm-accent)]">
                            {item.name}
                          </h3>

                          <p className="mt-1 flex items-center gap-2.5 text-sm">
                            <span className="font-semibold text-[var(--qm-accent)] tabular-nums">
                              {priceRange}
                            </span>
                            <span className="inline-flex items-center gap-1 text-xs text-[var(--qm-muted)]">
                              <Clock className="h-3 w-3" />
                              {item.prep_minutes} min
                            </span>
                          </p>

                          {item.description && (
                            <p className="mt-1.5 text-xs text-[var(--qm-muted)] leading-relaxed line-clamp-2">
                              {item.description}
                            </p>
                          )}
                        </button>

                        <div className="flex flex-col items-center flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => setOptionItem(item)}
                            className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-[var(--qm-surface)] border border-[var(--qm-line)] shadow-xs group"
                          >
                            <img
                              src={resolveDishImage(item.image_url)}
                              onError={handleDishImageError}
                              alt={item.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          </button>

                          <div className="-mt-4 relative z-10">
                            {qty > 0 && !hasOptions ? (
                              <div
                                style={{
                                  backgroundColor: "var(--qm-accent)",
                                  color: "var(--qm-accent-ink)",
                                }}
                                className="h-8 flex items-center rounded-full shadow-md"
                              >
                                <button
                                  type="button"
                                  onClick={() => changeQty(`${item.id}::`, -1)}
                                  aria-label={`Remove ${item.name}`}
                                  className="px-2.5 h-full"
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                                <span className="px-1 text-xs font-bold tabular-nums">{qty}</span>
                                <button
                                  type="button"
                                  onClick={() => changeQty(`${item.id}::`, 1)}
                                  aria-label={`Add one more ${item.name}`}
                                  className="px-2.5 h-full"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => addSimpleOrOpenModal(item)}
                                aria-label={`Add ${item.name}`}
                                className="h-8 px-4 rounded-full bg-white border border-[var(--qm-line)] text-[var(--qm-accent)] shadow-md hover:border-[var(--qm-accent)] text-xs font-bold uppercase tracking-wider flex items-center gap-1 transition-colors"
                              >
                                <span>ADD</span>
                                {hasOptions ? (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}

          {/* Restaurant Attribution & Links Footer */}
          <footer className="pt-6 border-t border-[var(--qm-line)] flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--qm-muted)]">
            <span>
              {settings?.white_label
                ? `© ${settings?.name}`
                : `${settings?.name || "Restaurant"} · Powered by ${platformName}`}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <Link to={reserveHref} className="font-semibold text-[var(--qm-accent)] hover:underline">
                Reserve a Table
              </Link>
              {hasSocial && socialLinks.google_review && (
                <a
                  href={socialLinks.google_review}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-[var(--qm-accent)] hover:underline"
                >
                  Google Review
                </a>
              )}
              {socialLinks.instagram && (
                <a
                  href={socialLinks.instagram}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[var(--qm-accent)]"
                >
                  Instagram
                </a>
              )}
              {socialLinks.facebook && (
                <a
                  href={socialLinks.facebook}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[var(--qm-accent)]"
                >
                  Facebook
                </a>
              )}
              {socialLinks.website && (
                <a
                  href={socialLinks.website}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[var(--qm-accent)]"
                >
                  Website
                </a>
              )}
            </div>
          </footer>
        </main>

        <aside className="hidden lg:block sticky top-6 rounded-3xl bg-white border border-[var(--qm-line)] p-5 shadow-md">
          {renderCartBody()}
        </aside>
      </div>

      {cartCount > 0 && (
        <div className="lg:hidden fixed bottom-3 inset-x-3 z-40">
          <button
            type="button"
            onClick={() => setMobileCartOpen(true)}
            style={{
              backgroundColor: "var(--qm-accent)",
              color: "var(--qm-accent-ink)",
            }}
            className="w-full h-14 px-5 rounded-2xl shadow-xl flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <ShoppingBag className="h-5 w-5" />
              <div className="text-left">
                <p className="text-sm font-bold tabular-nums">{formatINR(cartPayableTotal)}</p>
                <p className="text-[11px] opacity-80">
                  {cartCount} {cartCount === 1 ? "item" : "items"} · ~{estPrepMinutes} min
                </p>
              </div>
            </div>
            <span className="text-sm font-semibold inline-flex items-center gap-1">
              Review &amp; order <ChevronRight className="h-4 w-4" />
            </span>
          </button>
        </div>
      )}

      {mobileCartOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-end">
          <div className="bg-white w-full rounded-t-3xl border-t border-[var(--qm-line)] p-5 max-h-[88dvh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <span className="h-1 w-10 rounded-full bg-[var(--qm-line)] mx-auto" />
              <button
                type="button"
                onClick={() => setMobileCartOpen(false)}
                aria-label="Close order drawer"
                className="p-1.5 rounded-full hover:bg-[var(--qm-bg)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {renderCartBody()}
          </div>
        </div>
      )}

      {optionItem && (
        <DishOptionModal
          item={optionItem}
          onClose={() => setOptionItem(null)}
          onConfirm={(payload) => addConfiguredLine(optionItem, payload)}
        />
      )}

      {callModalOpen && tableNumber && (
        <CallStaffModal
          tableNumber={tableNumber}
          restaurantSlug={restaurantKey || undefined}
          activeCall={latestActiveCall}
          callsEnabled={settings?.waiter_call_enabled !== false}
          onClose={() => setCallModalOpen(false)}
          onCallCreated={(call) => setCalls((prev) => [call, ...prev])}
        />
      )}

      {billOpen && seating && (
        <BillModal
          tableNumber={tableNumber}
          restaurantSlug={restaurantKey || undefined}
          seating={seating}
          restaurantName={settings?.name || "Restaurant"}
          upiId={settings?.upi_id || ""}
          whiteLabel={settings?.white_label}
          brandAccent={settings?.brand_accent}
          onSeatingUpdated={setSeating}
          onRateOrder={() => rateableOrder && setFeedbackOrderId(rateableOrder.id)}
          onClose={() => setBillOpen(false)}
        />
      )}

      {spinOpen && seating && (
        <SpinWheelModal
          tableNumber={tableNumber}
          restaurantSlug={restaurantKey || undefined}
          prizes={seating.spin_prizes}
          existingSpin={seating.spin}
          onResult={setSeating}
          onClose={() => setSpinOpen(false)}
        />
      )}

      {feedbackOrderId && (
        <FeedbackModal
          orderId={feedbackOrderId}
          tableNumber={tableNumber || rateableOrder?.table_number || "TAKEAWAY"}
          restaurantSlug={restaurantKey || undefined}
          restaurantName={settings?.name || "Restaurant"}
          googleReviewUrl={settings?.social_links?.google_review}
          onClose={() => setFeedbackOrderId(null)}
        />
      )}

      {livePlacedOrder && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[3px] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-[var(--qm-line)] overflow-hidden shadow-2xl max-h-[90dvh] flex flex-col">
            <div
              style={{
                backgroundColor: "var(--qm-accent)",
                color: "var(--qm-accent-ink)",
              }}
              className="px-6 py-5 text-center relative"
            >
              <button
                type="button"
                onClick={() => setPlacedOrder(null)}
                aria-label="Close confirmation"
                className="absolute top-4 right-4 h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="h-12 w-12 mx-auto rounded-2xl bg-white text-[var(--qm-accent)] flex items-center justify-center shadow-sm">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h2 className="font-display text-3xl mt-3">Order placed</h2>
              <p className="text-xs opacity-85 mt-1 font-medium">
                {livePlacedOrder.order_type === "takeaway"
                  ? `Ticket ${livePlacedOrder.order_number} · Pickup Token ${livePlacedOrder.pickup_token || ""}`
                  : livePlacedOrder.order_type === "delivery"
                    ? `Ticket ${livePlacedOrder.order_number} · Restaurant Delivery`
                    : `Ticket ${livePlacedOrder.order_number} · Table ${livePlacedOrder.table_number}`}
              </p>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {livePlacedOrder.status !== "cancelled" &&
                livePlacedOrder.status !== "rejected" &&
                livePlacedOrder.status !== "completed" && (
                  <div className="rounded-2xl bg-[var(--qm-bg)] border border-[var(--qm-line)] p-3.5">
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--qm-muted)] mb-3">
                      <span className="inline-flex items-center gap-1.5 text-[var(--qm-accent)]">
                        <ChefHat className="h-3.5 w-3.5" />
                        {livePlacedOrder.order_type === "delivery"
                          ? "Fulfillment Status"
                          : "Kitchen Status"}
                      </span>
                      <span className="text-emerald-700 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Live
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 text-center">
                      {trackerSteps.map((st, idx) => {
                        const active = placedStepIndex >= idx;
                        const current = placedStepIndex === idx;
                        return (
                          <div key={st.key} className="space-y-1.5">
                            <div
                              style={active ? { backgroundColor: "var(--qm-accent)" } : undefined}
                              className={`h-1.5 rounded-full transition-colors ${
                                active ? "" : "bg-[var(--qm-line)]"
                              } ${current ? "animate-pulse" : ""}`}
                            />
                            <p
                              className={`text-[10px] sm:text-[11px] font-semibold ${
                                active ? "text-[var(--qm-accent)]" : "text-[var(--qm-muted)]"
                              }`}
                            >
                              {st.label}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              <div className="space-y-2">
                {livePlacedOrder.items.map((line, i) => (
                  <div
                    key={`${line.id}-${i}`}
                    className="flex items-center justify-between gap-2.5 text-sm py-1.5 border-b border-[var(--qm-line)]/60 last:border-b-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={resolveDishImage(line.image_url)}
                        onError={handleDishImageError}
                        alt={line.name}
                        className="h-9 w-9 rounded-xl object-cover border border-[var(--qm-line)] flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate text-[var(--qm-accent)]">
                          {line.quantity}× {line.name}
                        </p>
                        {line.selectedSize && (
                          <p className="text-[11px] text-[var(--qm-muted)]">{line.selectedSize}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-xs font-bold tabular-nums text-[var(--qm-accent)]">
                      {formatINR(line.price * line.quantity)}
                    </span>
                  </div>
                ))}
              </div>

              {livePlacedOrder.note && (
                <p className="text-xs rounded-xl bg-[var(--qm-bg)] border border-[var(--qm-line)] px-3 py-2 text-[var(--qm-muted)]">
                  Note: {livePlacedOrder.note}
                </p>
              )}

              {(livePlacedOrder.delivery_fee || 0) > 0 && (
                <div className="flex items-center justify-between text-xs text-[var(--qm-muted)]">
                  <span>Delivery fee</span>
                  <span className="tabular-nums">{formatINR(livePlacedOrder.delivery_fee || 0)}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-[var(--qm-line)] text-sm font-bold text-[var(--qm-accent)]">
                <span>Total Amount</span>
                <span className="tabular-nums">{formatINR(livePlacedOrder.total_amount)}</span>
              </div>
            </div>

            <div className="p-4 border-t border-[var(--qm-line)] bg-[var(--qm-bg)] grid grid-cols-2 gap-2.5">
              {livePlacedOrder.order_type === "dine_in" ? (
                <button
                  type="button"
                  onClick={() => {
                    setPlacedOrder(null);
                    setBillOpen(true);
                  }}
                  className="h-11 rounded-2xl border border-[var(--qm-line)] bg-white hover:border-[var(--qm-accent)] text-[var(--qm-accent)] font-semibold text-xs inline-flex items-center justify-center gap-1.5"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  View Bill &amp; Pay
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const id = livePlacedOrder.id;
                    setPlacedOrder(null);
                    setFeedbackOrderId(id);
                  }}
                  className="h-11 rounded-2xl border border-[var(--qm-line)] bg-white hover:border-[var(--qm-accent)] text-[var(--qm-accent)] font-semibold text-xs inline-flex items-center justify-center gap-1.5"
                >
                  <Star className="h-3.5 w-3.5" />
                  Rate Order
                </button>
              )}
              <button
                type="button"
                onClick={() => setPlacedOrder(null)}
                style={{
                  backgroundColor: "var(--qm-accent)",
                  color: "var(--qm-accent-ink)",
                }}
                className="h-11 rounded-2xl font-semibold text-xs transition-opacity hover:opacity-95"
              >
                Continue browsing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
