export function BrandMark({
  size = "md",
  accent,
  logoUrl,
  alt = "Brand logo",
}: {
  size?: "sm" | "md" | "lg";
  accent?: string;
  logoUrl?: string | null;
  alt?: string;
}) {
  const box =
    size === "sm"
      ? "h-8 w-8 rounded-xl"
      : size === "lg"
        ? "h-12 w-12 rounded-2xl"
        : "h-9 w-9 rounded-xl";

  const bgColor = accent || "var(--qm-accent, #49332A)";

  if (logoUrl && logoUrl !== "/food/brand-logo.svg") {
    return (
      <span
        className={`${box} inline-flex items-center justify-center bg-white border border-[var(--qm-line)] shadow-sm flex-shrink-0 overflow-hidden`}
      >
        <img src={logoUrl} alt={alt} className="w-full h-full object-cover" />
      </span>
    );
  }

  return (
    <span
      style={{ backgroundColor: bgColor, color: "var(--qm-accent-ink, #FAF8F5)" }}
      className={`${box} inline-flex items-center justify-center shadow-sm flex-shrink-0 overflow-hidden`}
    >
      <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
        <rect width="40" height="40" fill={bgColor} />
        <path d="M8 32 A24 24 0 0 1 32 8 L32 22 A10 10 0 0 0 22 32 Z" fill="currentColor" />
        <circle cx="29" cy="29" r="3.5" fill="currentColor" />
      </svg>
    </span>
  );
}
