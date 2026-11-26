import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BrandMark } from "../components/BrandMark";
import { PortalLoginCard } from "../components/PortalLoginCard";
import { ApiError, apiJson, buildVenueThemeStyle } from "../lib/api";
import type { PlatformBrandConfig, PublicVenueSummary } from "../types";

export function LandingPage() {
  const navigate = useNavigate();
  const [platform, setPlatform] = useState<PlatformBrandConfig | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [domainError, setDomainError] = useState<{ status: number; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    apiJson<{
      ok: boolean;
      mode: "platform" | "tenant";
      platform?: PlatformBrandConfig;
      tenant?: PublicVenueSummary | null;
    }>("/api/public/context")
      .then((ctx) => {
        if (!active) return;
        if (ctx.mode === "tenant" && ctx.tenant) {
          navigate("/scan", { replace: true });
          return;
        }
        if (ctx.platform) {
          setPlatform(ctx.platform);
          document.title = `${ctx.platform.platform_name} — White-Label Restaurant Platform`;
        }
        setContextLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        const status = err instanceof ApiError ? err.status : 404;
        setDomainError({
          status,
          message: err instanceof Error ? err.message : "Domain unavailable.",
        });
        setContextLoading(false);
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  const brandName = platform?.platform_name || "Khao Piyo";
  const themeStyle = buildVenueThemeStyle(
    platform?.default_brand_bg || "#FAF8F5",
    platform?.default_brand_accent || "#49332A",
    platform?.default_brand_secondary || "#766158"
  );

  if (contextLoading) {
    return (
      <div
        style={themeStyle}
        className="min-h-screen bg-[var(--qm-bg)] flex items-center justify-center p-6"
      >
        <p className="font-display text-2xl text-[var(--qm-muted)]">Loading portal...</p>
      </div>
    );
  }

  if (domainError) {
    return (
      <div
        style={themeStyle}
        className="min-h-screen bg-[var(--qm-bg)] flex items-center justify-center p-6"
      >
        <div className="max-w-md w-full rounded-3xl bg-white border border-[var(--qm-line)] p-8 text-center shadow-sm space-y-3">
          <h1 className="font-display text-3xl text-[var(--qm-accent)]">
            {domainError.status === 404 ? "Domain Not Found" : "Storefront Unavailable"}
          </h1>
          <p className="text-sm text-[var(--qm-muted)]">{domainError.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={themeStyle}
      className="min-h-screen bg-[var(--qm-bg)] text-[var(--qm-ink)] relative overflow-x-clip flex flex-col justify-between"
    >
      {/* Subtle Architectural Motif */}
      <svg
        aria-hidden
        viewBox="0 0 600 320"
        className="pointer-events-none fixed bottom-0 right-0 w-[340px] sm:w-[460px] opacity-[0.06] select-none"
      >
        <path d="M180 320 A160 160 0 0 1 340 160 L340 320 Z" fill="var(--qm-accent)" />
        <path d="M340 160 A160 160 0 0 1 500 0 L500 160 Z" fill="var(--qm-accent)" />
        <path d="M500 160 A160 160 0 0 0 340 0 L500 0 Z" fill="var(--qm-accent)" />
        <path d="M440 320 A160 160 0 0 1 600 160 L600 320 Z" fill="var(--qm-accent)" />
      </svg>

      <header className="relative max-w-6xl w-full mx-auto px-4 sm:px-8 h-18 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <BrandMark accent={themeStyle["--qm-accent"]} />
          <span className="font-display text-xl tracking-tight font-semibold text-[var(--qm-accent)]">
            {brandName}
          </span>
        </div>
        <span className="text-xs font-medium px-3 py-1 rounded-full bg-white border border-[var(--qm-line)] text-[var(--qm-muted)]">
          Restaurant Operations SaaS
        </span>
      </header>

      <main className="relative flex-1 flex items-center justify-center px-4 py-8">
        <PortalLoginCard
          brandName={brandName}
          subtitle="White-Label Restaurant QR Menu & Management Portal"
          accentColor={themeStyle["--qm-accent"]}
        />
      </main>

      <footer className="relative border-t border-[var(--qm-line)] bg-white/70 py-4 text-center text-xs text-[var(--qm-muted)]">
        {brandName} · White-Label Restaurant Ordering SaaS
      </footer>
    </div>
  );
}
