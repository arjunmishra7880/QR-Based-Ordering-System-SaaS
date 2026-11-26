import type { SyntheticEvent } from "react";

export const DEFAULT_DISH_IMAGE = "/food/default-dish.jpg";
export const DEFAULT_COVER_IMAGE = "/food/hero-cover.jpg";

export const DISH_PHOTO_PRESETS: Array<{ label: string; url: string }> = [
  { label: "Default Plate", url: "/food/default-dish.jpg" },
  { label: "Samosa", url: "/food/samosa.jpg" },
  { label: "Paneer Tikka", url: "/food/paneer-tikka.jpg" },
  { label: "Chicken Tikka", url: "/food/chicken-tikka.jpg" },
  { label: "Butter Chicken", url: "/food/butter-chicken.jpg" },
  { label: "Dal Makhani", url: "/food/dal-makhani.jpg" },
  { label: "Masala Dosa", url: "/food/masala-dosa.jpg" },
  { label: "Garlic Naan", url: "/food/garlic-naan.jpg" },
  { label: "Dum Biryani", url: "/food/biryani.jpg" },
  { label: "Masala Chai", url: "/food/masala-chai.jpg" },
  { label: "Cold Coffee", url: "/food/cold-coffee.jpg" },
];

const LEGACY_SVG_MAP: Record<string, string> = {
  "/food/samosa.svg": "/food/samosa.jpg",
  "/food/paneer-tikka.svg": "/food/paneer-tikka.jpg",
  "/food/chicken-tikka.svg": "/food/chicken-tikka.jpg",
  "/food/butter-chicken.svg": "/food/butter-chicken.jpg",
  "/food/dal-makhani.svg": "/food/dal-makhani.jpg",
  "/food/masala-dosa.svg": "/food/masala-dosa.jpg",
  "/food/garlic-naan.svg": "/food/garlic-naan.jpg",
  "/food/biryani.svg": "/food/biryani.jpg",
  "/food/masala-chai.svg": "/food/masala-chai.jpg",
  "/food/cold-coffee.svg": "/food/cold-coffee.jpg",
  "/food/hero-cover.svg": "/food/hero-cover.jpg",
};

export function resolveDishImage(url?: string | null): string {
  const clean = (url || "").trim();
  if (!clean) return DEFAULT_DISH_IMAGE;
  return LEGACY_SVG_MAP[clean] || clean;
}

export function resolveCoverImage(url?: string | null): string {
  const clean = (url || "").trim();
  if (!clean || clean === "/food/hero-cover.svg") return DEFAULT_COVER_IMAGE;
  return clean;
}

export function handleDishImageError(e: SyntheticEvent<HTMLImageElement>): void {
  const img = e.currentTarget;
  if (img.dataset.fallbackApplied === "1") return;
  img.dataset.fallbackApplied = "1";
  img.src = DEFAULT_DISH_IMAGE;
}

export function handleCoverImageError(e: SyntheticEvent<HTMLImageElement>): void {
  const img = e.currentTarget;
  if (img.dataset.fallbackApplied === "1") return;
  img.dataset.fallbackApplied = "1";
  img.src = DEFAULT_COVER_IMAGE;
}
