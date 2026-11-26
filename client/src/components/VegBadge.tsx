export function VegBadge({ isVeg }: { isVeg: number }) {
  if (isVeg === 2) return null;
  const veg = isVeg === 1;
  return (
    <span
      title={veg ? "Vegetarian" : "Non-Vegetarian"}
      aria-label={veg ? "Vegetarian" : "Non-Vegetarian"}
      className={`inline-flex items-center justify-center h-4 w-4 rounded-[4px] border flex-shrink-0 ${
        veg ? "border-emerald-700" : "border-red-700"
      }`}
    >
      {veg ? (
        <span className="h-2 w-2 rounded-full bg-emerald-700" />
      ) : (
        <span className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[7px] border-b-red-700" />
      )}
    </span>
  );
}
