"use client";

/**
 * URL-Picker fuer Campaign-Wizard.
 *
 * Verhalten:
 *   - <input type="url"> bleibt voll funktional (Auto-Complete, free-text).
 *   - Bei Focus oder Tipp: Dropdown mit gespeicherten Mediathek-URLs des Users.
 *   - Liste filterbar per Tipp (Titel ODER URL substring).
 *   - Footer-Action „+ Als neuen Link speichern" wenn der getippte Wert noch
 *     nicht in der Mediathek liegt → POST /api/media-urls inline, dann
 *     Liste neu laden.
 *   - Klick auf Eintrag setzt value auf die URL und schliesst Dropdown.
 *
 * Filter `types`: nur diese Typen anzeigen (z.B. `['gdoc']` fuer Brief).
 */

import * as React from "react";
import { Loader2, Plus, Library, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import {
  TYPE_BADGE_CLASS,
  TYPE_LABEL,
  type MediaUrlType,
} from "@/lib/media-urls/detect-type";

interface MediaUrlOption {
  id: string;
  url: string;
  title: string;
  type: MediaUrlType;
  previewUrl: string | null;
  previewStatus: "pending" | "ready" | "error" | "private";
}

interface Props {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Whitelist erlaubter Typen — nur diese kommen im Dropdown vor. */
  types?: MediaUrlType[];
  /** Async-Loader-Hook fuer Tests/Storybook. Default: GET /api/media-urls. */
  loader?: () => Promise<MediaUrlOption[]>;
}

async function defaultLoader(): Promise<MediaUrlOption[]> {
  const res = await fetch("/api/media-urls", { cache: "no-store" });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => ({}))) as {
    items?: MediaUrlOption[];
  };
  return body.items ?? [];
}

export function UrlPicker({
  id,
  value,
  onChange,
  placeholder,
  types,
  loader = defaultLoader,
}: Props) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<MediaUrlOption[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Lazily-load on first focus.
  async function ensureLoaded() {
    if (items !== null) return;
    setLoading(true);
    try {
      const next = await loader();
      setItems(next);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  // Outside-click close.
  React.useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = React.useMemo(() => {
    if (!items) return [];
    const lower = value.trim().toLowerCase();
    return items
      .filter((i) => (types ? types.includes(i.type) : true))
      .filter((i) => {
        if (!lower) return true;
        return (
          i.title.toLowerCase().includes(lower) ||
          i.url.toLowerCase().includes(lower)
        );
      })
      .slice(0, 8);
  }, [items, value, types]);

  const isInLibrary = React.useMemo(() => {
    if (!value.trim()) return true; // empty → nichts speichern
    if (!items) return true;
    return items.some((i) => i.url === value.trim());
  }, [items, value]);

  async function handleSaveCurrent() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/media-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        item?: MediaUrlOption;
        error?: string;
      };
      if (!res.ok || !body.item) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast({ variant: "success", title: "In Mediathek gespeichert" });
      // Re-load list
      const fresh = await loader();
      setItems(fresh);
    } catch (err) {
      toast({
        variant: "danger",
        title: "Speichern fehlgeschlagen",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Input
          id={id}
          type="url"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            setOpen(true);
            void ensureLoaded();
          }}
          autoComplete="off"
          className="pr-9"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-surface-muted"
            title="URL leeren"
          >
            <X className="size-3.5 text-ink-muted" />
          </button>
        ) : null}
      </div>
      {open ? (
        <div
          className="absolute z-50 mt-1 w-full bg-white border border-line rounded-squircle-md shadow-xl ring-1 ring-black/5 overflow-hidden"
          // Prevent input blur when clicking entries.
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="px-3 py-2 text-[11px] font-medium text-ink-muted uppercase tracking-wide border-b border-line flex items-center gap-2">
            <Library className="size-3.5" />
            Aus Mediathek
          </div>
          {loading && items === null ? (
            <div className="px-3 py-4 text-sm text-ink-muted flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Lade …
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-ink-muted">
              {items === null
                ? "—"
                : value.trim()
                  ? "Kein Treffer in Mediathek"
                  : "Noch keine Links gespeichert"}
            </div>
          ) : (
            <ul className="max-h-60 overflow-y-auto">
              {filtered.map((opt) => (
                <li key={opt.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(opt.url);
                      setOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-muted text-left"
                  >
                    <div className="size-10 shrink-0 rounded bg-surface-muted overflow-hidden border border-line">
                      {opt.previewStatus === "ready" && opt.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={opt.previewUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-surface-muted" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                            TYPE_BADGE_CLASS[opt.type],
                          )}
                        >
                          {TYPE_LABEL[opt.type]}
                        </span>
                        <span className="text-sm font-medium truncate">
                          {opt.title}
                        </span>
                      </div>
                      <div className="text-[11px] text-ink-muted truncate">
                        {opt.url}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {value.trim() && !isInLibrary ? (
            <button
              type="button"
              onClick={handleSaveCurrent}
              disabled={saving}
              className="w-full flex items-center gap-2 px-3 py-2 border-t border-line text-sm hover:bg-surface-muted text-left"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              <span>
                Als neuen Link speichern: <span className="font-medium">{value.length > 50 ? `${value.slice(0, 50)}…` : value}</span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
