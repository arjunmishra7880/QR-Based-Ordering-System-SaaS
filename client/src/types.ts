export interface SizeVariant {
  name: string;
  price: number;
}

export interface AddonOption {
  name: string;
  price: number;
}

export interface TableConfig {
  total: number;
  skip: number[];
  disabled: number[];
}

export interface LoyaltyConfig {
  enabled: boolean;
  rupees_per_point: number;
  goal: number;
  reward: string;
  phone_linked?: boolean;
  points?: number | null;
}

export type SpinPrizeKind = "pct" | "flat" | "item" | "none";

export interface SpinPrize {
  label: string;
  kind: SpinPrizeKind;
  value?: number;
  index?: number;
}

export interface SocialLinks {
  instagram?: string;
  facebook?: string;
  website?: string;
  google_review?: string;
}

export interface QrStyleConfig {
  style: "standard" | "circle" | "square" | "rounded" | "dots" | "elegant";
  fgColor: string;
  bgColor: string;
  dotScale: number;
  frameStyle: "none" | "simple" | "rounded" | "fancy";
}

export interface RestaurantSettings {
  id: string;
  slug: string;
  name: string;
  description: string;
  logo_url: string | null;
  cover_url: string | null;
  orders_enabled: boolean;
  waiter_call_enabled: boolean;
  qr_mode: "single" | "per_table";
  table_config: TableConfig;
  qr_style?: QrStyleConfig;
  menu_views: number;
  upi_id: string;
  gst_rate: number;
  service_charge_pct: number;
  require_table_pin: boolean;
  loyalty: LoyaltyConfig;
  spin_prizes: SpinPrize[];
  social_links: SocialLinks;
  wifi_ssid?: string;
  wifi_password?: string;
  has_wifi?: boolean;
  plan?: "Starter" | "Pro" | "Enterprise";
  plan_status?: "trial" | "active" | "past_due" | "paused";
  plan_expires_at?: string;
  is_active?: boolean;
  white_label?: boolean;
  brand_bg?: string;
  brand_accent?: string;
  brand_secondary?: string;
  primary_color?: string;
  secondary_color?: string;
  custom_domain?: string;
  custom_domain_verified?: boolean;
  opening_time?: string;
  closing_time?: string;
  takeaway_enabled?: boolean;
  delivery_enabled?: boolean;
  delivery_fee?: number;
  free_delivery_min?: number;
  updated_at: string;
}

export interface PlatformBrandConfig {
  platform_name: string;
  agency_name: string;
  agency_tagline: string;
  support_email: string;
  default_brand_bg: string;
  default_brand_accent: string;
  default_brand_secondary?: string;
  updated_at?: string;
}

export interface Category {
  id: string;
  name: string;
  station: string;
  display_order: number;
  created_at: string;
}

export interface MenuItem {
  id: string;
  category_id: string | null;
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  is_veg: number;
  is_bestseller: boolean;
  is_chef_special: boolean;
  is_available: boolean;
  prep_minutes: number;
  has_size_variants: boolean;
  size_variants: SizeVariant[];
  addons: AddonOption[];
  created_at: string;
}

export interface OrderLineItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  selectedSize: string | null;
  addons: AddonOption[];
  note: string | null;
  station: string;
  prep_minutes: number;
  image_url: string | null;
}

export type OrderStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled"
  | "rejected";

export type OrderType = "dine_in" | "takeaway" | "delivery";

export type DeliveryStatus = "pending" | "preparing" | "out_for_delivery" | "delivered";

