"use client";

/**
 * Block-basierter Landing-Page Editor.
 *
 * Layout:
 *   - Top: Name-Input, Theme-Picker (Preset-Dropdown), Save-Status
 *   - Linke Spalte: Block-Liste mit Add-Menü, Up/Down/Delete pro Block
 *   - Mittlere Spalte: Inspector für den aktiven Block (typ-spezifisches
 *     Form oder JSON-Fallback) + Brand-Panel (Logo + Footer)
 *   - Rechte Spalte: Live-Preview via `LpPreview` (block-renderer mit
 *     Sample-Lead-Daten + Theme-Provider)
 *
 * Migration: lp-editor benutzt `useLpEditorState`, das auch alte v1-
 * Templates beim Mount via `migrateLegacyContent()` in v2 überführt.
 * Der "Diese Vorlage wurde migriert"-Banner kommt sobald das geschieht.
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  ListPlus,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Block, BlockType } from "@/lib/landing-blocks/types";
import { THEME_PRESET_ORDER, THEME_PRESETS } from "@/lib/landing-theme/presets";
import type { ThemePresetId } from "@/lib/landing-theme/types";
import {
  BLOCK_LABELS,
  FORM_REGISTRY,
} from "./_editor/inspector-fields";
import { MediaUrlField } from "./_editor/inspector-fields/shared";
import {
  useLpEditorState,
  type LpEditorInitialTemplate,
} from "./_editor/state";
import { LpPreview } from "./lp-preview";

export interface LpEditorTemplate extends LpEditorInitialTemplate {}

export function LpEditor({ template }: { template: LpEditorTemplate }) {
  const s = useLpEditorState(template);
  const activeBlock = s.blocks.find((b) => b.id === s.activeBlockId) ?? null;

  return (
    <>
      <div className="mb-6">
        <Link
          href="/landingpages"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-brand-deep mb-2"
        >
          <ArrowLeft className="size-3.5" />
          Zurück zur Übersicht
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <input
              value={s.name}
              onChange={(e) => s.setName(e.target.value)}
              onBlur={() => void s.saveName()}
              className="bg-transparent border-0 outline-none text-2xl font-bold text-ink w-full max-w-lg focus:bg-line-soft rounded-md px-1 -mx-1"
            />
            <p className="text-sm text-ink-muted mt-1">
              Änderungen werden automatisch gespeichert.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ThemePresetPicker
              current={s.theme.preset}
              onChange={(preset) => {
                if (!preset || preset === "custom") return;
                s.setTheme(THEME_PRESETS[preset]);
              }}
            />
            <SaveIndicator state={s.saveState} lastSavedAt={s.lastSavedAt} />
            <Button
              variant="ghost"
              type="button"
              size="sm"
              disabled={!s.canUndo}
              onClick={s.undo}
              iconLeft={<Undo2 className="size-3.5" />}
            >
              Undo
            </Button>
            <Button
              variant="brand"
              type="button"
              size="sm"
              onClick={() => void s.saveNow()}
              iconLeft={<Save className="size-3.5" />}
            >
              Speichern
            </Button>
          </div>
        </div>
      </div>

      {s.showMigrationBanner && (
        <div className="flex items-start gap-3 rounded-squircle-md bg-warn-soft/60 px-4 py-3 text-sm mb-6">
          <Sparkles className="size-4 text-warn shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-ink">
              Diese Vorlage wurde in das neue Block-Format überführt.
            </p>
            <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
              Speichern Sie, um die alte Form abzulösen — Ihre alte
              Konfiguration bleibt rein technisch in der Datenbank erhalten.
            </p>
          </div>
          <button
            type="button"
            onClick={s.dismissMigrationBanner}
            className="text-ink-muted hover:text-ink shrink-0"
            aria-label="Hinweis schließen"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px,1fr,minmax(0,520px)] gap-6">
        {/* ── Block-Liste ─────────────────────────────────────────── */}
        <div className="bg-surface rounded-squircle-md shadow-card p-3 max-h-[80vh] overflow-y-auto">
          <BlockList
            blocks={s.blocks}
            activeBlockId={s.activeBlockId}
            onSelect={s.setActiveBlockId}
            onMove={s.moveBlock}
            onRemove={s.removeBlock}
            onDuplicate={s.duplicateBlock}
          />
          <AddBlockMenu onAdd={(type) => s.addBlock(type)} />
        </div>

        {/* ── Inspector ─────────────────────────────────────────── */}
        <div className="bg-surface rounded-squircle-md shadow-card p-5 max-h-[80vh] overflow-y-auto">
          <Tabs defaultValue="content">
            <TabsList>
              <TabsTrigger value="content">Inhalt</TabsTrigger>
              <TabsTrigger value="brand">Branding</TabsTrigger>
            </TabsList>
            <TabsContent value="content" className="pt-4">
              {!activeBlock ? (
                <p className="text-sm text-ink-muted">
                  Wählen Sie einen Block aus der Liste links, um ihn zu
                  bearbeiten.
                </p>
              ) : (
                <Inspector
                  block={activeBlock}
                  onChange={(patch) =>
                    s.updateBlockData(activeBlock.id, patch)
                  }
                />
              )}
            </TabsContent>
            <TabsContent value="brand" className="pt-4">
              <BrandPanel
                logoUrl={s.brand.logoUrl ?? ""}
                logoAlign={s.brand.logoAlign ?? "left"}
                showFooter={s.brand.showFooter}
                footerText={s.brand.footerText ?? ""}
                onChange={(patch) => s.setBrand({ ...s.brand, ...patch })}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* ── Live-Preview ───────────────────────────────────────── */}
        <div className="bg-surface rounded-squircle-md shadow-card overflow-hidden max-h-[80vh] sticky top-4">
          <LpPreview
            blocks={s.blocks}
            theme={s.theme}
            brand={s.brand}
            activeBlockId={s.activeBlockId}
            onSelectBlock={s.setActiveBlockId}
          />
        </div>
      </div>
    </>
  );
}

