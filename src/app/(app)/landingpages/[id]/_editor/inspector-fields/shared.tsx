"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  parseVideoEmbed,
  VIDEO_PROVIDER_NAMES,
} from "@/lib/landing-blocks/video-embed";
import { cn } from "@/lib/utils";

/**
 * Tiny grab-bag of presentational helpers shared by every inspector form.
 * Forms are intentionally dumb: prop-in, prop-out — they never touch the
 * editor store directly.
 */

export const PLACEHOLDER_HINTS: ReadonlyArray<{ token: string; label: string }> =
  [
    { token: "{{firstName}}", label: "Vorname" },
    { token: "{{lastName}}", label: "Nachname" },
    { token: "{{company}}", label: "Firma" },
    { token: "{{jobTitle}}", label: "Position" },
  ];

export function PlaceholderHint({
  onPick,
}: {
  onPick: (token: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {PLACEHOLDER_HINTS.map((p) => (
        <button
          key={p.token}
          type="button"
          onClick={() => onPick(p.token)}
          title={`${p.label} einfügen`}
          className="inline-flex items-center rounded-full bg-brand-soft text-brand-deep text-[10px] font-medium px-2 py-0.5 hover:bg-brand/15 transition-colors"
        >
          {p.token}
        </button>
      ))}
    </div>
  );
}

export function FormSection({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {title && (
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

export interface RepeaterProps<T> {
  label: string;
  items: T[];
  onChange: (items: T[]) => void;
  makeEmpty: () => T;
  renderItem: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode;
  /** Hide the "Eintrag entfernen" button when only one item remains. */
  minOne?: boolean;
  /** Vorschau-Text fuer die kollabierte Kopfzeile eines Eintrags. */
  preview?: (item: T) => string;
}

/** Erster nicht-leerer String-Wert eines Eintrags — Default-Vorschau. */
function defaultPreview(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    for (const value of Object.values(item as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "";
}

export function Repeater<T>({
  label,
  items,
  onChange,
  makeEmpty,
  renderItem,
  minOne,
  preview,
}: RepeaterProps<T>) {
  // Kollabierte Eintraege mit Vorschau-Zeile: nur der offene Eintrag zeigt
  // sein Formular. Neu hinzugefuegte Eintraege klappen automatisch auf.
  const [openIdx, setOpenIdx] = React.useState<number | null>(null);

  function update(idx: number, patch: Partial<T>) {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    onChange(next);
  }
  function remove(idx: number) {
    if (minOne && items.length <= 1) return;
    onChange(items.filter((_, i) => i !== idx));
    setOpenIdx((open) =>
      open === null ? null : open === idx ? null : open > idx ? open - 1 : open,
    );
  }
  function add() {
    onChange([...items, makeEmpty()]);
    setOpenIdx(items.length);
  }
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="space-y-2">
        {items.map((item, idx) => {
          const isOpen = openIdx === idx;
          const previewText =
            (preview ? preview(item) : defaultPreview(item)).trim() ||
            "Leerer Eintrag";
          return (
            <div
              key={idx}
              className="rounded-squircle-sm border border-line bg-surface-soft relative"
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : idx)}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="text-[11px] font-medium text-ink-muted shrink-0">
                    #{idx + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">
                    {previewText}
                  </span>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden
                    className={cn(
                      "shrink-0 text-ink-muted transition-transform",
                      isOpen && "rotate-180",
                    )}
                  >
                    <path
                      d="M2.5 4.5L6 8l3.5-3.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  disabled={minOne && items.length <= 1}
                  className={cn(
                    "inline-flex items-center text-ink-muted hover:text-danger transition-colors shrink-0",
                    minOne &&
                      items.length <= 1 &&
                      "opacity-40 cursor-not-allowed",
                  )}
                  title="Eintrag entfernen"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              {isOpen && (
                <div className="space-y-2 border-t border-line px-3 py-2.5">
                  {renderItem(item, (patch) => update(idx, patch))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={add}
        iconLeft={<Plus className="size-3.5" />}
        className="w-full"
      >
        Eintrag hinzufügen
      </Button>
    </div>
  );
}

/**
 * Lightweight URL picker — text field + Direkt-Upload + "Aus Mediathek
 * wählen" button that opens a modal listing the user's media items of the
 * given type. Kept inline here rather than as a top-level component because
 * every inspector form needs a slightly different filter.
 */
export function MediaUrlField({
  label,
  value,
  onChange,
  type,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  type: "image" | "logo" | "video" | "webcam";
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("kind", type);
      fd.append("file", file);
      const res = await fetch("/api/media", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const json = (await res.json().catch(() => null)) as {
        media?: { publicUrl?: string };
        error?: string;
      } | null;
      if (!res.ok || !json?.media?.publicUrl) {
        throw new Error(json?.error ?? `Upload fehlgeschlagen (${res.status})`);
      }
      onChange(json.media.publicUrl);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Upload fehlgeschlagen.",
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div
        className={cn(
          "rounded-squircle-sm transition-colors",
          dragOver && "outline outline-2 outline-brand bg-brand-soft/40",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void uploadFile(file);
        }}
      >
        <div className="flex items-center gap-2">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder ?? "https://..."}
          />
          <input
            ref={fileRef}
            type="file"
            accept={type === "video" || type === "webcam" ? "video/*" : "image/*"}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? "Lädt…" : "Hochladen"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(true)}
          >
            Mediathek
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-ink-muted leading-relaxed">
          Datei hierher ziehen oder „Hochladen" klicken.
        </p>
      </div>
      {uploadError && (
        <p className="text-xs text-danger">Fehler: {uploadError}</p>
      )}
      {value && (
        <div className="mt-1">
          {type === "image" || type === "logo" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt=""
              className="max-h-20 rounded-squircle-sm border border-line bg-surface-soft object-contain"
            />
          ) : (
            <video
              src={value}
              className="max-h-24 rounded-squircle-sm border border-line"
              muted
            />
          )}
        </div>
      )}
      {open && (
        <MediaPickerDialog
          type={type}
          onPick={(url) => {
            onChange(url);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

interface MediaApiItem {
  id: string;
  name: string;
  publicUrl: string;
  type: string;
}

function MediaPickerDialog({
  type,
  onPick,
  onClose,
}: {
  type: "image" | "logo" | "video" | "webcam";
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = React.useState<MediaApiItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/media?type=${type}`, { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ items: MediaApiItem[] }>;
      })
      .then((data) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Konnte Mediathek nicht laden.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] overflow-auto rounded-squircle-lg border border-line bg-surface shadow-card-hover p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-ink">
            Aus Mediathek wählen
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:text-ink"
          >
            Schließen
          </button>
        </div>
        {loading && (
          <p className="text-sm text-ink-muted">Wird geladen…</p>
        )}
        {error && (
          <p className="text-sm text-danger">Fehler: {error}</p>
        )}
        {!loading && !error && items.length === 0 && (
          <p className="text-sm text-ink-muted">
            Noch keine Einträge vom Typ <code>{type}</code>.
          </p>
        )}
        {!loading && !error && items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => onPick(it.publicUrl)}
                className="group rounded-squircle-sm border border-line bg-surface-soft p-2 text-left hover:border-brand transition-colors"
              >
                <div className="aspect-square bg-surface rounded-squircle-sm overflow-hidden mb-1.5 flex items-center justify-center">
                  {type === "image" || type === "logo" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.publicUrl}
                      alt={it.name}
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <video
                      src={it.publicUrl}
                      className="max-h-full max-w-full object-contain"
                      muted
                    />
                  )}
                </div>
                <div className="text-[11px] font-medium text-ink truncate">
                  {it.name}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * `<input type=color>` paired with a text field, mirroring the pattern in
 * the legacy editor. Returns the empty string when the user clears the
 * field so the caller can drop the key entirely if desired.
 */
export function ColorField({
  label,
  value,
  onChange,
  fallback,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fallback: string;
}) {
  const display = value || fallback;
  return (
    <div className="flex items-center gap-2">
      <label className="relative inline-flex shrink-0">
        <input
          type="color"
          value={display}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 size-9 opacity-0 cursor-pointer"
          aria-label={`${label} Farbe wählen`}
        />
        <span
          className="size-9 rounded-squircle-sm border border-line shadow-card pointer-events-none"
          style={{ background: display }}
        />
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={fallback}
        className="font-mono text-xs"
      />
    </div>
  );
}

/**
 * Reines URL-Feld für eingebettete Videos (kein Upload — Videos werden
 * ausschließlich fremdgehostet eingebunden). Zeigt live an, ob der Link
 * als YouTube/Vimeo/Wistia/Loom erkannt wurde.
 */
export function VideoUrlField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const embed = parseVideoEmbed(value);
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://youtube.com/watch?v=…"
      />
      {value.trim() ? (
        embed ? (
          <p className="text-[11px] text-ok leading-relaxed">
            Erkannt: {VIDEO_PROVIDER_NAMES[embed.provider]}
          </p>
        ) : (
          <p className="text-[11px] text-warn leading-relaxed">
            Kein bekannter Video-Link. Unterstützt: YouTube, Vimeo, Wistia,
            Loom.
          </p>
        )
      ) : (
        <p className="text-[11px] text-ink-muted leading-relaxed">
          Link zu YouTube, Vimeo, Wistia oder Loom einfügen.
        </p>
      )}
    </div>
  );
}

export function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
