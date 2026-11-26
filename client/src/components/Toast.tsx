import React, { createContext, useCallback, useContext, useState } from "react";
import { X } from "lucide-react";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive" | "success";
}

interface ToastContextValue {
  toast: (item: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback((item: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems((prev) => [...prev.slice(-3), { ...item, id }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }, 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-[calc(100vw-2rem)] pointer-events-none">
        {items.map((item) => {
          const tone =
            item.variant === "destructive"
              ? "bg-red-600 text-white border-red-700"
              : item.variant === "success"
                ? "bg-emerald-700 text-white border-emerald-800"
                : "bg-white text-[var(--qm-ink)] border-[var(--qm-line)]";
          return (
            <div
              key={item.id}
              className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-lg flex items-start gap-3 transition-all ${tone}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-snug">{item.title}</p>
                {item.description && (
                  <p
                    className={`text-xs mt-0.5 leading-relaxed ${
                      item.variant === "destructive" || item.variant === "success"
                        ? "text-white/90"
                        : "text-[var(--qm-muted)]"
                    }`}
                  >
                    {item.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="opacity-70 hover:opacity-100 p-0.5"
                aria-label="Close notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
