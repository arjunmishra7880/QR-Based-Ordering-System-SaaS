import React, { useCallback, useEffect, useMemo, useState } from "react";
import { History, Plus, Users, X } from "lucide-react";
import { useToast } from "../Toast";
import { apiJson } from "../../lib/api";
import type { ActivityLogItem, StaffMember, StaffRole } from "../../types";

interface StaffTabProps {
  actorName: string;
}

const ROLES: Array<{ value: StaffRole; label: string }> = [
  { value: "waiter", label: "Waiter" },
  { value: "kitchen", label: "Kitchen" },
  { value: "cashier", label: "Cashier" },
  { value: "manager", label: "Manager" },
];

const ACTION_LABELS: Record<string, string> = {
  table_opened: "Opened table",
  bill_closed: "Closed bill",
  bill_closed_unpaid: "Closed bill with balance due",
  pin_changed: "Changed table PIN",
  table_moved: "Moved guests",
  tables_merged: "Merged tables",
  payment_confirmed: "Confirmed payment",
  payment_rejected: "Marked payment not received",
  payment_taken: "Took payment",
  reward_redeemed: "Gave loyalty reward",
  staff_added: "Added staff",
  staff_updated: "Updated staff",
  shift_started: "Started shift",
  order_status: "Updated order",
  call_answered: "Answered call",
};

function formatDetails(details: Record<string, unknown>): string {
  const parts: string[] = [];
  if (details.table) parts.push(`Table ${details.table}`);
  if (details.from && details.to) parts.push(`${details.from} → ${details.to}`);
  if (details.into) parts.push(`${details.from} into ${details.into}`);
  if (details.amount !== undefined) parts.push(`₹${details.amount}`);
  if (details.mode) parts.push(String(details.mode).toUpperCase());
  if (details.name) parts.push(String(details.name));
  if (details.status) parts.push(String(details.status));
  if (details.note) parts.push(`"${details.note}"`);
  return parts.join(" · ");
}

