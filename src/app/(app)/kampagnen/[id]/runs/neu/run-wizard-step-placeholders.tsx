"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  History,
  Loader2,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
// TODO: Sobald Agent A's `src/lib/placeholders/types.ts` final ist, hier den
//       Shim entfernen und auf den finalen Pfad zeigen.
import type {
  DetectedPlaceholder,
  PlaceholderMapping,
  PlaceholderMappingEntry,
  PlaceholderSource,
  RunPlaceholdersResponse,
} from "@/lib/placeholders/types";

/**
 * Spezial-Wert für „keine Spalte zugewiesen" im Select.
 * Radix-Select erlaubt keinen empty-string als value → wir verwenden
 * Sentinel-Strings und mappen sie auf `undefined` in der Datenstruktur.
 */
const NO_COLUMN = "__none__";
const LEAVE_EMPTY = "__empty__";
// Sentinel — entspricht SYSTEM_MAPPING_PAGE_URL in lib/placeholders.
// Wir duplizieren das hardcoded, weil die Datei strikt UI ist und der
// Import aus dem worker-orientierten Modul Build-Side-Effects einsammelt.
const SYSTEM_PAGE_URL = "@system:pageUrl";

/** Status-Pille analog zum Draft-Save in `wizard-draft-ui.tsx`. */
type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface RunWizardStepPlaceholdersProps {
  runId: string;
  /**
   * Erste 1–2 Lead-Zeilen aus dem CSV-Upload-Schritt — für die Live-Preview.
   * Wird vom Wizard durchgereicht, damit wir keinen separaten Fetch brauchen.
   */
  previewRows: Record<string, string>[];
  /**
   * Wird aufgerufen, wenn der User auf „Weiter" klickt UND alle Validations
   * grün sind. Der Wizard übernimmt dann den Step-Wechsel.
   */
  onContinue: () => void;
  /**
   * Wird aufgerufen, wenn der GET-Endpoint einen Fehler liefert (z. B. weil
   * Agent A's Endpoint noch nicht deployed ist). Der Wizard fällt dann auf
   * den alten 1:1-Mapping-Step zurück.
   */
  onFallbackRequested: (reason: string) => void;
}

/** Beispiel-Text für die Live-Preview — bewusst mit Wiederholung. */
const PREVIEW_TEMPLATE_DE =
  "Hallo {{firstName}}, schön dass Sie sich Zeit nehmen, {{firstName}}.";

/**
 * Normalisiert einen Key/Spalten-Namen für Similar-Match:
 * lowercase + Umlaut-Replace + Sonderzeichen weg.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Substitution client-seitig für die Live-Preview.
 * Erwartet `{{key}}`-Format. Für andere Formate (single-brace, Tiptap-Span)
 * macht das später der Worker — die Preview reicht für UX-Gefühl aus.
 */
function substituteForPreview(
  template: string,
  lead: Record<string, string>,
  mapping: PlaceholderMapping,
): string {
  return template.replace(/\{\{\s*([^}|\s]+)(?:\s*\|\s*([^}]*))?\s*\}\}/g, (_, key: string, inlineFallback?: string) => {
    const entry = mapping[key];
    if (!entry) return inlineFallback ?? "";
    const col = entry.column;
    if (col) {
      const val = lead[col];
      if (val && val.trim() !== "") return val;
    }
    if (entry.fallback && entry.fallback !== "") return entry.fallback;
    return inlineFallback ?? "";
  });
}

/** Quellen-Tag-Label (deutsch) je Kind. */
function sourceKindLabel(kind: PlaceholderSource["kind"]): string {
  switch (kind) {
    case "slide":
      return "Folie";
    case "text":
      return "Text";
    case "gdocs":
      return "Google Doc";
    case "pdf":
      return "PDF";
    case "lp-block":
      return "Block-LP";
    case "lp-custom":
      return "Custom-LP";
    case "slug":
      return "Subdomain";
    default:
      return kind;
  }
}

function relativeFromIso(iso: string, nowMs: number): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "";
  const diff = Math.max(0, Math.round((nowMs - ts) / 1000));
  if (diff < 5) return "gerade eben";
  if (diff < 60) return `vor ${diff} Sek.`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  return new Date(iso).toLocaleDateString("de-DE");
}

