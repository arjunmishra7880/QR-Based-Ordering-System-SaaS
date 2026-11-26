import React, { useState } from "react";
import { ImageIcon, Pencil, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useToast } from "../Toast";
import { VegBadge } from "../VegBadge";
import { apiJson, apiUploadImage, formatINR } from "../../lib/api";
import {
  DEFAULT_DISH_IMAGE,
  DISH_PHOTO_PRESETS,
  handleDishImageError,
  resolveDishImage,
} from "../../lib/dishMedia";
import type { AddonOption, Category, MenuItem, SizeVariant } from "../../types";

interface MenuTabProps {
  categories: Category[];
  items: MenuItem[];
  onRefresh: () => Promise<void>;
}

interface ItemFormState {
  id?: string;
  name: string;
  description: string;
  price: string;
  category_id: string;
  image_url: string;
  is_veg: number;
  is_bestseller: boolean;
  is_chef_special: boolean;
  is_available: boolean;
  prep_minutes: string;
  size_variants: SizeVariant[];
  addons: AddonOption[];
}

export function MenuTab({ categories, items, onRefresh }: MenuTabProps) {
  const { toast } = useToast();
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryStation, setNewCategoryStation] = useState("");
  const [savingCat, setSavingCat] = useState(false);

  const [selectedCatFilter, setSelectedCatFilter] = useState<string>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<ItemFormState>({
    name: "",
    description: "",
    price: "",
    category_id: categories[0]?.id || "",
    image_url: "",
    is_veg: 1,
    is_bestseller: false,
    is_chef_special: false,
    is_available: true,
    prep_minutes: "10",
    size_variants: [],
    addons: [],
  });

  const addCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setSavingCat(true);
    try {
      await apiJson("/api/admin/categories", {
        method: "POST",
        body: JSON.stringify({
          name: newCategoryName.trim(),
          station: newCategoryStation.trim(),
        }),
      });
      setNewCategoryName("");
      setNewCategoryStation("");
      await onRefresh();
      toast({ title: "Category added", variant: "success" });
    } catch (err) {
      toast({
        title: "Failed to add category",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSavingCat(false);
    }
  };

  const updateStation = async (cat: Category, station: string) => {
    if (station.trim() === (cat.station || "")) return;
    try {
      await apiJson(`/api/admin/categories/${cat.id}`, {
        method: "PATCH",
        body: JSON.stringify({ station: station.trim() }),
      });
      await onRefresh();
      toast({
        title: station.trim() ? `${cat.name} → ${station.trim()}` : `${cat.name} shown on all KDS`,
      });
    } catch {
      toast({ title: "Could not save station", variant: "destructive" });
    }
  };

  const deleteCategory = async (cat: Category) => {
    try {
      await apiJson(`/api/admin/categories/${cat.id}`, { method: "DELETE" });
      await onRefresh();
      toast({ title: "Category deleted" });
    } catch {
      toast({ title: "Failed to delete category", variant: "destructive" });
    }
  };

  const openNewItem = () => {
    setForm({
      name: "",
      description: "",
      price: "",
      category_id: categories[0]?.id || "",
      image_url: "",
      is_veg: 1,
      is_bestseller: false,
      is_chef_special: false,
      is_available: true,
      prep_minutes: "10",
      size_variants: [],
      addons: [],
    });
    setModalOpen(true);
  };

  const openEditItem = (item: MenuItem) => {
    setForm({
      id: item.id,
      name: item.name,
      description: item.description,
      price: String(item.price),
      category_id: item.category_id || "",
      image_url: item.image_url || "",
      is_veg: item.is_veg,
      is_bestseller: item.is_bestseller,
      is_chef_special: item.is_chef_special,
      is_available: item.is_available,
      prep_minutes: String(item.prep_minutes),
      size_variants: item.size_variants,
      addons: item.addons,
    });
    setModalOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await apiUploadImage(file);
      setForm((prev) => ({ ...prev, image_url: res.url }));
      toast({ title: "Image uploaded", variant: "success" });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Check image size/format.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const saveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingItem(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        price: Number(form.price) || 0,
        category_id: form.category_id || null,
        image_url: form.image_url.trim() || null,
        is_veg: form.is_veg,
        is_bestseller: form.is_bestseller,
        is_chef_special: form.is_chef_special,
        is_available: form.is_available,
        prep_minutes: Number(form.prep_minutes) || 10,
        size_variants: form.size_variants.filter((s) => s.name.trim()),
        addons: form.addons.filter((a) => a.name.trim()),
      };
      if (form.id) {
        await apiJson(`/api/admin/items/${form.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        toast({ title: "Menu item updated", variant: "success" });
      } else {
        await apiJson("/api/admin/items", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast({ title: "Menu item added", variant: "success" });
      }
      setModalOpen(false);
      await onRefresh();
    } catch (err) {
      toast({
        title: "Failed to save item",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSavingItem(false);
    }
  };

  const toggleAvailability = async (item: MenuItem) => {
    try {
      await apiJson(`/api/admin/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_available: !item.is_available }),
      });
      await onRefresh();
    } catch {
      toast({ title: "Failed to toggle availability", variant: "destructive" });
    }
  };

  const deleteItem = async (item: MenuItem) => {
    try {
      await apiJson(`/api/admin/items/${item.id}`, { method: "DELETE" });
      await onRefresh();
      toast({ title: `${item.name} deleted` });
    } catch {
      toast({ title: "Failed to delete item", variant: "destructive" });
    }
  };

  const visibleItems = items.filter(
    (i) => selectedCatFilter === "all" || i.category_id === selectedCatFilter
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl">Menu</h2>
          <p className="text-sm text-[var(--qm-muted)]">
            Manage dishes, categories, kitchen stations, and availability
          </p>
        </div>

        <button
          type="button"
          onClick={openNewItem}
          className="h-10 px-4 rounded-xl bg-[var(--qm-accent)] hover:bg-[var(--qm-accent-hover)] text-white text-sm font-semibold inline-flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </button>
      </div>

      {/* Categories Card */}
      <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-5 shadow-xs space-y-4">
        <h3 className="font-display text-xl">Categories & Kitchen Stations</h3>

        <form onSubmit={addCategory} className="flex flex-wrap gap-2.5">
          <input
            type="text"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="Category name (e.g. Starters)"
            className="flex-1 min-w-[180px] h-10 px-3.5 rounded-xl bg-[var(--qm-surface)] border border-[var(--qm-line)] text-sm"
          />
          <input
            type="text"
            value={newCategoryStation}
            onChange={(e) => setNewCategoryStation(e.target.value)}
            placeholder="KDS Station (optional, e.g. Tandoor)"
            className="w-56 h-10 px-3.5 rounded-xl bg-[var(--qm-surface)] border border-[var(--qm-line)] text-sm"
          />
          <button
            type="submit"
            disabled={savingCat}
            className="h-10 px-4 rounded-xl bg-[var(--qm-ink)] text-white text-sm font-semibold hover:opacity-90"
          >
            + Add Category
          </button>
        </form>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {categories.map((cat) => {
            const count = items.filter((i) => i.category_id === cat.id).length;
            return (
              <div
                key={cat.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--qm-line)] bg-[var(--qm-surface)] px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{cat.name}</p>
                  <p className="text-xs text-[var(--qm-muted)]">{count} items</p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    defaultValue={cat.station}
                    placeholder="Station"
                    onBlur={(e) => updateStation(cat, e.target.value)}
                    className="w-24 h-8 px-2.5 rounded-lg bg-white border border-[var(--qm-line)] text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => deleteCategory(cat)}
                    aria-label={`Delete ${cat.name}`}
                    className="p-1.5 rounded-lg text-[var(--qm-muted)] hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setSelectedCatFilter("all")}
          className={`h-9 px-4 rounded-full text-xs font-semibold flex-shrink-0 ${
            selectedCatFilter === "all"
              ? "bg-[var(--qm-accent)] text-white"
              : "bg-white border border-[var(--qm-line)] text-[var(--qm-muted)]"
          }`}
        >
          All ({items.length})
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setSelectedCatFilter(cat.id)}
            className={`h-9 px-4 rounded-full text-xs font-semibold flex-shrink-0 ${
              selectedCatFilter === cat.id
                ? "bg-[var(--qm-accent)] text-white"
                : "bg-white border border-[var(--qm-line)] text-[var(--qm-muted)]"
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Items List */}
      <div className="grid gap-3.5 sm:grid-cols-2">
        {visibleItems.map((item) => (
          <div
            key={item.id}
            className="rounded-2xl bg-white border border-[var(--qm-line)] p-4 shadow-xs flex items-center gap-3.5"
          >
            <img
              src={resolveDishImage(item.image_url)}
              onError={handleDishImageError}
              alt={item.name}
              className="h-18 w-18 rounded-2xl object-cover bg-[var(--qm-surface)] border border-[var(--qm-line)] flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <VegBadge isVeg={item.is_veg} />
                <p className="font-semibold text-sm truncate">{item.name}</p>
              </div>
              <p className="text-xs font-semibold text-[var(--qm-accent)] mt-0.5 tabular-nums">
                {formatINR(item.price)}
                {item.size_variants.length > 0 && ` · ${item.size_variants.length} sizes`}
              </p>

              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleAvailability(item)}
                  className={`h-7 px-2.5 rounded-full text-[11px] font-semibold transition-colors ${
                    item.is_available
                      ? "bg-emerald-100 text-emerald-900"
                      : "bg-stone-200 text-stone-700"
                  }`}
                >
                  {item.is_available ? "Available" : "Sold Out"}
                </button>
                <button
                  type="button"
                  onClick={() => openEditItem(item)}
                  aria-label={`Edit ${item.name}`}
                  className="p-1.5 rounded-lg text-[var(--qm-muted)] hover:bg-[var(--qm-surface)]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteItem(item)}
                  aria-label={`Delete ${item.name}`}
                  className="p-1.5 rounded-lg text-[var(--qm-muted)] hover:text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit Item Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <form
            onSubmit={saveItem}
            className="bg-white w-full max-w-lg rounded-3xl border border-[var(--qm-line)] shadow-xl max-h-[90dvh] flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--qm-line)]">
              <h3 className="font-display text-2xl">
                {form.id ? "Edit Menu Item" : "Add New Menu Item"}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-[var(--qm-surface)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto text-sm">
              <div className="rounded-2xl border border-[var(--qm-line)] bg-[var(--qm-bg)] p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="font-semibold flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--qm-muted)]">
                    <ImageIcon className="h-3.5 w-3.5 text-[var(--qm-accent)]" />
                    Dish Photo
                  </label>
                  {form.image_url && form.image_url !== DEFAULT_DISH_IMAGE && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, image_url: "" })}
                      className="text-[11px] font-semibold text-[var(--qm-accent)] hover:underline inline-flex items-center gap-1"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Use default plate
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3.5">
                  <div className="relative h-20 w-20 rounded-2xl overflow-hidden border border-[var(--qm-line)] bg-white flex-shrink-0 shadow-xs">
                    <img
                      src={resolveDishImage(form.image_url)}
                      onError={handleDishImageError}
                      alt={form.name || "Dish preview"}
                      className="h-full w-full object-cover"
                    />
                    {(!form.image_url || form.image_url === DEFAULT_DISH_IMAGE) && (
                      <span className="absolute bottom-1 inset-x-1 text-center text-[9px] font-semibold bg-[#49332A]/85 text-[#FAF8F5] rounded-md py-0.5">
                        Default
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="h-9 px-3.5 rounded-xl border border-[var(--qm-line)] bg-white inline-flex items-center gap-2 cursor-pointer text-xs font-semibold hover:border-[var(--qm-accent)]">
                        <Upload className="h-3.5 w-3.5" />
                        <span>{uploading ? "Uploading..." : "Upload Real Photo"}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          onChange={handleImageUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                    <input
                      type="text"
                      value={form.image_url}
                      onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                      placeholder={`Default studio plate (${DEFAULT_DISH_IMAGE})`}
                      className="w-full h-9 px-3 rounded-xl border border-[var(--qm-line)] bg-white text-xs"
                    />
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[var(--qm-muted)] mb-1.5">
                    Or pick a matching studio dish photo:
                  </p>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                    {DISH_PHOTO_PRESETS.map((preset) => {
                      const active =
                        (preset.url === DEFAULT_DISH_IMAGE && !form.image_url) ||
                        form.image_url === preset.url;
                      return (
                        <button
                          key={preset.url}
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              image_url: preset.url === DEFAULT_DISH_IMAGE ? "" : preset.url,
                            })
                          }
                          title={preset.label}
                          className={`group flex-shrink-0 w-14 text-center rounded-xl p-1 border transition-colors ${
                            active
                              ? "border-[var(--qm-accent)] bg-[var(--qm-tint)]"
                              : "border-[var(--qm-line)] bg-white hover:border-[var(--qm-accent)]/50"
                          }`}
                        >
                          <img
                            src={preset.url}
                            alt={preset.label}
                            className="h-11 w-full rounded-lg object-cover"
                          />
                          <p className="text-[9px] font-medium truncate mt-0.5 text-[var(--qm-ink)]">
                            {preset.label.split(" ")[0]}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium mb-1">Item Name *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Paneer Tikka"
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Base Price (₹) *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    placeholder="220"
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium mb-1">Description</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Smoky grilled cottage cheese..."
                  className="w-full p-3 rounded-xl border border-[var(--qm-line)]"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium mb-1">Category</label>
                  <select
                    value={form.category_id}
                    onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] bg-white"
                  >
                    <option value="">Uncategorized</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">Kitchen Prep Time (min)</label>
                  <input
                    type="number"
                    min="1"
                    max="180"
                    value={form.prep_minutes}
                    onChange={(e) => setForm({ ...form, prep_minutes: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium mb-1.5">Food Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { val: 1, label: "Veg" },
                    { val: 0, label: "Non-veg" },
                    { val: 2, label: "None" },
                  ].map((opt) => (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => setForm({ ...form, is_veg: opt.val })}
                      className={`h-9 rounded-xl border text-xs font-semibold ${
                        form.is_veg === opt.val
                          ? "border-[var(--qm-accent)] bg-[var(--qm-tint)] text-[var(--qm-accent)]"
                          : "border-[var(--qm-line)]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-4 pt-1">
                <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_bestseller}
                    onChange={(e) => setForm({ ...form, is_bestseller: e.target.checked })}
                    className="rounded accent-[var(--qm-accent)]"
                  />
                  Bestseller badge
                </label>
                <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_chef_special}
                    onChange={(e) => setForm({ ...form, is_chef_special: e.target.checked })}
                    className="rounded accent-[var(--qm-accent)]"
                  />
                  Chef&apos;s pick
                </label>
              </div>

              {/* Size Options */}
              <div className="border-t border-[var(--qm-line)] pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-xs uppercase tracking-wider text-[var(--qm-muted)]">
                    Size Options
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        size_variants: [...form.size_variants, { name: "", price: 0 }],
                      })
                    }
                    className="text-xs font-semibold text-[var(--qm-accent)]"
                  >
                    + Add size
                  </button>
                </div>
                <div className="space-y-2">
                  {form.size_variants.map((sv, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        type="text"
                        value={sv.name}
                        onChange={(e) => {
                          const next = [...form.size_variants];
                          next[idx] = { ...sv, name: e.target.value };
                          setForm({ ...form, size_variants: next });
                        }}
                        placeholder="e.g. Half / Full"
                        className="flex-1 h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs"
                      />
                      <input
                        type="number"
                        value={sv.price}
                        onChange={(e) => {
                          const next = [...form.size_variants];
                          next[idx] = { ...sv, price: Number(e.target.value) };
                          setForm({ ...form, size_variants: next });
                        }}
                        placeholder="₹"
                        className="w-24 h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            size_variants: form.size_variants.filter((_, i) => i !== idx),
                          })
                        }
                        className="px-2 text-red-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add-ons */}
              <div className="border-t border-[var(--qm-line)] pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-xs uppercase tracking-wider text-[var(--qm-muted)]">
                    Add-ons
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        addons: [...form.addons, { name: "", price: 0 }],
                      })
                    }
                    className="text-xs font-semibold text-[var(--qm-accent)]"
                  >
                    + Add add-on
                  </button>
                </div>
                <div className="space-y-2">
                  {form.addons.map((ad, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        type="text"
                        value={ad.name}
                        onChange={(e) => {
                          const next = [...form.addons];
                          next[idx] = { ...ad, name: e.target.value };
                          setForm({ ...form, addons: next });
                        }}
                        placeholder="e.g. Extra Cheese"
                        className="flex-1 h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs"
                      />
                      <input
                        type="number"
                        value={ad.price}
                        onChange={(e) => {
                          const next = [...form.addons];
                          next[idx] = { ...ad, price: Number(e.target.value) };
                          setForm({ ...form, addons: next });
                        }}
                        placeholder="₹"
                        className="w-24 h-9 px-3 rounded-xl border border-[var(--qm-line)] text-xs"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            addons: form.addons.filter((_, i) => i !== idx),
                          })
                        }
                        className="px-2 text-red-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[var(--qm-line)] bg-[var(--qm-surface)] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="h-10 px-4 rounded-xl border border-[var(--qm-line)] text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingItem}
                className="h-10 px-5 rounded-xl bg-[var(--qm-accent)] text-white text-sm font-semibold hover:bg-[var(--qm-accent-hover)]"
              >
                {savingItem ? "Saving..." : form.id ? "Save Changes" : "Add Item"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
