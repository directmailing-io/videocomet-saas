"use client";

/**
 * Editor für E-Mail-Vorlagen (freie Komposition): links Name/Betreff +
 * Body als einzige Leinwand (TipTap mit optionalen emailGif-/emailCta-
 * Nodes), Signatur, Pflicht-Impressum — rechts sticky Live-Vorschau
 * (renderOutreachEmail mit Beispiel-Lead) + Spam-Ampel (debounced gegen
 * POST /api/email/spam-score).
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";
import {
  EMAIL_GIF_PREVIEW_URL,
  EmailBodyEditor,
} from "@/components/email/email-body-editor";
import { extractFirstCtaNode, renderOutreachEmail } from "@/lib/email/render";
import { cn } from "@/lib/utils";

type TemplateFormat = "branded" | "personal";
type TemplateFooterMode = "complete" | "unsubscribe" | "none";

interface TemplateData {
  id: string;
  name: string;
  subject: string;
  bodyJson: unknown;
  bodyHtml: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  signatureHtml: string | null;
  impressumHtml: string;
  format: TemplateFormat;
  footerMode: TemplateFooterMode;
  isComplete: boolean;
}

interface SpamHint {
  label: string;
  points: number;
}

interface SpamResult {
  score: number;
  level: "green" | "orange" | "red";
  hints: SpamHint[];
}

/**
 * Basis-Kontakt-Eigenschaften, wie sie nach dem Kontakt→Lead-Übertrag in den
 * Lead-Daten heißen (buildLeadDataFromContact — z. B. `linkedin`, nicht
 * `linkedinUrl`). `pageUrl` ist der System-Platzhalter für den Video-Link.
 */
const BASE_PLACEHOLDER_SUGGESTIONS = [
  "firstName",
  "lastName",
  "company",
  "salutation",
  "title",
  "position",
  "street",
  "postalCode",
  "city",
  "country",
  "phone",
  "email",
  "website",
  "linkedin",
  "pageUrl",
];

const SAMPLE_LEAD: Record<string, string> = {
  firstName: "Max",
  lastName: "Mustermann",
  company: "Muster GmbH",
  salutation: "Herr",
  title: "Dr.",
  position: "Geschäftsführer",
  street: "Musterstraße 12",
  postalCode: "10115",
  city: "Berlin",
  country: "Deutschland",
  phone: "+49 30 1234567",
  email: "max@muster-gmbh.de",
  website: "https://www.muster-gmbh.de",
  linkedin: "https://www.linkedin.com/in/max-mustermann",
};

const SAMPLE_PAGE_URL = "https://app.videocomet.de/v/beispiel";

const PREVIEW_GIF_URL = EMAIL_GIF_PREVIEW_URL;

const SPAM_STYLE: Record<
  SpamResult["level"],
  { badge: "success" | "warn" | "danger"; label: string }
> = {
  green: { badge: "success", label: "Geringes Spam-Risiko" },
  orange: { badge: "warn", label: "Erhöhtes Spam-Risiko" },
  red: { badge: "danger", label: "Hohes Spam-Risiko" },
};

const FORMAT_OPTIONS: Array<{
  value: TemplateFormat;
  label: string;
  description: string;
}> = [
  {
    value: "branded",
    label: "Gebrandet",
    description: "Gestaltete E-Mail mit Button & Layout",
  },
  {
    value: "personal",
    label: "Persönlich",
    description: "Wirkt wie eine persönlich getippte E-Mail",
  },
];

const FOOTER_OPTIONS: Array<{
  value: TemplateFooterMode;
  label: string;
}> = [
  { value: "complete", label: "Komplett (Abmelden + Impressum)" },
  { value: "unsubscribe", label: "Nur Abmelde-Link" },
  { value: "none", label: "Keine Signatur" },
];

