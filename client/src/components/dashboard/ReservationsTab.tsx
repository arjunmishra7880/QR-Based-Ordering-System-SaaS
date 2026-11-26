import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Check, Clock, Pencil, Users, X } from "lucide-react";
import { useToast } from "../Toast";
import { apiJson } from "../../lib/api";
import type { FloorState, ReservationRecord, ReservationStatus } from "../../types";

interface ReservationsTabProps {
  actorName: string;
  onSyncExternal?: () => void;
}

const STATUS_BADGE: Record<ReservationStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-100 text-amber-900" },
  confirmed: { label: "Confirmed", cls: "bg-emerald-100 text-emerald-900" },
  seated: { label: "Seated", cls: "bg-sky-100 text-sky-900" },
  rejected: { label: "Declined", cls: "bg-red-100 text-red-800" },
  cancelled: { label: "Cancelled", cls: "bg-stone-200 text-stone-700" },
};

export function ReservationsTab({ actorName, onSyncExternal }: ReservationsTabProps) {
  const { toast } = useToast();
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [tableNumbers, setTableNumbers] = useState<string[]>([]);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ReservationRecord | null>(null);
  const [editForm, setEditForm] = useState({
    reservation_date: "",
    reservation_time: "",
    party_size: 2,
    assigned_table: "",
    admin_note: "",
  });

  const loadAll = useCallback(async () => {
    try {
      const [resv, fl] = await Promise.all([
        apiJson<{ reservations: ReservationRecord[] }>("/api/admin/reservations"),
        apiJson<FloorState>("/api/admin/floor"),
      ]);
      setReservations(resv.reservations || []);
      setTableNumbers(fl.config?.numbers || []);
    } catch {
      // handled cleanly
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const patchReservation = async (
    id: string,
    payload: Record<string, unknown>,
    successMsg: string
  ) => {
    setBusyId(id);
    try {
      const res = await apiJson<{ reservation: ReservationRecord }>(
        `/api/admin/reservations/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ ...payload, by: actorName }),
        }
      );
      setReservations((prev) => prev.map((r) => (r.id === id ? res.reservation : r)));
      toast({ title: successMsg, variant: "success" });
      onSyncExternal?.();
    } catch (err) {
      toast({
        title: "Reservation update failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const openEdit = (r: ReservationRecord) => {
    setEditing(r);
    setEditForm({
      reservation_date: r.reservation_date,
      reservation_time: r.reservation_time,
      party_size: r.party_size,
      assigned_table: r.assigned_table || "",
      admin_note: r.admin_note || "",
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    await patchReservation(editing.id, editForm, "Reservation modified");
    setEditing(null);
  };

  const visible = reservations.filter((r) =>
    filter === "active" ? ["pending", "confirmed"].includes(r.status) : true
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl">Table Bookings</h2>
          <p className="text-sm text-[var(--qm-muted)]">
            Approve, assign tables, modify, or seat restaurant reservations
          </p>
        </div>

        <div className="inline-flex rounded-xl bg-white border border-[var(--qm-line)] p-1">
          {(["active", "all"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold capitalize ${
                filter === tab
                  ? "bg-[var(--qm-accent)] text-white"
                  : "text-[var(--qm-muted)]"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-10 text-center text-sm text-[var(--qm-muted)]">
          No {filter === "active" ? "pending or upcoming " : ""}table reservations yet.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((r) => {
            const st = STATUS_BADGE[r.status] || STATUS_BADGE.pending;
            const busy = busyId === r.id;
            return (
              <div
                key={r.id}
                className="rounded-2xl bg-white border border-[var(--qm-line)] p-5 shadow-xs space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-full bg-[var(--qm-tint)] text-[var(--qm-accent)]">
                        {r.booking_code}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.cls}`}>
                        {st.label}
                      </span>
                    </div>
                    <h3 className="font-display text-xl text-[#49332A] mt-1.5">
                      {r.customer_name}
                    </h3>
                    <p className="text-xs text-[var(--qm-muted)]">{r.customer_phone}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    className="h-8 px-2.5 rounded-lg border border-[var(--qm-line)] text-xs font-semibold inline-flex items-center gap-1 hover:border-[#49332A]"
                  >
                    <Pencil className="h-3 w-3" />
                    Modify
                  </button>
                </div>

                <div className="flex flex-wrap gap-3 text-xs text-[#49332A] bg-[var(--qm-bg)] rounded-xl px-3.5 py-2.5 border border-[var(--qm-line)]">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <CalendarClock className="h-3.5 w-3.5" />
                    {r.reservation_date}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <Clock className="h-3.5 w-3.5" />
                    {r.reservation_time}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <Users className="h-3.5 w-3.5" />
                    {r.party_size} guests
                  </span>
                  {r.assigned_table && (
                    <span className="font-bold text-emerald-800">· Table {r.assigned_table}</span>
                  )}
                </div>

                {r.notes && (
                  <p className="text-xs text-[var(--qm-muted)]">Guest note: &ldquo;{r.notes}&rdquo;</p>
                )}

                {["pending", "confirmed"].includes(r.status) && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {r.status === "pending" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          patchReservation(
                            r.id,
                            {
                              status: "confirmed",
                              assigned_table: r.assigned_table || tableNumbers[0] || "1",
                            },
                            `Approved booking ${r.booking_code}`
                          )
                        }
                        className="h-9 px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Approve
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        patchReservation(
                          r.id,
                          {
                            status: "seated",
                            assigned_table: r.assigned_table || tableNumbers[0] || "1",
                          },
                          `Seated at Table ${r.assigned_table || tableNumbers[0] || "1"}`
                        )
                      }
                      className="h-9 px-3.5 rounded-xl bg-[#49332A] hover:bg-[#38261F] text-[#FAF8F5] text-xs font-semibold"
                    >
                      Seat Guest
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        patchReservation(r.id, { status: "rejected" }, `Rejected ${r.booking_code}`)
                      }
                      className="h-9 px-3.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
          <form
            onSubmit={saveEdit}
            className="bg-white w-full max-w-md rounded-3xl border border-[var(--qm-line)] p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-2xl text-[#49332A]">
                Modify {editing.booking_code}
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Close"
                className="p-1.5 rounded-full hover:bg-[var(--qm-surface)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={editForm.reservation_date}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, reservation_date: e.target.value }))
                  }
                  className="w-full h-9 px-2.5 rounded-xl border border-[var(--qm-line)]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Time</label>
                <input
                  type="time"
                  required
                  value={editForm.reservation_time}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, reservation_time: e.target.value }))
                  }
                  className="w-full h-9 px-2.5 rounded-xl border border-[var(--qm-line)]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Party Size</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={editForm.party_size}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, party_size: Number(e.target.value) || 2 }))
                  }
                  className="w-full h-9 px-2.5 rounded-xl border border-[var(--qm-line)]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Assign Table</label>
                <select
                  value={editForm.assigned_table}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, assigned_table: e.target.value }))
                  }
                  className="w-full h-9 px-2.5 rounded-xl border border-[var(--qm-line)] bg-white"
                >
                  <option value="">Unassigned</option>
                  {tableNumbers.map((t) => (
                    <option key={t} value={t}>
                      Table {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Admin Note (visible to guest)</label>
              <input
                type="text"
                maxLength={200}
                value={editForm.admin_note}
                onChange={(e) => setEditForm((f) => ({ ...f, admin_note: e.target.value }))}
                placeholder="Corner booth reserved..."
                className="w-full h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="h-9 px-4 rounded-xl border border-[var(--qm-line)] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-9 px-4 rounded-xl bg-[#49332A] text-[#FAF8F5] text-xs font-semibold"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
