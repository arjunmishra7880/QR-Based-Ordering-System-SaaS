import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useToast } from "./Toast";
import { apiJson, getStoredPinToken } from "../lib/api";
import type { SeatingView, SpinPrize } from "../types";

interface SpinWheelModalProps {
  tableNumber: string;
  restaurantSlug?: string;
  prizes: SpinPrize[];
  existingSpin: SpinPrize | null;
  onResult: (seating: SeatingView) => void;
  onClose: () => void;
}

export function SpinWheelModal({
  tableNumber,
  restaurantSlug,
  prizes,
  existingSpin,
  onResult,
  onClose,
}: SpinWheelModalProps) {
  const { toast } = useToast();
  const [spinning, setSpinning] = useState(false);
  const [angle, setAngle] = useState(0);
  const [won, setWon] = useState<SpinPrize | null>(existingSpin);

  const count = Math.max(2, prizes.length);
  const sliceDeg = 360 / count;
  const pointOnCircle = (deg: number, r = 100) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)];
  };

  const handleSpin = async () => {
    if (spinning || won) return;
    setSpinning(true);
    try {
      const pinToken = getStoredPinToken(restaurantSlug || "", tableNumber);
      const res = await apiJson<{ spin: SpinPrize; seating: SeatingView }>("/api/public/seating/spin", {
        method: "POST",
        headers: pinToken ? { "X-Table-Pin-Token": pinToken } : undefined,
        body: JSON.stringify({
          tableNumber,
          ...(restaurantSlug ? { restaurant: restaurantSlug } : {}),
        }),
      });
      const idx = res.spin.index ?? 0;
      const targetCenter = (idx + 0.5) * sliceDeg;
      const targetAngle = 360 * 5 + (360 - targetCenter);
      setAngle(targetAngle);
      setTimeout(() => {
        setWon(res.spin);
        onResult(res.seating);
        setSpinning(false);
      }, 3200);
    } catch (err) {
      setSpinning(false);
      toast({
        title: "Cannot spin right now",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[3px] flex items-center justify-center p-4">
      <div className="bg-[var(--qm-card)] w-full max-w-sm rounded-3xl border border-[var(--qm-line)] p-6 text-center shadow-2xl relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 h-8 w-8 rounded-full hover:bg-[var(--qm-surface)] flex items-center justify-center"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="font-display text-3xl text-[#49332A]">Spin &amp; Win</h2>
        <p className="text-xs text-[var(--qm-muted)] mt-1">
          One celebratory spin per table · Table {tableNumber}
        </p>

        {/* Pointer + SVG Wheel */}
        <div className="relative w-56 h-56 mx-auto mt-5">
          <svg
            viewBox="0 0 24 20"
            className="w-6 h-5 text-[#49332A] absolute left-1/2 -top-1.5 -translate-x-1/2 z-10 drop-shadow"
          >
            <path d="M12 20 L2 2 Q12 -1 22 2 Z" fill="currentColor" />
          </svg>

          <svg
            viewBox="0 0 200 200"
            className="w-full h-full"
            style={{
              transform: `rotate(${angle}deg)`,
              transition: "transform 3.1s cubic-bezier(0.15, 0.72, 0.1, 1)",
            }}
          >
            {prizes.map((p, idx) => {
              const [x1, y1] = pointOnCircle(idx * sliceDeg);
              const [x2, y2] = pointOnCircle((idx + 1) * sliceDeg);
              const mid = (idx + 0.5) * sliceDeg;
              const [tx, ty] = pointOnCircle(mid, 64);
              const fill = idx % 2 === 0 ? "#FAF8F5" : "#49332A";
              const textColor = idx % 2 === 0 ? "#49332A" : "#FAF8F5";
              const shortLabel = p.label.length > 13 ? `${p.label.slice(0, 12)}…` : p.label;
              return (
                <g key={`${p.label}-${idx}`}>
                  <path
                    d={`M100 100 L${x1} ${y1} A100 100 0 ${sliceDeg > 180 ? 1 : 0} 1 ${x2} ${y2} Z`}
                    fill={fill}
                    stroke="#E4DDD5"
                    strokeWidth="1"
                  />
                  <text
                    x={tx}
                    y={ty}
                    transform={`rotate(${mid} ${tx} ${ty})`}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={count > 6 ? "8.5" : "9.5"}
                    fontWeight="600"
                    fill={textColor}
                  >
                    {shortLabel}
                  </text>
                </g>
              );
            })}
            <circle cx="100" cy="100" r="99" fill="none" stroke="#49332A" strokeWidth="2" />
            <circle cx="100" cy="100" r="14" fill="#FAF8F5" stroke="#49332A" strokeWidth="2" />
            <circle cx="100" cy="100" r="5" fill="#49332A" />
          </svg>
        </div>

        <div className="mt-6">
          {won ? (
            <div className="rounded-2xl bg-[#FAF8F5] border border-[var(--qm-line)] p-4 space-y-1">
              <p className="inline-flex items-center gap-1.5 font-display text-2xl text-[#49332A]">
                <Sparkles className="h-5 w-5" />
                {won.kind === "none" ? won.label : `You won ${won.label}!`}
              </p>
              <p className="text-xs text-[var(--qm-muted)]">
                {won.kind === "pct" || won.kind === "flat"
                  ? "Automatically applied to your table bill."
                  : won.kind === "item"
                    ? "Show this screen to your server to claim."
                    : "Thanks for playing — enjoy your meal!"}
              </p>
            </div>
          ) : (
            <button
              type="button"
              disabled={spinning}
              onClick={handleSpin}
              className="w-full h-11 rounded-2xl bg-[#49332A] hover:bg-[#38261F] disabled:opacity-55 text-[#FAF8F5] font-semibold text-sm shadow-md"
            >
              {spinning ? "Spinning..." : "Spin the wheel"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
