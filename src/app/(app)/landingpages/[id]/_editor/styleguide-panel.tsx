"use client";

/**
 * Styleguide-Panel im Editor (Konzept 3.4): ersetzt den alten
 * Theme-Preset-Picker. Öffnet sich als rechts einschiebendes Panel und
 * bearbeitet das Brand-Kit der Vorlage — jede Änderung wirkt sofort live
 * auf die ganze Seite (setTheme/setBrand aus useLpEditorState, Auto-Save
 * inklusive).
 *
 * Aufbau:
 *   - „Schnellstart-Looks": die fünf bisherigen Presets als Chip-Reihe —
 *     ein Klick übernimmt den kompletten Preset-Look (wie früher).
 *   - Darunter die fünf Kit-Gruppen (BrandKitGroups): Logo, Farben,
 *     Schrift, Form, Tiefe. Der Hell/Dunkel-Schalter setzt theme.mode;
 *     dunkle Flächen kommen über brandKitToTheme/deriveDarkColors.
 *   - Unten: „Als Standard speichern" (POST /api/brand/default) — macht
 *     den aktuellen Look zur Vorbelegung für neue Landingpages.
 *
 * Übersetzungs-Logik: das Panel liest das Kit via themeToBrandKit aus dem
 * aktuellen Theme und schreibt Änderungen via brandKitToTheme zurück.
 * `spacing` bleibt dabei erhalten (das Kit kennt bewusst kein Spacing).
 */

import * as React from "react";
import { BookmarkCheck, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  brandKitToTheme,
  themeToBrandKit,
  type BrandKit,
} from "@/lib/landing-theme/brand-kit";
import {
  THEME_PRESET_ORDER,
  THEME_PRESETS,
  themeFromPreset,
} from "@/lib/landing-theme/presets";
import type { BrandConfig, ThemeConfig } from "@/lib/landing-theme/types";
import { cn } from "@/lib/utils";
import { BrandKitGroups } from "../../_styleguide/kit-fields";

