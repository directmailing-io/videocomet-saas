"use client";

/**
 * Wenn-Dann-Regel-Dialog für den Platzhalter-Mapping-Step.
 *
 * UX-Modell: Werte-Zuordnungstabelle statt Bedingungs-Formular. Der Server
 * liefert die Distinct-Werte der gewählten CSV-Spalte (inkl. Häufigkeit),
 * der User trägt rechts nur ein, was daraus werden soll — leer lassen
 * heißt „unverändert". Intern wird daraus eine `equals`-Regel-Liste
 * (+ optional `is_empty`), die die zentrale Engine in
 * `src/lib/placeholders/rules.ts` auswertet.
 */

import * as React from "react";
import {
  ArrowRight,
  Eraser,
  Loader2,
  Search,
  Trash2,
  Undo2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { normalizeForRuleMatch } from "@/lib/placeholders/rules";
import type { PlaceholderRule } from "@/lib/placeholders/types";

interface ColumnValuesResponse {
  column: string;
  values: Array<{ value: string; count: number }>;
  distinctTotal: number;
  truncated: boolean;
  emptyCount: number;
  sampledRows: number;
  totalRows: number;
}

export interface ValueRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  placeholderKey: string;
  column: string;
  fallback?: string;
  initialRules: PlaceholderRule[];
  onSave: (rules: PlaceholderRule[]) => void;
}

