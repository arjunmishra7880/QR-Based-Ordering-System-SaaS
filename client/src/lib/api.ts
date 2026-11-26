export class ApiError extends Error {
  status: number;
  code?: string;
  retryAfterSec?: number;

  constructor(message: string, status: number, code?: string, retryAfterSec?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      data?.error || `Request failed (${res.status})`,
      res.status,
      data?.code,
      data?.retryAfterSec
    );
  }
  return data as T;
}

export async function apiUploadImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/admin/upload", {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data?.error || "Upload failed", res.status);
  }
  return data;
}

export function formatINR(amount: number): string {
  const hasDecimals = Math.round(amount * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  }).format(Number(amount || 0));
}

export function formatTimeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function elapsedMinutes(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

export function getPinTokenStorageKey(restaurantKey: string, tableNumber: string): string {
  return `brotocol_pin_token_${restaurantKey || "default"}_${tableNumber}`;
}

export function getStoredPinToken(restaurantKey: string, tableNumber: string): string {
  try {
    return (
      sessionStorage.getItem(getPinTokenStorageKey(restaurantKey, tableNumber)) ||
      sessionStorage.getItem(`qserve_pin_token_${restaurantKey || "default"}_${tableNumber}`) ||
      ""
    );
  } catch {
    return "";
  }
}

export function setStoredPinToken(restaurantKey: string, tableNumber: string, token: string): void {
  try {
    if (token) {
      sessionStorage.setItem(getPinTokenStorageKey(restaurantKey, tableNumber), token);
    } else {
      sessionStorage.removeItem(getPinTokenStorageKey(restaurantKey, tableNumber));
    }
  } catch {
    // ignore storage limits
  }
}

export function darkenHex(hex?: string, factor = 0.82): string {
  const clean = /^#[0-9a-fA-F]{6}$/.test(String(hex || "")) ? String(hex) : "#49332A";
  const r = Math.max(0, Math.round(Number.parseInt(clean.slice(1, 3), 16) * factor));
  const g = Math.max(0, Math.round(Number.parseInt(clean.slice(3, 5), 16) * factor));
  const b = Math.max(0, Math.round(Number.parseInt(clean.slice(5, 7), 16) * factor));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function getContrastText(hex?: string): string {
  const clean = /^#[0-9a-fA-F]{6}$/.test(String(hex || "")) ? String(hex) : "#49332A";
  const r = Number.parseInt(clean.slice(1, 3), 16);
  const g = Number.parseInt(clean.slice(3, 5), 16);
  const b = Number.parseInt(clean.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 165 ? "#241813" : "#FAF8F5";
}

export function buildVenueThemeStyle(
  brandBg?: string,
  brandAccent?: string,
  brandSecondary?: string
): Record<string, string> {
  const bg = /^#[0-9a-fA-F]{6}$/.test(String(brandBg || "")) ? String(brandBg) : "#FAF8F5";
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(brandAccent || ""))
    ? String(brandAccent)
    : "#49332A";
  const secondary = /^#[0-9a-fA-F]{6}$/.test(String(brandSecondary || ""))
    ? String(brandSecondary)
    : "#766158";
  const accentHover = darkenHex(accent, 0.82);
  const accentInk = getContrastText(accent);
  const secondaryInk = getContrastText(secondary);
  return {
    "--qm-bg": bg,
    "--qm-accent": accent,
    "--qm-accent-hover": accentHover,
    "--qm-accent-ink": accentInk,
    "--qm-primary": accent,
    "--qm-primary-hover": accentHover,
    "--qm-primary-ink": accentInk,
    "--qm-secondary": secondary,
    "--qm-secondary-ink": secondaryInk,
    "--qm-muted": secondary,
  };
}