// ── Block-Liste ─────────────────────────────────────────────────────────────

function BlockList({
  blocks,
  activeBlockId,
  onSelect,
  onMove,
  onRemove,
  onDuplicate,
}: {
  blocks: Block[];
  activeBlockId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  if (blocks.length === 0) {
    return (
      <p className="text-xs text-ink-muted text-center py-6">
        Keine Blöcke. Fügen Sie unten den ersten Block hinzu.
      </p>
    );
  }
  return (
    <ul className="space-y-1 mb-3">
      {blocks.map((b, idx) => {
        const active = b.id === activeBlockId;
        const summary = blockSummary(b);
        return (
          <li
            key={b.id}
            className={cn(
              "group flex items-center gap-1 rounded-squircle-sm px-2 py-1.5 transition-colors cursor-pointer",
              active
                ? "bg-brand-soft"
                : "bg-surface-soft hover:bg-surface-muted",
            )}
            onClick={() => onSelect(b.id)}
          >
            <div className="flex-1 min-w-0">
              <div
                className={cn(
                  "text-xs font-semibold truncate",
                  active ? "text-brand-deep" : "text-ink",
                )}
              >
                {BLOCK_LABELS[b.type] ?? b.type}
              </div>
              {summary && (
                <div className="text-[10px] text-ink-muted truncate">
                  {summary}
                </div>
              )}
            </div>
            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
              <IconBtn
                title="Nach oben"
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(b.id, -1);
                }}
                disabled={idx === 0}
              >
                <ChevronUp className="size-3" />
              </IconBtn>
              <IconBtn
                title="Nach unten"
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(b.id, 1);
                }}
                disabled={idx === blocks.length - 1}
              >
                <ChevronDown className="size-3" />
              </IconBtn>
              <IconBtn
                title="Duplizieren"
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(b.id);
                }}
              >
                <Copy className="size-3" />
              </IconBtn>
              <IconBtn
                title="Löschen"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(b.id);
                }}
                danger
              >
                <Trash2 className="size-3" />
              </IconBtn>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex size-5 items-center justify-center rounded text-ink-muted transition-colors",
        disabled && "opacity-30 cursor-not-allowed",
        !disabled && (danger ? "hover:text-danger" : "hover:text-ink"),
      )}
    >
      {children}
    </button>
  );
}

function blockSummary(b: Block): string | null {
  const d = b.data as Record<string, unknown>;
  if (typeof d.headline === "string" && d.headline.trim()) {
    return String(d.headline).slice(0, 40);
  }
  if (typeof d.name === "string" && d.name.trim()) {
    return String(d.name);
  }
  if (typeof d.title === "string" && d.title.trim()) {
    return String(d.title);
  }
  if (typeof d.markdown === "string" && d.markdown.trim()) {
    return String(d.markdown).slice(0, 40);
  }
  if (Array.isArray(d.items)) {
    return `${d.items.length} Eintrag${d.items.length === 1 ? "" : "e"}`;
  }
  return null;
}

// ── Add-Block-Menü ─────────────────────────────────────────────────────────

