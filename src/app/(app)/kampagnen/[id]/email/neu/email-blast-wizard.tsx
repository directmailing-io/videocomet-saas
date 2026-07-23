"use client";

/**
 * Blast-Wizard (Kontrakt: 6 Schritte) — ① Empfänger ② Postfach ③ Inhalt
 * ④ GIF-Ausschnitt ⑤ Zeitplan ⑥ Prüfen & Bestätigen.
 *
 * Draft-Blast wird erst beim Start angelegt (POST email-blasts) und sofort
 * gestartet (POST …/start mit confirmationTextVersion = Volltext der beiden
 * Pflicht-Checkboxen). Die Live-Zähler kommen aus dem Preview-Endpoint.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  FileText,
  Inbox,
  Loader2,
  Play,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  GifRangeEditor,
  type GifRangeValue,
} from "@/components/email/gif-range-editor";
import { EMAIL_GIF_PREVIEW_URL } from "@/components/email/email-body-editor";
import {
  renderOutreachEmail,
  tiptapDocContainsNode,
} from "@/lib/email/render";

export interface WizardRunOption {
  id: string;
  name: string;
  status: string;
  totalLeads: number;
}

interface WizardMailbox {
  id: string;
  provider: string;
  emailAddress: string;
  displayName: string | null;
  status: string;
  warmupStage: number;
  sentToday: number;
  effectiveDailyLimit: number;
  timezone: string;
  sendWindow: { days: number[]; startHour: number; endHour: number };
}

interface WizardTemplate {
  id: string;
  name: string;
  subject: string;
  bodyJson: unknown;
  bodyHtml: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  signatureHtml: string | null;
  impressumHtml: string | null;
  /** 'branded' | 'personal' — fehlt bei Alt-Daten ⇒ 'branded'. */
  format?: string | null;
  /** 'complete' | 'unsubscribe' | 'none' — fehlt bei Alt-Daten ⇒ 'complete'. */
  footerMode?: string | null;
  isComplete: boolean;
}

interface BlastPreview {
  total: number;
  sendable: number;
  noEmail: number;
  suppressed: number;
  duplicates: number;
  credits: number;
  schedule: {
    mailsPerDay: number;
    estimatedSendDays: number;
    sendWindow: { days: number[]; startHour: number; endHour: number };
    timezone: string;
  } | null;
}

export interface EmailBlastWizardProps {
  campaignId: string;
  campaignName: string;
  runs: WizardRunOption[];
  /** `leads.data` eines Beispiel-Leads — für Platzhalter-Check + Vorschau. */
  exampleLeadData: Record<string, string> | null;
  /** Video-URL eines Beispiel-Leads für den GIF-Editor. */
  exampleVideoUrl: string | null;
  initialGifConfig: { startSec: number; durationSec: number } | null;
}

const STEPS = [
  "Empfänger",
  "Postfach",
  "Inhalt",
  "GIF-Ausschnitt",
  "Zeitplan",
  "Prüfen & Bestätigen",
];

/** Exakte Texte der Pflicht-Checkboxen — werden als Volltext protokolliert. */
const CONFIRM_LEGAL =
  "Ich versichere, dass ich für den Versand dieser E-Mails alle rechtlichen Anforderungen (u. a. UWG/DSGVO) eigenverantwortlich erfülle.";
const CONFIRM_FOOTER =
  "Mir ist bewusst, dass Abmeldelink und mein Impressum automatisch in jede E-Mail eingefügt werden.";

const WEEKDAY_LABELS: Record<number, string> = {
  1: "Mo",
  2: "Di",
  3: "Mi",
  4: "Do",
  5: "Fr",
  6: "Sa",
  7: "So",
};

function formatSendWindow(w: {
  days: number[];
  startHour: number;
  endHour: number;
}): string {
  const days = Array.from(w.days)
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_LABELS[d] ?? String(d))
    .join(", ");
  return `${days} · ${w.startHour}–${w.endHour} Uhr`;
}

