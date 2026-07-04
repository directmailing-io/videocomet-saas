"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Eye,
  Save,
  Trash2,
  Loader2,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

// ─── Typen (analog zu DB-Schema) ─────────────────────────────────────────
type FontName = "Helvetica" | "BiroScript" | "LiebeHeideFineliner";
// Anmerkung: LiebeHeideFineliner bleibt im Type-Union fuer bestehende
// DB-Zeilen; die Auswahl im Editor bietet sie aber nicht mehr an (der
// Font wird von pdf-lib fehlerhaft gerendert, siehe FONT_ALIASES im
// Worker).
type FormatKey = "DIN_LANG" | "C4" | "C5" | "C6";

type TextAlign = "left" | "center" | "right";

interface EnvelopeField {
  id: string;
  label: string;
  content: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  lineHeight: number;
  font: FontName;
  color: string;
  align?: TextAlign;
}

interface EnvelopeSender {
  name?: string;
  street?: string;
  zip?: string;
  city?: string;
}

interface Template {
  id: string;
  name: string;
  format: FormatKey;
  fields: EnvelopeField[];
  sender: EnvelopeSender;
}

// ─── Konstanten ───────────────────────────────────────────────────────────
const PT_PER_MM = 72 / 25.4;

const FORMAT_MM: Record<FormatKey, { w: number; h: number; label: string }> = {
  DIN_LANG: { w: 220, h: 110, label: "DIN lang (220 × 110 mm)" },
  C4: { w: 324, h: 229, label: "C4 (324 × 229 mm)" },
  C5: { w: 229, h: 162, label: "C5 (229 × 162 mm)" },
  C6: { w: 162, h: 114, label: "C6 (162 × 114 mm)" },
};

const FONTS: Array<{ value: FontName; label: string; css: string }> = [
  {
    value: "Helvetica",
    label: "Arial",
    css: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  },
  {
    value: "BiroScript",
    label: "Handschrift (Biro Script)",
    css: "'BiroScript', cursive",
  },
];

const COLOR_PRESETS = [
  { hex: "#000000", label: "Schwarz" },
  { hex: "#1f3a8a", label: "Marineblau" },
  { hex: "#374151", label: "Anthrazit" },
];


// ─── Helper ───────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function resolvePreview(
  content: string,
): { text: string; isTag: boolean }[] {
  const parts: { text: string; isTag: boolean }[] = [];
  const rex = /\{\{([^}]+)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = rex.exec(content)) !== null) {
    if (m.index > last)
      parts.push({ text: content.slice(last, m.index), isTag: false });
    const key = m[1].trim();
    // Platzhalter als Chip mit dem Namen anzeigen — so sieht der User
    // genau welche Spalte spaeter beim Runden-Wizard gemappt wird.
    parts.push({ text: `[${key}]`, isTag: true });
    last = m.index + m[0].length;
  }
  if (last < content.length)
    parts.push({ text: content.slice(last), isTag: false });
  return parts;
}

// ─── Preset-Felder ────────────────────────────────────────────────────────
function newTextField(): EnvelopeField {
  return {
    id: uid(),
    label: "Textfeld",
    content: "Neuer Text",
    x: 20,
    y: 25,
    width: 55,
    fontSize: 13,
    lineHeight: 1.3,
    font: "Helvetica",
    color: "#000000",
    align: "left",
  };
}