export function ValueRulesDialog({
  open,
  onOpenChange,
  runId,
  placeholderKey,
  column,
  fallback,
  initialRules,
  onSave,
}: ValueRulesDialogProps) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<ColumnValuesResponse | null>(null);
  /** Output pro Distinct-Wert, keyed by normalisiertem Wert. Leer = unverändert. */
  const [outputs, setOutputs] = React.useState<Record<string, string>>({});
  /** Explizit „Feld leeren" pro Distinct-Wert (Regel mit leerem Output). */
  const [cleared, setCleared] = React.useState<Record<string, boolean>>({});
  const [emptyOutput, setEmptyOutput] = React.useState("");
  /**
   * Bestehende equals-Regeln, deren Wert in der aktuellen Liste nicht
   * (mehr) vorkommt — z. B. aus einer früheren Runde übernommen. Werden
   * beim Speichern erhalten, sind aber einzeln löschbar.
   */
  const [orphanRules, setOrphanRules] = React.useState<PlaceholderRule[]>([]);
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setSearch("");
      try {
        const url = new URL(
          `/api/runs/${runId}/column-values`,
          window.location.origin,
        );
        url.searchParams.set("column", column);
        const res = await fetch(url.toString(), { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        const d = json as ColumnValuesResponse;
        setData(d);

        // Bestehende Regeln in die Tabelle einsortieren.
        const known = new Set(d.values.map((v) => normalizeForRuleMatch(v.value)));
        const nextOutputs: Record<string, string> = {};
        const nextCleared: Record<string, boolean> = {};
        const orphans: PlaceholderRule[] = [];
        let nextEmpty = "";
        for (const r of initialRules) {
          if (r.op === "is_empty") {
            nextEmpty = r.output;
          } else if (r.op === "equals" && typeof r.match === "string") {
            const norm = normalizeForRuleMatch(r.match);
            if (known.has(norm)) {
              if (r.output.trim() === "") nextCleared[norm] = true;
              else nextOutputs[norm] = r.output;
            } else orphans.push(r);
          }
        }
        setOutputs(nextOutputs);
        setCleared(nextCleared);
        setEmptyOutput(nextEmpty);
        setOrphanRules(orphans);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Werte konnten nicht geladen werden.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // initialRules bewusst nicht in den Deps — wir initialisieren nur beim Öffnen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runId, column]);

  const filteredValues = React.useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.values;
    return data.values.filter((v) => v.value.toLowerCase().includes(q));
  }, [data, search]);

  const affectedLeads = React.useMemo(() => {
    if (!data) return 0;
    let n = 0;
    for (const v of data.values) {
      const norm = normalizeForRuleMatch(v.value);
      const out = outputs[norm];
      // Zählt: geleerte Werte, echte Ersetzungen UND reine
      // Leerzeichen-Eingaben (werden beim Speichern zu „leeren").
      if (cleared[norm] || (out && out !== "")) n += v.count;
    }
    if (emptyOutput.trim() !== "") n += data.emptyCount;
    return n;
  }, [data, outputs, cleared, emptyOutput]);

  const hasClearedWithFallback = React.useMemo(() => {
    if (!fallback || fallback.trim() === "" || !data) return false;
    return data.values.some((v) => {
      const norm = normalizeForRuleMatch(v.value);
      const out = outputs[norm];
      return cleared[norm] || (out !== undefined && out !== "" && out.trim() === "");
    });
  }, [data, outputs, cleared, fallback]);

  function handleSave() {
    if (!data) return;
    const rules: PlaceholderRule[] = [];
    for (const v of data.values) {
      const norm = normalizeForRuleMatch(v.value);
      const out = outputs[norm] ?? "";
      if (cleared[norm] || (out !== "" && out.trim() === "")) {
        // Explizit geleert ODER nur Leerzeichen eingetippt → Feld leeren.
        rules.push({ op: "equals", match: v.value, output: "" });
      } else if (out.trim() !== "") {
        rules.push({ op: "equals", match: v.value, output: out.trim() });
      }
    }
    rules.push(...orphanRules);
    if (emptyOutput.trim() !== "") {
      rules.push({ op: "is_empty", output: emptyOutput.trim() });
    }
    onSave(rules);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-4 text-brand-deep" />
            Werte anpassen — {`{{${placeholderKey}}}`}
          </DialogTitle>
          <DialogDescription>
            {data ? (
              <>
                In der Spalte <strong>„{data.column}"</strong> gibt es{" "}
                {data.distinctTotal} verschiedene Werte
                {data.emptyCount > 0
                  ? ` und ${data.emptyCount} leere Zellen`
                  : ""}
                . Trage rechts ein, was daraus werden soll — leer lassen
                heißt „unverändert übernehmen". Mit dem Radiergummi-Symbol
                wird das Feld für diesen Wert komplett geleert.
                Groß-/Kleinschreibung und Leerzeichen spielen keine Rolle.
              </>
            ) : (
              <>Werte der Spalte „{column}" werden geladen …</>
            )}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="py-10 text-center text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin inline mr-2" />
            Lade Werte …
          </div>
        )}

        {error && !loading && (
          <p className="text-sm text-danger py-4">{error}</p>
        )}

        {data && !loading && !error && (
          <div className="space-y-3">
            {data.values.length > 12 && (
              <div className="relative">
                <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Wert suchen …"
                  className="pl-9"
                />
              </div>
            )}

            <div className="max-h-[45vh] overflow-y-auto rounded-squircle-sm bg-surface-soft divide-y divide-line-soft">
              {filteredValues.map((v) => {
                const norm = normalizeForRuleMatch(v.value);
                const out = outputs[norm] ?? "";
                const isCleared = !!cleared[norm];
                const isActive = isCleared || out.trim() !== "";
                return (
                  <div
                    key={norm}
                    className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-sm text-ink truncate" title={v.value}>
                        {v.value}
                      </span>
                      <span className="text-[10px] text-ink-muted shrink-0">
                        {v.count}×
                      </span>
                    </div>
                    <ArrowRight
                      className={
                        isActive
                          ? "size-3.5 text-brand-deep shrink-0"
                          : "size-3.5 text-ink-muted opacity-40 shrink-0"
                      }
                    />
                    {isCleared ? (
                      <div className="flex h-8 items-center justify-between gap-2 rounded-squircle-sm bg-canvas px-3">
                        <span className="text-sm italic text-ink-muted">
                          Feld wird geleert
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setCleared((m) => ({ ...m, [norm]: false }))
                          }
                          aria-label="Leeren rückgängig"
                          title="Rückgängig"
                          className="text-ink-muted hover:text-ink"
                        >
                          <Undo2 className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={out}
                          onChange={(e) =>
                            setOutputs((m) => ({ ...m, [norm]: e.target.value }))
                          }
                          placeholder="unverändert"
                          className="h-8 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setCleared((m) => ({ ...m, [norm]: true }))
                          }
                          aria-label={`„${v.value}" → Feld leeren`}
                          title="Feld leeren (Wert wird entfernt)"
                          className="shrink-0 text-ink-muted hover:text-brand-deep"
                        >
                          <Eraser className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredValues.length === 0 && (
                <p className="px-3 py-4 text-sm text-ink-muted">
                  Kein Wert passt zur Suche.
                </p>
              )}

              {data.emptyCount > 0 && !search.trim() && (
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2 bg-surface-soft">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-sm italic text-ink-muted">(leer)</span>
                    <span className="text-[10px] text-ink-muted shrink-0">
                      {data.emptyCount}×
                    </span>
                  </div>
                  <ArrowRight
                    className={
                      emptyOutput.trim() !== ""
                        ? "size-3.5 text-brand-deep shrink-0"
                        : "size-3.5 text-ink-muted opacity-40 shrink-0"
                    }
                  />
                  <Input
                    value={emptyOutput}
                    onChange={(e) => setEmptyOutput(e.target.value)}
                    placeholder={
                      fallback && fallback.trim() !== ""
                        ? `Fallback: „${fallback}"`
                        : "bleibt leer"
                    }
                    className="h-8 text-sm"
                  />
                </div>
              )}
            </div>

            {data.emptyCount > 0 && emptyOutput.trim() !== "" && fallback && (
              <p className="text-xs text-warn">
                Diese Eingabe ersetzt bei leeren Zellen deinen Fallback
                („{fallback}").
              </p>
            )}

            {hasClearedWithFallback && (
              <p className="text-xs text-warn">
                Geleerte Werte bleiben wirklich leer — dein Fallback
                („{fallback}") greift dort bewusst nicht.
              </p>
            )}

            {data.truncated && (
              <p className="text-xs text-ink-muted">
                Es werden die {data.values.length} häufigsten Werte gezeigt
                (von {data.distinctTotal}).
              </p>
            )}
            {data.totalRows > data.sampledRows && (
              <p className="text-xs text-ink-muted">
                Basierend auf den ersten {data.sampledRows} von{" "}
                {data.totalRows} Zeilen.
              </p>
            )}

            {orphanRules.length > 0 && (
              <div className="rounded-squircle-sm bg-surface-soft px-4 py-3 space-y-1.5">
                <p className="text-xs font-medium text-ink-muted">
                  Regeln aus einer früheren Runde — der Wert kommt in dieser
                  Liste nicht vor (bleiben aktiv):
                </p>
                {orphanRules.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-ink">{r.match}</span>
                    <ArrowRight className="size-3 text-ink-muted" />
                    <span className="text-ink flex-1 truncate">
                      {r.output.trim() === "" ? (
                        <em className="text-ink-muted">Feld wird geleert</em>
                      ) : (
                        r.output
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setOrphanRules((rs) => rs.filter((_, j) => j !== i))
                      }
                      aria-label="Regel löschen"
                      className="text-ink-muted hover:text-red-600"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-3">
          {data && (
            <span className="text-xs text-ink-muted mr-auto">
              {affectedLeads > 0
                ? `${affectedLeads} von ${data.sampledRows} Zeilen werden angepasst`
                : "Noch keine Anpassung eingetragen"}
            </span>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleSave} disabled={!data || !!error}>
            Regeln übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
