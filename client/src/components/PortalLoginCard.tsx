import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { useToast } from "./Toast";
import { apiJson } from "../lib/api";
import type { AuthUser } from "../types";

export type PortalRoleChoice = "admin" | "super_admin";

interface PortalLoginCardProps {
  brandName: string;
  subtitle?: string;
  accentColor: string;
}

export function PortalLoginCard({
  brandName,
  subtitle,
  accentColor,
}: PortalLoginCardProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [portalRole, setPortalRole] = useState<PortalRoleChoice>("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiJson<{ user: AuthUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const isSuper = res.user.role === "super_admin";

      if (portalRole === "super_admin" && !isSuper) {
        await apiJson("/api/auth/logout", { method: "POST" }).catch(() => {});
        toast({
          title: "Role mismatch",
          description: "This account is a Restaurant Admin. Select Admin in the dropdown.",
          variant: "destructive",
        });
        return;
      }

      if (portalRole === "admin" && isSuper) {
        await apiJson("/api/auth/logout", { method: "POST" }).catch(() => {});
        toast({
          title: "Role mismatch",
          description: "This account is a Super Admin. Select Super Admin in the dropdown.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Welcome back!",
        description: isSuper
          ? `Signed in to ${brandName} Super Admin Console.`
          : "Signed in to your restaurant dashboard.",
      });
      navigate(isSuper ? "/super-admin" : "/dashboard", { replace: true });
    } catch (err) {
      toast({
        title: "Sign in failed",
        description: err instanceof Error ? err.message : "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white rounded-3xl border border-[var(--qm-line)] p-7 sm:p-8 shadow-sm">
      <div className="text-center">
        <div className="flex justify-center">
          <BrandMark size="lg" accent={accentColor} />
        </div>
        <h1 className="font-display text-3xl mt-4 text-[var(--qm-accent)]">{brandName}</h1>
        <p className="text-sm text-[var(--qm-muted)] mt-1">
          {subtitle || "Sign in to open your management portal"}
        </p>
      </div>

      <form onSubmit={handleLogin} className="mt-6 space-y-4">
        <div>
          <label htmlFor="portal-role" className="block text-sm font-medium mb-1.5">
            Portal Access
          </label>
          <div className="relative">
            <select
              id="portal-role"
              value={portalRole}
              onChange={(e) => setPortalRole(e.target.value as PortalRoleChoice)}
              className="w-full h-11 pl-3.5 pr-10 rounded-xl border border-[var(--qm-line)] bg-white text-sm font-medium text-[var(--qm-ink)] appearance-none focus:outline-none focus:ring-2 focus:ring-[var(--qm-accent)]"
            >
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
            <ChevronDown className="pointer-events-none h-4 w-4 text-[var(--qm-muted)] absolute right-3.5 top-1/2 -translate-y-1/2" />
          </div>
        </div>

        <div>
          <label htmlFor="auth-email" className="block text-sm font-medium mb-1.5">
            {portalRole === "super_admin" ? "Super Admin ID or Email" : "Admin Email"}
          </label>
          <input
            id="auth-email"
            type="text"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={
              portalRole === "super_admin"
                ? "Enter Super Admin ID"
                : "Enter restaurant admin email"
            }
            className="w-full h-11 px-3.5 rounded-xl border border-[var(--qm-line)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--qm-accent)]"
          />
        </div>

        <div>
          <label htmlFor="auth-password" className="block text-sm font-medium mb-1.5">
            Password
          </label>
          <div className="relative">
            <input
              id="auth-password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full h-11 pl-3.5 pr-10 rounded-xl border border-[var(--qm-line)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--qm-accent)]"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label="Toggle password visibility"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--qm-muted)] hover:text-[var(--qm-accent)]"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            backgroundColor: "var(--qm-accent)",
            color: "var(--qm-accent-ink)",
          }}
          className="w-full h-11 rounded-full disabled:opacity-60 font-semibold text-sm flex items-center justify-center gap-2 transition-opacity hover:opacity-95"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          <span>{portalRole === "super_admin" ? "Open Super Admin Portal" : "Open Admin Portal"}</span>
        </button>
      </form>

      <div className="mt-5 rounded-2xl bg-[var(--qm-surface)] border border-[var(--qm-line)] px-4 py-3 text-xs text-[var(--qm-muted)] flex items-center gap-2.5">
        <ShieldCheck className="h-4 w-4 text-[var(--qm-accent)] flex-shrink-0" />
        <span>
          {portalRole === "super_admin"
            ? "Manage white-label restaurant tenants, custom domains, and platform settings."
            : "Access your floor POS, menu catalog, waiter panel, and kitchen display."}
        </span>
      </div>
    </div>
  );
}
