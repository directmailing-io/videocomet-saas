"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { detectDuplicates } from "@/lib/dedupe/engine";
import type { DedupeConfig, DedupeRule } from "@/lib/dedupe/types";

/**
 * Wizard-Card "Duplikate erkennen".
 *
 * Lebt rein im Wizard-State; persistiert NICHT selbst. Der Parent
 * (run-wizard.tsx) übernimmt das PUT auf `/api/runs/[id]/dedupe-config`
 * beim "Weiter"-Klick.
 *
 * Die Auto-Suggest-Logik läuft client-seitig — `suggest.ts` aus Paket A
 * importiert `node:crypto` und ist deshalb nicht client-safe. Wir
 * implementieren hier einen kompakten Header-Heuristik-Pass mit den
 * gleichen Regel-Schablonen.
 */
export interface RunWizardDedupeCardProps {
  rows: Record<string, string>[];
  headers: string[];
  value: DedupeConfig;
  onChange: (next: DedupeConfig) => void;
}

const DEFAULT_CONFIG: DedupeConfig = {
  enabled: true,
  strategy: "keep-first",
  rules: [],
};

export const RUN_WIZARD_DEDUPE_DEFAULT: DedupeConfig = DEFAULT_CONFIG;

/** UUID, fällt auf Math.random zurück falls `crypto.randomUUID` fehlt. */
function rid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

/** Header-Normalisierung — identisch zu `suggest.ts` Server-Seite. */
function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function findHeader(headers: string[], patterns: RegExp): string | null {
  for (const h of headers) {
    if (patterns.test(normHeader(h))) return h;
  }
  return null;
}

/**
 * Client-seitiges Pendant zu `suggestRules` aus Paket A. Identische
 * Heuristik, aber `crypto.randomUUID` statt `node:crypto`.
 */
function suggestRulesClient(headers: string[]): DedupeRule[] {
  const rules: DedupeRule[] = [];

  const emailCol = findHeader(headers, /^(e ?mail|mail)$/);
  if (emailCol) {
    rules.push({
      id: rid(),
      label: "E-Mail",
      columns: [emailCol],
      normalizers: { [emailCol]: "email" },
      enabled: true,
    });
  }

  const firstNameCol = findHeader(headers, /^(vorname|firstname|first name)$/);
  const lastNameCol = findHeader(headers, /^(nachname|lastname|last name)$/);
  const plzCol = findHeader(headers, /^(plz|postleitzahl|zip|postcode)$/);
  const streetCol = findHeader(headers, /^(strasse|street|adresse)$/);
  const dobCol = findHeader(
    headers,
    /^(geburtsdatum|geburtstag|dob|birthday)$/,
  );
  const companyCol = findHeader(headers, /^(firma|company|unternehmen)$/);

  if (firstNameCol && lastNameCol && plzCol) {
    rules.push({
      id: rid(),
      label: "Vorname + Nachname + PLZ",
      columns: [firstNameCol, lastNameCol, plzCol],
      normalizers: { [plzCol]: "digits-only" },
      enabled: true,
    });
  }

  if (lastNameCol && plzCol && streetCol) {
    rules.push({
      id: rid(),
      label: "Nachname + Straße + PLZ",
      columns: [lastNameCol, streetCol, plzCol],
      normalizers: { [plzCol]: "digits-only" },
      enabled: false,
    });
  }

  if (firstNameCol && lastNameCol && dobCol) {
    rules.push({
      id: rid(),
      label: "Vorname + Nachname + Geburtsdatum",
      columns: [firstNameCol, lastNameCol, dobCol],
      enabled: true,
    });
  }

  if (firstNameCol && lastNameCol && companyCol) {
    rules.push({
      id: rid(),
      label: "Vorname + Nachname + Firma",
      columns: [firstNameCol, lastNameCol, companyCol],
      enabled: false,
    });
  }

  return rules;
}

