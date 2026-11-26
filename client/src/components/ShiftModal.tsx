import React, { useState } from "react";
import { KeyRound, LogOut, UserCheck, X } from "lucide-react";
import { useToast } from "./Toast";
import type { ActiveShiftActor } from "../lib/useShift";

interface ShiftModalProps {
  actor: ActiveShiftActor | null;
  onUnlock: (pin: string) => Promise<ActiveShiftActor>;
  onEndShift: () => void;
  onClose: () => void;
}

export function ShiftModal({ actor, onUnlock, onEndShift, onClose }: ShiftModalProps) {
  const { toast } = useToast();
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) return;
    setSubmitting(true);
    try {
      const staff = await onUnlock(pin);
      toast({
        title: `Shift started: ${staff.name}`,
        description: `Role: ${staff.role}. Tables and calls now record under your name.`,
        variant: "success",
      });
      onClose();
    } catch (err) {
      toast({
        title: "Invalid PIN",
        description: err instanceof Error ? err.message : "Try another 4-6 digit PIN.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-[var(--qm-bg)] w-full max-w-sm rounded-3xl border border-[var(--qm-line)] p-6 shadow-2xl relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 h-8 w-8 rounded-full hover:bg-[var(--qm-surface)] flex items-center justify-center"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="h-11 w-11 rounded-2xl bg-[#EDE6DE] text-[#49332A] flex items-center justify-center mb-3">
          <KeyRound className="h-5 w-5" />
        </div>

        <h2 className="font-display text-2xl">Start your shift</h2>
        <p className="text-xs text-[var(--qm-muted)] mt-1 leading-relaxed">
          Enter your 4–6 digit staff PIN. Tables you open, payments you confirm, and calls you answer
          go under your name.
        </p>

        {actor && (
          <div className="mt-4 rounded-2xl bg-white border border-[var(--qm-line)] p-3.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <UserCheck className="h-4 w-4 text-emerald-700 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">{actor.name}</p>
                <p className="text-[11px] text-[var(--qm-muted)] capitalize">
                  {actor.role}
                  {actor.section ? ` · ${actor.section}` : ""}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onEndShift();
                toast({ title: "Returned to Owner mode" });
                onClose();
              }}
              className="text-xs font-semibold text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1"
            >
              <LogOut className="h-3.5 w-3.5" />
              End
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="Staff PIN (e.g. 1111)"
            aria-label="Staff PIN"
            className="w-full h-12 px-4 rounded-2xl border-2 border-[#49332A]/40 focus:border-[#49332A] bg-white text-center font-mono text-lg tracking-[0.35em] focus:outline-none"
          />

          <p className="text-[11px] text-center text-[var(--qm-muted)]">
            Enter the 4–6 digit PIN configured by your restaurant manager
          </p>

          <button
            type="submit"
            disabled={submitting || !/^\d{4,6}$/.test(pin)}
            className="w-full h-11 rounded-2xl bg-[#49332A] hover:bg-[#38261F] disabled:opacity-45 text-[#FAF8F5] text-sm font-semibold transition-colors"
          >
            {submitting ? "Checking..." : "Start shift"}
          </button>
        </form>
      </div>
    </div>
  );
}
