"use client";

/**
 * Die fünf Styleguide-Gruppen (Konzept 3.4) als kontrollierte Formular-
 * Bausteine über einem `BrandKit`:
 *
 *   1. Logo    — Upload (Mediathek-API, kind=logo) oder URL
 *   2. Farben  — Picker + 8 kuratierte Dots, aufklappbar Akzent, Hell/Dunkel
 *   3. Schrift — kuratierte Paare als Kacheln (Headline im echten Font)
 *   4. Form    — 4 Radius-Stufen mit Button-Vorschau
 *   5. Tiefe   — 3 Schatten-Stufen mit Karten-Vorschau
 *
 * Wird an ZWEI Stellen benutzt: Einstiegs-Wizard (Weg B / „Anpassen") und
 * Styleguide-Panel im Editor. Deshalb bewusst dumm gehalten: Kit rein,
 * `onChange(nextKit, meta)` raus — kein Fetch außer dem Logo-Upload.
 * `meta.logoOrigin` sagt dem Aufrufer, ob das Logo von unserem Upload
 * ("upload") oder von einer fremden URL ("external") stammt — der Wizard
 * kopiert fremde Logos vor dem Anlegen auf unser CDN.
 */

import * as React from "react";
import { ChevronDown, ImagePlus, Loader2, Moon, Sun, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ensureGoogleFont } from "@/lib/slide/google-fonts-loader";
import type { BrandKit } from "@/lib/landing-theme/brand-kit";
import { FONT_PAIRS } from "@/lib/landing-theme/font-pairs";
import { cn } from "@/lib/utils";
import {
  CURATED_PRIMARIES,
  RADIUS_BUTTON_PX,
  RADIUS_LABELS,
  RADIUS_ORDER,
  SHADOW_CARD_CSS,
  SHADOW_LABELS,
  SHADOW_ORDER,
} from "./kit-labels";

export interface BrandKitChangeMeta {
  /** Nur bei Logo-Änderungen gesetzt. */
  logoOrigin?: "upload" | "external";
}

export interface BrandKitGroupsProps {
  kit: BrandKit;
  onChange: (next: BrandKit, meta?: BrandKitChangeMeta) => void;
  /** Optionaler Slot direkt unter den Logo-Feldern (z. B. „im Kopfbereich zeigen"). */
  logoExtras?: React.ReactNode;
  /** Optionaler Slot oberhalb der Farb-Felder (z. B. Schnellstart-Looks). */
  colorsIntro?: React.ReactNode;
}