/** Alle Platzhalter-Keys einer Vorlage ({{key}} + TipTap-Spans). */
function extractPlaceholderKeys(t: WizardTemplate): string[] {
  const sources = [
    t.subject,
    t.bodyHtml ?? "",
    t.ctaLabel ?? "",
    t.signatureHtml ?? "",
    t.impressumHtml ?? "",
  ].join("\n");
  const keys = new Set<string>();
  const patterns = [
    /\{\{\s*([\w-]+)(?:\s*\|[^}]*)?\s*\}\}/g,
    /data-placeholder=["']([\w-]+)["']/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(sources)) !== null) keys.add(m[1]!);
  }
  return Array.from(keys);
}

export function EmailBlastWizard({
  campaignId,
  campaignName,
  runs,
  exampleLeadData,
  exampleVideoUrl,
  initialGifConfig,
}: EmailBlastWizardProps) {
  const router = useRouter();

  const [step, setStep] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  // ① Empfänger: null = ganze Kampagne, sonst runId.
  const [runId, setRunId] = React.useState<string | null>(null);
  // ② Postfach / ③ Vorlage
  const [mailboxId, setMailboxId] = React.useState<string | null>(null);
  const [templateId, setTemplateId] = React.useState<string | null>(null);
  // ④ GIF
  const [gifValue, setGifValue] = React.useState<GifRangeValue | null>(
    initialGifConfig,
  );
  const [gifSkipped, setGifSkipped] = React.useState(false);
  const [gifSaving, setGifSaving] = React.useState(false);
  // ⑥ Bestätigung
  const [confirmLegal, setConfirmLegal] = React.useState(false);
  const [confirmFooter, setConfirmFooter] = React.useState(false);
  const [starting, setStarting] = React.useState(false);

  const [mailboxes, setMailboxes] = React.useState<WizardMailbox[] | null>(null);
  const [templates, setTemplates] = React.useState<WizardTemplate[] | null>(null);
  const [preview, setPreview] = React.useState<BlastPreview | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [mRes, tRes] = await Promise.all([
          fetch("/api/mailboxes"),
          fetch("/api/email-templates"),
        ]);
        const mJson = await mRes.json().catch(() => null);
        const tJson = await tRes.json().catch(() => null);
        if (cancelled) return;
        setMailboxes((mJson?.mailboxes as WizardMailbox[] | undefined) ?? []);
        setTemplates((tJson?.templates as WizardTemplate[] | undefined) ?? []);
      } catch {
        if (!cancelled) {
          setMailboxes([]);
          setTemplates([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live-Zähler: neu laden, wenn Empfänger-Scope oder Postfach wechselt.
  React.useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    void (async () => {
      try {
        const url = new URL(
          `/api/campaigns/${campaignId}/email-blasts/preview`,
          window.location.origin,
        );
        if (runId) url.searchParams.set("runId", runId);
        if (mailboxId) url.searchParams.set("mailboxId", mailboxId);
        const res = await fetch(url.toString());
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok) setPreview(json as BlastPreview);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, runId, mailboxId]);

  const selectedMailbox = mailboxes?.find((m) => m.id === mailboxId) ?? null;
  const selectedTemplate = templates?.find((t) => t.id === templateId) ?? null;

  // GIF-Schritt nur relevant, wenn die Vorlage einen emailGif-Node enthält.
  const templateHasGif = selectedTemplate
    ? tiptapDocContainsNode(selectedTemplate.bodyJson, "emailGif")
    : false;

  // Platzhalter-Kompatibilitätscheck gegen die Lead-Daten des Beispiel-Leads.
  const unresolvedKeys = React.useMemo(() => {
    if (!selectedTemplate) return [];
    const keys = extractPlaceholderKeys(selectedTemplate);
    const dataKeys = new Set(
      Object.keys(exampleLeadData ?? {}).map((k) => k.toLowerCase()),
    );
    return keys.filter((k) => {
      const lower = k.toLowerCase();
      if (lower === "pageurl") return false; // System-Key
      return !dataKeys.has(lower);
    });
  }, [selectedTemplate, exampleLeadData]);

  // Beispiel-Mail für Schritt 6 — renderOutreachEmail ist pur/client-safe.
  const renderedExample = React.useMemo(() => {
    if (!selectedTemplate) return null;
    return renderOutreachEmail({
      content: {
        subject: selectedTemplate.subject,
        bodyJson: selectedTemplate.bodyJson,
        bodyHtml: selectedTemplate.bodyHtml ?? "",
        signatureHtml: selectedTemplate.signatureHtml,
        impressumHtml: selectedTemplate.impressumHtml ?? "",
        format: selectedTemplate.format,
        footerMode: selectedTemplate.footerMode,
      },
      leadData: exampleLeadData ?? {},
      pageUrl: null,
      emailGifUrl:
        templateHasGif && !gifSkipped && gifValue
          ? EMAIL_GIF_PREVIEW_URL
          : null,
      unsubscribeToken: "00000000000000000000000000000000",
      appUrl:
        typeof window === "undefined"
          ? undefined
          : window.location.origin,
    });
  }, [selectedTemplate, exampleLeadData, templateHasGif, gifSkipped, gifValue]);

  /** Schritt 4 → 5: GIF-Konfiguration an der Kampagne persistieren. */
  async function saveGifAndContinue(): Promise<void> {
    setError(null);
    setGifSaving(true);
    try {
      if (!templateHasGif || gifSkipped || !gifValue || !exampleVideoUrl) {
        // „Ohne GIF fortfahren" / kein GIF-Node in der Vorlage: evtl.
        // vorhandene Config entfernen, damit der Start-Snapshot ohne
        // gifConfig eingefroren wird.
        if (initialGifConfig || gifSkipped || !templateHasGif) {
          await fetch(`/api/campaigns/${campaignId}/email-gif`, {
            method: "DELETE",
          }).catch(() => undefined);
        }
        setStep(4);
        return;
      }
      const res = await fetch(`/api/campaigns/${campaignId}/email-gif`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gifValue),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? "GIF-Konfiguration konnte nicht gespeichert werden.");
        return;
      }
      setStep(4);
    } finally {
      setGifSaving(false);
    }
  }

  /** Schritt 6: Draft anlegen + sofort starten. */
  async function startBlast(): Promise<void> {
    if (!mailboxId || !templateId) return;
    setError(null);
    setStarting(true);
    try {
      const createRes = await fetch(`/api/campaigns/${campaignId}/email-blasts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          mailboxConnectionId: mailboxId,
          runId,
        }),
      });
      const createJson = await createRes.json().catch(() => null);
      if (!createRes.ok) {
        setError(createJson?.error ?? "Blast konnte nicht angelegt werden.");
        return;
      }
      const blastId = createJson.blast.id as string;

      const startRes = await fetch(`/api/email-blasts/${blastId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmationTextVersion: `${CONFIRM_LEGAL}\n${CONFIRM_FOOTER}`,
        }),
      });
      const startJson = await startRes.json().catch(() => null);
      if (!startRes.ok) {
        setError(startJson?.error ?? "Der Blast konnte nicht gestartet werden.");
        return;
      }
      router.push(`/kampagnen/${campaignId}/email/${blastId}`);
    } finally {
      setStarting(false);
    }
  }

  const canContinue =
    step === 0
      ? (preview?.sendable ?? 0) > 0
      : step === 1
        ? Boolean(selectedMailbox)
        : step === 2
          ? Boolean(selectedTemplate?.isComplete)
          : true;

  return (
    <>
      <PageHeader
        title="E-Mail-Blast starten"
        subtitle={`Kampagne ${campaignName} · Schritt ${step + 1} von ${STEPS.length}: ${STEPS[step]}`}
      />

      <ol className="mb-8 flex items-center gap-1.5 overflow-x-auto pb-1">
        {STEPS.map((label, idx) => {
          const isActive = idx === step;
          const isDone = idx < step;
          return (
            <li key={label} className="flex shrink-0 items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium transition-all",
                  isActive && "bg-surface text-ink shadow-card",
                  isDone && !isActive && "text-ink-soft",
                  !isActive && !isDone && "text-ink-muted opacity-60",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    isActive
                      ? "bg-ink text-white"
                      : isDone
                        ? "bg-brand-soft text-brand-deep"
                        : "bg-canvas-deep text-ink-muted",
                  )}
                >
                  {isDone ? <Check className="size-3" /> : idx + 1}
                </span>
                {label}
              </span>
              {idx < STEPS.length - 1 && <span className="h-px w-5 bg-line" />}
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="mb-4 rounded-squircle-sm bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-brand" /> Empfänger wählen
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setRunId(null)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-squircle-md p-4 text-left transition-all",
                  runId === null
                    ? "ring-2 ring-brand bg-brand-soft/40"
                    : "bg-surface-soft hover:bg-surface-muted",
                )}
              >
                <span className="text-sm font-semibold text-ink">Ganze Kampagne</span>
                <span className="text-xs text-ink-muted">
                  Alle Leads der Kampagne (rundenübergreifend)
                </span>
              </button>
              {runs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRunId(r.id)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-squircle-md p-4 text-left transition-all",
                    runId === r.id
                      ? "ring-2 ring-brand bg-brand-soft/40"
                      : "bg-surface-soft hover:bg-surface-muted",
                  )}
                >
                  <span className="text-sm font-semibold text-ink">{r.name}</span>
                  <span className="text-xs text-ink-muted">
                    {r.totalLeads} Leads · Status {r.status}
                  </span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Sendbar", value: preview?.sendable },
                { label: "Ohne E-Mail", value: preview?.noEmail },
                { label: "Suppression", value: preview?.suppressed },
                { label: "Duplikate", value: preview?.duplicates },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-squircle-sm bg-surface-soft px-4 py-3"
                >
                  <p className="text-lg font-semibold text-ink">
                    {previewLoading || s.value == null ? "…" : s.value}
                  </p>
                  <p className="text-[11px] text-ink-muted">{s.label}</p>
                </div>
              ))}
            </div>
            {!previewLoading && preview != null && preview.sendable === 0 && (
              <p className="flex items-center gap-2 text-sm text-warn">
                <AlertTriangle className="size-4" /> Keine versandfähigen
                Empfänger in dieser Auswahl.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="size-4 text-brand" /> Postfach wählen
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mailboxes == null ? (
              <p className="text-sm text-ink-muted">Lade Postfächer…</p>
            ) : mailboxes.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Noch kein Postfach verbunden — unter{" "}
                <a href="/einstellungen" className="text-brand underline">
                  Einstellungen → E-Mail-Postfächer
                </a>{" "}
                verbinden.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {mailboxes.map((m) => {
                  const connected = m.status === "connected";
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={!connected}
                      onClick={() => setMailboxId(m.id)}
                      className={cn(
                        "flex flex-col items-start gap-1.5 rounded-squircle-md p-4 text-left transition-all",
                        !connected && "cursor-not-allowed opacity-50",
                        mailboxId === m.id
                          ? "ring-2 ring-brand bg-brand-soft/40"
                          : "bg-surface-soft hover:bg-surface-muted",
                      )}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink">
                          {m.emailAddress}
                        </span>
                        <Badge
                          variant={connected ? "success" : "warn"}
                          className="text-[10px]"
                        >
                          {connected ? "Verbunden" : m.status}
                        </Badge>
                      </span>
                      <span className="text-xs text-ink-muted">
                        {m.provider === "m365" ? "Microsoft 365" : "SMTP/IMAP"} ·
                        heute {m.sentToday}/{m.effectiveDailyLimit} · Warmup-Stufe{" "}
                        {m.warmupStage}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {formatSendWindow(m.sendWindow)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4 text-brand" /> Inhalt wählen
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {templates == null ? (
              <p className="text-sm text-ink-muted">Lade Vorlagen…</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Noch keine Vorlage angelegt — unter{" "}
                <a href="/email-vorlagen" className="text-brand underline">
                  E-Mail-Vorlagen
                </a>{" "}
                erstellen.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!t.isComplete}
                    onClick={() => setTemplateId(t.id)}
                    className={cn(
                      "flex flex-col items-start gap-1.5 rounded-squircle-md p-4 text-left transition-all",
                      !t.isComplete && "cursor-not-allowed opacity-50",
                      templateId === t.id
                        ? "ring-2 ring-brand bg-brand-soft/40"
                        : "bg-surface-soft hover:bg-surface-muted",
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">{t.name}</span>
                      {t.isComplete ? (
                        <Badge variant="success" className="text-[10px]">
                          Vollständig
                        </Badge>
                      ) : (
                        <Badge variant="warn" className="text-[10px]">
                          Unvollständig
                        </Badge>
                      )}
                    </span>
                    <span className="line-clamp-1 text-xs text-ink-muted">
                      {t.subject || "(kein Betreff)"}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {selectedTemplate && unresolvedKeys.length > 0 && (
              <div className="rounded-squircle-sm bg-warn-soft px-4 py-3 text-sm text-ink">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-4 text-warn" /> Platzhalter ohne
                  passende Lead-Daten
                </p>
                <p className="mt-1 text-xs text-ink-soft">
                  {unresolvedKeys.map((k) => `{{${k}}}`).join(", ")} — diese
                  Felder wären in den E-Mails leer (geprüft am Beispiel-Lead).
                </p>
              </div>
            )}
            <p className="text-xs text-ink-muted">
              Vorlagen bearbeiten:{" "}
              <a href="/email-vorlagen" className="text-brand underline">
                E-Mail-Vorlagen öffnen
              </a>
            </p>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="size-4 text-brand" /> GIF-Ausschnitt
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!templateHasGif ? (
              <div className="rounded-squircle-sm bg-surface-soft px-4 py-4">
                <p className="text-sm font-medium text-ink">
                  Kein GIF in der Vorlage — Schritt übersprungen
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Die gewählte Vorlage enthält keinen Video-GIF-Block. Einfach
                  auf „Weiter" klicken — oder{" "}
                  <a
                    href={
                      selectedTemplate
                        ? `/email-vorlagen/${selectedTemplate.id}`
                        : "/email-vorlagen"
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand underline"
                  >
                    GIF in Vorlage einfügen
                  </a>
                  .
                </p>
              </div>
            ) : exampleVideoUrl ? (
              <>
                <p className="text-sm text-ink-soft">
                  Wählen Sie den Video-Ausschnitt, der als animiertes GIF an
                  der GIF-Position der Vorlage erscheint (Vorschau am
                  Beispiel-Lead).
                </p>
                <GifRangeEditor
                  videoUrl={exampleVideoUrl}
                  value={gifSkipped ? null : gifValue}
                  onChange={(v) => {
                    setGifSkipped(false);
                    setGifValue(v);
                  }}
                />
                {gifSkipped && (
                  <p className="text-xs text-ink-muted">
                    GIF deaktiviert — die Mails werden ohne Video-Vorschau
                    versendet.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-muted">
                Kein Lead mit fertigem Video gefunden — der Blast wird ohne GIF
                versendet.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-brand" /> Zeitplan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview?.schedule ? (
              <>
                <p className="text-2xl font-semibold text-ink">
                  ~{preview.schedule.estimatedSendDays}{" "}
                  {preview.schedule.estimatedSendDays === 1
                    ? "Werktag"
                    : "Werktage"}
                  <span className="ml-2 text-sm font-normal text-ink-muted">
                    bei {preview.schedule.mailsPerDay} Mails/Tag
                  </span>
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-squircle-sm bg-surface-soft px-4 py-3">
                    <p className="text-sm font-medium text-ink">
                      {formatSendWindow(preview.schedule.sendWindow)}
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      Sendefenster ({preview.schedule.timezone})
                    </p>
                  </div>
                  <div className="rounded-squircle-sm bg-surface-soft px-4 py-3">
                    <p className="text-sm font-medium text-ink">
                      {preview.sendable} Empfänger
                    </p>
                    <p className="text-[11px] text-ink-muted">Versandfähig</p>
                  </div>
                  <div className="rounded-squircle-sm bg-surface-soft px-4 py-3">
                    <p className="text-sm font-medium text-ink">
                      {preview.credits} Credits
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      1 Credit je 10 Mails
                    </p>
                  </div>
                </div>
                <p className="text-xs text-ink-muted">
                  Der Versand läuft automatisch verteilt im Sendefenster des
                  Postfachs — pausieren oder abbrechen ist jederzeit möglich.
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-muted">Lade Zeitplan…</p>
            )}
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Beispiel-Mail</CardTitle>
            </CardHeader>
            <CardContent>
              {renderedExample ? (
                <>
                  <p className="mb-3 text-sm text-ink">
                    <span className="text-ink-muted">Betreff:</span>{" "}
                    <span className="font-medium">{renderedExample.subject}</span>
                  </p>
                  <iframe
                    title="Beispiel-Mail"
                    srcDoc={renderedExample.html}
                    sandbox=""
                    className="h-96 w-full rounded-squircle-sm border border-line bg-white"
                  />
                  <p className="mt-2 text-[11px] text-ink-muted">
                    Gerendert mit den Daten des Beispiel-Leads.{" "}
                    {!templateHasGif
                      ? "Die Vorlage enthält keinen GIF-Block."
                      : gifSkipped || !gifValue
                        ? "Ohne GIF."
                        : "Im Versand wird an der GIF-Position das persönliche Video-GIF eingesetzt."}
                  </p>
                </>
              ) : (
                <p className="text-sm text-ink-muted">Keine Vorlage gewählt.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bestätigen & starten</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedTemplate?.footerMode === "none" && (
                <div className="rounded-squircle-sm bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                  <p className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="size-4 shrink-0" /> Diese Vorlage
                    versendet ohne sichtbare Signatur — Abmelden nur über
                    E-Mail-Client-Funktion.
                  </p>
                </div>
              )}
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={confirmLegal}
                  onCheckedChange={(v) => setConfirmLegal(v === true)}
                  className="mt-0.5"
                />
                <span className="text-sm leading-relaxed text-ink">
                  {CONFIRM_LEGAL}
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={confirmFooter}
                  onCheckedChange={(v) => setConfirmFooter(v === true)}
                  className="mt-0.5"
                />
                <span className="text-sm leading-relaxed text-ink">
                  {CONFIRM_FOOTER}
                </span>
              </label>
              <p className="text-xs text-ink-muted">
                Beim Start werden {preview?.credits ?? "…"} Credits berechnet (
                {preview?.sendable ?? "…"} Empfänger). Der Bestätigungstext wird
                protokolliert.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() =>
            step === 0
              ? router.push(`/kampagnen/${campaignId}`)
              : setStep(step - 1)
          }
          disabled={starting || gifSaving}
        >
          <ArrowLeft className="mr-1.5 size-4" />
          {step === 0 ? "Abbrechen" : "Zurück"}
        </Button>

        <div className="flex items-center gap-2">
          {step === 3 && templateHasGif && exampleVideoUrl && !gifSkipped && (
            <Button
              variant="ghost"
              disabled={gifSaving}
              onClick={() => {
                setGifSkipped(true);
              }}
            >
              Ohne GIF fortfahren
            </Button>
          )}
          {step < 5 ? (
            <Button
              onClick={() => {
                setError(null);
                if (step === 3) void saveGifAndContinue();
                else setStep(step + 1);
              }}
              disabled={!canContinue || gifSaving}
            >
              {gifSaving ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : null}
              Weiter
              <ArrowRight className="ml-1.5 size-4" />
            </Button>
          ) : (
            <Button
              onClick={() => void startBlast()}
              disabled={!confirmLegal || !confirmFooter || starting}
            >
              {starting ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Play className="mr-1.5 size-4" />
              )}
              Blast starten
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