export function RunWizardDedupeCard({
  rows,
  headers,
  value,
  onChange,
}: RunWizardDedupeCardProps) {
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [groupsExpanded, setGroupsExpanded] = React.useState(false);

  // Auto-Suggest beim ersten Mount, wenn noch keine Regeln gesetzt sind.
  // useRef-Guard verhindert mehrfache Aufrufe, wenn der Parent das `value`
  // unverändert zurückschickt (React-StrictMode → Doppel-Effect).
  const didSuggestRef = React.useRef(false);
  React.useEffect(() => {
    if (didSuggestRef.current) return;
    if (value.rules.length > 0) {
      didSuggestRef.current = true;
      return;
    }
    if (headers.length === 0) return;
    didSuggestRef.current = true;
    const suggested = suggestRulesClient(headers);
    if (suggested.length === 0) return;
    onChange({ ...value, rules: suggested });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers.join("")]);

  // Live-Compute. Engine ist sync und in der Größenordnung 5k Rows OK
  // (O(R·C·R̅)). Bei sehr breiten Configs (>20 Regeln) sollte man später
  // einen Web-Worker erwägen.
  const result = React.useMemo(
    () => detectDuplicates(rows, value),
    [rows, value],
  );

  const totalRows = rows.length;
  const excluded = result.stats.excluded;
  const remaining = totalRows - excluded;

  function patchRule(ruleId: string, patch: Partial<DedupeRule>) {
    onChange({
      ...value,
      rules: value.rules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)),
    });
  }

  function removeRule(ruleId: string) {
    onChange({
      ...value,
      rules: value.rules.filter((r) => r.id !== ruleId),
    });
  }

  function appendRule(label: string, columns: string[]) {
    if (columns.length === 0) return;
    onChange({
      ...value,
      rules: [
        ...value.rules,
        {
          id: rid(),
          label: label.trim() || columns.join(" + "),
          columns,
          enabled: true,
        },
      ],
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand" />
            Duplikate erkennen
          </CardTitle>
          <p className="text-xs text-ink-muted">
            Vor dem Start prüfen wir auf doppelte Leads. Duplikate werden aus
            der Verarbeitung entfernt, bleiben aber im Run-Audit.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <Label
            htmlFor="dedupe-master"
            className="text-xs font-medium text-ink-muted"
          >
            Duplikate ausschließen
          </Label>
          <Switch
            id="dedupe-master"
            checked={value.enabled}
            onCheckedChange={(checked) =>
              onChange({ ...value, enabled: checked })
            }
          />
        </div>
      </CardHeader>

      <CardContent
        className={cn(
          "space-y-5",
          !value.enabled && "opacity-60 pointer-events-none",
        )}
      >
        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Regeln
            </h4>
            <span className="text-xs text-ink-muted">
              {value.rules.filter((r) => r.enabled).length} von{" "}
              {value.rules.length} aktiv
            </span>
          </div>

          {value.rules.length === 0 ? (
            <p className="text-sm text-ink-muted italic">
              Keine Regeln erkannt — du kannst unten eine eigene anlegen.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-squircle-md border border-line">
              {value.rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <Checkbox
                    id={`rule-${rule.id}`}
                    checked={rule.enabled}
                    onCheckedChange={(checked) =>
                      patchRule(rule.id, { enabled: checked === true })
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <Label
                      htmlFor={`rule-${rule.id}`}
                      className="text-sm font-medium text-ink cursor-pointer"
                    >
                      {rule.label ?? rule.columns.join(" + ")}
                    </Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {rule.columns.map((c) => (
                        <Badge key={c} variant="neutral" className="text-[10px]">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Regel löschen"
                    onClick={() => removeRule(rule.id)}
                    className="text-ink-muted hover:text-danger transition-colors p-1"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3">
            {editorOpen ? (
              <InlineRuleEditor
                headers={headers}
                onCancel={() => setEditorOpen(false)}
                onSave={(label, columns) => {
                  appendRule(label, columns);
                  setEditorOpen(false);
                }}
              />
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconLeft={<Plus className="size-4" />}
                onClick={() => setEditorOpen(true)}
              >
                Eigene Regel hinzufügen
              </Button>
            )}
          </div>
        </section>

        <section className="rounded-squircle-md border border-line bg-surface-muted/40 p-3">
          <p className="text-sm text-ink">
            <strong>{totalRows}</strong> Lead{totalRows === 1 ? "" : "s"} →{" "}
            <strong className="text-danger">{excluded}</strong> Duplikat
            {excluded === 1 ? "" : "e"} in{" "}
            <strong>{result.stats.groupCount}</strong> Gruppe
            {result.stats.groupCount === 1 ? "" : "n"} werden entfernt.{" "}
            <strong className="text-ok">{remaining}</strong> Lead
            {remaining === 1 ? "" : "s"} kommen weiter.
          </p>

          {result.groups.length > 0 && (
            <button
              type="button"
              onClick={() => setGroupsExpanded((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-deep hover:underline"
            >
              {groupsExpanded ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
              Duplikate anzeigen
            </button>
          )}

          {groupsExpanded && result.groups.length > 0 && (
            <ul className="mt-3 space-y-2 max-h-64 overflow-y-auto">
              {result.groups.slice(0, 10).map((g, idx) => (
                <li
                  key={`${g.ruleId}-${g.originalRowIndex}-${idx}`}
                  className="rounded-squircle-sm border border-line bg-surface px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="warn" className="text-[10px]">
                      {g.duplicateRowIndices.length + 1}x
                    </Badge>
                    <span className="text-ink-muted">
                      Zeile {g.originalRowIndex + 1} +{" "}
                      {g.duplicateRowIndices
                        .map((i) => i + 1)
                        .join(", ")}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(g.keyPreview).map(([col, val]) => (
                      <span
                        key={col}
                        className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5"
                      >
                        <span className="text-ink-muted">{col}:</span>
                        <span className="text-ink truncate max-w-[140px]">
                          {val || "—"}
                        </span>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
              {result.groups.length > 10 && (
                <li className="text-xs text-ink-muted italic px-1">
                  … und {result.groups.length - 10} weitere Gruppen
                </li>
              )}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

interface InlineRuleEditorProps {
  headers: string[];
  onCancel: () => void;
  onSave: (label: string, columns: string[]) => void;
}

function InlineRuleEditor({ headers, onCancel, onSave }: InlineRuleEditorProps) {
  const [label, setLabel] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);

  function toggleColumn(col: string) {
    setSelected((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  }

  return (
    <div className="rounded-squircle-md border border-line bg-surface p-3 space-y-3">
      <div>
        <Label htmlFor="rule-label">Name der Regel</Label>
        <Input
          id="rule-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="z. B. Telefonnummer"
        />
      </div>
      <div>
        <Label>Spalten (mind. 1)</Label>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {headers.map((h) => {
            const active = selected.includes(h);
            return (
              <button
                key={h}
                type="button"
                onClick={() => toggleColumn(h)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-brand bg-brand-soft text-brand-deep"
                    : "border-line bg-surface text-ink-muted hover:border-ink-muted",
                )}
              >
                {h}
                {active && <X className="size-3" />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={selected.length === 0}
          onClick={() => onSave(label, selected)}
        >
          Regel speichern
        </Button>
      </div>
    </div>
  );
}
