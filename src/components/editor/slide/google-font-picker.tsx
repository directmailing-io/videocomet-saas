"use client";

import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ensureGoogleFont,
  loadGoogleFontsManifest,
  type GoogleFontEntry,
} from "@/lib/slide/google-fonts-loader";

const CATEGORY_LABEL: Record<string, string> = {
  "sans-serif": "Sans-Serif",
  serif: "Serif",
  display: "Display",
  handwriting: "Handwriting",
  monospace: "Monospace",
};
const CATEGORY_ORDER = ["all", "sans-serif", "serif", "display", "handwriting", "monospace"];

export interface GoogleFontPickerProps {
  value: string | null;
  onChange: (family: string) => void;
}

export function GoogleFontPicker({ value, onChange }: GoogleFontPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string>("all");
  const [fonts, setFonts] = React.useState<GoogleFontEntry[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    loadGoogleFontsManifest().then(setFonts);
  }, []);

  React.useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return fonts
      .filter((f) => category === "all" || f.c === category)
      .filter((f) => !q || f.f.toLowerCase().includes(q))
      .slice(0, 200);
  }, [fonts, query, category]);

  // Lazy-preload sichtbare Fonts, damit der Picker beim Scrollen die echten
  // Glyphen zeigt. Nur Top-50 vom aktuellen Filter — sonst killt das den
  // CSS-Loader.
  React.useEffect(() => {
    if (!open) return;
    for (const f of filtered.slice(0, 50)) {
      ensureGoogleFont(f.f);
    }
  }, [filtered, open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 rounded-squircle-sm border border-line bg-surface px-3 py-2 text-sm",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        )}
      >
        <span
          className="truncate text-left"
          style={{ fontFamily: value ? `"${value}"` : undefined }}
        >
          {value ?? "Schriftart wählen…"}
        </span>
        <ChevronDown className="size-4 text-ink-muted shrink-0" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute z-50 mt-1 w-[320px] rounded-squircle-sm border border-line bg-surface shadow-lg overflow-hidden">
            <div className="border-b border-line p-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-ink-muted" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Suche aus ~2.000 Google-Fonts…"
                  className="w-full pl-7 pr-2 py-1.5 text-sm bg-surface-muted rounded-squircle-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                />
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {CATEGORY_ORDER.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={cn(
                      "text-[10.5px] font-semibold px-2 py-0.5 rounded-full transition-colors",
                      category === cat
                        ? "bg-brand text-white"
                        : "bg-surface-muted text-ink-muted hover:bg-line",
                    )}
                  >
                    {cat === "all" ? "Alle" : CATEGORY_LABEL[cat] ?? cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[340px] overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="py-6 text-center text-xs text-ink-muted">
                  Keine Treffer
                </div>
              ) : (
                filtered.map((f) => (
                  <button
                    key={f.f}
                    type="button"
                    onClick={() => {
                      ensureGoogleFont(f.f);
                      onChange(f.f);
                      setOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-muted transition-colors",
                      value === f.f && "bg-brand-soft",
                    )}
                  >
                    <span
                      className="truncate text-sm"
                      style={{ fontFamily: `"${f.f}"` }}
                    >
                      {f.f}
                    </span>
                    {value === f.f && (
                      <Check className="size-3.5 text-brand-deep shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
            <div className="border-t border-line px-3 py-1.5 text-[10.5px] text-ink-muted bg-surface-soft">
              {filtered.length === 200
                ? "200 sichtbar · Suche zum Eingrenzen"
                : `${filtered.length} Treffer`}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
