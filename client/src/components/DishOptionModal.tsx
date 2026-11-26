import { useState } from "react";
import { Check, Clock, Minus, Plus, Sparkles, X } from "lucide-react";
import { VegBadge } from "./VegBadge";
import { formatINR } from "../lib/api";
import { handleDishImageError, resolveDishImage } from "../lib/dishMedia";
import type { MenuItem } from "../types";

interface DishOptionModalProps {
  item: MenuItem;
  onClose: () => void;
  onConfirm: (payload: {
    size: string | null;
    addons: string[];
    note: string;
    unitPrice: number;
    quantity?: number;
  }) => void;
}

const QUICK_NOTES = ["Less spicy", "No onion / garlic", "Extra crisp", "With cutlery"];

export function DishOptionModal({ item, onClose, onConfirm }: DishOptionModalProps) {
  const [selectedSize, setSelectedSize] = useState<string | null>(
    item.size_variants[0]?.name ?? null
  );
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [quantity, setQuantity] = useState(1);

  const basePrice =
    item.size_variants.length > 0
      ? item.size_variants.find((s) => s.name === selectedSize)?.price ?? item.price
      : item.price;

  const addonsTotal = item.addons
    .filter((a) => selectedAddons.includes(a.name))
    .reduce((sum, a) => sum + a.price, 0);

  const unitPrice = basePrice + addonsTotal;
  const lineTotal = unitPrice * quantity;

  const toggleAddon = (name: string) => {
    setSelectedAddons((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]
    );
  };

  const toggleQuickNote = (tag: string) => {
    const parts = note
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const exists = parts.some((p) => p.toLowerCase() === tag.toLowerCase());
    const next = exists
      ? parts.filter((p) => p.toLowerCase() !== tag.toLowerCase())
      : [...parts, tag];
    setNote(next.join(", "));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[3px] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-[var(--qm-card)] w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-[var(--qm-line)] overflow-hidden shadow-2xl max-h-[92dvh] flex flex-col">
        {/* Dish Photography Header */}
        <div className="relative h-48 sm:h-52 w-full bg-[var(--qm-surface)] flex-shrink-0">
          <img
            src={resolveDishImage(item.image_url)}
            onError={handleDishImageError}
            alt={item.name}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/20" />

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3.5 right-3.5 h-9 w-9 rounded-full bg-white/95 hover:bg-white text-[var(--qm-accent)] shadow-md flex items-center justify-center transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="absolute bottom-3.5 inset-x-5 text-white">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/95 text-[var(--qm-accent)] text-[11px] font-semibold">
                <VegBadge isVeg={item.is_veg} />
                <span>{item.is_veg === 1 ? "Pure Veg" : item.is_veg === 0 ? "Non-Veg" : "Special"}</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-black/45 backdrop-blur-sm text-[11px] font-medium">
                <Clock className="h-3 w-3" />
                {item.prep_minutes} min
              </span>
              {item.is_bestseller && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-[11px] font-semibold">
                  <Sparkles className="h-3 w-3" />
                  Bestseller
                </span>
              )}
            </div>
            <div className="flex items-end justify-between gap-3">
              <h2 className="font-display text-2xl sm:text-3xl leading-tight">{item.name}</h2>
              <span className="text-base font-bold tabular-nums text-white flex-shrink-0">
                {formatINR(basePrice)}
              </span>
            </div>
          </div>
        </div>

        {/* Customization Controls */}
        <div className="p-5 space-y-5 overflow-y-auto">
          {item.description && (
            <p className="text-xs sm:text-sm text-[var(--qm-muted)] leading-relaxed">
              {item.description}
            </p>
          )}

          {item.size_variants.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--qm-muted)] mb-2.5">
                Choose Portion Size
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {item.size_variants.map((variant) => {
                  const active = selectedSize === variant.name;
                  return (
                    <button
                      key={variant.name}
                      type="button"
                      onClick={() => setSelectedSize(variant.name)}
                      className={`flex items-center justify-between px-3.5 py-3 rounded-2xl border text-sm transition-all ${
                        active
                          ? "border-[var(--qm-accent)] bg-[var(--qm-bg)] ring-1 ring-[var(--qm-accent)] font-semibold text-[var(--qm-accent)]"
                          : "border-[var(--qm-line)] bg-white hover:bg-[var(--qm-surface)]"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          style={active ? { borderColor: "var(--qm-accent)", backgroundColor: "var(--qm-accent)" } : undefined}
                          className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                            active ? "" : "border-[var(--qm-muted)]"
                          }`}
                        >
                          {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </span>
                        <span>{variant.name}</span>
                      </span>
                      <span className="tabular-nums">{formatINR(variant.price)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {item.addons.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--qm-muted)] mb-2.5">
                Upgrade with Add-ons
              </p>
              <div className="space-y-2">
                {item.addons.map((addon) => {
                  const checked = selectedAddons.includes(addon.name);
                  return (
                    <button
                      key={addon.name}
                      type="button"
                      onClick={() => toggleAddon(addon.name)}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl border text-sm transition-all ${
                        checked
                          ? "border-[var(--qm-accent)] bg-[var(--qm-bg)] ring-1 ring-[var(--qm-accent)] font-semibold text-[var(--qm-accent)]"
                          : "border-[var(--qm-line)] bg-white hover:bg-[var(--qm-surface)]"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span
                          style={
                            checked
                              ? {
                                  borderColor: "var(--qm-accent)",
                                  backgroundColor: "var(--qm-accent)",
                                  color: "var(--qm-accent-ink)",
                                }
                              : undefined
                          }
                          className={`h-4 w-4 rounded-md border flex items-center justify-center ${
                            checked ? "" : "border-[var(--qm-muted)]"
                          }`}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <span>{addon.name}</span>
                      </span>
                      <span className="tabular-nums text-xs font-semibold">
                        +{formatINR(addon.price)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="dish-note"
              className="block text-[11px] font-bold uppercase tracking-wider text-[var(--qm-muted)] mb-2"
            >
              Chef Preferences &amp; Note
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {QUICK_NOTES.map((tag) => {
                const active = note.toLowerCase().includes(tag.toLowerCase());
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleQuickNote(tag)}
                    style={
                      active
                        ? {
                            borderColor: "var(--qm-accent)",
                            backgroundColor: "var(--qm-accent)",
                            color: "var(--qm-accent-ink)",
                          }
                        : undefined
                    }
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                      active
                        ? ""
                        : "border-[var(--qm-line)] bg-[var(--qm-bg)] text-[var(--qm-muted)] hover:border-[var(--qm-accent)]/50"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <input
              id="dish-note"
              type="text"
              maxLength={120}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Less spicy, serve piping hot..."
              className="w-full h-10 px-3.5 rounded-xl border border-[var(--qm-line)] bg-[var(--qm-bg)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--qm-accent)]"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--qm-line)] bg-[var(--qm-bg)] flex items-center gap-3">
          <div className="inline-flex items-center h-12 rounded-2xl border border-[var(--qm-line)] bg-white px-1">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label="Decrease quantity"
              className="h-10 w-9 flex items-center justify-center text-[var(--qm-accent)] hover:bg-[var(--qm-surface)] rounded-xl"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-8 text-center text-sm font-bold tabular-nums">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(20, q + 1))}
              aria-label="Increase quantity"
              className="h-10 w-9 flex items-center justify-center text-[var(--qm-accent)] hover:bg-[var(--qm-surface)] rounded-xl"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() =>
              onConfirm({
                size: selectedSize,
                addons: selectedAddons,
                note: note.trim(),
                unitPrice,
                quantity,
              })
            }
            style={{
              backgroundColor: "var(--qm-accent)",
              color: "var(--qm-accent-ink)",
            }}
            className="flex-1 h-12 px-5 rounded-2xl font-semibold text-sm flex items-center justify-between shadow-md transition-opacity hover:opacity-95"
          >
            <span>Add to order</span>
            <span className="tabular-nums font-bold">{formatINR(lineTotal)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
