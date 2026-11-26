import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PortalLoginCard } from "../components/PortalLoginCard";
import { apiJson, buildVenueThemeStyle } from "../lib/api";
import type { PlatformBrandConfig, PublicVenueSummary } from "../types";

export function AuthPage() {
  const [platform, setPlatform] = useState<PlatformBrandConfig | null>(null);
  const [tenantContext, setTenantContext] = useState<PublicVenueSummary | null>(null);

  useEffect(() => {
    apiJson<{
      ok: boolean;
      mode: "platform" | "tenant";
      platform?: PlatformBrandConfig;
      tenant?: PublicVenueSummary | null;
    }>("/api/public/context")
      .then((res) => {
        if (res.mode === "tenant" && res.tenant) {
          setTenantContext(res.tenant);
        } else if (res.platform) {
          setPlatform(res.platform);
        }
      })
      .catch(() => {});
  }, []);

  const brandName = tenantContext
    ? tenantContext.name
    : platform?.platform_name || "Khao Piyo";
  const themeStyle = buildVenueThemeStyle(
    tenantContext?.brand_bg || platform?.default_brand_bg || "#FAF8F5",
    tenantContext?.primary_color || tenantContext?.brand_accent || platform?.default_brand_accent || "#49332A",
    tenantContext?.secondary_color || tenantContext?.brand_secondary || platform?.default_brand_secondary || "#766158"
  );

  return (
    <div
      style={themeStyle}
      className="min-h-screen bg-[var(--qm-bg)] flex flex-col items-center justify-center p-4"
    >
      <PortalLoginCard
        brandName={brandName}
        subtitle="Sign in as Admin or Super Admin"
        accentColor={themeStyle["--qm-accent"]}
      />
      <p className="mt-5 text-center text-xs text-[var(--qm-muted)]">
        <Link to="/" className="hover:underline font-medium text-[var(--qm-accent)]">
          &larr; Back to {brandName} Portal
        </Link>
      </p>
    </div>
  );
}
