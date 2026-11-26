import { useCallback, useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import QRCode from "qrcode";
import {
  Check,
  Circle,
  Copy,
  Download,
  ExternalLink,
  LayoutGrid,
  Palette,
  QrCode,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  SquareDot,
} from "lucide-react";
import { useToast } from "../Toast";
import { apiJson } from "../../lib/api";
import type { QrStyleConfig, RestaurantSettings } from "../../types";

interface QrTabProps {
  settings: RestaurantSettings;
  onSettingsUpdated: (s: RestaurantSettings) => void;
}

const DEFAULT_QR_STYLE: QrStyleConfig = {
  style: "standard",
  fgColor: "#000000",
  bgColor: "#FFFFFF",
  dotScale: 0.85,
  frameStyle: "rounded",
};

const QR_STYLES: Array<{
  id: QrStyleConfig["style"];
  name: string;
  icon: typeof QrCode;
}> = [
  { id: "standard", name: "Standard", icon: QrCode },
  { id: "circle", name: "Modern", icon: Circle },
  { id: "square", name: "Classic", icon: Square },
  { id: "rounded", name: "Rounded", icon: SquareDot },
  { id: "dots", name: "Dots", icon: Sparkles },
  { id: "elegant", name: "Elegant", icon: SlidersHorizontal },
];

const QR_COLORS: Array<{ id: string; name: string; fg: string; bg: string }> = [
  { id: "black", name: "Classic", fg: "#000000", bg: "#FFFFFF" },
  { id: "espresso", name: "Espresso", fg: "#49332A", bg: "#FFFFFF" },
  { id: "blue", name: "Ocean", fg: "#1E40AF", bg: "#FFFFFF" },
  { id: "green", name: "Forest", fg: "#166534", bg: "#FFFFFF" },
  { id: "purple", name: "Royal", fg: "#7C3AED", bg: "#FFFFFF" },
  { id: "red", name: "Ruby", fg: "#DC2626", bg: "#FFFFFF" },
  { id: "orange", name: "Sunset", fg: "#EA580C", bg: "#FFFFFF" },
  { id: "gradient1", name: "Fire", fg: "gradient:FF6B6B,FF8E53", bg: "#FFFFFF" },
  { id: "gradient2", name: "Ocean Grad", fg: "gradient:667EEA,764BA2", bg: "#FFFFFF" },
];

function parseColor(fgColor: string): { isGradient: boolean; colors: string[] } {
  if (fgColor.startsWith("gradient:")) {
    const colors = fgColor
      .replace("gradient:", "")
      .split(",")
      .map((c) => `#${c.trim()}`);
    return { isGradient: colors.length >= 2, colors };
  }
  return { isGradient: false, colors: [fgColor || "#000000"] };
}

/**
 * Renders the exact QuickMenu matrix QR onto a canvas with Error Correction H,
 * finder-pattern corner rounding, custom module shapes, and optional gradient fill.
 */
async function renderStyledQrDataUrl(
  url: string,
  size: number,
  cfg: QrStyleConfig
): Promise<string> {
  const qr = QRCode.create(url, { errorCorrectionLevel: "H" });
  const count = qr.modules.size;
  const pad = Math.floor(size * 0.08);
  const mod = (size - pad * 2) / count;
  const radius = (mod / 2) * cfg.dotScale;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = cfg.bgColor || "#FFFFFF";
  ctx.fillRect(0, 0, size, size);

  const { isGradient, colors } = parseColor(cfg.fgColor);
  if (isGradient && colors.length >= 2) {
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(1, colors[1]);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = colors[0] || "#000000";
  }

  if (cfg.style === "standard") {
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.modules.get(r, c)) {
          ctx.fillRect(pad + c * mod, pad + r * mod, mod + 0.3, mod + 0.3);
        }
      }
    }
    return canvas.toDataURL("image/png");
  }

  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!qr.modules.get(r, c)) continue;
      const cx = pad + c * mod + mod / 2;
      const cy = pad + r * mod + mod / 2;
      const inFinderOuter =
        (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);
      const inFinderEye =
        (r >= 2 && r <= 4 && c >= 2 && c <= 4) ||
        (r >= 2 && r <= 4 && c >= count - 5 && c <= count - 3) ||
        (r >= count - 5 && r <= count - 3 && c >= 2 && c <= 4);

      if (inFinderEye || inFinderOuter) {
        const s = inFinderEye ? 0.75 : 0.9;
        ctx.beginPath();
        ctx.roundRect(
          pad + c * mod + (mod * (1 - s)) / 2,
          pad + r * mod + (mod * (1 - s)) / 2,
          mod * s,
          mod * s,
          mod * 0.25
        );
        ctx.fill();
      } else {
        ctx.beginPath();
        switch (cfg.style) {
          case "circle":
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            break;
          case "square": {
            const w = radius * 1.8;
            ctx.rect(cx - w / 2, cy - w / 2, w, w);
            break;
          }
          case "rounded": {
            const w = radius * 1.8;
            ctx.roundRect(cx - w / 2, cy - w / 2, w, w, radius * 0.4);
            break;
          }
          case "dots":
            ctx.arc(cx, cy, radius * 0.7, 0, Math.PI * 2);
            break;
          case "elegant": {
            const s = radius * 1.4;
            ctx.moveTo(cx, cy - s);
            ctx.quadraticCurveTo(cx + s, cy, cx, cy + s);
            ctx.quadraticCurveTo(cx - s, cy, cx, cy - s);
            break;
          }
          default:
            ctx.rect(cx - mod / 2, cy - mod / 2, mod, mod);
        }
        ctx.fill();
      }
    }
  }

  return canvas.toDataURL("image/png");
}