export function BrandKitGroups({
  kit,
  onChange,
  logoExtras,
  colorsIntro,
}: BrandKitGroupsProps) {
  return (
    <div className="space-y-6">
      <Group title="Logo">
        <LogoFields kit={kit} onChange={onChange} />
        {logoExtras}
      </Group>
      <Group title="Farben">
        {colorsIntro}
        <ColorFields kit={kit} onChange={onChange} />
      </Group>
      <Group title="Schrift">
        <FontPairFields kit={kit} onChange={onChange} />
      </Group>
      <Group title="Form">
        <RadiusFields kit={kit} onChange={onChange} />
      </Group>
      <Group title="Tiefe">
        <ShadowFields kit={kit} onChange={onChange} />
      </Group>
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2.5">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// ── 1. Logo ─────────────────────────────────────────────────────────────────

function LogoFields({
  kit,
  onChange,
}: Pick<BrandKitGroupsProps, "kit" | "onChange">) {
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("kind", "logo");
      form.append("file", file);
      const res = await fetch("/api/media", { method: "POST", body: form });
      const data = (await res.json()) as {
        media?: { publicUrl?: string };
        error?: string;
      };
      if (!res.ok || !data.media?.publicUrl) {
        setError(data.error ?? "Upload fehlgeschlagen. Bitte erneut versuchen.");
        return;
      }
      onChange(
        { ...kit, logo: { url: data.media.publicUrl } },
        { logoOrigin: "upload" },
      );
    } catch {
      setError("Upload fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {kit.logo?.url ? (
        <div className="flex items-center gap-3 rounded-squircle-sm border border-line bg-surface-soft p-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={kit.logo.url}
            alt="Logo"
            className="h-8 max-w-[140px] object-contain"
          />
          <button
            type="button"
            onClick={() => {
              const next = { ...kit };
              delete next.logo;
              onChange(next);
            }}
            className="ml-auto inline-flex size-6 items-center justify-center rounded-full text-ink-muted hover:text-danger transition-colors"
            title="Logo entfernen"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface-soft px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-muted transition-colors disabled:opacity-60"
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ImagePlus className="size-3.5" />
          )}
          {uploading ? "Lädt hoch…" : "Logo hochladen"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>
      <div>
        <Label>Oder Logo-URL</Label>
        <Input
          value={kit.logo?.url ?? ""}
          onChange={(e) => {
            const url = e.target.value.trim();
            if (!url) {
              const next = { ...kit };
              delete next.logo;
              onChange(next);
              return;
            }
            onChange({ ...kit, logo: { url } }, { logoOrigin: "external" });
          }}
          placeholder="https://deine-website.de/logo.svg"
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

// ── 2. Farben ───────────────────────────────────────────────────────────────

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function ColorFields({
  kit,
  onChange,
}: Pick<BrandKitGroupsProps, "kit" | "onChange">) {
  const [accentOpen, setAccentOpen] = React.useState(Boolean(kit.colors.accent));

  function setPrimary(hex: string) {
    onChange({ ...kit, colors: { ...kit.colors, primary: hex } });
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Primärfarbe</Label>
        <div className="flex items-center gap-2 mt-1">
          <ColorSwatchInput value={kit.colors.primary} onChange={setPrimary} />
          <HexInput value={kit.colors.primary} onCommit={setPrimary} />
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {CURATED_PRIMARIES.map((c) => (
            <button
              key={c.hex}
              type="button"
              title={c.label}
              onClick={() => setPrimary(c.hex)}
              className={cn(
                "size-7 rounded-full ring-2 ring-offset-2 ring-offset-surface transition-transform hover:scale-110",
                kit.colors.primary.toLowerCase() === c.hex.toLowerCase()
                  ? "ring-ink/60"
                  : "ring-transparent",
              )}
              style={{ background: c.hex }}
              aria-label={`Primärfarbe ${c.label}`}
            />
          ))}
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setAccentOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-ink transition-colors"
        >
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              accentOpen && "rotate-180",
            )}
          />
          Akzentfarbe {kit.colors.accent ? "(gesetzt)" : "(optional)"}
        </button>
        {accentOpen && (
          <div className="flex items-center gap-2 mt-2">
            <ColorSwatchInput
              value={kit.colors.accent ?? kit.colors.primary}
              onChange={(hex) =>
                onChange({ ...kit, colors: { ...kit.colors, accent: hex } })
              }
            />
            <HexInput
              value={kit.colors.accent ?? ""}
              onCommit={(hex) =>
                onChange({ ...kit, colors: { ...kit.colors, accent: hex } })
              }
            />
            {kit.colors.accent && (
              <button
                type="button"
                onClick={() => {
                  const colors = { ...kit.colors };
                  delete colors.accent;
                  onChange({ ...kit, colors });
                }}
                className="text-xs font-semibold text-ink-muted hover:text-ink whitespace-nowrap"
              >
                Zurücksetzen
              </button>
            )}
          </div>
        )}
      </div>

      <div>
        <Label>Seiten-Hintergrund</Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {(
            [
              { value: "light", label: "Hell", icon: Sun },
              { value: "dark", label: "Dunkel", icon: Moon },
            ] as const
          ).map((opt) => {
            const active = kit.colors.bg === opt.value;
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  onChange({
                    ...kit,
                    colors: { ...kit.colors, bg: opt.value },
                  })
                }
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                  active
                    ? "bg-brand-soft text-brand-deep"
                    : "bg-surface-soft text-ink-muted hover:text-ink",
                )}
              >
                <Icon className="size-3.5" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ColorSwatchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const safe = HEX_RE.test(value) ? value : "#2563eb";
  return (
    <label
      className="relative inline-flex size-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-squircle-sm ring-1 ring-inset ring-ink/10"
      style={{ background: safe }}
      title="Farbe wählen"
    >
      <input
        type="color"
        value={expandHex(safe)}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        aria-label="Farbe wählen"
      />
    </label>
  );
}

/** `#abc` → `#aabbcc` — `<input type=color>` akzeptiert nur die 6er-Form. */
function expandHex(hex: string): string {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

/**
 * Hex-Text-Eingabe mit lokalem Draft: committet nur gültige Hex-Werte,
 * lässt den User aber ungestört tippen (kein „springendes" Input).
 */
function HexInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (hex: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <Input
      value={draft}
      onChange={(e) => {
        const v = e.target.value.trim();
        setDraft(v);
        if (HEX_RE.test(v)) onCommit(v);
      }}
      onBlur={() => setDraft(value)}
      placeholder="#2563eb"
      className="font-mono text-xs"
    />
  );
}

// ── 3. Schrift ──────────────────────────────────────────────────────────────

function FontPairFields({
  kit,
  onChange,
}: Pick<BrandKitGroupsProps, "kit" | "onChange">) {
  React.useEffect(() => {
    for (const pair of FONT_PAIRS) {
      ensureGoogleFont(pair.heading);
    }
  }, []);

  return (
    <div className="grid grid-cols-1 gap-2">
      {FONT_PAIRS.map((pair) => {
        const active = kit.fontPairId === pair.id;
        return (
          <button
            key={pair.id}
            type="button"
            onClick={() => onChange({ ...kit, fontPairId: pair.id })}
            className={cn(
              "rounded-squircle-sm border p-3 text-left transition-colors",
              active
                ? "border-brand bg-brand-soft/40"
                : "border-line bg-surface-soft hover:border-ink/20",
            )}
          >
            <span
              className="block text-base font-bold text-ink leading-tight truncate"
              style={{ fontFamily: `'${pair.heading}', sans-serif` }}
            >
              {pair.label}
            </span>
            <span className="block text-[11px] text-ink-muted mt-0.5">
              {pair.vibe}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── 4. Form (Rundungen) ─────────────────────────────────────────────────────

function RadiusFields({
  kit,
  onChange,
}: Pick<BrandKitGroupsProps, "kit" | "onChange">) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {RADIUS_ORDER.map((r) => {
        const active = kit.radius === r;
        return (
          <button
            key={r}
            type="button"
            onClick={() => onChange({ ...kit, radius: r })}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-squircle-sm border p-2.5 transition-colors",
              active
                ? "border-brand bg-brand-soft/40"
                : "border-line bg-surface-soft hover:border-ink/20",
            )}
            title={RADIUS_LABELS[r]}
          >
            <span
              className="h-4 w-10 bg-ink/80"
              style={{ borderRadius: RADIUS_BUTTON_PX[r] }}
              aria-hidden
            />
            <span
              className={cn(
                "text-[10px] font-semibold",
                active ? "text-brand-deep" : "text-ink-muted",
              )}
            >
              {RADIUS_LABELS[r]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── 5. Tiefe (Schatten) ─────────────────────────────────────────────────────

function ShadowFields({
  kit,
  onChange,
}: Pick<BrandKitGroupsProps, "kit" | "onChange">) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {SHADOW_ORDER.map((sh) => {
        const active = kit.shadow === sh;
        return (
          <button
            key={sh}
            type="button"
            onClick={() => onChange({ ...kit, shadow: sh })}
            className={cn(
              "flex flex-col items-center gap-2 rounded-squircle-sm border p-2.5 pt-3 transition-colors",
              active
                ? "border-brand bg-brand-soft/40"
                : "border-line bg-surface-soft hover:border-ink/20",
            )}
            title={SHADOW_LABELS[sh]}
          >
            <span
              className="h-6 w-12 rounded-md bg-white ring-1 ring-inset ring-ink/10"
              style={{ boxShadow: SHADOW_CARD_CSS[sh] }}
              aria-hidden
            />
            <span
              className={cn(
                "text-[10px] font-semibold",
                active ? "text-brand-deep" : "text-ink-muted",
              )}
            >
              {SHADOW_LABELS[sh]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
