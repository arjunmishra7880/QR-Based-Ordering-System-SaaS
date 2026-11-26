import { useEffect, useState } from "react";
import { Droplets, HandHelping, Receipt, Sparkles, UserRound, X } from "lucide-react";
import { ApiError, apiJson, getStoredPinToken } from "../lib/api";
import { useToast } from "./Toast";
import type { CallType, ServiceCall } from "../types";

interface CallStaffModalProps {
  tableNumber: string;
  restaurantSlug?: string;
  activeCall: ServiceCall | null;
  callsEnabled: boolean;
  onClose: () => void;
  onCallCreated: (call: ServiceCall) => void;
}

const CALL_OPTIONS: Array<{
  type: CallType;
  label: string;
  icon: typeof Droplets;
}> = [
  { type: "water", label: "Water", icon: Droplets },
  { type: "bill", label: "The bill", icon: Receipt },
  { type: "waiter", label: "A waiter", icon: UserRound },
  { type: "help", label: "Help", icon: HandHelping },
  { type: "clean", label: "Clean the table", icon: Sparkles },
];

export function CallStaffModal({
  tableNumber,
  restaurantSlug,
  activeCall,
  callsEnabled,
  onClose,
  onCallCreated,
}: CallStaffModalProps) {
  const { toast } = useToast();
  const [sending, setSending] = useState<CallType | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const cooldownRemaining = activeCall
    ? Math.max(0, Math.ceil(30 - (nowMs - new Date(activeCall.created_at).getTime()) / 1000))
    : 0;

  const triggerCall = async (callType: CallType) => {
    if (!callsEnabled) {
      toast({
        title: "Staff calls are paused",
        description: "Please wave a member of staff over.",
        variant: "destructive",
      });
      return;
    }
    setSending(callType);
    try {
      const pinToken = getStoredPinToken(restaurantSlug || "", tableNumber);
      const res = await apiJson<{ call: ServiceCall }>("/api/public/service-calls", {
        method: "POST",
        headers: pinToken ? { "X-Table-Pin-Token": pinToken } : undefined,
        body: JSON.stringify({
          tableNumber,
          callType,
          ...(restaurantSlug ? { restaurant: restaurantSlug } : {}),
        }),
      });
      onCallCreated(res.call);
      toast({
        title: "Staff notified",
        description: `Table ${tableNumber} request sent.`,
        variant: "success",
      });
    } catch (err) {
      if (err instanceof ApiError) {
        toast({ title: "Please wait", description: err.message, variant: "destructive" });
      } else {
        toast({ title: "Failed to call staff", variant: "destructive" });
      }
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-[var(--qm-line)] p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-2xl">Call staff</h2>
            <p className="text-xs text-[var(--qm-muted)] mt-0.5">Table {tableNumber}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 rounded-full hover:bg-[var(--qm-bg)] flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {activeCall && activeCall.status !== "completed" && (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs">
            <p className="font-semibold text-amber-950 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              {activeCall.status === "acknowledged"
                ? `Staff on the way (${activeCall.call_type})`
                : `Calling staff · ${activeCall.call_type}`}
            </p>
            <p className="text-amber-800 mt-0.5">
              {activeCall.status === "acknowledged"
                ? `${activeCall.acknowledged_by || "A team member"} saw your request.`
                : "Waiting for a team member to answer."}
            </p>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {CALL_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const disabled = Boolean(sending) || cooldownRemaining > 0 || !callsEnabled;
            return (
              <button
                key={opt.type}
                type="button"
                disabled={disabled}
                onClick={() => triggerCall(opt.type)}
                className="flex items-center gap-3 p-3.5 rounded-2xl border border-[var(--qm-line)] bg-[var(--qm-surface)] hover:border-[var(--qm-accent)] disabled:opacity-55 text-left transition-colors"
              >
                <span className="h-9 w-9 rounded-xl bg-[var(--qm-tint)] text-[var(--qm-accent)] flex items-center justify-center flex-shrink-0">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold">{opt.label}</span>
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-xs text-[var(--qm-muted)]">
          {cooldownRemaining > 0
            ? `You can call again in ${cooldownRemaining}s.`
            : "One tap. No need to wave."}
        </p>
      </div>
    </div>
  );
}