function CornerBrackets({ frameStyle }: { frameStyle: QrStyleConfig["frameStyle"] }) {
  if (frameStyle === "none") return null;
  const cornerRound = frameStyle === "fancy" ? "xl" : frameStyle === "simple" ? "none" : "lg";
  const tl = cornerRound === "none" ? "" : `rounded-tl-${cornerRound}`;
  const tr = cornerRound === "none" ? "" : `rounded-tr-${cornerRound}`;
  const bl = cornerRound === "none" ? "" : `rounded-bl-${cornerRound}`;
  const br = cornerRound === "none" ? "" : `rounded-br-${cornerRound}`;
  return (
    <>
      <div className={`pointer-events-none absolute top-3 left-3 w-7 h-7 border-t-2 border-l-2 border-[#49332A] ${tl}`} />
      <div className={`pointer-events-none absolute top-3 right-3 w-7 h-7 border-t-2 border-r-2 border-[#49332A] ${tr}`} />
      <div className={`pointer-events-none absolute bottom-3 left-3 w-7 h-7 border-b-2 border-l-2 border-[#49332A] ${bl}`} />
      <div className={`pointer-events-none absolute bottom-3 right-3 w-7 h-7 border-b-2 border-r-2 border-[#49332A] ${br}`} />
    </>
  );
}

