"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { AbSplitPicker, type AbSplitMode } from "@/components/ab/ab-split-picker";

export interface AbTestSettingsProps {
  campaignId: string;
  pdfEnabled: boolean;
  /** Brief A = campaigns.pdf_google_docs_url (bestehende Vorlage). */
  urlA: string | null;
  /** Brief B = campaigns.pdf_google_docs_url_b. */
  urlB: string | null;
  enabled: boolean;
  /** Standard-Verteilung (Migration 0035) — vorbefüllt den Runden-Wizard. */
  splitMode: AbSplitMode;
  splitWeightA: number;
}

function isGoogleDocsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.hostname === "docs.google.com" && u.pathname.includes("/document/");
  } catch {
    return false;
  }
}

/**
 * Verwaltung des Brief-A/B-Tests auf Kampagnen-Ebene.
 *
 * Der Test wirkt nur auf NEUE Runden: beim Runden-Start wird die Regel +
 * beide URLs als Snapshot in `runs.ab_config` eingefroren. Laufende und
 * abgeschlossene Runden bleiben von allem hier unberührt.
 */
export function AbTestSettings({
  campaignId,
  pdfEnabled,
  urlA,
  urlB,
  enabled,
  splitMode,
  splitWeightA,
}: AbTestSettingsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [urlBDraft, setUrlBDraft] = React.useState(urlB ?? "");
  const [modeDraft, setModeDraft] = React.useState<AbSplitMode>(splitMode);
  const [weightDraft, setWeightDraft] = React.useState(splitWeightA);
  const splitDirty = modeDraft !== splitMode || weightDraft !== splitWeightA;
  const [pending, setPending] = React.useState<
    "activate" | "keepA" | "adoptB" | "split" | null
  >(null);
  const [adoptBOpen, setAdoptBOpen] = React.useState(false);

  const urlBValid = isGoogleDocsUrl(urlBDraft.trim());
  const canActivate = Boolean(urlA) && urlBValid;

  async function patch(
    action: "activate" | "keepA" | "adoptB" | "split",
    body: Record<string, unknown>,
    successTitle: string,
  ) {
    setPending(action);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Speichern fehlgeschlagen",
          description: j.error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      toast({ title: successTitle, variant: "success" });
      router.refresh();
    } catch {
      toast({
        title: "Speichern fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-4 text-brand-deep" />
          A/B-Test für Brief-Vorlagen
          {enabled ? (
            <Badge variant="success" dot>
              Aktiv
            </Badge>
          ) : (
            <Badge variant="neutral" dot>
              Inaktiv
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-ink-muted leading-relaxed">
          Testen Sie zwei Brief-Vorlagen gegeneinander: Bei jeder neuen Runde
          werden die Leads nach Ihrer Regel auf Brief A und Brief B
          aufgeteilt. Die Verteilung legen Sie beim Start der Runde fest —
          bereits gestartete Runden bleiben unverändert.
        </p>

        {!pdfEnabled && (
          <div className="rounded-squircle-sm border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">
            Der PDF-Brief ist für diese Kampagne deaktiviert. Aktivieren Sie
            ihn zuerst, um A/B-Tests zu nutzen.
          </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          <div>
            <Label>Brief A (bestehende Vorlage)</Label>
            <p
              className="truncate rounded-squircle-sm border border-line bg-surface-soft px-3 py-2 text-sm text-ink"
              title={urlA ?? undefined}
            >
              {urlA || (
                <span className="text-ink-muted">
                  Keine Google-Docs-URL hinterlegt
                </span>
              )}
            </p>
          </div>
          <div>
            <Label htmlFor="ab-url-b">Brief B (Google-Docs-URL)</Label>
            <Input
              id="ab-url-b"
              value={urlBDraft}
              onChange={(e) => setUrlBDraft(e.target.value)}
              placeholder="https://docs.google.com/document/d/..."
              disabled={!pdfEnabled}
            />
            {urlBDraft.trim() !== "" && !urlBValid && (
              <p className="mt-1 text-xs text-danger">
                Bitte eine gültige Google-Docs-URL eingeben.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-squircle-md border border-line p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-ink">
              Standard-Verteilung
            </p>
            <p className="mt-0.5 text-xs text-ink-muted leading-relaxed">
              Gilt als Vorgabe für jede neue Runde — beim Start einer Runde
              können Sie sie jederzeit anpassen. Bereits gestartete Runden
              behalten ihre Verteilung.
            </p>
          </div>
          <AbSplitPicker
            mode={modeDraft}
            weightA={weightDraft}
            onModeChange={setModeDraft}
            onWeightChange={setWeightDraft}
            disabled={!pdfEnabled}
          />
          {enabled && (
            <Button
              variant="subtle"
              onClick={() =>
                void patch(
                  "split",
                  { abSplitMode: modeDraft, abSplitWeightA: weightDraft },
                  "Standard-Verteilung gespeichert",
                )
              }
              loading={pending === "split"}
              disabled={!splitDirty || pending !== null}
            >
              Verteilung speichern
            </Button>
          )}
        </div>

        {!enabled ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() =>
                void patch(
                  "activate",
                  {
                    abTestingEnabled: true,
                    pdfGoogleDocsUrlB: urlBDraft.trim(),
                    abSplitMode: modeDraft,
                    abSplitWeightA: weightDraft,
                  },
                  "A/B-Test aktiviert",
                )
              }
              loading={pending === "activate"}
              disabled={!pdfEnabled || !canActivate || pending !== null}
              iconLeft={<FlaskConical className="size-4" />}
            >
              A/B-Test aktivieren
            </Button>
            {!urlA && (
              <p className="text-xs text-ink-muted">
                Hinterlegen Sie zuerst eine Google-Docs-URL für Brief A.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-squircle-sm border border-line bg-surface-soft px-3 py-2 text-xs text-ink-muted leading-relaxed">
              Die Auswertung (Öffnungsrate, Play-Rate, Watch-Time pro Brief)
              finden Sie im <span className="font-medium text-ink">Übersicht-Tab</span>{" "}
              — die Runden-Tabelle zeigt zusätzlich pro Runde die verwendete
              Verteilung und die Öffnungsraten beider Briefe.
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="subtle"
                onClick={() =>
                  void patch(
                    "activate",
                    { pdfGoogleDocsUrlB: urlBDraft.trim() },
                    "Brief B aktualisiert",
                  )
                }
                loading={pending === "activate"}
                disabled={
                  !urlBValid ||
                  urlBDraft.trim() === (urlB ?? "") ||
                  pending !== null
                }
              >
                Brief B speichern
              </Button>
            </div>
            <div className="border-t border-line pt-3">
              <p className="mb-2 text-sm font-semibold text-ink">
                Test beenden — Gewinner übernehmen
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="subtle"
                  onClick={() =>
                    void patch(
                      "keepA",
                      { abTestingEnabled: false, pdfGoogleDocsUrlB: null },
                      "A/B-Test beendet — Brief A bleibt Standard",
                    )
                  }
                  loading={pending === "keepA"}
                  disabled={pending !== null}
                  iconLeft={<Trophy className="size-4" />}
                >
                  Brief A behalten
                </Button>
                <Button
                  variant="subtle"
                  onClick={() => setAdoptBOpen(true)}
                  disabled={pending !== null || !urlB}
                  iconLeft={<Trophy className="size-4" />}
                >
                  Brief B übernehmen
                </Button>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                Neue Runden verwenden danach nur noch den gewählten Brief.
                Sie können jederzeit einen neuen A/B-Test starten.
              </p>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog
        open={adoptBOpen}
        onOpenChange={(open) => {
          if (!open && pending === null) setAdoptBOpen(false);
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Brief B als Standard übernehmen?</DialogTitle>
            <DialogDescription>
              Brief B wird die neue Standard-Vorlage dieser Kampagne und
              ersetzt die bisherige URL von Brief A. Der A/B-Test wird
              beendet. Bereits gestartete Runden bleiben unverändert.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setAdoptBOpen(false)}
              disabled={pending !== null}
            >
              Abbrechen
            </Button>
            <Button
              type="button"
              loading={pending === "adoptB"}
              iconLeft={<Trophy className="size-4" />}
              onClick={async () => {
                await patch(
                  "adoptB",
                  {
                    pdfGoogleDocsUrl: urlB,
                    pdfGoogleDocsUrlB: null,
                    abTestingEnabled: false,
                  },
                  "A/B-Test beendet — Brief B ist neuer Standard",
                );
                setAdoptBOpen(false);
              }}
            >
              Brief B übernehmen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
