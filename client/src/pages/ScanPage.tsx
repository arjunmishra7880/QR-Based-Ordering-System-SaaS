import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CalendarClock, KeyRound, QrCode, ShoppingBag, Truck } from "lucide-react";
import {
  apiJson,
  buildVenueThemeStyle,
  getStoredPinToken,
  setStoredPinToken,
} from "../lib/api";
import type { TableConfig } from "../types";

interface TableStatusResponse {
  ok: boolean;
  restaurant?: {
    id: string;
    slug: string;
    name: string;
    logo_url: string | null;
    brand_bg?: string;
    brand_accent?: string;
    brand_secondary?: string;
    primary_color?: string;
    secondary_color?: string;
    takeaway_enabled?: boolean;
    delivery_enabled?: boolean;
    opening_time?: string;
    closing_time?: string;
  };
  table: string | null;
  qr_mode: "single" | "per_table";
  table_config: TableConfig;
  require_table_pin?: boolean;
  has_open_seating?: boolean;
  needs_pin?: boolean;
}

export function ScanPage() {
  const { slug } = useParams<{ slug?: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const rawTable = params.get("table");
  const restaurantKey = slug || params.get("restaurant") || params.get("r") || "";

  const scanBase = slug ? `/r/${slug}/scan` : "/scan";
  const menuBase = slug ? `/r/${slug}/menu` : "/menu";
  const reserveHref = slug
    ? `/r/${slug}/reserve`
    : restaurantKey
      ? `/reserve?restaurant=${encodeURIComponent(restaurantKey)}`
      : "/reserve";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [venue, setVenue] = useState<TableStatusResponse["restaurant"] | undefined>(undefined);
  const [config, setConfig] = useState<TableConfig | null>(null);
  const [pinTable, setPinTable] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);

  const buildMenuHref = (tbl: string) => {
    const q = new URLSearchParams({ table: tbl });
    if (!slug && restaurantKey) q.set("restaurant", restaurantKey);
    return `${menuBase}?${q.toString()}`;
  };

  const buildModeHref = (mode: "takeaway" | "delivery") => {
    const q = new URLSearchParams({ mode });
    if (!slug && restaurantKey) q.set("restaurant", restaurantKey);
    return `${menuBase}?${q.toString()}`;
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPinTable(null);

    const qsParams = new URLSearchParams();
    if (rawTable) qsParams.set("table", rawTable);
    if (restaurantKey) qsParams.set("restaurant", restaurantKey);
    const qs = qsParams.toString() ? `?${qsParams.toString()}` : "";
    const storedToken = rawTable ? getStoredPinToken(restaurantKey, rawTable) : "";

    apiJson<TableStatusResponse>(`/api/public/table-status${qs}`, {
      headers: storedToken ? { "X-Table-Pin-Token": storedToken } : undefined,
    })
      .then((res) => {
        if (!active) return;
        if (res.restaurant) setVenue(res.restaurant);
        if (res.table) {
          if (res.require_table_pin && !res.has_open_seating) {
            setError(`Table ${res.table} isn't open yet. Ask restaurant staff to seat your table.`);
            setLoading(false);
            return;
          }
          if (res.needs_pin) {
            setPinTable(res.table);
            setLoading(false);
            return;
          }
          navigate(buildMenuHref(res.table), { replace: true });
          return;
        }
        setConfig(res.table_config);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not open this table QR.");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [rawTable, restaurantKey, slug, navigate]);

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinTable || !/^\d{4}$/.test(pinInput)) return;
    setVerifyingPin(true);
    setPinError(null);
    try {
      const res = await apiJson<{ ok: boolean; pinToken: string }>("/api/public/seating/join", {
        method: "POST",
        body: JSON.stringify({
          tableNumber: pinTable,
          pin: pinInput,
          ...(restaurantKey ? { restaurant: restaurantKey } : {}),
        }),
      });
      if (res.pinToken) {
        setStoredPinToken(restaurantKey, pinTable, res.pinToken);
      }
      navigate(buildMenuHref(pinTable), { replace: true });
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Wrong PIN.");
    } finally {
      setVerifyingPin(false);
    }
  };

  const activeTables = useMemo(() => {
    if (!config) return [];
    const skip = new Set(config.skip || []);
    const disabled = new Set(config.disabled || []);
    return Array.from({ length: config.total || 12 }, (_, idx) => idx + 1).filter(
      (n) => !skip.has(n) && !disabled.has(n)
    );
  }, [config]);

  const venueName = venue?.name || "Restaurant Menu";
  const themeStyle = buildVenueThemeStyle(
    venue?.brand_bg,
    venue?.primary_color || venue?.brand_accent,
    venue?.secondary_color || venue?.brand_secondary
  );

  if (loading) {
    return (
      <div
        style={themeStyle}
        className="min-h-screen flex items-center justify-center bg-[var(--qm-bg)] p-6"
      >
        <div className="text-center">
          <p className="font-display text-2xl text-[var(--qm-accent)]">Opening the menu</p>
          <div className="h-0.5 w-24 mx-auto mt-5 bg-[var(--qm-line)] overflow-hidden rounded-full">
            <div className="h-full w-1/2 bg-[var(--qm-accent)] animate-pulse rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  if (pinTable) {
    return (
      <div
        style={themeStyle}
        className="min-h-screen flex items-center justify-center bg-[var(--qm-bg)] p-6"
      >
        <form
          onSubmit={submitPin}
          className="max-w-sm w-full bg-white rounded-3xl border border-[var(--qm-line)] p-7 text-center shadow-sm space-y-4"
        >
          <div className="h-12 w-12 mx-auto rounded-full bg-[var(--qm-tint)] text-[var(--qm-accent)] flex items-center justify-center">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--qm-muted)]">
              {venueName}
            </p>
            <h1 className="font-display text-2xl mt-0.5 text-[var(--qm-accent)]">
              Table {pinTable} PIN
            </h1>
            <p className="text-xs text-[var(--qm-muted)] mt-1">
              Enter the 4-digit PIN given by your waiter to unlock ordering.
            </p>
          </div>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            maxLength={4}
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="••••"
            className="w-full h-12 rounded-2xl border border-[var(--qm-line)] bg-[var(--qm-bg)] text-center font-mono text-xl tracking-[0.4em]"
          />
          {pinError && <p className="text-xs font-medium text-red-600">{pinError}</p>}
          <button
            type="submit"
            disabled={verifyingPin || pinInput.length < 4}
            style={{
              backgroundColor: "var(--qm-accent)",
              color: "var(--qm-accent-ink)",
            }}
            className="w-full h-11 rounded-full text-sm font-semibold disabled:opacity-45"
          >
            {verifyingPin ? "Checking..." : "Unlock Table Menu"}
          </button>
        </form>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={themeStyle}
        className="min-h-screen flex items-center justify-center bg-[var(--qm-bg)] p-6"
      >
        <div className="max-w-sm w-full bg-white rounded-3xl border border-[var(--qm-line)] p-7 text-center shadow-xs">
          <div className="h-12 w-12 mx-auto mb-5 rounded-full bg-[var(--qm-tint)] text-[var(--qm-accent)] flex items-center justify-center">
            <QrCode className="h-5 w-5" />
          </div>
          <h1 className="font-display text-2xl text-[var(--qm-accent)]">
            Couldn&apos;t open the menu
          </h1>
          <p className="mt-2.5 text-sm text-[var(--qm-muted)] leading-relaxed">{error}</p>
          <button
            type="button"
            onClick={() => navigate(scanBase, { replace: true })}
            style={{
              backgroundColor: "var(--qm-accent)",
              color: "var(--qm-accent-ink)",
            }}
            className="mt-6 w-full h-11 rounded-full text-sm font-semibold hover:opacity-95 transition-opacity"
          >
            Choose a Table or Service Mode
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={themeStyle}
      className="min-h-screen flex items-center justify-center bg-[var(--qm-bg)] p-5"
    >
      <div className="max-w-md w-full bg-white rounded-3xl border border-[var(--qm-line)] p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <span className="h-11 w-11 rounded-2xl bg-[var(--qm-tint)] text-[var(--qm-accent)] flex items-center justify-center flex-shrink-0">
            <QrCode className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--qm-muted)]">
              {venueName}
            </p>
            <h1 className="font-display text-2xl leading-tight text-[var(--qm-accent)]">
              Start Ordering
            </h1>
            <p className="text-xs text-[var(--qm-muted)] mt-0.5">
              Tap your table number for Dine-In, or choose Takeaway / Delivery
            </p>
          </div>
        </div>

        {(venue?.takeaway_enabled !== false || venue?.delivery_enabled) && (
          <div className="grid grid-cols-2 gap-2.5">
            {venue?.takeaway_enabled !== false && (
              <Link
                to={buildModeHref("takeaway")}
                className="flex items-center gap-2.5 px-3.5 py-3 rounded-2xl border border-[var(--qm-line)] bg-[var(--qm-surface)] hover:border-[var(--qm-accent)] transition-colors"
              >
                <ShoppingBag className="h-4 w-4 text-[var(--qm-accent)] flex-shrink-0" />
                <div>
                  <p className="text-xs font-bold text-[var(--qm-accent)]">Takeaway</p>
                  <p className="text-[11px] text-[var(--qm-muted)]">Self-pickup counter</p>
                </div>
              </Link>
            )}
            {venue?.delivery_enabled && (
              <Link
                to={buildModeHref("delivery")}
                className="flex items-center gap-2.5 px-3.5 py-3 rounded-2xl border border-[var(--qm-line)] bg-[var(--qm-surface)] hover:border-[var(--qm-accent)] transition-colors"
              >
                <Truck className="h-4 w-4 text-[var(--qm-accent)] flex-shrink-0" />
                <div>
                  <p className="text-xs font-bold text-[var(--qm-accent)]">Delivery</p>
                  <p className="text-[11px] text-[var(--qm-muted)]">Direct restaurant delivery</p>
                </div>
              </Link>
            )}
          </div>
        )}

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--qm-muted)] mb-2.5">
            Dine-In · Select Your Table
          </p>
          <div className="grid grid-cols-4 gap-2.5">
            {activeTables.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() =>
                  navigate(
                    !slug && restaurantKey
                      ? `${scanBase}?table=${n}&restaurant=${encodeURIComponent(restaurantKey)}`
                      : `${scanBase}?table=${n}`
                  )
                }
                className="h-12 rounded-2xl border border-[var(--qm-line)] bg-[var(--qm-surface)] hover:border-[var(--qm-accent)] hover:bg-[var(--qm-tint)]/50 font-semibold text-base transition-colors text-[var(--qm-accent)]"
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--qm-line)] flex items-center justify-between text-xs">
          <span className="text-[var(--qm-muted)]">Planning a visit later?</span>
          <Link
            to={reserveHref}
            className="inline-flex items-center gap-1.5 font-semibold text-[var(--qm-accent)] hover:underline"
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Book a Table
          </Link>
        </div>
      </div>
    </div>
  );
}
