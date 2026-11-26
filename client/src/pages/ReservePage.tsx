import React, { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock,
  Search,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { useToast } from "../components/Toast";
import { apiJson, buildVenueThemeStyle } from "../lib/api";
import type { ReservationRecord, RestaurantSettings } from "../types";

const STATUS_META: Record<ReservationRecord["status"], { label: string; cls: string }> = {
  pending: { label: "Pending Review", cls: "bg-amber-100 text-amber-900" },
  confirmed: { label: "Confirmed", cls: "bg-emerald-100 text-emerald-900" },
  seated: { label: "Seated", cls: "bg-sky-100 text-sky-900" },
  rejected: { label: "Declined", cls: "bg-red-100 text-red-800" },
  cancelled: { label: "Cancelled", cls: "bg-stone-200 text-stone-700" },
};

export function ReservePage() {
  const { slug } = useParams<{ slug?: string }>();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const restaurantKey = slug || params.get("restaurant") || params.get("r") || "";
  const restaurantQs = restaurantKey ? `?restaurant=${encodeURIComponent(restaurantKey)}` : "";
  const menuHref = slug
    ? `/r/${slug}/scan`
    : restaurantKey
      ? `/scan?restaurant=${encodeURIComponent(restaurantKey)}`
      : "/scan?table=1";

  const todayStr = new Date().toISOString().slice(0, 10);

  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [date, setDate] = useState(todayStr);
  const [time, setTime] = useState("19:30");
  const [partySize, setPartySize] = useState(4);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdBooking, setCreatedBooking] = useState<ReservationRecord | null>(null);

  const [lookupQuery, setLookupQuery] = useState(() => params.get("code") || "");
  const [lookupResults, setLookupResults] = useState<ReservationRecord[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    apiJson<{ settings: RestaurantSettings }>(`/api/public/menu${restaurantQs}`)
      .then((res) => {
        setSettings(res.settings);
        document.title = `${res.settings.name} — Reserve a Table`;
      })
      .catch(() => {});
  }, [restaurantQs]);

  const submitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiJson<{ reservation: ReservationRecord }>("/api/public/reservations", {
        method: "POST",
        body: JSON.stringify({
          ...(restaurantKey ? { restaurant: restaurantKey } : {}),
          reservationDate: date,
          reservationTime: time,
          partySize,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          notes: notes.trim(),
        }),
      });
      setCreatedBooking(res.reservation);
      setLookupQuery(res.reservation.booking_code);
      setLookupResults([res.reservation]);
      toast({ title: "Reservation request submitted!", variant: "success" });
    } catch (err) {
      toast({
        title: "Reservation couldn't be placed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const checkStatus = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = lookupQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const isCode = q.toUpperCase().startsWith("BK-");
      const queryStr = isCode
        ? `code=${encodeURIComponent(q.toUpperCase())}`
        : `phone=${encodeURIComponent(q)}`;
      const res = await apiJson<{ reservations: ReservationRecord[] }>(
        `/api/public/reservations?${queryStr}${restaurantKey ? `&restaurant=${encodeURIComponent(restaurantKey)}` : ""}`
      );
      setLookupResults(res.reservations || []);
      if ((res.reservations || []).length === 0) {
        toast({ title: "No matching reservations found" });
      }
    } catch (err) {
      toast({
        title: "Lookup failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSearching(false);
    }
  };

  const themeStyle = buildVenueThemeStyle(
    settings?.brand_bg,
    settings?.primary_color || settings?.brand_accent,
    settings?.secondary_color || settings?.brand_secondary
  );

  return (
    <div style={themeStyle} className="min-h-screen bg-[var(--qm-bg)] pb-14">
      <header className="bg-white border-b border-[var(--qm-line)]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link
              to={menuHref}
              className="h-9 w-9 rounded-full border border-[var(--qm-line)] hover:border-[var(--qm-accent)] flex items-center justify-center text-[var(--qm-accent)]"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <BrandMark
              size="sm"
              accent={themeStyle["--qm-accent"]}
              logoUrl={settings?.logo_url}
              alt={settings?.name || "Restaurant"}
            />
            <div className="min-w-0">
              <p className="font-display text-lg leading-tight truncate text-[var(--qm-accent)]">
                {settings?.name || "Restaurant Reservations"}
              </p>
              <p className="text-[11px] text-[var(--qm-muted)]">
                Hours: {settings?.opening_time || "09:00"} – {settings?.closing_time || "23:00"}
              </p>
            </div>
          </div>

          <Link
            to={menuHref}
            className="h-9 px-3.5 rounded-full border border-[var(--qm-line)] bg-[var(--qm-bg)] text-xs font-semibold text-[var(--qm-accent)] inline-flex items-center gap-1.5"
          >
            <UtensilsCrossed className="h-3.5 w-3.5" />
            <span>View Menu</span>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 grid gap-6 md:grid-cols-[1.2fr_0.9fr] items-start">
        <section className="rounded-3xl bg-white border border-[var(--qm-line)] p-6 sm:p-7 shadow-xs space-y-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--qm-muted)]">
              Restaurant Dining Booking
            </p>
            <h1 className="font-display text-3xl mt-1 text-[var(--qm-accent)]">Reserve a Table</h1>
            <p className="text-xs text-[var(--qm-muted)] mt-1">
              Choose your preferred date, time slot, and party size.
            </p>
          </div>

          {createdBooking ? (
            <div className="rounded-2xl bg-[var(--qm-bg)] border border-[var(--qm-line)] p-5 space-y-4">
              <div className="flex items-center gap-3">
                <span className="h-11 w-11 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-xs uppercase font-bold tracking-wider text-[var(--qm-muted)]">
                    Booking Code: {createdBooking.booking_code}
                  </p>
                  <h2 className="font-display text-2xl text-[var(--qm-accent)]">Request Received</h2>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs bg-white rounded-xl border border-[var(--qm-line)] p-3.5">
                <div>
                  <p className="text-[var(--qm-muted)]">Date &amp; Time</p>
                  <p className="font-semibold text-[var(--qm-accent)]">
                    {createdBooking.reservation_date} · {createdBooking.reservation_time}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--qm-muted)]">Party Size</p>
                  <p className="font-semibold text-[var(--qm-accent)]">
                    {createdBooking.party_size} guests
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreatedBooking(null)}
                className="text-xs font-semibold text-[var(--qm-accent)] hover:underline"
              >
                + Make another reservation
              </button>
            </div>
          ) : (
            <form onSubmit={submitBooking} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    min={todayStr}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                    Time
                  </label>
                  <input
                    type="time"
                    required
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                    Party Size
                  </label>
                  <div className="relative">
                    <Users className="h-3.5 w-3.5 text-[var(--qm-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="number"
                      required
                      min={1}
                      max={20}
                      value={partySize}
                      onChange={(e) => setPartySize(Number.parseInt(e.target.value, 10) || 2)}
                      className="w-full h-10 pl-8 pr-3 rounded-xl border border-[var(--qm-line)] text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                    Guest Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name"
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Mobile or contact number"
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                  Special Requests (optional)
                </label>
                <input
                  type="text"
                  maxLength={240}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Window seat, birthday celebration, allergy note..."
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                style={{
                  backgroundColor: "var(--qm-accent)",
                  color: "var(--qm-accent-ink)",
                }}
                className="w-full h-11 rounded-full font-semibold text-sm inline-flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-55"
              >
                <CalendarClock className="h-4 w-4" />
                <span>{submitting ? "Submitting..." : "Request Table Reservation"}</span>
              </button>
            </form>
          )}
        </section>

        <section className="rounded-3xl bg-white border border-[var(--qm-line)] p-6 shadow-xs space-y-4">
          <div>
            <h2 className="font-display text-2xl text-[var(--qm-accent)]">Check Booking Status</h2>
            <p className="text-xs text-[var(--qm-muted)] mt-0.5">
              Enter your booking code (e.g. BK-A1B2) or phone number
            </p>
          </div>

          <form onSubmit={checkStatus} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="h-3.5 w-3.5 text-[var(--qm-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
                placeholder="Booking code or phone..."
                className="w-full h-10 pl-8 pr-3 rounded-xl border border-[var(--qm-line)] text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={searching}
              style={{
                backgroundColor: "var(--qm-accent)",
                color: "var(--qm-accent-ink)",
              }}
              className="h-10 px-4 rounded-xl text-xs font-semibold"
            >
              {searching ? "..." : "Check"}
            </button>
          </form>

          {lookupResults.length > 0 && (
            <div className="space-y-2.5">
              {lookupResults.map((r) => {
                const st = STATUS_META[r.status] || STATUS_META.pending;
                return (
                  <div
                    key={r.id}
                    className="rounded-2xl border border-[var(--qm-line)] bg-[var(--qm-bg)] p-3.5 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-[var(--qm-accent)]">
                        {r.booking_code}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.cls}`}>
                        {st.label}
                      </span>
                    </div>
                    <p className="font-semibold text-[var(--qm-accent)]">
                      {r.customer_name} · {r.party_size} guests
                    </p>
                    <p className="text-[var(--qm-muted)] flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      {r.reservation_date} at {r.reservation_time}
                      {r.assigned_table ? ` · Table ${r.assigned_table}` : ""}
                    </p>
                    {r.admin_note && (
                      <p className="text-[11px] text-[var(--qm-accent)] bg-white rounded-lg px-2.5 py-1.5 border border-[var(--qm-line)]">
                        Restaurant note: {r.admin_note}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
