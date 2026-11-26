import React, { useCallback, useEffect, useState } from "react";
import { Gift, Plus, RotateCcw, Save, Share2, ShieldCheck, Trash2, Upload, Wifi } from "lucide-react";
import { useToast } from "../Toast";
import { apiJson, apiUploadImage, formatINR } from "../../lib/api";
import {
  DEFAULT_COVER_IMAGE,
  handleCoverImageError,
  handleDishImageError,
  resolveCoverImage,
  resolveDishImage,
} from "../../lib/dishMedia";
import type { Coupon, RestaurantSettings, SpinPrizeKind } from "../../types";

interface SettingsTabProps {
  section?: "profile" | "setup" | "social";
  onChangeSection: (section: "profile" | "setup" | "social") => void;
  settings: RestaurantSettings;
  onSettingsUpdated: (s: RestaurantSettings) => void;
}

const GST_PRESETS = [0, 5, 12, 18];
const PRIZE_KINDS: Array<{ v: SpinPrizeKind; l: string }> = [
  { v: "pct", l: "% off" },
  { v: "flat", l: "₹ off" },
  { v: "item", l: "Free item" },
  { v: "none", l: "No prize" },
];

export function SettingsTab({
  section = "profile",
  onChangeSection,
  settings,
  onSettingsUpdated,
}: SettingsTabProps) {
  const { toast } = useToast();

  // Restaurant section state
  const [name, setName] = useState(settings.name);
  const [description, setDescription] = useState(settings.description);
  const [logoUrl, setLogoUrl] = useState(settings.logo_url || "");
  const [coverUrl, setCoverUrl] = useState(settings.cover_url || "");
  const [upiId, setUpiId] = useState(settings.upi_id || "");
  const [ordersEnabled, setOrdersEnabled] = useState(settings.orders_enabled);
  const [callsEnabled, setCallsEnabled] = useState(settings.waiter_call_enabled);
  const [requireTablePin, setRequireTablePin] = useState(settings.require_table_pin);
  const [whiteLabel, setWhiteLabel] = useState(Boolean(settings.white_label));
  const [brandBg, setBrandBg] = useState(settings.brand_bg || "#FAF8F5");
  const [brandAccent, setBrandAccent] = useState(
    settings.primary_color || settings.brand_accent || "#49332A"
  );
  const [brandSecondary, setBrandSecondary] = useState(
    settings.secondary_color || settings.brand_secondary || "#766158"
  );
  const [customDomain, setCustomDomain] = useState(settings.custom_domain || "");
  const [openingTime, setOpeningTime] = useState(settings.opening_time || "09:00");
  const [closingTime, setClosingTime] = useState(settings.closing_time || "23:00");
  const [takeawayEnabled, setTakeawayEnabled] = useState(settings.takeaway_enabled !== false);
  const [deliveryEnabled, setDeliveryEnabled] = useState(Boolean(settings.delivery_enabled));
  const [deliveryFee, setDeliveryFee] = useState(String(settings.delivery_fee ?? 40));
  const [freeDeliveryMin, setFreeDeliveryMin] = useState(String(settings.free_delivery_min ?? 500));
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Bills & extras state
  const [gstRate, setGstRate] = useState(settings.gst_rate ?? 5);
  const [servicePct, setServicePct] = useState(settings.service_charge_pct ?? 0);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [newCoupon, setNewCoupon] = useState({ code: "", kind: "pct" as "pct" | "flat", value: "", min_bill: "" });
  const [loyalty, setLoyalty] = useState(settings.loyalty);
  const [spinPrizes, setSpinPrizes] = useState(settings.spin_prizes || []);
  const [wifiSsid, setWifiSsid] = useState(settings.wifi_ssid || "");
  const [wifiPass, setWifiPass] = useState(settings.wifi_password || "");

  // Social links state
  const [social, setSocial] = useState(settings.social_links || {});

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const loadCoupons = useCallback(async () => {
    try {
      const res = await apiJson<{ coupons: Coupon[] }>("/api/admin/coupons");
      setCoupons(res.coupons);
    } catch {}
  }, []);

  useEffect(() => {
    if (section === "setup") loadCoupons();
  }, [section, loadCoupons]);

  const patchSettings = async (key: string, payload: Record<string, unknown>, successMsg: string) => {
    setSavingKey(key);
    try {
      const res = await apiJson<{ settings: RestaurantSettings }>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      onSettingsUpdated(res.settings);
      toast({ title: successMsg, variant: "success" });
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSavingKey(null);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: "logo" | "cover") => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await apiUploadImage(file);
      if (target === "logo") setLogoUrl(res.url);
      else setCoverUrl(res.url);
      toast({ title: "Image uploaded", variant: "success" });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const addCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKey("coupon");
    try {
      await apiJson("/api/admin/coupons", {
        method: "POST",
        body: JSON.stringify({
          code: newCoupon.code,
          kind: newCoupon.kind,
          value: Number(newCoupon.value),
          min_bill: Number(newCoupon.min_bill || 0),
        }),
      });
      setNewCoupon({ code: "", kind: "pct", value: "", min_bill: "" });
      await loadCoupons();
      toast({ title: "Discount code added", variant: "success" });
    } catch (err) {
      toast({
        title: "Check coupon details",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSavingKey(null);
    }
  };

  const toggleCoupon = async (cp: Coupon) => {
    await apiJson(`/api/admin/coupons/${cp.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !cp.active }),
    });
    await loadCoupons();
  };

  const deleteCoupon = async (cp: Coupon) => {
    await apiJson(`/api/admin/coupons/${cp.id}`, { method: "DELETE" });
    await loadCoupons();
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    setSavingKey("password");
    try {
      await apiJson("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      toast({ title: "Password updated", variant: "success" });
    } catch (err) {
      toast({
        title: "Could not change password",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSavingKey(null);
    }
  };

  const sampleSvc = Math.round(1000 * (servicePct / 100));
  const sampleGst = Math.round((1000 + sampleSvc) * (gstRate / 100));
  const sampleTotal = 1000 + sampleSvc + sampleGst;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Sub-navigation */}
      <nav className="flex gap-2 overflow-x-auto no-scrollbar">
        {(
          [
            { id: "profile", label: "Restaurant" },
            { id: "setup", label: "Bills & extras" },
            { id: "social", label: "Social links" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChangeSection(tab.id)}
            className={`h-9 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
              section === tab.id
                ? "bg-[#49332A] text-[#FAF8F5]"
                : "bg-[var(--qm-tint)] text-[#49332A] hover:bg-[#E4DDD5]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {section === "profile" && (
        <div className="space-y-6">
          <div>
            <h2 className="font-display text-3xl">Restaurant Settings</h2>
            <p className="text-sm text-[var(--qm-muted)]">
              Branding, UPI payment link, table controls &amp; owner password
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              patchSettings(
                "profile",
                {
                  name: name.trim(),
                  description: description.trim(),
                  logo_url: logoUrl.trim() || null,
                  cover_url: coverUrl.trim() || null,
                  upi_id: upiId.trim(),
                  orders_enabled: ordersEnabled,
                  waiter_call_enabled: callsEnabled,
                  require_table_pin: requireTablePin,
                  white_label: whiteLabel,
                  brand_bg: brandBg,
                  brand_accent: brandAccent,
                  brand_secondary: brandSecondary,
                  primary_color: brandAccent,
                  secondary_color: brandSecondary,
                  custom_domain: customDomain.trim(),
                  opening_time: openingTime,
                  closing_time: closingTime,
                  takeaway_enabled: takeawayEnabled,
                  delivery_enabled: deliveryEnabled,
                  delivery_fee: Math.max(0, Number(deliveryFee) || 0),
                  free_delivery_min: Math.max(0, Number(freeDeliveryMin) || 0),
                },
                "Restaurant settings saved!"
              );
            }}
            className="rounded-3xl bg-white border border-[var(--qm-line)] p-6 shadow-xs space-y-5"
          >
            <div className="rounded-2xl overflow-hidden border border-[var(--qm-line)] bg-[var(--qm-bg)]">
              <div className="relative h-32 w-full">
                <img
                  src={resolveCoverImage(coverUrl)}
                  onError={handleCoverImageError}
                  alt="Restaurant cover preview"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#2a1b15]/90 via-[#49332A]/45 to-black/20 flex items-end p-3.5 gap-3">
                  <img
                    src={resolveDishImage(logoUrl)}
                    onError={handleDishImageError}
                    alt="Logo preview"
                    className="h-10 w-10 rounded-xl object-cover bg-white ring-2 ring-white/30"
                  />
                  <div className="text-[#FAF8F5] min-w-0">
                    <p className="font-display text-lg leading-tight truncate">
                      {name || "Restaurant"}
                    </p>
                    <p className="text-[11px] text-white/80 truncate">Live guest hero preview</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                  Logo URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    className="flex-1 h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs"
                  />
                  <label className="h-9 px-3 rounded-xl border border-[var(--qm-line)] bg-[var(--qm-surface)] inline-flex items-center cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    <input type="file" accept="image/*" onChange={(e) => handleUpload(e, "logo")} className="hidden" />
                  </label>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-[var(--qm-muted)]">Cover Banner</label>
                  {coverUrl !== DEFAULT_COVER_IMAGE && (
                    <button
                      type="button"
                      onClick={() => setCoverUrl(DEFAULT_COVER_IMAGE)}
                      className="text-[11px] font-semibold text-[#49332A] hover:underline inline-flex items-center gap-1"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      Default restaurant banner
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={coverUrl}
                    onChange={(e) => setCoverUrl(e.target.value)}
                    className="flex-1 h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs"
                  />
                  <label className="h-9 px-3 rounded-xl border border-[var(--qm-line)] bg-[var(--qm-surface)] inline-flex items-center cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    <input type="file" accept="image/*" onChange={(e) => handleUpload(e, "cover")} className="hidden" />
                  </label>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Restaurant Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-10 px-3.5 rounded-xl border border-[var(--qm-line)] text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Description / Tagline</label>
              <textarea
                rows={2}
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full p-3.5 rounded-xl border border-[var(--qm-line)] text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">UPI ID for bill payment</label>
              <input
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="yourrestaurant@okaxis"
                className="w-full h-10 px-3.5 rounded-xl border border-[var(--qm-line)] text-sm"
              />
              <p className="text-xs text-[var(--qm-muted)] mt-1">
                Customers see a &ldquo;Pay with UPI&rdquo; button &amp; scannable UPI QR on their bill. Leave blank to hide UPI.
              </p>
            </div>

            <div className="space-y-3 pt-2 border-t border-[var(--qm-line)]">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-semibold">Online Ordering</p>
                  <p className="text-xs text-[var(--qm-muted)]">Allow guests to submit orders from their phone</p>
                </div>
                <input
                  type="checkbox"
                  checked={ordersEnabled}
                  onChange={(e) => setOrdersEnabled(e.target.checked)}
                  className="h-4 w-4 accent-[#49332A]"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-semibold">Waiter / Service Call Bell</p>
                  <p className="text-xs text-[var(--qm-muted)]">Allow guests to call staff for water, bill, or cleanup</p>
                </div>
                <input
                  type="checkbox"
                  checked={callsEnabled}
                  onChange={(e) => setCallsEnabled(e.target.checked)}
                  className="h-4 w-4 accent-[#49332A]"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-[#49332A]" />
                    Require 4-digit Table PIN
                  </p>
                  <p className="text-xs text-[var(--qm-muted)]">
                    When enabled, staff seat guests on Floor first and guests enter the 4-digit table PIN
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={requireTablePin}
                  onChange={(e) => setRequireTablePin(e.target.checked)}
                  className="h-4 w-4 accent-[#49332A]"
                />
              </label>

              <div className="pt-3 border-t border-[var(--qm-line)] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[#49332A]">White-Label Branding</p>
                    <p className="text-xs text-[var(--qm-muted)]">
                      Customize guest menu colors and hide platform attribution
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setBrandBg("#FAF8F5");
                      setBrandAccent("#49332A");
                    }}
                    className="text-[11px] font-semibold text-[#49332A] hover:underline"
                  >
                    Reset #FAF8F5 / #49332A
                  </button>
                </div>

                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <p className="text-xs font-semibold text-[#49332A]">
                      Hide &ldquo;Powered by BROTOCOL ServeOS&rdquo; on guest menu
                    </p>
                    <p className="text-[11px] text-[var(--qm-muted)]">
                      Display only your restaurant&apos;s brand identity to diners
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={whiteLabel}
                    onChange={(e) => setWhiteLabel(e.target.checked)}
                    className="h-4 w-4 accent-[#49332A]"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                      Background Color
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brandBg}
                        onChange={(e) => setBrandBg(e.target.value.toUpperCase())}
                        className="h-9 w-10 rounded-lg border border-[var(--qm-line)] cursor-pointer bg-white p-0.5"
                      />
                      <input
                        type="text"
                        value={brandBg}
                        onChange={(e) => setBrandBg(e.target.value.toUpperCase())}
                        className="flex-1 h-9 px-2.5 rounded-xl border border-[var(--qm-line)] text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                      Primary Color
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brandAccent}
                        onChange={(e) => setBrandAccent(e.target.value.toUpperCase())}
                        className="h-9 w-10 rounded-lg border border-[var(--qm-line)] cursor-pointer bg-white p-0.5"
                      />
                      <input
                        type="text"
                        value={brandAccent}
                        onChange={(e) => setBrandAccent(e.target.value.toUpperCase())}
                        className="flex-1 h-9 px-2.5 rounded-xl border border-[var(--qm-line)] text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                      Secondary Color
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brandSecondary}
                        onChange={(e) => setBrandSecondary(e.target.value.toUpperCase())}
                        className="h-9 w-10 rounded-lg border border-[var(--qm-line)] cursor-pointer bg-white p-0.5"
                      />
                      <input
                        type="text"
                        value={brandSecondary}
                        onChange={(e) => setBrandSecondary(e.target.value.toUpperCase())}
                        className="flex-1 h-9 px-2.5 rounded-xl border border-[var(--qm-line)] text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-[var(--qm-muted)]">
                        Custom Domain
                      </label>
                      {settings.custom_domain && (
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            settings.custom_domain_verified
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-900"
                          }`}
                        >
                          {settings.custom_domain_verified ? "Verified" : "Pending Verification"}
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={customDomain}
                      onChange={(e) => setCustomDomain(e.target.value)}
                      placeholder="menu.yourrestaurant.com"
                      className="w-full h-9 px-2.5 rounded-xl border border-[var(--qm-line)] text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Operating Hours & Ordering Channels */}
              <div className="pt-3 border-t border-[var(--qm-line)] space-y-3">
                <div>
                  <p className="text-sm font-semibold text-[#49332A]">
                    Hours &amp; Ordering Channels
                  </p>
                  <p className="text-xs text-[var(--qm-muted)]">
                    Configure operating hours for reservations plus Takeaway &amp; direct Delivery
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                      Opening Time
                    </label>
                    <input
                      type="time"
                      value={openingTime}
                      onChange={(e) => setOpeningTime(e.target.value)}
                      className="w-full h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                      Closing Time
                    </label>
                    <input
                      type="time"
                      value={closingTime}
                      onChange={(e) => setClosingTime(e.target.value)}
                      className="w-full h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center justify-between rounded-2xl border border-[var(--qm-line)] px-3.5 py-2.5 cursor-pointer">
                    <span className="text-xs font-semibold text-[#49332A]">Enable Takeaway Ordering</span>
                    <input
                      type="checkbox"
                      checked={takeawayEnabled}
                      onChange={(e) => setTakeawayEnabled(e.target.checked)}
                      className="h-4 w-4 accent-[#49332A]"
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-2xl border border-[var(--qm-line)] px-3.5 py-2.5 cursor-pointer">
                    <span className="text-xs font-semibold text-[#49332A]">Enable Self Delivery</span>
                    <input
                      type="checkbox"
                      checked={deliveryEnabled}
                      onChange={(e) => setDeliveryEnabled(e.target.checked)}
                      className="h-4 w-4 accent-[#49332A]"
                    />
                  </label>
                </div>

                {deliveryEnabled && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                        Delivery Fee (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={deliveryFee}
                        onChange={(e) => setDeliveryFee(e.target.value)}
                        className="w-full h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                        Free Delivery Above (₹, 0 = none)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={freeDeliveryMin}
                        onChange={(e) => setFreeDeliveryMin(e.target.value)}
                        className="w-full h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={savingKey === "profile"}
              className="h-10 px-5 rounded-xl bg-[#49332A] hover:bg-[#38261F] text-[#FAF8F5] text-sm font-semibold inline-flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              {savingKey === "profile" ? "Saving..." : "Save Changes"}
            </button>
          </form>

          <form
            onSubmit={changePassword}
            className="rounded-3xl bg-white border border-[var(--qm-line)] p-6 shadow-xs space-y-4"
          >
            <h3 className="font-display text-xl">Change Owner Password</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                className="h-10 px-3.5 rounded-xl border border-[var(--qm-line)] text-sm"
              />
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (8+ chars)"
                className="h-10 px-3.5 rounded-xl border border-[var(--qm-line)] text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={savingKey === "password"}
              className="h-10 px-5 rounded-xl bg-[#49332A] text-[#FAF8F5] text-sm font-semibold"
            >
              {savingKey === "password" ? "Updating..." : "Update Password"}
            </button>
          </form>
        </div>
      )}

      {section === "setup" && (
        <div className="space-y-6">
          <div>
            <h2 className="font-display text-3xl">Service Setup &amp; Extras</h2>
            <p className="text-sm text-[var(--qm-muted)]">
              Tax, service charge, discount codes, loyalty rewards, Spin &amp; Win &amp; guest WiFi
            </p>
          </div>

          {/* Tax & Service Charge */}
          <section className="rounded-3xl bg-white border border-[var(--qm-line)] p-6 space-y-4">
            <div>
              <h3 className="font-display text-xl">Tax and service charge</h3>
              <p className="text-xs text-[var(--qm-muted)] mt-0.5">
                A ₹1,000 order comes to {formatINR(sampleTotal)} with these settings.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold mb-1.5">GST</p>
                <div className="flex gap-1.5">
                  {GST_PRESETS.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setGstRate(rate)}
                      className={`flex-1 h-10 rounded-xl border text-xs font-semibold ${
                        gstRate === rate
                          ? "bg-[#49332A] text-[#FAF8F5] border-[#49332A]"
                          : "border-[var(--qm-line)] hover:bg-[var(--qm-surface)]"
                      }`}
                    >
                      {rate}%
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">Service charge (%)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={servicePct}
                  onChange={(e) =>
                    setServicePct(Math.min(20, Number(e.target.value.replace(/[^0-9.]/g, "")) || 0))
                  }
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={savingKey === "tax"}
              onClick={() =>
                patchSettings(
                  "tax",
                  { gst_rate: gstRate, service_charge_pct: servicePct },
                  "Tax settings saved"
                )
              }
              className="h-10 px-5 rounded-xl border border-[#49332A] text-[#49332A] hover:bg-[#FAF8F5] text-sm font-semibold"
            >
              {savingKey === "tax" ? "Saving..." : "Save tax"}
            </button>
          </section>

          {/* Discount Codes */}
          <section className="rounded-3xl bg-white border border-[var(--qm-line)] p-6 space-y-4">
            <div>
              <h3 className="font-display text-xl">Discount codes</h3>
              <p className="text-xs text-[var(--qm-muted)] mt-0.5">
                Guests apply these on the bill before payment. One discount per bill.
              </p>
            </div>

            {coupons.length > 0 && (
              <ul className="rounded-2xl border border-[var(--qm-line)] divide-y divide-[var(--qm-line)] text-sm">
                {coupons.map((cp) => (
                  <li
                    key={cp.id}
                    className={`p-3 flex items-center justify-between gap-3 ${!cp.active ? "opacity-55" : ""}`}
                  >
                    <span>
                      <strong className="font-mono">{cp.code}</strong> ·{" "}
                      {cp.kind === "pct" ? `${cp.value}% off` : `${formatINR(cp.value)} off`}
                      {cp.min_bill > 0 && ` on bills over ${formatINR(cp.min_bill)}`}
                    </span>
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={cp.active}
                        onChange={() => toggleCoupon(cp)}
                        aria-label={`${cp.code} active`}
                        className="h-4 w-4 accent-[#49332A]"
                      />
                      <button
                        type="button"
                        onClick={() => deleteCoupon(cp)}
                        aria-label={`Delete ${cp.code}`}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={addCoupon} className="grid grid-cols-2 sm:grid-cols-[1.2fr_auto_0.7fr_0.7fr_auto] gap-2 items-end">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[11px] font-semibold mb-1">Code</label>
                <input
                  type="text"
                  required
                  value={newCoupon.code}
                  onChange={(e) =>
                    setNewCoupon({ ...newCoupon, code: e.target.value.toUpperCase().slice(0, 16) })
                  }
                  placeholder="FLAT10"
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm uppercase font-mono"
                />
              </div>
              <div className="flex h-10 rounded-xl border border-[var(--qm-line)] overflow-hidden">
                {(["pct", "flat"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setNewCoupon({ ...newCoupon, kind: k })}
                    className={`px-3 text-xs font-bold ${
                      newCoupon.kind === k ? "bg-[#49332A] text-[#FAF8F5]" : "bg-white"
                    }`}
                  >
                    {k === "pct" ? "%" : "₹"}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Value</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={newCoupon.value}
                  onChange={(e) => setNewCoupon({ ...newCoupon, value: e.target.value })}
                  placeholder="10"
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Min bill ₹</label>
                <input
                  type="number"
                  min="0"
                  value={newCoupon.min_bill}
                  onChange={(e) => setNewCoupon({ ...newCoupon, min_bill: e.target.value })}
                  placeholder="0"
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={savingKey === "coupon"}
                className="h-10 px-4 rounded-xl bg-[#49332A] text-[#FAF8F5] text-xs font-semibold inline-flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </form>
          </section>

          {/* Loyalty Points */}
          <section className="rounded-3xl bg-white border border-[var(--qm-line)] p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-xl flex items-center gap-2">
                  <Gift className="h-5 w-5 text-[#49332A]" />
                  Loyalty points
                </h3>
                <p className="text-xs text-[var(--qm-muted)] mt-0.5">
                  Guests link their mobile number and earn points automatically when their bill is paid.
                </p>
              </div>
              <input
                type="checkbox"
                checked={loyalty.enabled}
                onChange={(e) => setLoyalty({ ...loyalty, enabled: e.target.checked })}
                className="h-5 w-5 accent-[#49332A]"
              />
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">₹ per point</label>
                <input
                  type="number"
                  min="1"
                  value={loyalty.rupees_per_point}
                  onChange={(e) =>
                    setLoyalty({ ...loyalty, rupees_per_point: Math.max(1, Number(e.target.value) || 1) })
                  }
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Points for reward</label>
                <input
                  type="number"
                  min="1"
                  value={loyalty.goal}
                  onChange={(e) =>
                    setLoyalty({ ...loyalty, goal: Math.max(1, Number(e.target.value) || 1) })
                  }
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Reward</label>
                <input
                  type="text"
                  maxLength={40}
                  value={loyalty.reward}
                  onChange={(e) => setLoyalty({ ...loyalty, reward: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
            </div>

            <p className="text-xs text-[var(--qm-muted)]">
              Guests spend ~{formatINR(loyalty.goal * loyalty.rupees_per_point)} to earn &ldquo;
              {loyalty.reward}&rdquo;.
            </p>

            <button
              type="button"
              disabled={savingKey === "loyalty"}
              onClick={() => patchSettings("loyalty", { loyalty }, "Loyalty programme saved")}
              className="h-10 px-5 rounded-xl border border-[#49332A] text-[#49332A] hover:bg-[#FAF8F5] text-sm font-semibold"
            >
              {savingKey === "loyalty" ? "Saving..." : "Save loyalty"}
            </button>
          </section>

          {/* Spin & Win */}
          <section className="rounded-3xl bg-white border border-[var(--qm-line)] p-6 space-y-4">
            <div>
              <h3 className="font-display text-xl">Spin &amp; Win</h3>
              <p className="text-xs text-[var(--qm-muted)] mt-0.5">
                One spin per table after their first order. Leave empty to disable.
              </p>
            </div>

            <div className="space-y-2">
              {spinPrizes.map((p, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_auto_5rem_auto] gap-2 items-center">
                  <input
                    type="text"
                    maxLength={24}
                    value={p.label}
                    onChange={(e) =>
                      setSpinPrizes(
                        spinPrizes.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x))
                      )
                    }
                    placeholder="Prize label"
                    className="h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                  />
                  <select
                    value={p.kind}
                    onChange={(e) =>
                      setSpinPrizes(
                        spinPrizes.map((x, i) =>
                          i === idx ? { ...x, kind: e.target.value as SpinPrizeKind } : x
                        )
                      )
                    }
                    className="h-10 px-2.5 rounded-xl border border-[var(--qm-line)] bg-white text-xs font-medium"
                  >
                    {PRIZE_KINDS.map((k) => (
                      <option key={k.v} value={k.v}>
                        {k.l}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    disabled={p.kind === "item" || p.kind === "none"}
                    value={p.kind === "item" || p.kind === "none" ? "" : p.value ?? ""}
                    onChange={(e) =>
                      setSpinPrizes(
                        spinPrizes.map((x, i) =>
                          i === idx ? { ...x, value: Number(e.target.value) || 0 } : x
                        )
                      )
                    }
                    placeholder="Val"
                    className="h-10 px-2.5 rounded-xl border border-[var(--qm-line)] text-sm disabled:bg-[var(--qm-surface)]"
                  />
                  <button
                    type="button"
                    onClick={() => setSpinPrizes(spinPrizes.filter((_, i) => i !== idx))}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={spinPrizes.length >= 8}
                onClick={() => setSpinPrizes([...spinPrizes, { label: "Free dessert", kind: "item" }])}
                className="h-10 px-4 rounded-xl border border-[var(--qm-line)] text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Add prize
              </button>
              <button
                type="button"
                disabled={savingKey === "spin"}
                onClick={() =>
                  patchSettings(
                    "spin",
                    { spin_prizes: spinPrizes },
                    spinPrizes.length ? "Spin & Win saved" : "Spin & Win turned off"
                  )
                }
                className="h-10 px-5 rounded-xl border border-[#49332A] text-[#49332A] hover:bg-[#FAF8F5] text-sm font-semibold"
              >
                {savingKey === "spin" ? "Saving..." : "Save prizes"}
              </button>
            </div>
          </section>

          {/* Guest WiFi */}
          <section className="rounded-3xl bg-white border border-[var(--qm-line)] p-6 space-y-4">
            <div>
              <h3 className="font-display text-xl flex items-center gap-2">
                <Wifi className="h-5 w-5 text-[#49332A]" />
                Guest WiFi
              </h3>
              <p className="text-xs text-[var(--qm-muted)] mt-0.5">
                Shown to seated guests only, under &ldquo;While you wait&rdquo;.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Network name (SSID)</label>
                <input
                  type="text"
                  maxLength={64}
                  value={wifiSsid}
                  onChange={(e) => setWifiSsid(e.target.value)}
                  placeholder="TandoorHouse_Guest"
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Password</label>
                <input
                  type="text"
                  maxLength={64}
                  value={wifiPass}
                  onChange={(e) => setWifiPass(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={savingKey === "wifi"}
              onClick={() =>
                patchSettings(
                  "wifi",
                  { wifi_ssid: wifiSsid.trim(), wifi_password: wifiPass.trim() },
                  "WiFi details saved"
                )
              }
              className="h-10 px-5 rounded-xl border border-[#49332A] text-[#49332A] hover:bg-[#FAF8F5] text-sm font-semibold"
            >
              {savingKey === "wifi" ? "Saving..." : "Save WiFi"}
            </button>
          </section>
        </div>
      )}

      {section === "social" && (
        <div className="space-y-6">
          <div>
            <h2 className="font-display text-3xl flex items-center gap-2">
              <Share2 className="h-6 w-6 text-[#49332A]" />
              Social &amp; Review Links
            </h2>
            <p className="text-sm text-[var(--qm-muted)]">
              Displayed at the bottom of your menu and used for 4–5★ Google Review prompts
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              patchSettings("social", { social_links: social }, "Social links saved");
            }}
            className="rounded-3xl bg-white border border-[var(--qm-line)] p-6 space-y-4"
          >
            {(
              [
                { key: "google_review", label: "Google Review Link", placeholder: "https://g.page/r/..." },
                { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/..." },
                { key: "website", label: "Website", placeholder: "https://..." },
                { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/..." },
              ] as const
            ).map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-semibold mb-1">{f.label}</label>
                <input
                  type="url"
                  value={social[f.key] || ""}
                  onChange={(e) => setSocial({ ...social, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className="w-full h-10 px-3.5 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
            ))}

            <button
              type="submit"
              disabled={savingKey === "social"}
              className="h-10 px-5 rounded-xl bg-[#49332A] hover:bg-[#38261F] text-[#FAF8F5] text-sm font-semibold inline-flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              {savingKey === "social" ? "Saving..." : "Save Links"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
