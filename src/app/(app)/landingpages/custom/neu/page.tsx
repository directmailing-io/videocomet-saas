"use client";

/**
 * "Neue Custom-LP-Vorlage anlegen" — clientseitiges Formular.
 *
 * Im Gegensatz zu den block-basierten Vorlagen können wir Custom-LPs nicht
 * mit einer Default-Konfiguration anlegen — der Kunde muss am Ende ein ZIP
 * uploaden. Daher fragen wir hier nur Name (+ optionale Beschreibung) ab,
 * legen das Template an und springen direkt auf die Detail-Seite, wo der
 * Upload-Wizard wartet.
 *
 * Bewusst client-side: kein Redirect-on-mount-Pattern wie bei den anderen
 * Vorlagen, da der Kunde hier eine Entscheidung trifft (Name).
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileArchive, Plus, Download } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toaster";

export default function NeueCustomLpPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function onCreate() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/custom-lp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        template?: { id: string };
        error?: string;
      };
      if (!res.ok) {
        toast({
          title: "Anlegen fehlgeschlagen",
          description: data.error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      const id = data.template?.id;
      if (id) {
        router.push(`/landingpages/custom/${id}`);
      } else {
        router.push("/landingpages");
      }
    } catch {
      toast({
        title: "Anlegen fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Neue HTML-Vorlage"
        subtitle="Geben Sie Ihrer Vorlage einen Namen. Im nächsten Schritt laden Sie das ZIP hoch."
        actions={
          <Button
            variant="ghost"
            asChild
            iconLeft={<ArrowLeft className="size-4" />}
          >
            <Link href="/landingpages">Zurück</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-5xl">
        <Card className="lg:col-span-2">
          <CardContent className="p-6 space-y-5">
            <div>
              <Label htmlFor="tpl-name">Name der Vorlage</Label>
              <Input
                id="tpl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Sommer-Kampagne 2025"
                autoFocus
                maxLength={120}
              />
              <p className="mt-1.5 text-xs text-ink-muted">
                Nur für Sie sichtbar — wird im Kampagnen-Wizard angezeigt.
              </p>
            </div>

            <div>
              <Label htmlFor="tpl-desc">
                Beschreibung{" "}
                <span className="font-normal text-ink-muted">(optional)</span>
              </Label>
              <Textarea
                id="tpl-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Kurze Notiz zur Vorlage, z. B. Branche oder Anlass."
                rows={3}
                maxLength={500}
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="ghost" asChild>
                <Link href="/landingpages">Abbrechen</Link>
              </Button>
              <Button
                onClick={() => {
                  void onCreate();
                }}
                disabled={!name.trim()}
                loading={saving}
                iconLeft={<Plus className="size-4" />}
              >
                Anlegen und ZIP hochladen
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <span className="inline-flex size-10 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep shrink-0">
                  <FileArchive className="size-5" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-ink">
                    Sie brauchen einen Startpunkt?
                  </h3>
                  <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                    Laden Sie unser Starter-Kit herunter — ein sauberes
                    HTML/CSS/JS-Gerüst mit Hero, Video-Slot und CTAs.
                  </p>
                  <Button
                    asChild
                    variant="subtle"
                    size="sm"
                    className="mt-3"
                    iconLeft={<Download className="size-4" />}
                  >
                    <a href="/api/custom-lp/starter-kit" download>
                      ZIP-Vorlage herunterladen
                    </a>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 text-xs text-ink-muted space-y-2 leading-relaxed">
              <p className="font-semibold text-ink text-sm">Was kommt rein?</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  <code className="font-mono">index.html</code> als Einstieg
                </li>
                <li>Erlaubte Typen: HTML, CSS, JS, SVG, PNG, JPG, MP4, …</li>
                <li>Max. 50 MB komprimiert / 200 MB entpackt</li>
                <li>
                  Nutzen Sie <code className="font-mono">{"{{firstName}}"}</code>{" "}
                  &amp; Co. für Personalisierung
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