export function StyleguidePanel({
  open,
  onClose,
  theme,
  brand,
  setTheme,
  setBrand,
}: {
  open: boolean;
  onClose: () => void;
  theme: ThemeConfig;
  brand: BrandConfig;
  setTheme: (next: ThemeConfig) => void;
  setBrand: (next: BrandConfig) => void;
}) {
  const kit = React.useMemo(
    () => themeToBrandKit(theme, brand),
    [theme, brand],
  );

  // Merkt sich die zuletzt entfernte Logo-URL, damit der „im Kopfbereich
  // zeigen"-Schalter das Logo wieder herstellen kann.
  const hiddenLogoRef = React.useRef<string | null>(null);
  const logoVisible = Boolean(brand.logoUrl);
  const logoToggleAvailable = logoVisible || Boolean(hiddenLogoRef.current);

  const applyKit = React.useCallback(
    (next: BrandKit) => {
      const mapped = brandKitToTheme(next);
      // Spacing ist bewusst kein Kit-Bestandteil — den bestehenden Wert
      // der Vorlage beibehalten statt auf "cozy" zurückzufallen.
      setTheme({ ...mapped.theme, spacing: theme.spacing });
      const nextLogoUrl = mapped.brand.logoUrl ?? null;
      const nextLogoAlign = mapped.brand.logoAlign ?? "left";
      if (
        nextLogoUrl !== (brand.logoUrl ?? null) ||
        nextLogoAlign !== (brand.logoAlign ?? "left")
      ) {
        if (nextLogoUrl) hiddenLogoRef.current = null;
        setBrand({ ...brand, logoUrl: nextLogoUrl, logoAlign: nextLogoAlign });
      }
    },
    [setTheme, setBrand, theme.spacing, brand],
  );

  function toggleLogoVisible(show: boolean) {
    if (show) {
      if (!hiddenLogoRef.current) return;
      setBrand({ ...brand, logoUrl: hiddenLogoRef.current });
      hiddenLogoRef.current = null;
    } else {
      if (!brand.logoUrl) return;
      hiddenLogoRef.current = brand.logoUrl;
      setBrand({ ...brand, logoUrl: null });
    }
  }

  // ── „Als Standard speichern" ──────────────────────────────────────────
  const [saveState, setSaveState] = React.useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  async function saveAsDefault() {
    setSaveState("saving");
    try {
      const res = await fetch("/api/brand/default", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kit: themeToBrandKit(theme, brand) }),
      });
      setSaveState(res.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
    setTimeout(() => setSaveState("idle"), 2500);
  }

  // Escape schließt das Panel.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Klick-Fänger — bewusst transparent, damit die Live-Preview beim
          Einstellen sichtbar bleibt. */}
      <div
        className="fixed inset-0 z-[150]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label="Styleguide"
        className="fixed inset-y-0 right-0 z-[155] flex w-full max-w-[400px] flex-col bg-surface shadow-lift animate-slide-in-right"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
          <div>
            <h2 className="text-sm font-bold text-ink">Styleguide</h2>
            <p className="text-[11px] text-ink-muted mt-0.5">
              Wirkt sofort auf die ganze Seite.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-surface-soft transition-colors"
            aria-label="Styleguide schließen"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <BrandKitGroups
            kit={kit}
            onChange={applyKit}
            logoExtras={
              logoToggleAvailable ? (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs font-medium text-ink">
                    Im Kopfbereich zeigen
                  </span>
                  <Switch
                    checked={logoVisible}
                    onCheckedChange={toggleLogoVisible}
                  />
                </div>
              ) : null
            }
            colorsIntro={
              <QuickLooks
                currentPreset={theme.preset}
                onPick={(id) => setTheme(themeFromPreset(id))}
              />
            }
          />

          <div className="mt-6 pt-5 border-t border-line">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink">
                Sticky-CTA auf dem Smartphone
              </span>
              <Switch
                checked={theme.stickyCta !== false}
                onCheckedChange={(c) => setTheme({ ...theme, stickyCta: c })}
              />
            </div>
            <p className="text-[11px] text-ink-muted mt-1.5 leading-relaxed">
              Zeigt unten eine Leiste mit deinem CTA-Button, sobald der
              Besucher am Video vorbeigescrollt ist.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-line shrink-0">
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => void saveAsDefault()}
            disabled={saveState === "saving"}
            iconLeft={
              saveState === "saving" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BookmarkCheck className="size-4" />
              )
            }
          >
            {saveState === "saved"
              ? "Als Standard gespeichert"
              : saveState === "error"
                ? "Speichern fehlgeschlagen"
                : "Als Standard speichern"}
          </Button>
          <p className="text-[11px] text-ink-muted mt-1.5 leading-relaxed">
            Neue Landingpages starten dann automatisch in diesem Look.
          </p>
        </div>
      </aside>
    </>
  );
}

/** Die fünf bisherigen Theme-Presets als Schnellstart-Reihe. */
function QuickLooks({
  currentPreset,
  onPick,
}: {
  currentPreset: string | undefined;
  onPick: (id: (typeof THEME_PRESET_ORDER)[number]) => void;
}) {
  return (
    <div className="mb-1">
      <div className="text-[11px] font-semibold text-ink-muted mb-1.5">
        Schnellstart-Looks
      </div>
      <div className="flex flex-wrap gap-1.5">
        {THEME_PRESET_ORDER.map((id) => {
          const preset = THEME_PRESETS[id];
          const active = currentPreset === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                active
                  ? "bg-brand-soft text-brand-deep"
                  : "bg-surface-soft text-ink-muted hover:text-ink",
              )}
              title={preset.description}
            >
              <span
                className="inline-block size-2.5 rounded-full ring-1 ring-inset ring-ink/10"
                style={{ background: preset.colors.primary }}
              />
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