/** Segmented Radio-Pills im bestehenden Stil (vgl. Platzhalter-Pills). */
function OptionPills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
            value === o.value
              ? "bg-ink text-white"
              : "bg-surface-soft text-ink hover:bg-line",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmailTemplateEditor({ templateId }: { templateId: string }) {
  const router = useRouter();
  const { toast } = useToast();

  const [tpl, setTpl] = React.useState<TemplateData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  const [spam, setSpam] = React.useState<SpamResult | null>(null);
  const [spamLoading, setSpamLoading] = React.useState(false);
  const [spamOpen, setSpamOpen] = React.useState(false);

  const subjectRef = React.useRef<HTMLInputElement | null>(null);

  // Benutzerdefinierte Kontakt-Felder als zusätzliche Platzhalter (best-effort).
  const [customFieldKeys, setCustomFieldKeys] = React.useState<string[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/contact-fields", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { fields: [] }))
      .then((json) => {
        if (cancelled) return;
        const keys = (json.fields ?? [])
          .map((f: { key?: string }) => f.key)
          .filter((k: unknown): k is string => typeof k === "string" && k.length > 0);
        setCustomFieldKeys(keys);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const placeholderSuggestions = React.useMemo(() => {
    const extra = customFieldKeys.filter(
      (k) => !BASE_PLACEHOLDER_SUGGESTIONS.includes(k),
    );
    return [...BASE_PLACEHOLDER_SUGGESTIONS, ...extra];
  }, [customFieldKeys]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/email-templates/${templateId}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Load failed");
        const json = await res.json();
        if (!cancelled) setTpl(json.template);
      } catch {
        if (!cancelled) {
          toast({
            variant: "danger",
            title: "Vorlage konnte nicht geladen werden",
          });
          router.push("/email-vorlagen");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, router, toast]);

  function patch(next: Partial<TemplateData>) {
    setTpl((t) => (t ? { ...t, ...next } : t));
    setDirty(true);
  }

  function insertSubjectPlaceholder(key: string) {
    if (!tpl) return;
    const input = subjectRef.current;
    const token = `{{${key}}}`;
    const pos = input?.selectionStart ?? tpl.subject.length;
    const next =
      tpl.subject.slice(0, pos) + token + tpl.subject.slice(pos);
    patch({ subject: next });
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(pos + token.length, pos + token.length);
    });
  }

  // ── Live-Vorschau ──────────────────────────────────────────────────────
  const preview = React.useMemo(() => {
    if (!tpl) return null;
    try {
      return renderOutreachEmail({
        content: {
          subject: tpl.subject,
          bodyJson: tpl.bodyJson,
          bodyHtml: tpl.bodyHtml,
          signatureHtml: tpl.signatureHtml,
          impressumHtml: tpl.impressumHtml,
          format: tpl.format,
          footerMode: tpl.footerMode,
        },
        leadData: SAMPLE_LEAD,
        pageUrl: SAMPLE_PAGE_URL,
        emailGifUrl: PREVIEW_GIF_URL,
        unsubscribeToken: "vorschau",
      });
    } catch {
      return null;
    }
  }, [tpl]);

  // ── Spam-Score (debounced) ─────────────────────────────────────────────
  React.useEffect(() => {
    if (!preview) return;
    setSpamLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch("/api/email/spam-score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: preview.subject,
            html: preview.html,
          }),
        });
        if (!res.ok) throw new Error();
        const json = (await res.json()) as SpamResult;
        setSpam(json);
      } catch {
        setSpam(null);
      } finally {
        setSpamLoading(false);
      }
    }, 800);
    return () => clearTimeout(handle);
  }, [preview]);

  async function handleSave() {
    if (!tpl) return;
    setSaving(true);
    try {
      // ctaLabel/ctaUrl dienen nur noch als Insert-Defaults — aus dem
      // ERSTEN CTA-Node zurückspiegeln, damit Alt-Daten konsistent bleiben.
      const firstCta = extractFirstCtaNode(tpl.bodyJson);
      const res = await fetch(`/api/email-templates/${tpl.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tpl.name,
          subject: tpl.subject,
          bodyJson: tpl.bodyJson,
          bodyHtml: tpl.bodyHtml,
          ...(firstCta ? { ctaLabel: firstCta.label, ctaUrl: firstCta.url } : {}),
          signatureHtml: tpl.signatureHtml,
          impressumHtml: tpl.impressumHtml,
          format: tpl.format,
          footerMode: tpl.footerMode,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Fehler");
      setTpl(json.template);
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

  async function handleDelete() {
    if (!tpl) return;
    if (!window.confirm("Diese E-Mail-Vorlage löschen?")) return;
    try {
      const res = await fetch(`/api/email-templates/${tpl.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast({ variant: "success", title: "Vorlage gelöscht" });
      router.push("/email-vorlagen");
    } catch {
      toast({ variant: "danger", title: "Fehler beim Löschen" });
    }
  }

  if (loading || !tpl) {
    return (
      <div className="py-20 text-center text-ink-muted text-sm">
        <Loader2 className="size-4 animate-spin inline mr-2" /> Lade Vorlage …
      </div>
    );
  }

  // Impressum ist nur bei „Komplett"-Signatur Pflicht (Migration 0039).
  const impressumEmpty =
    tpl.impressumHtml.replace(/<[^>]+>/g, "").trim().length === 0;
  const impressumMissing = tpl.footerMode === "complete" && impressumEmpty;

  return (
    <div className="flex flex-col gap-6">
      {/* Kopfzeile */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/email-vorlagen"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" /> Alle Vorlagen
        </Link>
        <div className="flex-1" />
        {impressumMissing ? (
          <Badge variant="warn">Impressum fehlt — nicht einsatzbereit</Badge>
        ) : (
          <Badge variant="success">Einsatzbereit</Badge>
        )}
        <Button
          variant="ghost"
          onClick={handleDelete}
          iconLeft={<Trash2 className="size-4" />}
        >
          Löschen
        </Button>
        <Button
          onClick={handleSave}
          loading={saving}
          disabled={!dirty}
          iconLeft={<Save className="size-4" />}
        >
          Speichern
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* Linke Spalte: Zonen-Formular */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Allgemein</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tpl-name">Name der Vorlage</Label>
                <Input
                  id="tpl-name"
                  value={tpl.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tpl-subject">Betreff</Label>
                <Input
                  id="tpl-subject"
                  ref={subjectRef}
                  value={tpl.subject}
                  onChange={(e) => patch({ subject: e.target.value })}
                  placeholder="z. B. {{firstName}}, ein Video für {{company}}"
                />
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-ink-muted mr-1">
                    Platzhalter:
                  </span>
                  {placeholderSuggestions.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => insertSubjectPlaceholder(key)}
                      className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-surface-soft text-ink hover:bg-line transition-colors"
                    >
                      {`{{${key}}}`}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Darstellung</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label>Format</Label>
                <OptionPills
                  options={FORMAT_OPTIONS}
                  value={tpl.format}
                  onChange={(v) => patch({ format: v })}
                />
                <p className="text-[11px] text-ink-muted">
                  {
                    FORMAT_OPTIONS.find((o) => o.value === tpl.format)
                      ?.description
                  }
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Signatur</Label>
                <OptionPills
                  options={FOOTER_OPTIONS}
                  value={tpl.footerMode}
                  onChange={(v) => patch({ footerMode: v })}
                />
                {tpl.footerMode === "none" && (
                  <div className="mt-1 rounded-squircle-sm bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
                    Ohne Abmelde-Link und Impressum im Text verantworten Sie
                    die rechtliche Einordnung selbst (UWG §7). Der unsichtbare
                    List-Unsubscribe-Header und die Abmelde-Sperrliste bleiben
                    aktiv.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inhalt</CardTitle>
            </CardHeader>
            <CardContent>
              <EmailBodyEditor
                initialJson={tpl.bodyJson}
                initialHtml={tpl.bodyHtml}
                onChange={({ json, html }) =>
                  patch({ bodyJson: json, bodyHtml: html })
                }
                placeholderSuggestions={placeholderSuggestions}
                ctaDefaults={{
                  label: tpl.ctaLabel || "Video ansehen",
                  url: tpl.ctaUrl || "@system:pageUrl",
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Signatur</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              <Textarea
                value={tpl.signatureHtml ?? ""}
                onChange={(e) =>
                  patch({ signatureHtml: e.target.value })
                }
                rows={4}
                placeholder={"Viele Grüße\nDaniel Kurzeja\nVIDEOCOMET GmbH"}
              />
              <p className="text-[11px] text-ink-muted">
                Optional. Zeilenumbrüche und einfaches HTML sind erlaubt.
              </p>
            </CardContent>
          </Card>

          {tpl.footerMode !== "none" && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Impressum{" "}
                  {tpl.footerMode === "complete" ? (
                    <span className="text-danger" title="Pflichtfeld">
                      *
                    </span>
                  ) : (
                    <span className="text-ink-muted font-normal text-sm">
                      (optional)
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5">
                <Textarea
                  value={tpl.impressumHtml}
                  onChange={(e) => patch({ impressumHtml: e.target.value })}
                  rows={5}
                  placeholder={
                    "Muster GmbH · Musterstraße 1 · 10115 Berlin\nGeschäftsführer: Max Mustermann · HRB 12345"
                  }
                />
                <p className="text-[11px] text-ink-muted">
                  {tpl.footerMode === "complete"
                    ? "Pflicht für den Versand: Das Impressum wird zusammen mit dem Abmeldelink automatisch an jede E-Mail angehängt."
                    : "Optional: Bei „Nur Abmelde-Link“ wird das Impressum nicht in die E-Mail gerendert."}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Rechte Spalte: sticky Live-Vorschau + Spam-Ampel */}
        <div className="xl:sticky xl:top-20 flex flex-col gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>Live-Vorschau</CardTitle>
              <div className="flex items-center gap-2">
                {spamLoading && (
                  <Loader2 className="size-3.5 animate-spin text-ink-muted" />
                )}
                {spam && (
                  <button
                    type="button"
                    onClick={() => setSpamOpen((s) => !s)}
                    className="inline-flex items-center gap-1.5"
                    aria-expanded={spamOpen}
                  >
                    <Badge variant={SPAM_STYLE[spam.level].badge}>
                      {spam.level === "green" ? (
                        <ShieldCheck className="size-3 mr-1" />
                      ) : (
                        <ShieldAlert className="size-3 mr-1" />
                      )}
                      {SPAM_STYLE[spam.level].label} ·{" "}
                      {spam.score.toFixed(1)}
                    </Badge>
                    <ChevronDown
                      className={cn(
                        "size-3.5 text-ink-muted transition-transform",
                        spamOpen && "rotate-180",
                      )}
                    />
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {spam && spamOpen && (
                <div className="rounded-squircle-sm border border-line bg-surface-soft p-3">
                  {spam.hints.length === 0 ? (
                    <p className="text-xs text-ink-muted">
                      Keine Auffälligkeiten gefunden.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {spam.hints.map((h, i) => (
                        <li
                          key={i}
                          className="flex items-start justify-between gap-3 text-xs"
                        >
                          <span className="text-ink">{h.label}</span>
                          <span className="shrink-0 tabular-nums text-ink-muted">
                            {h.points > 0 ? `+${h.points}` : "info"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="rounded-squircle-sm border border-line bg-surface-soft px-3 py-2 text-sm">
                <span className="text-ink-muted mr-1.5">Betreff:</span>
                <span className="font-medium text-ink">
                  {preview?.subject.trim() || "— noch kein Betreff —"}
                </span>
              </div>

              <div className="overflow-hidden rounded-squircle-sm border border-line bg-white">
                <iframe
                  title="E-Mail-Vorschau"
                  sandbox=""
                  srcDoc={preview?.html ?? ""}
                  className="w-full h-[640px] border-0"
                />
              </div>
              <p className="text-[11px] text-ink-muted">
                Vorschau mit Beispiel-Daten (Max Mustermann, Muster GmbH).
                Falls ein GIF-Block eingefügt ist, wird er beim Versand pro
                Empfänger durch das persönliche Video-GIF ersetzt.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