export function RunWizardStepPlaceholders({
  runId,
  previewRows,
  onContinue,
  onFallbackRequested,
}: RunWizardStepPlaceholdersProps) {
  const { toast } = useToast();

  // ── State: Server-Daten ────────────────────────────────────────────────
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [placeholders, setPlaceholders] = React.useState<DetectedPlaceholder[]>([]);
  const [csvColumns, setCsvColumns] = React.useState<string[]>([]);
  const [suggestedMapping, setSuggestedMapping] = React.useState<PlaceholderMapping>({});
  const [reusedFromPrevious, setReusedFromPrevious] = React.useState(false);

  // ── State: Eigenes Mapping (Working Copy) ──────────────────────────────
  const [mapping, setMapping] = React.useState<PlaceholderMapping>({});

  // ── State: Save-Status ────────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(null);
  // Re-render für „vor X Sek." in der Pille.
  const [nowTick, setNowTick] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (saveStatus !== "saved") return;
    const id = window.setInterval(() => setNowTick(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [saveStatus]);

  // Refs zum Scroll-Sprung beim Validation-Banner.
  const rowRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  // ── Initial-Load ──────────────────────────────────────────────────────
  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/runs/${runId}/placeholders`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          // 404 / 501 → Endpoint existiert noch nicht (Agent A nicht deployed).
          if (res.status === 404 || res.status === 501) {
            onFallbackRequested(
              `Platzhalter-Endpoint nicht verfügbar (${res.status})`,
            );
            return;
          }
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as RunPlaceholdersResponse;
        if (cancelled) return;
        setPlaceholders(data.placeholders ?? []);
        setCsvColumns(data.csvColumns ?? []);
        setSuggestedMapping(data.suggestedMapping ?? {});
        setReusedFromPrevious(Boolean(data.reusedFromPreviousRun));
        // Vorbelegen mit suggestedMapping — der User kann jederzeit überschreiben.
        setMapping(data.suggestedMapping ?? {});
      } catch (err) {
        if (cancelled) return;
        // Bei Netzwerk-/Parse-Fehler → Fallback statt Block.
        onFallbackRequested(
          err instanceof Error
            ? err.message
            : "Platzhalter konnten nicht geladen werden.",
        );
        setLoadError(
          err instanceof Error
            ? err.message
            : "Platzhalter konnten nicht geladen werden.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [runId, onFallbackRequested]);

  // ── Auto-Save (debounced) ─────────────────────────────────────────────
  const mappingRef = React.useRef(mapping);
  mappingRef.current = mapping;
  const saveTimer = React.useRef<number | null>(null);
  const lastSavedJson = React.useRef<string | null>(null);

  const saveNow = React.useCallback(
    async (silent = true): Promise<boolean> => {
      const payload = { placeholderMapping: mappingRef.current };
      const json = JSON.stringify(payload);
      // Skip wenn nichts geändert — vermeidet überflüssige Requests.
      if (json === lastSavedJson.current) {
        return true;
      }
      setSaveStatus("saving");
      try {
        const res = await fetch(`/api/runs/${runId}/mapping`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: json,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        lastSavedJson.current = json;
        const now = new Date().toISOString();
        setLastSavedAt(now);
        setSaveStatus("saved");
        if (!silent) {
          toast({
            variant: "success",
            title: "Mapping gespeichert",
          });
        }
        return true;
      } catch (err) {
        setSaveStatus("error");
        toast({
          variant: "danger",
          title: "Speichern fehlgeschlagen",
          description:
            err instanceof Error ? err.message : "Bitte erneut versuchen.",
        });
        return false;
      }
    },
    [runId, toast],
  );

  // Debounced Auto-Save: 600 ms nach letzter Änderung.
  React.useEffect(() => {
    if (loading) return;
    // Vor dem ersten User-Edit nicht speichern (kein Toast-Spam beim Mount).
    if (lastSavedJson.current === null && Object.keys(mapping).length === 0)
      return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveNow(true);
    }, 600);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [mapping, loading, saveNow]);

  // ── Derived: Progress + Validation ────────────────────────────────────
  const totalKeys = placeholders.length;
  const assignedKeys = React.useMemo(() => {
    return placeholders.filter((p) => {
      const e = mapping[p.key];
      if (!e) return false;
      const hasColumn = typeof e.column === "string" && e.column.length > 0;
      const hasFallback =
        typeof e.fallback === "string" && e.fallback.length > 0;
      return hasColumn || hasFallback;
    }).length;
  }, [placeholders, mapping]);

  const unmapped = React.useMemo(() => {
    return placeholders.filter((p) => {
      const e = mapping[p.key];
      if (!e) return true;
      const hasColumn = typeof e.column === "string" && e.column.length > 0;
      const hasFallback =
        typeof e.fallback === "string" && e.fallback.length > 0;
      return !hasColumn && !hasFallback;
    });
  }, [placeholders, mapping]);

  // ── Auto-Vorschlag-Button ─────────────────────────────────────────────
  const applyAutoSuggest = React.useCallback(() => {
    // Merged auf das aktuelle Mapping: bestehende Einträge gewinnen NICHT,
    // wir überschreiben mit Server-Suggestion (deutlicher UX-Hint).
    setMapping((prev) => ({ ...prev, ...suggestedMapping }));
    toast({ variant: "default", title: "Auto-Vorschlag übernommen" });
  }, [suggestedMapping, toast]);

  // ── Per-Row Updates ───────────────────────────────────────────────────
  function patchEntry(key: string, patch: Partial<PlaceholderMappingEntry>) {
    setMapping((m) => {
      const prev: PlaceholderMappingEntry = m[key] ?? {};
      const next: PlaceholderMappingEntry = { ...prev, ...patch };
      // Aufräumen: leere Strings → undefined, damit "keine Zuweisung"
      // konsistent serialisiert wird.
      if (next.column === "") delete next.column;
      if (next.fallback === "") delete next.fallback;
      return { ...m, [key]: next };
    });
  }

  /**
   * Bulk-Vorschlag: wenn der User Spalte X für Key A wählt, sammeln wir alle
   * anderen Keys, die normalisiert identisch sind und noch KEINE Spalte
   * gesetzt haben.
   */
  function similarKeys(key: string): string[] {
    const target = placeholders.find((p) => p.key === key);
    if (!target) return [];
    const targetNorm = target.normalized || normalize(target.key);
    return placeholders
      .filter((p) => p.key !== key)
      .filter((p) => (p.normalized || normalize(p.key)) === targetNorm)
      .filter((p) => !(mapping[p.key]?.column))
      .map((p) => p.key);
  }

  function applyToSimilar(key: string, column: string) {
    const targets = similarKeys(key);
    if (targets.length === 0) return;
    setMapping((m) => {
      const next = { ...m };
      for (const k of targets) {
        next[k] = { ...(next[k] ?? {}), column };
      }
      return next;
    });
    toast({
      variant: "default",
      title: `Spalte für ${targets.length} weitere Variant${targets.length === 1 ? "" : "s"} gesetzt`,
    });
  }

  // ── „Weiter"-Handler ──────────────────────────────────────────────────
  const [advancing, setAdvancing] = React.useState(false);
  async function handleContinue() {
    if (unmapped.length > 0) {
      // Banner ist sichtbar — Sprung zum ersten unmappten Key.
      const first = unmapped[0];
      const el = rowRefs.current[first.key];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-danger");
        window.setTimeout(() => {
          el.classList.remove("ring-2", "ring-danger");
        }, 1600);
      }
      return;
    }
    setAdvancing(true);
    const ok = await saveNow(false);
    setAdvancing(false);
    if (ok) onContinue();
  }

  // ── UI ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Platzhalter werden geladen …</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin" />
            Kampagne wird nach Platzhaltern gescannt.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    // Wenn wir hierher kommen, hat `onFallbackRequested` schon den Wizard
    // gewechselt — diese View ist nur eine Sicherheit, sollte selten sichtbar sein.
    return (
      <Card>
        <CardHeader>
          <CardTitle>Platzhalter konnten nicht geladen werden</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-danger">{loadError}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header-Card mit Progress + Actions ─────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle>Spalten zuweisen</CardTitle>
              <p className="text-sm text-ink-muted mt-1">
                {assignedKeys} / {totalKeys} Platzhalter zugewiesen
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SaveStatusPill status={saveStatus} lastSavedAt={lastSavedAt} nowTick={nowTick} />
              <Button
                variant="ghost"
                onClick={applyAutoSuggest}
                disabled={Object.keys(suggestedMapping).length === 0}
                iconLeft={<Wand2 className="size-4" />}
              >
                Auto-Vorschlag
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Progress-Bar */}
          <div className="h-1.5 w-full rounded-full bg-line-soft overflow-hidden">
            <div
              className="h-full bg-brand transition-all duration-300"
              style={{
                width:
                  totalKeys === 0
                    ? "0%"
                    : `${Math.round((assignedKeys / totalKeys) * 100)}%`,
              }}
            />
          </div>

          {/* Reuse-Banner */}
          {reusedFromPrevious && (
            <div className="flex items-start gap-3 rounded-squircle border border-brand/30 bg-brand-soft/40 px-4 py-3">
              <span className="mt-0.5 inline-flex size-7 items-center justify-center rounded-full bg-brand text-white shrink-0">
                <History className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">
                  Aus voriger Runde übernommen
                </p>
                <p className="text-xs text-ink-muted">
                  Wir haben das Mapping deiner letzten Runde vorbelegt. Du
                  kannst alles ändern, bevor Du auf „Weiter" klickst.
                </p>
              </div>
            </div>
          )}

          {/* Validation-Banner */}
          {unmapped.length > 0 && (
            <div className="flex items-start gap-3 rounded-squircle border border-warn/40 bg-warn-soft px-4 py-3">
              <span className="mt-0.5 inline-flex size-7 items-center justify-center rounded-full bg-warn text-white shrink-0">
                <AlertTriangle className="size-4" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-ink">
                  {unmapped.length}{" "}
                  {unmapped.length === 1
                    ? "Platzhalter ohne Zuweisung"
                    : "Platzhalter ohne Zuweisung"}
                </p>
                <p className="text-xs text-ink-muted mt-0.5">
                  Weise jedem Key entweder eine CSV-Spalte oder einen
                  Fallback-Wert zu, sonst können wir den Lauf nicht starten.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {unmapped.slice(0, 6).map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => {
                        const el = rowRefs.current[p.key];
                        el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      className="font-mono text-xs px-2 py-0.5 rounded-md bg-surface border border-warn/40 hover:bg-warn-soft transition-colors"
                    >
                      {`{{${p.key}}}`}
                    </button>
                  ))}
                  {unmapped.length > 6 && (
                    <span className="text-xs text-ink-muted self-center">
                      + {unmapped.length - 6} weitere
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Liste der Platzhalter ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Platzhalter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {placeholders.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Keine Platzhalter in dieser Kampagne gefunden. Du kannst direkt
              weitergehen.
            </p>
          ) : (
            placeholders.map((p) => (
              <PlaceholderRow
                key={p.key}
                placeholder={p}
                entry={mapping[p.key]}
                csvColumns={csvColumns}
                similarUnmapped={similarKeys(p.key)}
                onChangeColumn={(col) => patchEntry(p.key, { column: col })}
                onChangeFallback={(fb) => patchEntry(p.key, { fallback: fb })}
                onApplyToSimilar={(col) => applyToSimilar(p.key, col)}
                rowRef={(el) => {
                  rowRefs.current[p.key] = el;
                }}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* ── Live-Vorschau ─────────────────────────────────────────── */}
      {previewRows.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-brand-deep" />
              <CardTitle>Live-Vorschau</CardTitle>
            </div>
            <p className="text-sm text-ink-muted mt-1">
              So sieht der Text mit dem aktuellen Mapping für die ersten Leads aus.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {previewRows.slice(0, 2).map((row, i) => (
              <div
                key={i}
                className="rounded-squircle-sm border border-line bg-surface-soft px-4 py-3"
              >
                <p className="text-xs text-ink-muted mb-1.5">
                  Lead {i + 1}
                </p>
                <p className="text-sm text-ink leading-relaxed">
                  {substituteForPreview(PREVIEW_TEMPLATE_DE, row, mapping)}
                </p>
              </div>
            ))}
            <p className="text-xs text-ink-muted">
              Vorlage:{" "}
              <code className="font-mono text-xs px-1 py-0.5 rounded bg-line-soft">
                {PREVIEW_TEMPLATE_DE}
              </code>
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Weiter-Button ─────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3">
        {unmapped.length > 0 && (
          <span className="text-xs text-ink-muted">
            Bitte alle {unmapped.length} unmappten Keys zuweisen.
          </span>
        )}
        <Button
          onClick={handleContinue}
          loading={advancing}
          disabled={unmapped.length > 0}
          iconRight={<ArrowRight className="size-4" />}
        >
          Weiter
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────────────────────────

interface PlaceholderRowProps {
  placeholder: DetectedPlaceholder;
  entry: PlaceholderMappingEntry | undefined;
  csvColumns: string[];
  similarUnmapped: string[];
  onChangeColumn: (column: string | undefined) => void;
  onChangeFallback: (fallback: string) => void;
  onApplyToSimilar: (column: string) => void;
  rowRef: (el: HTMLDivElement | null) => void;
}

function PlaceholderRow({
  placeholder,
  entry,
  csvColumns,
  similarUnmapped,
  onChangeColumn,
  onChangeFallback,
  onApplyToSimilar,
  rowRef,
}: PlaceholderRowProps) {
  const hasInaccessibleSource = placeholder.sources.some((s) => s.inaccessible);
  const column = entry?.column;
  const fallback = entry?.fallback ?? "";

  // Aktueller Select-Wert (mit Sentinel-Mapping).
  // System-Werte (@system:…) werden 1:1 gezeigt — der Select-Eintrag
  // mit gleichem `value` wird automatisch selected.
  const selectValue =
    column && column.length > 0
      ? column
      : entry && "column" in entry
        ? LEAVE_EMPTY
        : NO_COLUMN;

  return (
    <div
      ref={rowRef}
      className={cn(
        "rounded-squircle-sm border border-line bg-surface px-4 py-3 transition-shadow",
        "scroll-mt-6",
      )}
    >
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 items-start">
        {/* Spalte 1: Key + Quellen */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono text-sm font-medium text-ink bg-brand-soft px-2 py-0.5 rounded">
              {`{{${placeholder.key}}}`}
            </code>
            {placeholder.occurrences > 1 && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-ink-muted">
                {placeholder.occurrences}×
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {placeholder.sources.map((s, idx) => (
              <span
                key={`${s.kind}-${idx}`}
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md border",
                  s.inaccessible
                    ? "bg-warn-soft border-warn/40 text-warn"
                    : "bg-line-soft border-line text-ink-muted",
                )}
                title={s.label}
              >
                {s.label || sourceKindLabel(s.kind)}
                {s.inaccessible && <AlertTriangle className="size-3" />}
              </span>
            ))}
            {hasInaccessibleSource && (
              <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md border bg-warn-soft border-warn/40 text-warn font-medium">
                Doc nicht lesbar
              </span>
            )}
          </div>
          {/* Bulk-Hint */}
          {similarUnmapped.length > 0 && column && (
            <button
              type="button"
              onClick={() => onApplyToSimilar(column)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-brand-deep hover:text-brand-deep/80 transition-colors"
            >
              <Sparkles className="size-3" />
              auch für{" "}
              {similarUnmapped
                .slice(0, 3)
                .map((k) => `\`${k}\``)
                .join(", ")}
              {similarUnmapped.length > 3
                ? ` + ${similarUnmapped.length - 3} weitere`
                : ""}{" "}
              setzen?
            </button>
          )}
        </div>

        {/* Spalte 2: CSV-Spalten-Select */}
        <div>
          <Label
            htmlFor={`col-${placeholder.key}`}
            className="text-xs font-medium text-ink-muted"
          >
            CSV-Spalte
          </Label>
          <Select
            value={selectValue}
            onValueChange={(v) => {
              if (v === NO_COLUMN) {
                onChangeColumn(undefined);
              } else if (v === LEAVE_EMPTY) {
                // Explizit „leer lassen" → column = undefined, aber wir markieren
                // den Eintrag als „intentionally empty" (Fallback greift).
                onChangeColumn(undefined);
              } else {
                // CSV-Spalte ODER System-Sentinel (@system:pageUrl)
                onChangeColumn(v);
              }
            }}
          >
            <SelectTrigger id={`col-${placeholder.key}`}>
              <SelectValue placeholder="— wählen —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_COLUMN}>— wählen —</SelectItem>
              <SelectItem value={LEAVE_EMPTY}>(leer lassen)</SelectItem>
              {/* System-Werte zuoberst, optisch abgesetzt. */}
              <SelectItem value={SYSTEM_PAGE_URL}>
                🔗 Landingpage-URL (automatisch)
              </SelectItem>
              {csvColumns.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Spalte 3: Fallback-Input */}
        <div>
          <Label
            htmlFor={`fb-${placeholder.key}`}
            className="text-xs font-medium text-ink-muted"
          >
            Fallback
          </Label>
          <div className="relative">
            <Input
              id={`fb-${placeholder.key}`}
              value={fallback}
              onChange={(e) => onChangeFallback(e.target.value)}
              placeholder="Standard"
            />
            {fallback && (
              <button
                type="button"
                onClick={() => onChangeFallback("")}
                aria-label="Fallback leeren"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SaveStatusPillProps {
  status: SaveStatus;
  lastSavedAt: string | null;
  nowTick: number;
}

function SaveStatusPill({ status, lastSavedAt, nowTick }: SaveStatusPillProps) {
  if (status === "idle" && !lastSavedAt) return null;

  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-muted border border-line">
        <Loader2 className="size-3 animate-spin" />
        Speichere …
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger border border-danger/30">
        <AlertTriangle className="size-3" />
        Speichern fehlgeschlagen
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-xs font-medium text-ok border border-ok/30">
      <Check className="size-3" />
      Gespeichert
      {lastSavedAt && (
        <span className="text-ok/70">· {relativeFromIso(lastSavedAt, nowTick)}</span>
      )}
    </span>
  );
}
