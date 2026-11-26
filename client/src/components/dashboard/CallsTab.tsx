import { Bell, Check, Droplets, HandHelping, Receipt, Sparkles, UserRound } from "lucide-react";
import { elapsedMinutes, formatTimeShort } from "../../lib/api";
import type { CallStatus, CallType, ServiceCall } from "../../types";

interface CallsTabProps {
  calls: ServiceCall[];
  onUpdateCall: (id: string, status: Exclude<CallStatus, "pending">) => Promise<void>;
}

const CALL_META: Record<CallType, { label: string; icon: typeof Bell }> = {
  water: { label: "Water", icon: Droplets },
  bill: { label: "The bill", icon: Receipt },
  waiter: { label: "A waiter", icon: UserRound },
  help: { label: "Help", icon: HandHelping },
  clean: { label: "Clean the table", icon: Sparkles },
};

export function CallsTab({ calls, onUpdateCall }: CallsTabProps) {
  const active = calls.filter((c) => c.status !== "completed");
  const history = calls.filter((c) => c.status === "completed").slice(0, 15);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-3xl">Service calls</h2>
        <p className="text-sm text-[var(--qm-muted)]">
          Guest table bell requests for water, bill, waiter, or cleanup
        </p>
      </div>

      {active.length === 0 ? (
        <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-10 text-center text-sm text-[var(--qm-muted)]">
          No pending table calls right now.
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {active.map((call) => {
            const meta = CALL_META[call.call_type] || CALL_META.waiter;
            const Icon = meta.icon;
            return (
              <div
                key={call.id}
                className="rounded-2xl bg-white border border-amber-300 p-5 shadow-xs flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3.5">
                  <span className="h-11 w-11 rounded-2xl bg-amber-100 text-amber-900 flex items-center justify-center flex-shrink-0">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-semibold text-base">
                      Table {call.table_number} · {meta.label}
                    </p>
                    <p className="text-xs text-[var(--qm-muted)]">
                      {formatTimeShort(call.created_at)} ({elapsedMinutes(call.created_at)}m ago) ·{" "}
                      {call.status === "acknowledged"
                        ? `${call.acknowledged_by || "Staff"} on the way`
                        : "Waiting"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {call.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => onUpdateCall(call.id, "acknowledged")}
                      className="h-9 px-3 rounded-xl bg-amber-100 text-amber-950 text-xs font-semibold hover:bg-amber-200"
                    >
                      On the way
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onUpdateCall(call.id, "completed")}
                    className="h-9 px-3 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 inline-flex items-center gap-1"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Done
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-6">
          <h3 className="font-display text-xl mb-3">Recently completed</h3>
          <div className="divide-y divide-[var(--qm-line)]/70">
            {history.map((c) => {
              const meta = CALL_META[c.call_type] || CALL_META.waiter;
              return (
                <div key={c.id} className="py-2.5 flex items-center justify-between text-xs">
                  <span>
                    <strong>Table {c.table_number}</strong> requested {meta.label}
                  </span>
                  <span className="text-[var(--qm-muted)]">
                    Done at {c.completed_at ? formatTimeShort(c.completed_at) : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
