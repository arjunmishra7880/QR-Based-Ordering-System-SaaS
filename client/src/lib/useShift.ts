import { useCallback, useEffect, useState } from "react";
import { apiJson } from "./api";
import type { StaffRole } from "../types";

export interface ActiveShiftActor {
  id: string;
  name: string;
  role: StaffRole;
  section: string;
}

const STORAGE_KEY = "qserve_shift_actor_v1";
const SHIFT_EVENT = "qserve-shift-change";

function readStored(): ActiveShiftActor | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

export function useShift() {
  const [actor, setActor] = useState<ActiveShiftActor | null>(() => readStored());

  useEffect(() => {
    const sync = () => setActor(readStored());
    window.addEventListener(SHIFT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SHIFT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const persist = useCallback((next: ActiveShiftActor | null) => {
    try {
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setActor(next);
    window.dispatchEvent(new Event(SHIFT_EVENT));
  }, []);

  const unlockWithPin = useCallback(
    async (pin: string) => {
      const res = await apiJson<{ staff: ActiveShiftActor }>("/api/admin/staff/unlock", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      persist(res.staff);
      return res.staff;
    },
    [persist]
  );

  return {
    actor,
    actorName: actor?.name || "Owner",
    unlockWithPin,
    endShift: () => persist(null),
  };
}
