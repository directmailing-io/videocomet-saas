"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Save,
  Eye,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toaster";

interface Field {
  id: string;
  label: string;
  content: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  lineHeight: number;
  font: "LiebeHeideFineliner" | "BiroScript" | "Helvetica";
  color: string;
}

interface Sender {
  name?: string;
  street?: string;
  zip?: string;
  city?: string;
}

interface Template {
  id: string;
  name: string;
  format: "DIN_LANG" | "C4" | "C5" | "C6";
  fields: Field[];
  sender: Sender;
}

const FONT_OPTIONS: Array<{ value: Field["font"]; label: string }> = [
  { value: "Helvetica", label: "Helvetica (Standard)" },
  { value: "BiroScript", label: "Biro Script (Handschrift)" },
  { value: "LiebeHeideFineliner", label: "Liebe Heide Fineliner (Handschrift)" },
];

export function EnvelopeEditor({ templateId }: { templateId: string }) {
  const { toast } = useToast();
  const [template, setTemplate] = React.useState<Template | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/envelopes/${templateId}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Load failed");
        const json = await res.json();
        setTemplate(json.template);
      } catch (err) {
        toast({
          variant: "danger",
          title: "Fehler beim Laden",
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [templateId, toast]);

  function patchTemplate(patch: Partial<Template>) {
    setTemplate((t) => (t ? { ...t, ...patch } : t));
    setDirty(true);
  }

  function patchField(id: string, patch: Partial<Field>) {
    setTemplate((t) =>
      t
        ? {
            ...t,
            fields: t.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
          }
        : t,
    );
    setDirty(true);
  }

  function removeField(id: string) {
    setTemplate((t) =>
      t ? { ...t, fields: t.fields.filter((f) => f.id !== id) } : t,
    );
    setDirty(true);
  }

  function addField() {
    setTemplate((t) =>
      t
        ? {
            ...t,
            fields: [
              ...t.fields,
              {
                id: `f-${Date.now()}`,
                label: "Neues Feld",
                content: "",
                x: 20,
                y: 50,
                width: 50,
                fontSize: 12,
                lineHeight: 1.3,
                font: "Helvetica",
                color: "#000000",
              },
            ],
          }
        : t,
    );
    setDirty(true);
  }

  async function handleSave() {
    if (!template) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/envelopes/${templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: template.name,
          format: template.format,
          fields: template.fields,
          sender: template.sender,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
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
    if (dirty) await handleSave();
    window.open(`/api/envelopes/${templateId}/preview`, "_blank");
  }

  if (loading) {
    return (
      <div className="py-20 text-center text-ink-muted text-sm">
        <Loader2 className="size-4 animate-spin inline mr-2" /> Lade Vorlage …
      </div>
    );
  }

  if (!template) {
    return (
      <div className="py-20 text-center text-ink-muted">Vorlage nicht gefunden.</div>
    );
  }

  return (
    <>
      <PageHeader
        title={template.name || "Umschlag-Vorlage"}
        subtitle={`Format: ${template.format}`}
        actions={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={handlePreview}
              iconLeft={<Eye className="size-4" />}
            >
              Vorschau
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
        }
      />

      <Link
        href="/umschlaege"
        className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink mb-4"
      >
        <ArrowLeft className="size-3" /> Alle Vorlagen
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Grunddaten */}
        <Card>
          <CardHeader>
            <CardTitle>Grunddaten</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Name der Vorlage</Label>
              <Input
                value={template.name}
                onChange={(e) => patchTemplate({ name: e.target.value })}
              />
            </div>
            <div>
              <Label>Format</Label>
              <Select
                value={template.format}
                onValueChange={(v) => patchTemplate({ format: v as Template["format"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DIN_LANG">DIN lang (220 × 110 mm)</SelectItem>
                  <SelectItem value="C4">C4 (324 × 229 mm)</SelectItem>
                  <SelectItem value="C5">C5 (229 × 162 mm)</SelectItem>
                  <SelectItem value="C6">C6 (162 × 114 mm)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Absender */}
        <Card>
          <CardHeader>
            <CardTitle>Absender</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Name / Firma</Label>
              <Input
                value={template.sender.name ?? ""}
                onChange={(e) =>
                  patchTemplate({ sender: { ...template.sender, name: e.target.value } })
                }
                placeholder="Max Mustermann"
              />
            </div>
            <div>
              <Label>Straße</Label>
              <Input
                value={template.sender.street ?? ""}
                onChange={(e) =>
                  patchTemplate({
                    sender: { ...template.sender, street: e.target.value },
                  })
                }
                placeholder="Musterstraße 1"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>PLZ</Label>
                <Input
                  value={template.sender.zip ?? ""}
                  onChange={(e) =>
                    patchTemplate({ sender: { ...template.sender, zip: e.target.value } })
                  }
                />
              </div>
              <div>
                <Label>Ort</Label>
                <Input
                  value={template.sender.city ?? ""}
                  onChange={(e) =>
                    patchTemplate({
                      sender: { ...template.sender, city: e.target.value },
                    })
                  }
                />
              </div>
            </div>
            <p className="text-[11px] text-ink-muted">
              Referenzierbar in Feldern als{" "}
              <code>{`{{__sender.name}}`}</code>,{" "}
              <code>{`{{__sender.street}}`}</code>,{" "}
              <code>{`{{__sender.zip}}`}</code>,{" "}
              <code>{`{{__sender.city}}`}</code>.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Textfelder */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Textfelder ({template.fields.length})</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={addField}
              iconLeft={<Plus className="size-3.5" />}
            >
              Feld hinzufügen
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-ink-muted">
            Für jedes Feld setzt du Text (mit Merge-Tags wie{" "}
            <code>{`{{firstName}}`}</code>, <code>{`{{lastName}}`}</code>,{" "}
            <code>{`{{street}}`}</code>, <code>{`{{zip}}`}</code>,{" "}
            <code>{`{{city}}`}</code>), Position in Prozent (0-100) und
            Font/Größe.
          </p>
          {template.fields.map((field) => (
            <FieldRow
              key={field.id}
              field={field}
              onChange={(patch) => patchField(field.id, patch)}
              onRemove={() => removeField(field.id)}
            />
          ))}
          {template.fields.length === 0 && (
            <div className="text-center py-6 text-sm text-ink-muted">
              Noch keine Felder — klick oben auf „Feld hinzufügen".
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function FieldRow({
  field,
  onChange,
  onRemove,
}: {
  field: Field;
  onChange: (patch: Partial<Field>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-squircle-md border border-line p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className="flex-1 !text-sm"
          placeholder="Feld-Bezeichnung"
        />
        <button
          type="button"
          onClick={onRemove}
          className="text-ink-muted hover:text-red-600 shrink-0"
          aria-label="Feld löschen"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <div>
        <Label className="text-[11px]">Inhalt (mit {`{{merge-tags}}`})</Label>
        <Input
          value={field.content}
          onChange={(e) => onChange({ content: e.target.value })}
          placeholder="z. B. {{firstName}} {{lastName}}"
          className="!text-sm font-mono"
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <Label className="text-[11px]">X (%)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={field.x}
            onChange={(e) => onChange({ x: Number(e.target.value) })}
            className="!text-sm"
          />
        </div>
        <div>
          <Label className="text-[11px]">Y (%)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={field.y}
            onChange={(e) => onChange({ y: Number(e.target.value) })}
            className="!text-sm"
          />
        </div>
        <div>
          <Label className="text-[11px]">Breite (%)</Label>
          <Input
            type="number"
            min={5}
            max={100}
            step={1}
            value={field.width}
            onChange={(e) => onChange({ width: Number(e.target.value) })}
            className="!text-sm"
          />
        </div>
        <div>
          <Label className="text-[11px]">Font-Größe (pt)</Label>
          <Input
            type="number"
            min={6}
            max={72}
            step={1}
            value={field.fontSize}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
            className="!text-sm"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div>
          <Label className="text-[11px]">Font</Label>
          <Select
            value={field.font}
            onValueChange={(v) => onChange({ font: v as Field["font"] })}
          >
            <SelectTrigger className="!text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px]">Zeilenabstand</Label>
          <Input
            type="number"
            min={0.8}
            max={4}
            step={0.1}
            value={field.lineHeight}
            onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
            className="!text-sm"
          />
        </div>
        <div>
          <Label className="text-[11px]">Farbe</Label>
          <Input
            type="color"
            value={field.color}
            onChange={(e) => onChange({ color: e.target.value })}
            className="!text-sm h-9 !p-1"
          />
        </div>
      </div>
    </div>
  );
}