export function QrTab({ settings, onSettingsUpdated }: QrTabProps) {
  const { toast } = useToast();
  const [qrMode, setQrMode] = useState<"single" | "per_table">(settings.qr_mode);
  const [totalTables, setTotalTables] = useState(settings.table_config.total || 12);
  const [skipInput, setSkipInput] = useState((settings.table_config.skip || []).join(", "));
  const [disabledSet, setDisabledSet] = useState<number[]>(settings.table_config.disabled || []);
  const [selectedTable, setSelectedTable] = useState<number>(1);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [qrStyle, setQrStyle] = useState<QrStyleConfig>(() => ({
    ...DEFAULT_QR_STYLE,
    ...(settings.qr_style || {}),
  }));
  const [previewDataUrl, setPreviewDataUrl] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    setQrMode(settings.qr_mode);
    setTotalTables(settings.table_config.total || 12);
    setSkipInput((settings.table_config.skip || []).join(", "));
    setDisabledSet(settings.table_config.disabled || []);
    setQrStyle({ ...DEFAULT_QR_STYLE, ...(settings.qr_style || {}) });
  }, [settings]);

  const parsedSkip = useMemo(
    () =>
      skipInput
        .split(/[,\s]+/)
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n > 0),
    [skipInput]
  );

  const activeNumbers = useMemo(() => {
    const skip = new Set(parsedSkip);
    return Array.from({ length: Math.max(1, totalTables) }, (_, idx) => idx + 1).filter(
      (n) => !skip.has(n)
    );
  }, [totalTables, parsedSkip]);

  useEffect(() => {
    if (!activeNumbers.includes(selectedTable) && activeNumbers.length > 0) {
      setSelectedTable(activeNumbers[0]);
    }
  }, [activeNumbers, selectedTable]);

  const baseScanUrl = useMemo(() => {
    const customHost = (settings.custom_domain || "").trim();
    if (customHost && settings.custom_domain_verified) {
      return `https://${customHost}/scan`;
    }
    const isDefault = !settings.id || settings.id === "rest_default";
    return isDefault
      ? `${window.location.origin}/scan`
      : `${window.location.origin}/r/${settings.slug}/scan`;
  }, [settings.id, settings.slug, settings.custom_domain, settings.custom_domain_verified]);

  const previewUrl = useMemo(() => {
    return qrMode === "single" ? baseScanUrl : `${baseScanUrl}?table=${selectedTable}`;
  }, [baseScanUrl, qrMode, selectedTable]);

  useEffect(() => {
    let mounted = true;
    renderStyledQrDataUrl(previewUrl, 400, qrStyle).then((url) => {
      if (mounted) setPreviewDataUrl(url);
    });
    return () => {
      mounted = false;
    };
  }, [previewUrl, qrStyle]);

  const saveConfig = async (
    nextMode: "single" | "per_table" = qrMode,
    nextTotal = totalTables,
    nextSkip = parsedSkip,
    nextDisabled = disabledSet,
    nextStyle = qrStyle
  ) => {
    setSaving(true);
    try {
      const res = await apiJson<{ settings: RestaurantSettings }>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({
          qr_mode: nextMode,
          table_config: {
            total: Math.max(1, Math.min(200, nextTotal)),
            skip: nextSkip,
            disabled: nextDisabled,
          },
          qr_style: nextStyle,
        }),
      });
      onSettingsUpdated(res.settings);
      toast({ title: "Saved", description: "Your QR settings are saved.", variant: "success" });
    } catch {
      toast({ title: "Failed to save QR settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleTableDisabled = async (n: number) => {
    const next = disabledSet.includes(n)
      ? disabledSet.filter((x) => x !== n)
      : [...disabledSet, n];
    setDisabledSet(next);
    await saveConfig(qrMode, totalTables, parsedSkip, next, qrStyle);
  };

  const downloadSizedPng = useCallback(
    async (sizeKey: "small" | "medium" | "large") => {
      const px = sizeKey === "small" ? 512 : sizeKey === "large" ? 2048 : 1024;
      const dataUrl = await renderStyledQrDataUrl(previewUrl, px, qrStyle);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download =
        qrMode === "single" ? `menu-qr-${sizeKey}.png` : `qr-table-${selectedTable}-${sizeKey}.png`;
      a.click();
      toast({ title: "Downloaded!" });
    },
    [previewUrl, qrStyle, qrMode, selectedTable, toast]
  );

  const downloadAllZip = async () => {
    setDownloadingAll(true);
    try {
      const zip = new JSZip();
      for (const n of activeNumbers) {
        if (disabledSet.includes(n)) continue;
        const url = `${baseScanUrl}?table=${n}`;
        const dataUrl = await renderStyledQrDataUrl(url, 1024, qrStyle);
        const base64 = dataUrl.split(",")[1];
        zip.file(`qr-table-${n}.png`, base64, { base64: true });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${settings.slug || "restaurant"}-table-qrs.zip`;
      a.click();
      URL.revokeObjectURL(blobUrl);
      toast({
        title: `Downloaded ${activeNumbers.filter((n) => !disabledSet.includes(n)).length} QR codes`,
        variant: "success",
      });
    } catch {
      toast({ title: "Failed to build ZIP", variant: "destructive" });
    } finally {
      setDownloadingAll(false);
    }
  };

  const pillLabel = qrMode === "single" ? "Scan to view menu" : `Table ${selectedTable}`;

  const qrPreviewCard = (
    <div className="rounded-3xl bg-white border border-[var(--qm-line)] overflow-hidden shadow-xs">
      <div className="bg-[var(--qm-surface)]/75 p-6 sm:p-8">
        <div className="max-w-xs mx-auto">
          <div className="relative bg-white rounded-2xl p-6 shadow-md border border-[var(--qm-line)]">
            <CornerBrackets frameStyle={qrStyle.frameStyle} />
            {previewDataUrl && (
              <img
                src={previewDataUrl}
                alt="QR Preview"
                className="w-full aspect-square rounded-xl"
              />
            )}
            <div className="mt-3 text-center">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#49332A]/10 rounded-full text-xs font-semibold text-[#49332A]">
                <Smartphone className="w-3.5 h-3.5" />
                {pillLabel}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Exact QuickMenu 4-action bottom strip */}
      <div className="p-4 bg-[var(--qm-surface)]/45 border-t border-[var(--qm-line)] grid grid-cols-4 gap-2">
        {(["small", "medium", "large"] as const).map((sz) => (
          <button
            key={sz}
            type="button"
            onClick={() => downloadSizedPng(sz)}
            className="flex flex-col items-center justify-center py-2.5 px-2 rounded-xl bg-white border border-[var(--qm-line)] hover:border-[#49332A] gap-1 text-xs font-medium capitalize text-[#49332A] transition-colors"
          >
            <Download className="h-4 w-4" />
            <span>{sz}</span>
          </button>
        ))}
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="flex flex-col items-center justify-center py-2.5 px-2 rounded-xl bg-white border border-[var(--qm-line)] hover:border-[#49332A] gap-1 text-xs font-medium text-[#49332A] transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          <span>Preview</span>
        </a>
      </div>
    </div>
  );

  const customizePanel = (
    <div className="space-y-4">
      <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2 text-[#49332A]">
            <Palette className="h-4 w-4" />
            QR Style
          </h3>
          <button
            type="button"
            onClick={() => setQrStyle(DEFAULT_QR_STYLE)}
            className="h-7 px-2.5 rounded-lg text-xs text-[var(--qm-muted)] hover:bg-[var(--qm-surface)] inline-flex items-center gap-1"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {QR_STYLES.map((st) => {
            const Icon = st.icon;
            const active = qrStyle.style === st.id;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => setQrStyle((s) => ({ ...s, style: st.id }))}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-xs font-medium transition-all ${
                  active
                    ? "border-[#49332A] bg-[#49332A]/8 text-[#49332A]"
                    : "border-[var(--qm-line)] hover:border-[#49332A]/40 text-[var(--qm-muted)]"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{st.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-5 shadow-xs space-y-3">
        <h3 className="font-semibold text-sm text-[#49332A]">Color Theme</h3>
        <div className="grid grid-cols-3 gap-2">
          {QR_COLORS.map((c) => {
            const bgCss = c.fg.startsWith("gradient:")
              ? `linear-gradient(135deg, #${c.fg.split(":")[1].split(",")[0]}, #${c.fg.split(":")[1].split(",")[1]})`
              : c.fg;
            const active = qrStyle.fgColor === c.fg;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setQrStyle((s) => ({ ...s, fgColor: c.fg, bgColor: c.bg }))}
                className={`h-9 rounded-xl border-2 text-[11px] font-semibold text-white transition-all ${
                  active ? "border-[#49332A] ring-2 ring-[#49332A]/30" : "border-transparent"
                }`}
                style={{ background: bgCss }}
                title={c.name}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-5 shadow-xs space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-[#49332A]">Dot Size</span>
            <span className="text-xs font-mono text-[var(--qm-muted)]">
              {Math.round(qrStyle.dotScale * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.05}
            value={qrStyle.dotScale}
            onChange={(e) =>
              setQrStyle((s) => ({ ...s, dotScale: Number(e.target.value) || 0.85 }))
            }
            className="w-full accent-[#49332A]"
          />
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#49332A] mb-2">Frame Style</h3>
          <div className="grid grid-cols-4 gap-2">
            {(["none", "simple", "rounded", "fancy"] as const).map((fs) => (
              <button
                key={fs}
                type="button"
                onClick={() => setQrStyle((s) => ({ ...s, frameStyle: fs }))}
                className={`h-9 rounded-xl text-xs font-semibold capitalize border transition-colors ${
                  qrStyle.frameStyle === fs
                    ? "bg-[#49332A] text-[#FAF8F5] border-[#49332A]"
                    : "bg-white border-[var(--qm-line)] text-[#49332A]"
                }`}
              >
                {fs}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => saveConfig(qrMode, totalTables, parsedSkip, disabledSet, qrStyle)}
          className="w-full h-10 rounded-xl bg-[#49332A] hover:bg-[#38261F] text-[#FAF8F5] text-xs font-semibold"
        >
          {saving ? "Saving..." : "Save QR Style"}
        </button>
      </div>
    </div>
  );

  const infoPanel = (
    <div className="space-y-4">
      <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-5 shadow-xs space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2 text-[#49332A]">
          <QrCode className="h-4 w-4" />
          Scan URL
        </h3>
        <div className="flex gap-2">
          <div className="flex-1 p-3 bg-[var(--qm-surface)] rounded-xl overflow-hidden">
            <code className="text-xs break-all text-[var(--qm-muted)]">{previewUrl}</code>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(previewUrl);
              setCopiedUrl(true);
              toast({ title: "Copied!", description: previewUrl });
              setTimeout(() => setCopiedUrl(false), 1800);
            }}
            aria-label="Copy Scan URL"
            className="h-10 w-10 rounded-xl border border-[var(--qm-line)] hover:border-[#49332A] flex items-center justify-center flex-shrink-0"
          >
            {copiedUrl ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Copy className="h-4 w-4 text-[#49332A]" />
            )}
          </button>
        </div>
        <p className="text-xs text-[var(--qm-muted)]">Each scan starts a 4-hour menu session</p>
        {settings.custom_domain && !settings.custom_domain_verified && (
          <p className="text-[11px] rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
            Custom domain <span className="font-mono font-semibold">{settings.custom_domain}</span> is
            pending Super Admin verification. QR codes use the default platform URL until verified.
          </p>
        )}
      </div>

      <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-5 shadow-xs space-y-2.5">
        <h3 className="font-semibold text-sm text-[#49332A]">Quick Tips</h3>
        <ul className="space-y-1.5 text-sm text-[var(--qm-muted)]">
          <li>• Print on white paper for best contrast</li>
          <li>• Minimum 2 × 2 inches for table placement</li>
          <li>• Test scan before printing in bulk</li>
          <li>• Place in well-lit, visible areas</li>
        </ul>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl">QR codes</h2>
          <p className="text-sm text-[var(--qm-muted)] mt-0.5">
            Single QR for all or unique QR per table
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCustomizeOpen((o) => !o)}
          className={`h-10 px-4 rounded-xl border text-xs font-semibold inline-flex items-center gap-2 transition-colors shadow-xs ${
            customizeOpen
              ? "bg-[#49332A] text-[#FAF8F5] border-[#49332A]"
              : "bg-white border-[var(--qm-line)] text-[#49332A] hover:border-[#49332A]"
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>{customizeOpen ? "Hide Style" : "Customize"}</span>
        </button>
      </div>

      {/* Mode Switch — Exact QuickMenu 2-card strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {(
          [
            {
              key: "single",
              title: "Single QR",
              desc: "One code for all tables",
              icon: QrCode,
            },
            {
              key: "per_table",
              title: "Per Table QR",
              desc: "Unique QR per table",
              icon: LayoutGrid,
            },
          ] as const
        ).map((m) => {
          const active = qrMode === m.key;
          const Icon = m.icon;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                setQrMode(m.key);
                saveConfig(m.key);
              }}
              className={`relative flex flex-col items-start gap-2.5 p-5 rounded-2xl border-2 transition-all text-left shadow-xs ${
                active
                  ? "border-[#49332A] bg-white"
                  : "border-[var(--qm-line)] bg-white/75 hover:border-[#49332A]/40"
              }`}
            >
              <div
                className={`p-2.5 rounded-xl ${
                  active ? "bg-[#49332A]/12 text-[#49332A]" : "bg-[var(--qm-surface)] text-[var(--qm-muted)]"
                }`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-bold text-sm text-[#49332A]">{m.title}</p>
                <p className="text-xs text-[var(--qm-muted)] mt-0.5">{m.desc}</p>
              </div>
              {active && (
                <span className="absolute top-3.5 right-3.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  Active
                </span>
              )}
            </button>
          );
        })}
      </div>

      {qrMode === "single" ? (
        <div className="grid lg:grid-cols-5 gap-6 items-start">
          <div className="lg:col-span-3">{qrPreviewCard}</div>
          <div className="lg:col-span-2">{customizeOpen ? customizePanel : infoPanel}</div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-5 gap-6 items-start">
          <div className="lg:col-span-3 space-y-5">
            <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-5 shadow-xs space-y-4">
              <h3 className="font-display text-xl">Table Configuration</h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                    Total Tables
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={totalTables}
                    onChange={(e) => setTotalTables(Number(e.target.value) || 1)}
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--qm-muted)] mb-1">
                    Skip Numbers (comma separated)
                  </label>
                  <input
                    type="text"
                    value={skipInput}
                    onChange={(e) => setSkipInput(e.target.value)}
                    placeholder="e.g. 13, 14"
                    className="w-full h-10 px-3 rounded-xl border border-[var(--qm-line)] text-sm"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={() => saveConfig()}
                className="h-10 px-5 rounded-xl bg-[#49332A] text-[#FAF8F5] text-sm font-semibold hover:bg-[#38261F]"
              >
                {saving ? "Saving..." : "Save Table Settings"}
              </button>
            </div>

            <div className="rounded-3xl bg-white border border-[var(--qm-line)] p-5 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-xl">All Tables ({activeNumbers.length})</h3>
                  <p className="text-xs text-[var(--qm-muted)]">
                    Tap a table to preview its QR, or toggle to disable scanning
                  </p>
                </div>

                <button
                  type="button"
                  disabled={downloadingAll}
                  onClick={downloadAllZip}
                  className="h-9 px-4 rounded-xl bg-[#49332A] text-[#FAF8F5] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#38261F]"
                >
                  <Download className="h-3.5 w-3.5" />
                  {downloadingAll ? "Preparing ZIP..." : "Download All (ZIP)"}
                </button>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {activeNumbers.map((n) => {
                  const isDisabled = disabledSet.includes(n);
                  const isSelected = selectedTable === n;
                  return (
                    <div
                      key={n}
                      className={`rounded-2xl border p-2.5 text-center transition-colors ${
                        isSelected
                          ? "border-[#49332A] bg-[var(--qm-tint)]/55"
                          : "border-[var(--qm-line)] bg-[var(--qm-surface)]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedTable(n)}
                        className="w-full text-sm font-bold py-1 text-[#49332A]"
                      >
                        Table {n}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleTableDisabled(n)}
                        className={`mt-1 w-full py-0.5 rounded-lg text-[10px] font-semibold ${
                          isDisabled ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {isDisabled ? "Disabled" : "Active"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            {qrPreviewCard}
            {customizeOpen ? customizePanel : infoPanel}
          </div>
        </div>
      )}
    </div>
  );
}
