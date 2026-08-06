"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  AtSign,
  Check,
  History,
  Loader2,
  Mail,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
import { ValueRulesDialog } from "./value-rules-dialog";
import type { PlaceholderRule } from "@/lib/placeholders/types";
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
    case "envelope":
      return "Umschlag";
    case "slug":
      return "Subdomain";
    case "website":
      return "Webseite-Video";
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

  // ── Envelope-Auswahl ──────────────────────────────────────────────────
  interface EnvOption { id: string; name: string; format: string }
  const [envelopeOptions, setEnvelopeOptions] = React.useState<EnvOption[]>([]);
  const [envelopeEnabled, setEnvelopeEnabled] = React.useState(false);
  const [envelopeTemplateId, setEnvelopeTemplateId] = React.useState<string | null>(null);
  const [envelopeSaving, setEnvelopeSaving] = React.useState(false);
  // Reload-Trigger fuer den Placeholder-Load-Effect. Wird erhoeht wenn
  // envelope-Auswahl aendert, damit die neuen Umschlag-Platzhalter erscheinen.
  const [reloadTick, setReloadTick] = React.useState(0);

  // Umschlag-Vorlagen des Users laden.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/envelopes", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        setEnvelopeOptions(j.templates ?? []);
      } catch {
        // still, keine Envelope-Card ist ok
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Aktuellen Wert vom Run lesen (initial).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        const id = (j.run?.envelopeTemplateId ?? null) as string | null;
        setEnvelopeTemplateId(id);
        setEnvelopeEnabled(!!id);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [runId]);

  async function saveEnvelopeSelection(id: string | null) {
    setEnvelopeSaving(true);
    try {
      const res = await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envelopeTemplateId: id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "Fehler");
      }
      setEnvelopeTemplateId(id);
      // Trigger reload der Placeholder-Detektion.
      setReloadTick((t) => t + 1);
    } catch (err) {
      toast({
        variant: "danger",
        title: "Umschlag-Auswahl konnte nicht gespeichert werden",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setEnvelopeSaving(false);
    }
  }

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
        const sm = data.suggestedMapping ?? {};
        // Auto-Vorschlag für die reservierte E-Mail-Spalte (Outreach):
        // erste CSV-Spalte, die nach E-Mail aussieht.
        if (!sm.email?.column) {
          const guess = (data.csvColumns ?? []).find((c) => /e-?mail/i.test(c));
          if (guess) {
            setMapping({ ...sm, email: { column: guess } });
            return;
          }
        }
        setMapping(sm);
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
  }, [runId, onFallbackRequested, reloadTick]);

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
      return hasColumn || hasFallback || e.empty === true;
    }).length;
  }, [placeholders, mapping]);

  const unmapped = React.useMemo(() => {
    return placeholders.filter((p) => {
      const e = mapping[p.key];
      if (!e) return true;
      const hasColumn = typeof e.column === "string" && e.column.length > 0;
      const hasFallback =
        typeof e.fallback === "string" && e.fallback.length > 0;
      return !hasColumn && !hasFallback && e.empty !== true;
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
      // Aufräumen: leere/undefined Werte raus, damit "keine Zuweisung"
      // konsistent serialisiert wird (JSON.stringify dropt undefined nicht
      // aus "key in obj"-Sicht, aber der gespeicherte Blob soll sauber sein).
      if (next.column === "" || next.column === undefined) delete next.column;
      if (next.fallback === "" || next.fallback === undefined)
        delete next.fallback;
      if (next.empty !== true) delete next.empty;
      if (!next.rules || next.rules.length === 0) delete next.rules;
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
      // Klares Feedback statt stillem Block: Toast + Sprung zum ersten
      // offenen Key. Vorher passierte hier für den User „einfach nichts".
      toast({
        variant: "danger",
        title: `${unmapped.length} Platzhalter noch offen`,
        description:
          "Wähle für jeden Platzhalter eine CSV-Spalte, trage einen Standardwert ein oder wähle „(leer lassen)“, wenn dort nichts stehen soll.",
      });
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
      {/* ── Umschlaege-Card (optional) ─────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-full bg-brand-soft text-brand-deep flex items-center justify-center">
                <Mail className="size-4" />
              </div>
              <div>
                <CardTitle className="text-base">
                  Umschläge generieren?
                </CardTitle>
                <p className="text-xs text-ink-muted mt-0.5">
                  Für diese Runde einen personalisierten Umschlag pro Lead
                  drucken lassen — zusätzlich zu den Video-/Brief-Assets.
                </p>
                {envelopeOptions.length === 0 && (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-warn">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    Keine Umschlag-Vorlage vorhanden — erstelle zuerst eine
                    unter{" "}
                    <a href="/umschlaege" className="underline">
                      Umschläge
                    </a>
                    .
                  </p>
                )}
              </div>
            </div>
            <Switch
              checked={envelopeEnabled}
              disabled={envelopeSaving || envelopeOptions.length === 0}
              onCheckedChange={(v) => {
                setEnvelopeEnabled(v);
                if (!v) {
                  void saveEnvelopeSelection(null);
                }
              }}
            />
          </div>
        </CardHeader>
        {envelopeEnabled && envelopeOptions.length > 0 && (
          <CardContent className="pt-0">
            <div className="flex items-center gap-3">
                <Label
                  htmlFor="env-select"
                  className="text-xs whitespace-nowrap"
                >
                  Vorlage
                </Label>
                <Select
                  value={envelopeTemplateId ?? undefined}
                  onValueChange={(v) => void saveEnvelopeSelection(v)}
                >
                  <SelectTrigger id="env-select" className="max-w-[420px]">
                    <SelectValue placeholder="Umschlag-Vorlage auswählen …" />
                  </SelectTrigger>
                  <SelectContent>
                    {envelopeOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              {envelopeSaving && (
                <Loader2 className="size-3.5 animate-spin text-ink-muted" />
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── E-Mail-Spalte (optional, Outreach) ─────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-brand-soft text-brand-deep flex items-center justify-center">
              <AtSign className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">
                E-Mail-Spalte (optional)
              </CardTitle>
              <p className="text-xs text-ink-muted mt-0.5">
                Enthält deine Liste E-Mail-Adressen? Dann kannst Du später
                E-Mail-Outreach für diese Leads starten.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center gap-3">
            <Label htmlFor="email-col-select" className="text-xs whitespace-nowrap">
              Spalte
            </Label>
            <Select
              value={mapping.email?.column ?? NO_COLUMN}
              onValueChange={(v) =>
                setMapping((m) => {
                  if (v === NO_COLUMN) {
                    const next = { ...m };
                    delete next.email;
                    return next;
                  }
                  return { ...m, email: { column: v } };
                })
              }
            >
              <SelectTrigger id="email-col-select" className="max-w-[420px]">
                <SelectValue placeholder="— keine —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COLUMN}>— keine —</SelectItem>
                {csvColumns.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Mapping-Card: Progress + Banner + Platzhalter-Liste ────── */}
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
            <div className="flex items-start gap-3 rounded-squircle-sm bg-brand-soft/50 px-4 py-3">
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

          {/* Info-Banner: unmapped Platzhalter bleiben im Video leer.
              Bewusst nur Warnung, kein Blocker — manche Platzhalter sind
              optional und sollen im Video schlicht nichts anzeigen. */}
          {unmapped.length > 0 && (
            <div className="flex items-start gap-3 rounded-squircle-sm bg-surface-soft px-4 py-3">
              <span className="mt-0.5 inline-flex size-7 items-center justify-center rounded-full bg-ink-muted/15 text-ink-muted shrink-0">
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
                  Wähle für jeden Platzhalter eine CSV-Spalte, trage einen
                  Standardwert ein oder wähle „(leer lassen)", wenn dort
                  bewusst nichts stehen soll.
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
                      className="font-mono text-xs px-2 py-0.5 rounded-full bg-surface hover:bg-warn-soft transition-colors"
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

          {/* Platzhalter-Liste */}
          {placeholders.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Keine Platzhalter in dieser Kampagne gefunden. Du kannst direkt
              weitergehen.
            </p>
          ) : (
            <div>
              <div className="hidden md:grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-4 pb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <span>Platzhalter</span>
                <span>CSV-Spalte</span>
                <span>Fallback</span>
              </div>
              <div className="divide-y divide-line-soft rounded-squircle-sm bg-surface-soft">
                {placeholders.map((p) => (
                  <PlaceholderRow
                    key={p.key}
                    runId={runId}
                    placeholder={p}
                    entry={mapping[p.key]}
                    csvColumns={csvColumns}
                    similarUnmapped={similarKeys(p.key)}
                    onSelectColumn={(col, empty) =>
                      patchEntry(p.key, {
                        column: col,
                        empty: empty ? true : undefined,
                      })
                    }
                    onChangeFallback={(fb) => patchEntry(p.key, { fallback: fb })}
                    onChangeRules={(rules) =>
                      patchEntry(p.key, {
                        rules: rules.length > 0 ? rules : undefined,
                      })
                    }
                    onApplyToSimilar={(col) => applyToSimilar(p.key, col)}
                    rowRef={(el) => {
                      rowRefs.current[p.key] = el;
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Weiter-Button ─────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3">
        <Button
          onClick={handleContinue}
          loading={advancing}
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
  runId: string;
  placeholder: DetectedPlaceholder;
  entry: PlaceholderMappingEntry | undefined;
  csvColumns: string[];
  similarUnmapped: string[];
  onSelectColumn: (column: string | undefined, empty: boolean) => void;
  onChangeFallback: (fallback: string) => void;
  onChangeRules: (rules: PlaceholderRule[]) => void;
  onApplyToSimilar: (column: string) => void;
  rowRef: (el: HTMLDivElement | null) => void;
}

function PlaceholderRow({
  runId,
  placeholder,
  entry,
  csvColumns,
  similarUnmapped,
  onSelectColumn,
  onChangeFallback,
  onChangeRules,
  onApplyToSimilar,
  rowRef,
}: PlaceholderRowProps) {
  const hasInaccessibleSource = placeholder.sources.some((s) => s.inaccessible);
  const column = entry?.column;
  const isEmptyChoice = entry?.empty === true && !column;
  const fallback = entry?.fallback ?? "";
  const rules = entry?.rules ?? [];
  const [rulesOpen, setRulesOpen] = React.useState(false);
  // Regeln nur für echte CSV-Spalten — System-Werte (@system:…) werden
  // vor dem Mapping aufgelöst, dort greifen Regeln nie.
  const canHaveRules = !!column && !column.startsWith("@system:");

  // Aktueller Select-Wert (mit Sentinel-Mapping).
  // System-Werte (@system:…) werden 1:1 gezeigt — der Select-Eintrag
  // mit gleichem `value` wird automatisch selected.
  const selectValue =
    column && column.length > 0
      ? column
      : entry?.empty === true
        ? LEAVE_EMPTY
        : NO_COLUMN;

  return (
    <div ref={rowRef} className="px-4 py-3 scroll-mt-6">
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
          <p className="mt-1 text-[11px] text-ink-muted truncate">
            {Array.from(
              new Set(
                placeholder.sources.map(
                  (s) => s.label || sourceKindLabel(s.kind),
                ),
              ),
            ).join(" · ")}
          </p>
          {hasInaccessibleSource && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-warn">
              <AlertTriangle className="size-3" />
              Doc nicht lesbar
            </p>
          )}
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
            className="md:hidden text-xs font-medium text-ink-muted"
          >
            CSV-Spalte
          </Label>
          <Select
            value={selectValue}
            onValueChange={(v) => {
              if (v === NO_COLUMN) {
                onSelectColumn(undefined, false);
              } else if (v === LEAVE_EMPTY) {
                // Explizite Entscheidung „leer lassen" — zählt als
                // zugewiesen, kein Standardwert nötig.
                onSelectColumn(undefined, true);
              } else {
                // CSV-Spalte ODER System-Sentinel (@system:pageUrl)
                onSelectColumn(v, false);
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
          {canHaveRules && (
            <button
              type="button"
              onClick={() => setRulesOpen(true)}
              className={cn(
                "mt-2 inline-flex items-center gap-1 text-[11px] font-medium transition-colors",
                rules.length > 0
                  ? "text-brand-deep hover:text-brand-deep/80"
                  : "text-ink-muted hover:text-brand-deep",
              )}
            >
              <Wand2 className="size-3" />
              {rules.length > 0
                ? `Wenn-Dann-Regeln (${rules.length} aktiv)`
                : "Werte anpassen (Wenn-Dann)"}
            </button>
          )}
        </div>

        {/* Spalte 3: Fallback-Input */}
        <div>
          <Label
            htmlFor={`fb-${placeholder.key}`}
            className="md:hidden text-xs font-medium text-ink-muted"
          >
            Fallback
          </Label>
          <div className="relative">
            <Input
              id={`fb-${placeholder.key}`}
              value={fallback}
              onChange={(e) => onChangeFallback(e.target.value)}
              disabled={isEmptyChoice}
              placeholder={
                isEmptyChoice ? "bleibt bewusst leer" : "Standardwert (optional)"
              }
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

      {canHaveRules && column && (
        <ValueRulesDialog
          open={rulesOpen}
          onOpenChange={setRulesOpen}
          runId={runId}
          placeholderKey={placeholder.key}
          column={column}
          fallback={fallback}
          initialRules={rules}
          onSave={onChangeRules}
        />
      )}
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
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-muted">
        <Loader2 className="size-3 animate-spin" />
        Speichere …
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger">
        <AlertTriangle className="size-3" />
        Speichern fehlgeschlagen
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-xs font-medium text-ok">
      <Check className="size-3" />
      Gespeichert
      {lastSavedAt && (
        <span className="text-ok/70">· {relativeFromIso(lastSavedAt, nowTick)}</span>
      )}
    </span>
  );
}
