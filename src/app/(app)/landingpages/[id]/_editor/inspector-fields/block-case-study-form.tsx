"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { InspectorFormProps } from "./index";
import { asObject, asString, MediaUrlField, VideoUrlField } from "./shared";

/**
 * Inspector-Formular für den Fallstudien-Block.
 * data-Shape siehe makeDefaultBlock in ../state.ts:
 *   { headline, client: { name, logoUrl, photoUrl },
 *     medium: { kind, url, alt }, textMode,
 *     quote: { text, author, role }, freeText,
 *     structured: { situation, action, result, kpi } }
 * Die Medium-Position (links/rechts/oben) steuert der zentrale
 * Varianten-Umschalter.
 */

type TextMode = "quote" | "free" | "structured" | "none";

const TEXT_MODES: ReadonlyArray<{ id: TextMode; label: string }> = [
  { id: "quote", label: "Zitat" },
  { id: "free", label: "Freitext" },
  { id: "structured", label: "Strukturiert" },
  { id: "none", label: "Ohne Text" },
];

function asTextMode(value: unknown): TextMode {
  return value === "free" || value === "structured" || value === "none"
    ? value
    : "quote";
}

export function BlockCaseStudyForm({ block, onChange }: InspectorFormProps) {
  const data = block.data;
  const client = asObject(data.client);
  const medium = asObject(data.medium);
  const quote = asObject(data.quote);
  const structured = asObject(data.structured);
  const textMode = asTextMode(data.textMode);
  const mediumKind = medium.kind === "video" ? "video" : "image";

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="case-headline">Headline</Label>
        <Input
          id="case-headline"
          value={asString(data.headline)}
          onChange={(e) => onChange({ headline: e.target.value })}
          placeholder="So haben wir Kunden geholfen"
        />
      </div>

      {/* ── Kunde ─────────────────────────────────────────────────── */}
      <fieldset className="rounded-squircle-sm border border-line p-3 space-y-2">
        <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Kunde
        </legend>
        <div>
          <Label htmlFor="case-client-name">Name</Label>
          <Input
            id="case-client-name"
            value={asString(client.name)}
            onChange={(e) =>
              onChange({ client: { ...client, name: e.target.value } })
            }
            placeholder="Beispiel GmbH"
          />
        </div>
        <MediaUrlField
          label="Logo (optional)"
          value={asString(client.logoUrl)}
          onChange={(url) => onChange({ client: { ...client, logoUrl: url } })}
          type="logo"
        />
        <MediaUrlField
          label="Foto (optional)"
          value={asString(client.photoUrl)}
          onChange={(url) => onChange({ client: { ...client, photoUrl: url } })}
          type="image"
        />
      </fieldset>

      {/* ── Medium ────────────────────────────────────────────────── */}
      <fieldset className="rounded-squircle-sm border border-line p-3 space-y-2">
        <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Medium
        </legend>
        <div>
          <Label>Art</Label>
          <div className="flex gap-2 mt-1.5">
            {(
              [
                { id: "image", label: "Bild" },
                { id: "video", label: "Video" },
              ] as const
            ).map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => onChange({ medium: { ...medium, kind: k.id } })}
                className={cn(
                  "flex-1 px-3 py-1.5 text-xs font-semibold rounded-squircle-sm border transition-colors",
                  mediumKind === k.id
                    ? "border-brand bg-brand-soft text-brand-deep"
                    : "border-line bg-surface text-ink-muted hover:text-ink",
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
        {mediumKind === "video" ? (
          <VideoUrlField
            label="Video-Link"
            value={asString(medium.url)}
            onChange={(url) => onChange({ medium: { ...medium, url } })}
          />
        ) : (
          <MediaUrlField
            label="Bild"
            value={asString(medium.url)}
            onChange={(url) => onChange({ medium: { ...medium, url } })}
            type="image"
          />
        )}
        <div>
          <Label htmlFor="case-medium-alt">Alt-Text</Label>
          <Input
            id="case-medium-alt"
            value={asString(medium.alt)}
            onChange={(e) =>
              onChange({ medium: { ...medium, alt: e.target.value } })
            }
            placeholder="Beschreibung für Screenreader"
          />
        </div>
      </fieldset>

      {/* ── Textstufe ─────────────────────────────────────────────── */}
      <div>
        <Label>Textstufe</Label>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {TEXT_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ textMode: m.id })}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-squircle-sm border transition-colors",
                textMode === m.id
                  ? "border-brand bg-brand-soft text-brand-deep"
                  : "border-line bg-surface text-ink-muted hover:text-ink",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {textMode === "quote" && (
        <fieldset className="rounded-squircle-sm border border-line p-3 space-y-2">
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Zitat
          </legend>
          <div>
            <Label htmlFor="case-quote-text">Text</Label>
            <Textarea
              id="case-quote-text"
              value={asString(quote.text)}
              onChange={(e) =>
                onChange({ quote: { ...quote, text: e.target.value } })
              }
              rows={3}
              placeholder="Was sagt dein Kunde über die Zusammenarbeit?"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="case-quote-author">Autor</Label>
              <Input
                id="case-quote-author"
                value={asString(quote.author)}
                onChange={(e) =>
                  onChange({ quote: { ...quote, author: e.target.value } })
                }
                placeholder="Anna Schmidt"
              />
            </div>
            <div>
              <Label htmlFor="case-quote-role">Rolle</Label>
              <Input
                id="case-quote-role"
                value={asString(quote.role)}
                onChange={(e) =>
                  onChange({ quote: { ...quote, role: e.target.value } })
                }
                placeholder="CEO Beispiel GmbH"
              />
            </div>
          </div>
        </fieldset>
      )}

      {textMode === "free" && (
        <div>
          <Label htmlFor="case-free-text">Freitext</Label>
          <Textarea
            id="case-free-text"
            value={asString(data.freeText)}
            onChange={(e) => onChange({ freeText: e.target.value })}
            rows={5}
            placeholder="Erzähle in eigenen Worten, was ihr erreicht habt."
          />
        </div>
      )}

      {textMode === "structured" && (
        <fieldset className="rounded-squircle-sm border border-line p-3 space-y-2">
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Strukturiert
          </legend>
          <div>
            <Label htmlFor="case-situation">Ausgangslage</Label>
            <Textarea
              id="case-situation"
              value={asString(structured.situation)}
              onChange={(e) =>
                onChange({
                  structured: { ...structured, situation: e.target.value },
                })
              }
              rows={2}
              placeholder="Wo stand der Kunde vorher?"
            />
          </div>
          <div>
            <Label htmlFor="case-action">Was wir gemacht haben</Label>
            <Textarea
              id="case-action"
              value={asString(structured.action)}
              onChange={(e) =>
                onChange({
                  structured: { ...structured, action: e.target.value },
                })
              }
              rows={2}
              placeholder="Welche Schritte habt ihr umgesetzt?"
            />
          </div>
          <div>
            <Label htmlFor="case-result">Ergebnis</Label>
            <Textarea
              id="case-result"
              value={asString(structured.result)}
              onChange={(e) =>
                onChange({
                  structured: { ...structured, result: e.target.value },
                })
              }
              rows={2}
              placeholder="Was ist dabei herausgekommen?"
            />
          </div>
          <div>
            <Label htmlFor="case-kpi">Kennzahl</Label>
            <Input
              id="case-kpi"
              value={asString(structured.kpi)}
              onChange={(e) =>
                onChange({ structured: { ...structured, kpi: e.target.value } })
              }
              placeholder="+43 %"
            />
          </div>
        </fieldset>
      )}
    </div>
  );
}