export interface Order {
  id: string;
  order_number: string;
  seq_num: number;
  order_type?: OrderType;
  table_number: string;
  pickup_token?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  delivery_landmark?: string | null;
  delivery_fee?: number;
  delivery_status?: DeliveryStatus | null;
  created_by_staff_id?: string | null;
  created_by_staff_name?: string | null;
  client_session_id: string;
  seating_id?: string | null;
  items: OrderLineItem[];
  note: string | null;
  total_amount: number;
  status: OrderStatus;
  timeline: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export type ReservationStatus = "pending" | "confirmed" | "seated" | "rejected" | "cancelled";

export interface ReservationRecord {
  id: string;
  restaurant_id: string;
  booking_code: string;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  reservation_date: string;
  reservation_time: string;
  status: ReservationStatus;
  assigned_table: string | null;
  notes: string;
  admin_note: string;
  created_at: string;
  updated_at: string;
}

export type CallType = "water" | "bill" | "waiter" | "help" | "clean";
export type CallStatus = "pending" | "acknowledged" | "completed";

export interface ServiceCall {
  id: string;
  table_number: string;
  call_type: CallType;
  status: CallStatus;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface BillSummary {
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
}

export type PaymentMode = "upi" | "card" | "cash";
export type SplitType = "full" | "equal" | "items" | "custom";

export interface PaymentRecord {
  id: string;
  seating_id: string;
  table_number: string;
  payer: string;
  amount: number;
  tip: number;
  mode: PaymentMode;
  split_type: SplitType;
  status: "pending" | "confirmed" | "rejected";
  handled_by: string | null;
  created_at: string;
  settled_at: string | null;
}

export interface DiscountInfo {
  code: string;
  kind: "pct" | "flat";
  value: number;
  min_bill: number;
  label: string;
}

export interface SeatingView {
  id: string;
  table: string;
  table_number: string;
  bill_table: string;
  status: "open" | "closed";
  opened_by: string | null;
  opened_at: string;
  closed_at: string | null;
  table_pin?: string | null;
  guest_phone: string | null;
  loyalty_points: number;
  discount: DiscountInfo | null;
  spin: SpinPrize | null;
  spin_prizes: SpinPrize[];
  loyalty: LoyaltyConfig | null;
  wifi: { ssid: string; password: string } | null;
  orders: Order[];
  payments: PaymentRecord[];
  bill: BillSummary;
}

export interface FloorTable {
  number: string;
  status: "free" | "open" | "bill" | "cleaning";
  section: string;
  activated_by: string | null;
  mergedInto: string | null;
  calls: number;
  pendingPay: number;
  seating: SeatingView | null;
}

export interface FloorState {
  config: {
    numbers: string[];
    require_pin: boolean;
    loyalty: LoyaltyConfig;
  };
  tables: FloorTable[];
  calls: ServiceCall[];
  pendingPayments: PaymentRecord[];
}

export interface Coupon {
  id: string;
  code: string;
  kind: "pct" | "flat";
  value: number;
  min_bill: number;
  active: boolean;
  created_at: string;
}

export type StaffRole = "waiter" | "kitchen" | "cashier" | "manager";

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  pin?: string | null;
  section: string;
  active: boolean;
  created_at: string;
}

export interface ActivityLogItem {
  id: string;
  staff_name: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface FeedbackItem {
  id: string;
  order_id: string;
  order_number: string | null;
  table_number: string;
  rating: number;
  comment: string;
  created_at: string;
}

export interface ReportsData {
  period: "today" | "7d" | "30d";
  sales: number;
  tips: number;
  orders: number;
  voided: number;
  bills: number;
  avgBill: number;
  kitchenMinutes: number | null;
  peakHour: number | null;
  hours: Array<{ hour: number; orders: number; sales: number }>;
  items: Array<{ name: string; qty: number; revenue: number }>;
  payModes: Array<{ mode: PaymentMode; amount: number }>;
  tables: Array<{ table: string; sales: number; orders: number }>;
  feedback: {
    totalReviews: number;
    avgRating: number;
    ratingCounts: Record<number, number>;
    reviews: FeedbackItem[];
  };
}

export type UserRole = "super_admin" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  restaurant_id: string | null;
  active_restaurant_id: string | null;
}

export interface AuthRestaurantOption {
  id: string;
  slug: string;
  name: string;
  plan: "Starter" | "Pro" | "Enterprise";
  is_active: boolean;
}

export interface PublicVenueSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  logo_url: string | null;
  cover_url: string | null;
  qr_mode: "single" | "per_table";
  table_count: number;
  takeaway_enabled?: boolean;
  delivery_enabled?: boolean;
  opening_time?: string;
  closing_time?: string;
  white_label?: boolean;
  brand_bg?: string;
  brand_accent?: string;
  brand_secondary?: string;
  primary_color?: string;
  secondary_color?: string;
}

export interface SuperVenueSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  logo_url: string | null;
  cover_url: string | null;
  plan?: "Starter" | "Pro" | "Enterprise";
  plan_status?: "trial" | "active" | "past_due" | "paused";
  plan_expires_at?: string;
  is_active?: boolean;
  white_label?: boolean;
  brand_bg?: string;
  brand_accent?: string;
  brand_secondary?: string;
  primary_color?: string;
  secondary_color?: string;
  custom_domain?: string;
  custom_domain_verified?: boolean;
  gst_rate: number;
  takeaway_enabled?: boolean;
  delivery_enabled?: boolean;
  tables_total: number;
  created_at?: string;
  updated_at: string;
  metrics: {
    tablesCount: number;
    activeTables: number;
    todayOrders: number;
    totalOrders: number;
    activeOrders: number;
    todayRevenue: number;
    totalRevenue: number;
    menuCount: number;
    staffCount: number;
    totalReviews: number;
    avgRating: number;
  };
}

export interface PlatformActivityItem {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  staff_name: string;
  action: string;
  created_at: string;
}

export interface PlatformOverviewResponse {
  platform?: PlatformBrandConfig;
  stats: {
    totalVenues: number;
    activeVenues: number;
    pausedVenues: number;
    totalTables: number;
    activeTables: number;
    todayOrders: number;
    totalOrders: number;
    activeOrders?: number;
    todayRevenue: number;
    totalRevenue: number;
    activeAdmins: number;
  };
  venues: SuperVenueSummary[];
  recentActivity: PlatformActivityItem[];
  monthlyStats?: Array<{
    month: string;
    label: string;
    orders: number;
    revenue: number;
  }>;
  orderTypeBreakdown?: Array<{
    type: "dine_in" | "takeaway" | "delivery";
    label: string;
    count: number;
    pct: number;
  }>;
}

export interface DashboardOverview {
  stats: {
    todayRevenue: number;
    todayOrders: number;
    yesterdayRevenue: number;
    yesterdayOrders: number;
    activeOrders: number;
    menuViews: number;
    avgOrderValue: number;
    pendingCalls: number;
    totalMenuItems: number;
    totalOrders: number;
    avgRating: number;
    totalFeedback: number;
  };
  recentOrders: Order[];
  topItems: Array<{ name: string; count: number }>;
}