function AddBlockMenu({ onAdd }: { onAdd: (type: BlockType) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        iconLeft={<ListPlus className="size-3.5" />}
        className="w-full"
      >
        Block hinzufügen
      </Button>
      {open && (
        <div
          className="absolute left-0 right-0 mt-1 z-20 bg-surface rounded-squircle-sm shadow-card-hover max-h-64 overflow-y-auto"
          onMouseLeave={() => setOpen(false)}
        >
          {(Object.keys(BLOCK_LABELS) as BlockType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                onAdd(t);
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-2 text-xs font-medium text-ink hover:bg-line-soft transition-colors"
            >
              {BLOCK_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inspector ──────────────────────────────────────────────────────────────

function Inspector({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const Form = FORM_REGISTRY[block.type];
  if (Form) {
    return (
      <div>
        <h3 className="text-sm font-bold text-ink mb-3">
          {BLOCK_LABELS[block.type]}
        </h3>
        <Form block={block} onChange={onChange} />
      </div>
    );
  }
  return (
    <div>
      <h3 className="text-sm font-bold text-ink mb-3">
        {BLOCK_LABELS[block.type] ?? block.type}
      </h3>
      <Label>JSON</Label>
      <textarea
        value={JSON.stringify(block.data, null, 2)}
        onChange={(e) => {
          try {
            const next = JSON.parse(e.target.value);
            if (next && typeof next === "object") {
              onChange(next as Record<string, unknown>);
            }
          } catch {
            /* invalid JSON — wait until valid */
          }
        }}
        rows={12}
        className="w-full font-mono text-xs border border-line rounded-squircle-sm p-2"
      />
    </div>
  );
}

// ── Brand-Panel ────────────────────────────────────────────────────────────

function BrandPanel({
  logoUrl,
  logoAlign,
  showFooter,
  footerText,
  onChange,
}: {
  logoUrl: string;
  logoAlign: "left" | "center";
  showFooter: boolean | undefined;
  footerText: string;
  onChange: (patch: {
    logoUrl?: string | null;
    logoAlign?: "left" | "center";
    showFooter?: boolean | undefined;
    footerText?: string;
  }) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-ink mb-3">Logo</h3>
        <MediaUrlField
          label="Logo (aus Mediathek)"
          value={logoUrl}
          onChange={(url) => onChange({ logoUrl: url || null })}
          type="logo"
        />
        {logoUrl && (
          <div className="mt-3">
            <Label>Ausrichtung</Label>
            <div className="flex gap-2 mt-1.5">
              {(["left", "center"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => onChange({ logoAlign: a })}
                  className={cn(
                    "flex-1 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors",
                    logoAlign === a
                      ? "bg-brand-soft text-brand-deep"
                      : "bg-surface-soft text-ink-muted hover:text-ink",
                  )}
                >
                  {a === "left" ? "Links" : "Mitte"}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="pt-3 border-t border-line">
        <h3 className="text-sm font-bold text-ink mb-3">Footer</h3>
        <div className="flex items-center justify-between">
          <Label className="mb-0">Footer anzeigen</Label>
          <Switch
            checked={showFooter ?? false}
            onCheckedChange={(c) => onChange({ showFooter: c })}
          />
        </div>
        <p className="text-[11px] text-ink-muted mt-1.5 leading-relaxed">
          Auf Custom-Domains ist der Footer standardmäßig <strong>aus</strong>{" "}
          (White-Label), auf app.videocomet.de standardmäßig{" "}
          <strong>an</strong>. Diese Option setzt sich darüber hinweg.
        </p>
        {showFooter && (
          <div className="mt-3">
            <Label>Footer-Text (optional)</Label>
            <Input
              value={footerText}
              onChange={(e) => onChange({ footerText: e.target.value })}
              placeholder="© 2026 · Impressum · Datenschutz"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Theme-Preset-Picker ─────────────────────────────────────────────────────

function ThemePresetPicker({
  current,
  onChange,
}: {
  current: string | undefined;
  onChange: (preset: ThemePresetId | null) => void;
}) {
  // `current` can be "custom" (or any value coming from older data) — fall
  // back to "noir" for the select display while passing the user's choice
  // through unchanged to onChange.
  type PresetKey = (typeof THEME_PRESET_ORDER)[number];
  const selectValue: PresetKey =
    current && (THEME_PRESET_ORDER as readonly string[]).includes(current)
      ? (current as PresetKey)
      : "noir";
  return (
    <Select
      value={selectValue}
      onValueChange={(v) => onChange(v as ThemePresetId)}
    >
      <SelectTrigger className="h-9 w-[180px] text-xs">
        <SelectValue placeholder="Theme wählen" />
      </SelectTrigger>
      <SelectContent>
        {THEME_PRESET_ORDER.map((p) => (
          <SelectItem key={p} value={p}>
            <span className="flex items-center gap-2">
              <span
                className="inline-block size-3 rounded-full"
                style={{ background: THEME_PRESETS[p].colors.primary }}
              />
              <span className="capitalize">{p}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Save-Indicator ─────────────────────────────────────────────────────────

function SaveIndicator({
  state,
  lastSavedAt,
}: {
  state: "idle" | "saving" | "saved" | "error";
  lastSavedAt: number | null;
}) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
        <Loader2 className="size-3 animate-spin" />
        Speichert…
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-danger">
        Speichern fehlgeschlagen
      </span>
    );
  }
  if (state === "saved" && lastSavedAt) {
    const ago = Math.max(0, Math.round((Date.now() - lastSavedAt) / 1000));
    return (
      <span className="text-xs text-ink-muted">
        Gespeichert vor {ago < 5 ? "wenigen Sekunden" : `${ago} Sek.`}
      </span>
    );
  }
  return null;
}