export function StaffTab({ actorName }: StaffTabProps) {
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [actorFilter, setActorFilter] = useState("all");
  const [draft, setDraft] = useState<{
    id?: string;
    name: string;
    role: StaffRole;
    pin: string;
    section: string;
    active: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await apiJson<{ staff: StaffMember[]; logs: ActivityLogItem[] }>(
        "/api/admin/staff"
      );
      setStaff(res.staff);
      setLogs(res.logs);
    } catch {}
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    try {
      if (draft.id) {
        await apiJson(`/api/admin/staff/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...draft, by: actorName }),
        });
        toast({ title: "Staff updated", variant: "success" });
      } else {
        await apiJson("/api/admin/staff", {
          method: "POST",
          body: JSON.stringify({ ...draft, by: actorName }),
        });
        toast({
          title: `${draft.name.trim()} added`,
          description: "They can now start a shift with their PIN.",
          variant: "success",
        });
      }
      setDraft(null);
      await loadData();
    } catch (err) {
      toast({
        title: "Couldn't save staff member",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (m: StaffMember) => {
    try {
      await apiJson(`/api/admin/staff/${m.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !m.active, by: actorName }),
      });
      await loadData();
    } catch {
      toast({ title: "Could not update status", variant: "destructive" });
    }
  };

  const actors = useMemo(
    () => [...new Set(logs.map((l) => l.staff_name).filter(Boolean))],
    [logs]
  );
  const visibleLogs = logs.filter(
    (l) => actorFilter === "all" || l.staff_name === actorFilter
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-[var(--qm-tint)] text-[#49332A] flex items-center justify-center">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-3xl leading-none">Staff</h2>
            <p className="text-sm text-[var(--qm-muted)] mt-1">
              Everyone starts their shift with a PIN, so the log shows who did what.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            setDraft({ name: "", role: "waiter", pin: "", section: "", active: true })
          }
          className="h-10 px-4 rounded-xl bg-[#49332A] hover:bg-[#38261F] text-[#FAF8F5] text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Add staff
        </button>
      </div>

      {/* Team List */}
      <section>
        {staff.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[var(--qm-line)] p-8 text-center text-sm text-[var(--qm-muted)]">
            No staff yet. Add your waiters, kitchen, and cashier with a 4–6 digit PIN each.
          </div>
        ) : (
          <ul className="rounded-3xl border border-[var(--qm-line)] bg-white divide-y divide-[var(--qm-line)]">
            {staff.map((m) => (
              <li
                key={m.id}
                className={`p-4 flex flex-wrap items-center justify-between gap-3 ${
                  !m.active ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="h-10 w-10 rounded-full bg-[var(--qm-tint)] text-[#49332A] font-display text-lg flex items-center justify-center flex-shrink-0">
                    {m.name.charAt(0)}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{m.name}</p>
                    <p className="text-xs text-[var(--qm-muted)] capitalize">
                      {m.role}
                      {m.section ? ` · ${m.section}` : ""}
                      {m.pin ? ` · PIN: ${m.pin}` : ""}
                      {!m.active ? " · switched off" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        id: m.id,
                        name: m.name,
                        role: m.role,
                        pin: "",
                        section: m.section,
                        active: m.active,
                      })
                    }
                    className="h-8 px-3 rounded-xl border border-[var(--qm-line)] bg-white hover:border-[#49332A] text-xs font-semibold"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleActive(m)}
                    className="h-8 px-3 rounded-xl text-xs font-semibold text-[var(--qm-muted)] hover:bg-[var(--qm-surface)]"
                  >
                    {m.active ? "Switch off" : "Switch on"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Activity Log */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-xl flex items-center gap-2">
            <History className="h-4 w-4 text-[#49332A]" />
            Activity
          </h3>
          {actors.length > 0 && (
            <select
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              aria-label="Filter activity by actor"
              className="h-9 px-3 rounded-xl border border-[var(--qm-line)] bg-white text-xs font-medium"
            >
              <option value="all">Everyone</option>
              {actors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
        </div>

        {visibleLogs.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[var(--qm-line)] p-6 text-center text-sm text-[var(--qm-muted)]">
            Opening tables, payments, PIN changes, and bill closes appear here.
          </div>
        ) : (
          <ol className="rounded-3xl border border-[var(--qm-line)] bg-white divide-y divide-[var(--qm-line)] text-sm">
            {visibleLogs.map((l) => {
              const desc = formatDetails(l.details);
              return (
                <li key={l.id} className="p-3.5 grid grid-cols-[auto_1fr] gap-x-4 items-baseline">
                  <time className="text-xs text-[var(--qm-muted)] tabular-nums">
                    {new Date(l.created_at).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                  <div className="min-w-0">
                    <span className="font-semibold text-[#49332A]">{l.staff_name || "Owner"}</span>{" "}
                    <span>{(ACTION_LABELS[l.action] || l.action).toLowerCase()}</span>
                    {desc && <p className="text-xs text-[var(--qm-muted)] truncate">{desc}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Add/Edit Staff Modal */}
      {draft && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
          <form
            onSubmit={saveMember}
            className="bg-white w-full max-w-md rounded-3xl border border-[var(--qm-line)] p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-display text-2xl">
                  {draft.id ? `Edit ${draft.name}` : "Add staff"}
                </h3>
                <p className="text-xs text-[var(--qm-muted)] mt-0.5">
                  {draft.id
                    ? "Leave PIN blank to keep their current PIN."
                    : "They'll use this 4–6 digit PIN to start shifts."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="h-8 w-8 rounded-full hover:bg-[var(--qm-surface)] flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Name *</label>
              <input
                type="text"
                required
                maxLength={40}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Rahul Sharma"
                className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5">Role</label>
              <div className="grid grid-cols-4 gap-1.5">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setDraft({ ...draft, role: r.value })}
                    className={`h-9 rounded-xl border text-xs font-semibold ${
                      draft.role === r.value
                        ? "bg-[#49332A] text-[#FAF8F5] border-[#49332A]"
                        : "border-[var(--qm-line)] bg-[var(--qm-bg)]"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">
                  PIN (4–6 digits) {!draft.id && "*"}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  required={!draft.id}
                  maxLength={6}
                  value={draft.pin}
                  onChange={(e) =>
                    setDraft({ ...draft, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })
                  }
                  placeholder={draft.id ? "Keep current" : "e.g. 4545"}
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Section (optional)</label>
                <input
                  type="text"
                  maxLength={30}
                  value={draft.section}
                  onChange={(e) => setDraft({ ...draft, section: e.target.value })}
                  placeholder="e.g. Terrace"
                  className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="h-10 px-4 rounded-xl border border-[var(--qm-line)] text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-10 px-5 rounded-xl bg-[#49332A] text-[#FAF8F5] text-sm font-semibold"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