// ─── Editor ──────────────────────────────────────────────────────────────
export function EnvelopeEditor({ templateId }: { templateId: string }) {
  const { toast } = useToast();
  const [tpl, setTpl] = React.useState<Template | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<
    | {
        mode: "move";
        id: string;
        offsetX: number;
        offsetY: number;
        canvasRect: DOMRect;
      }
    | {
        mode: "resize";
        id: string;
        startWidth: number; // %
        startX: number; // %
        startMouseX: number; // px
        canvasRect: DOMRect;
      }
    | null
  >(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/envelopes/${templateId}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Load failed");
        const json = await res.json();
        if (cancelled) return;
        setTpl(json.template);
      } catch (err) {
        if (!cancelled)
          toast({
            variant: "danger",
            title: "Vorlage konnte nicht geladen werden",
            description: err instanceof Error ? err.message : undefined,
          });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, toast]);

  const patchTpl = (patch: Partial<Template>) => {
    setTpl((t) => (t ? { ...t, ...patch } : t));
    setDirty(true);
  };
  const patchField = (id: string, patch: Partial<EnvelopeField>) => {
    setTpl((t) =>
      t
        ? {
            ...t,
            fields: t.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
          }
        : t,
    );
    setDirty(true);
  };
  const addField = (field: EnvelopeField) => {
    setTpl((t) => (t ? { ...t, fields: [...t.fields, field] } : t));
    setSelectedId(field.id);
    setDirty(true);
  };
  const removeField = (id: string) => {
    setTpl((t) =>
      t ? { ...t, fields: t.fields.filter((f) => f.id !== id) } : t,
    );
    if (selectedId === id) setSelectedId(null);
    setDirty(true);
  };
  async function handleSave() {
    if (!tpl) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/envelopes/${tpl.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tpl.name,
          format: tpl.format,
          fields: tpl.fields,
          sender: tpl.sender,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "Fehler beim Speichern");
      }
      setDirty(false);
      toast({ variant: "success", title: "Vorlage gespeichert" });
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

  async function handlePreview() {
    if (!tpl) return;
    if (dirty) await handleSave();
    window.open(`/api/envelopes/${tpl.id}/preview`, "_blank");
  }

  const onGlobalMouseMove = React.useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = drag.canvasRect;
    if (drag.mode === "move") {
      let newX = ((e.clientX - rect.left - drag.offsetX) / rect.width) * 100;
      let newY = ((e.clientY - rect.top - drag.offsetY) / rect.height) * 100;
      newX = Math.max(0, Math.min(100, newX));
      newY = Math.max(0, Math.min(100, newY));
      setTpl((t) => {
        if (!t) return t;
        return {
          ...t,
          fields: t.fields.map((f) =>
            f.id === drag.id ? { ...f, x: newX, y: newY } : f,
          ),
        };
      });
    } else {
      // resize: neue Breite = startWidth + delta in %
      const deltaPx = e.clientX - drag.startMouseX;
      const deltaPct = (deltaPx / rect.width) * 100;
      const maxWidth = 100 - drag.startX; // nicht ueber rechten Rand
      let newWidth = drag.startWidth + deltaPct;
      newWidth = Math.max(5, Math.min(maxWidth, newWidth));
      setTpl((t) => {
        if (!t) return t;
        return {
          ...t,
          fields: t.fields.map((f) =>
            f.id === drag.id ? { ...f, width: newWidth } : f,
          ),
        };
      });
    }
    setDirty(true);
  }, []);

  const onGlobalMouseUp = React.useCallback(() => {
    dragRef.current = null;
    document.removeEventListener("mousemove", onGlobalMouseMove);
    document.removeEventListener("mouseup", onGlobalMouseUp);
  }, [onGlobalMouseMove]);

  const onFieldMouseDown = (e: React.MouseEvent, fieldId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(fieldId);
    const canvas = canvasRef.current;
    if (!canvas || !tpl) return;
    const rect = canvas.getBoundingClientRect();
    const field = tpl.fields.find((f) => f.id === fieldId);
    if (!field) return;
    const fieldPxX = (field.x / 100) * rect.width;
    const fieldPxY = (field.y / 100) * rect.height;
    dragRef.current = {
      mode: "move",
      id: fieldId,
      offsetX: e.clientX - rect.left - fieldPxX,
      offsetY: e.clientY - rect.top - fieldPxY,
      canvasRect: rect,
    };
    document.addEventListener("mousemove", onGlobalMouseMove);
    document.addEventListener("mouseup", onGlobalMouseUp);
  };

  const onResizeHandleMouseDown = (e: React.MouseEvent, fieldId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(fieldId);
    const canvas = canvasRef.current;
    if (!canvas || !tpl) return;
    const field = tpl.fields.find((f) => f.id === fieldId);
    if (!field) return;
    dragRef.current = {
      mode: "resize",
      id: fieldId,
      startWidth: field.width,
      startX: field.x,
      startMouseX: e.clientX,
      canvasRect: canvas.getBoundingClientRect(),
    };
    document.addEventListener("mousemove", onGlobalMouseMove);
    document.addEventListener("mouseup", onGlobalMouseUp);
  };

  React.useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", onGlobalMouseMove);
      document.removeEventListener("mouseup", onGlobalMouseUp);
    };
  }, [onGlobalMouseMove, onGlobalMouseUp]);


  if (loading) {
    return (
      <div className="py-20 text-center text-ink-muted text-sm">
        <Loader2 className="size-5 inline animate-spin mr-2" /> Lade Vorlage …
      </div>
    );
  }
  if (!tpl) {
    return (
      <div className="py-20 text-center text-ink-muted text-sm">
        Vorlage nicht gefunden.
      </div>
    );
  }

  const dims = FORMAT_MM[tpl.format];
  const canvasStyle: React.CSSProperties = {
    aspectRatio: `${dims.w} / ${dims.h}`,
    containerType: "inline-size",
  };
  const selectedField = tpl.fields.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/umschlaege"
          className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" /> Alle Vorlagen
        </Link>
        <div className="flex-1 min-w-[200px]">
          <Input
            value={tpl.name}
            onChange={(e) => patchTpl({ name: e.target.value })}
            className="text-lg font-semibold border-transparent bg-transparent hover:border-line focus:border-brand"
            placeholder="Name der Vorlage"
          />
        </div>
        <Select
          value={tpl.format}
          onValueChange={(v) => patchTpl({ format: v as FormatKey })}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FORMAT_MM) as FormatKey[]).map((f) => (
              <SelectItem key={f} value={f}>
                {FORMAT_MM[f].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          onClick={handlePreview}
          iconLeft={<Eye className="size-4" />}
        >
          PDF-Vorschau
        </Button>
        <Button
          onClick={handleSave}
          disabled={!dirty || saving}
          loading={saving}
          iconLeft={<Save className="size-4" />}
        >
          Speichern
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_360px] gap-5">
        {/* Linke Sidebar: nur Bausteine */}
        <aside>
          <Card>
            <CardContent className="p-4 space-y-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => addField(newTextField())}
                iconLeft={<Type className="size-4" />}
                className="w-full"
              >
                Textfeld hinzufügen
              </Button>
              <p className="text-[11px] text-ink-muted leading-snug">
                Ein Textfeld nutzt du für alles — Empfänger, Absender oder
                sonstigen Text. Für dynamische Felder Platzhalter wie{" "}
                <code className="bg-line-soft px-1 rounded">{"{{vorname}}"}</code>{" "}
                verwenden, für Absender einfach direkt tippen.
              </p>
            </CardContent>
          </Card>
        </aside>

        {/* Mitte: Canvas */}
        <div className="space-y-3">
          <div className="rounded-squircle-md bg-line-soft p-6 flex items-center justify-center">
            <div
              ref={canvasRef}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setSelectedId(null);
              }}
              className="relative w-full max-w-[720px] bg-white shadow-lg rounded-sm border border-line select-none"
              style={canvasStyle}
            >
              {tpl.fields.map((f) => (
                <FieldOnCanvas
                  key={f.id}
                  field={f}
                  selected={f.id === selectedId}
                  canvasWidthMm={dims.w}
                  onMouseDown={(e) => onFieldMouseDown(e, f.id)}
                  onResizeMouseDown={(e) => onResizeHandleMouseDown(e, f.id)}
                />
              ))}
              {tpl.fields.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-ink-muted text-sm px-6 text-center">
                  ← Links auf einen Baustein klicken, um zu starten
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-ink-muted text-center">
            Klick auf ein Element = auswählen · Ziehen = verschieben · Blauer
            Griff rechts = Breite ändern
          </p>

          {/* Mobile: Inspector unter Canvas */}
          <div className="lg:hidden">
            {selectedField && (
              <FieldInspector
                field={selectedField}
                onChange={(patch) => patchField(selectedField.id, patch)}
                onDelete={() => removeField(selectedField.id)}
              />
            )}
          </div>
        </div>

        {/* Rechte Sidebar (Desktop): Inspector, sticky damit Vorschau sichtbar bleibt */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-3">
            {selectedField ? (
              <FieldInspector
                field={selectedField}
                onChange={(patch) => patchField(selectedField.id, patch)}
                onDelete={() => removeField(selectedField.id)}
              />
            ) : (
              <Card>
                <CardContent className="py-10 text-center text-ink-muted text-sm">
                  Wähle links ein Element aus, um es zu bearbeiten.
                </CardContent>
              </Card>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Feld auf Canvas ──────────────────────────────────────────────────────
function FieldOnCanvas({
  field,
  selected,
  canvasWidthMm,
  onMouseDown,
  onResizeMouseDown,
}: {
  field: EnvelopeField;
  selected: boolean;
  canvasWidthMm: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onResizeMouseDown: (e: React.MouseEvent) => void;
}) {
  const parts = resolvePreview(field.content);
  const fontDef = FONTS.find((f) => f.value === field.font) ?? FONTS[0];
  const fontCqw = (field.fontSize / PT_PER_MM / canvasWidthMm) * 100;

  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        "absolute cursor-move p-0.5",
        selected
          ? "outline outline-2 outline-brand outline-offset-1"
          : "hover:outline hover:outline-1 hover:outline-brand/40",
      )}
      style={{
        left: `${field.x}%`,
        top: `${field.y}%`,
        width: `${field.width}%`,
        fontFamily: fontDef.css,
        color: field.color,
        lineHeight: field.lineHeight,
        textAlign: field.align ?? "left",
        whiteSpace: "pre-wrap",
        wordBreak: "normal",
        overflowWrap: "break-word",
        fontSize: `${fontCqw}cqw`,
      }}
    >
      {parts.length === 0 && (
        <span className="text-ink-muted italic opacity-40">(leer)</span>
      )}
      {parts.map((p, i) =>
        p.isTag ? (
          // Chip nur subtil markieren, ohne die Textfarbe zu ueberschreiben —
          // damit man in der Vorschau die tatsaechliche Font-Farbe sieht.
          <span
            key={i}
            className="rounded-sm border border-dashed border-current/40 px-0.5"
            style={{ backgroundColor: "rgba(0,0,0,0.03)" }}
          >
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}

      {selected && (
        <div
          onMouseDown={onResizeMouseDown}
          className="absolute -right-2 top-0 h-full w-4 flex items-center justify-center cursor-ew-resize group/handle"
          title="Breite ändern — hier ziehen"
        >
          <div className="h-full w-1 bg-brand rounded-full opacity-70 group-hover/handle:opacity-100 transition-opacity" />
          <div className="absolute size-5 bg-brand text-white rounded-full shadow-lg flex items-center justify-center border-2 border-white">
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M4 2 L2 5 L4 8" />
              <path d="M6 2 L8 5 L6 8" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inspector ────────────────────────────────────────────────────────────
function FieldInspector({
  field,
  onChange,
  onDelete,
}: {
  field: EnvelopeField;
  onChange: (patch: Partial<EnvelopeField>) => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">
            Bearbeiten: {field.label || "Element"}
          </CardTitle>
          <button
            type="button"
            onClick={onDelete}
            className="text-ink-muted hover:text-red-600 text-xs inline-flex items-center gap-1"
          >
            <Trash2 className="size-3.5" /> Element löschen
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div>
          <Label htmlFor={`f-label-${field.id}`} className="text-xs">
            Label (nur intern, für dich)
          </Label>
          <Input
            id={`f-label-${field.id}`}
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
            className="h-8 text-sm"
          />
        </div>

        <div>
          <Label htmlFor={`field-content-${field.id}`} className="text-xs">
            Text (Klick auf Baustein fügt ihn ein)
          </Label>
          <textarea
            id={`field-content-${field.id}`}
            value={field.content}
            onChange={(e) => onChange({ content: e.target.value })}
            rows={4}
            className="mt-1 w-full rounded-squircle-sm border border-line bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:border-brand"
            placeholder="Text hier eingeben oder einen Baustein anklicken →"
          />
          <p className="mt-2 text-[11px] text-ink-muted leading-snug">
            Platzhalter schreibst du in doppelten geschweiften Klammern, z. B.{" "}
            <code className="bg-line-soft px-1 rounded">{"{{vorname}}"}</code>,{" "}
            <code className="bg-line-soft px-1 rounded">{"{{titel}}"}</code>,{" "}
            <code className="bg-line-soft px-1 rounded">{"{{strasse}}"}</code>.
            Bei der Runden-Erstellung ordnest du diese Namen dann deinen
            Excel-Spalten zu.
          </p>
        </div>

        {/* Schrift + Farbe */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
          <div>
            <Label htmlFor={`f-font-${field.id}`} className="text-xs">
              Schrift
            </Label>
            <Select
              value={field.font}
              onValueChange={(v) => onChange({ font: v as FontName })}
            >
              <SelectTrigger id={`f-font-${field.id}`} className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONTS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    <span style={{ fontFamily: f.css }}>{f.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Farbe</Label>
            <div className="flex gap-1 mt-1">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => onChange({ color: c.hex })}
                  className={cn(
                    "size-8 rounded-full border-2 transition-transform",
                    field.color === c.hex
                      ? "border-brand scale-110"
                      : "border-line",
                  )}
                  style={{ backgroundColor: c.hex }}
                  title={c.label}
                  aria-label={c.label}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Ausrichtung */}
        <div>
          <Label className="text-xs">Ausrichtung</Label>
          <div className="flex gap-1 mt-1">
            {(
              [
                { key: "left" as const, label: "Links", icon: "⇤" },
                { key: "center" as const, label: "Mitte", icon: "⇔" },
                { key: "right" as const, label: "Rechts", icon: "⇥" },
              ]
            ).map((a) => {
              const current = field.align ?? "left";
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => onChange({ align: a.key })}
                  className={cn(
                    "flex-1 h-9 rounded-squircle-sm border text-xs font-medium inline-flex items-center justify-center gap-1",
                    current === a.key
                      ? "bg-brand text-white border-brand"
                      : "border-line text-ink hover:bg-line-soft",
                  )}
                >
                  <span className="text-base leading-none">{a.icon}</span>
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Textgroesse: Slider + Zahleneingabe */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <Label className="text-xs">Textgröße</Label>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={4}
              max={72}
              step={1}
              value={field.fontSize}
              onChange={(e) =>
                onChange({ fontSize: Number(e.target.value) })
              }
              className="flex-1 accent-brand"
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={4}
                max={96}
                step={1}
                value={field.fontSize}
                onChange={(e) =>
                  onChange({
                    fontSize: Math.max(4, Math.min(96, Number(e.target.value) || 4)),
                  })
                }
                className="w-16 h-8 rounded-squircle-sm border border-line px-2 text-sm text-center"
              />
              <span className="text-xs text-ink-muted">pt</span>
            </div>
          </div>
        </div>

        {/* Zeilenabstand */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <Label className="text-xs">Zeilenabstand</Label>
            <div className="text-xs text-ink-muted">{field.lineHeight.toFixed(2)}×</div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0.8}
              max={3}
              step={0.05}
              value={field.lineHeight}
              onChange={(e) =>
                onChange({ lineHeight: Number(e.target.value) })
              }
              className="flex-1 accent-brand"
            />
            <input
              type="number"
              min={0.8}
              max={4}
              step={0.05}
              value={field.lineHeight}
              onChange={(e) =>
                onChange({
                  lineHeight: Math.max(0.8, Math.min(4, Number(e.target.value) || 1)),
                })
              }
              className="w-20 h-8 rounded-squircle-sm border border-line px-2 text-sm text-center"
            />
          </div>
        </div>

        {/* Feldbreite */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <Label className="text-xs">Feldbreite</Label>
            <div className="text-xs text-ink-muted">
              {Math.round(field.width)} % · Tipp: am blauen Punkt rechts am Element ziehen
            </div>
          </div>
          <input
            type="range"
            min={5}
            max={100}
            step={1}
            value={field.width}
            onChange={(e) => onChange({ width: Number(e.target.value) })}
            className="w-full accent-brand"
          />
        </div>
      </CardContent>
    </Card>
  );
}

