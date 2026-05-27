import { notFound } from "next/navigation";
import Link from "next/link";
import { Save, ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { getTpl } from "@/lib/db/queries/landingPageTemplates";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const THEMES = [
  { id: "noir", label: "Noir", preview: "bg-gradient-to-br from-ink to-ink-soft" },
  {
    id: "clean",
    label: "Clean",
    preview: "bg-gradient-to-br from-surface to-surface-muted border border-line",
  },
  {
    id: "gradient",
    label: "Gradient",
    preview: "bg-gradient-to-br from-brand to-brand-deep",
  },
  {
    id: "warm",
    label: "Warm",
    preview: "bg-gradient-to-br from-warn to-brand",
  },
];

export default async function LandingpageBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireUser();

  let tpl;
  try {
    tpl = await getTpl(id, user.id);
  } catch {
    notFound();
  }

  return (
    <>
      <PageHeader
        title={tpl.name}
        subtitle="Landingpage-Builder (Skeleton). Theme links, Live-Vorschau rechts."
        actions={
          <>
            <Button variant="ghost" asChild iconLeft={<ArrowLeft className="size-4" />}>
              <Link href="/landingpages">Zurueck</Link>
            </Button>
            <Button iconLeft={<Save className="size-4" />}>Speichern</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Theme</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {THEMES.map((t) => {
                const active = t.id === tpl.themeId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={cn(
                      "w-full flex items-center gap-3 rounded-squircle-md border p-2 text-left transition-colors",
                      active
                        ? "border-brand bg-brand-soft"
                        : "border-line hover:border-brand/50",
                    )}
                  >
                    <span
                      className={cn(
                        "size-10 rounded-squircle-sm shrink-0",
                        t.preview,
                      )}
                    />
                    <span className="flex-1 text-sm font-medium text-ink">
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inhalte</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Headline</Label>
                <p className="text-sm text-ink-muted">
                  {`{{firstName}}, hier ist dein Video`}
                </p>
              </div>
              <div>
                <Label>CTA-Button</Label>
                <p className="text-sm text-ink-muted">Termin buchen</p>
              </div>
              <div>
                <Label>Footer</Label>
                <p className="text-sm text-ink-muted">Impressum &amp; Datenschutz</p>
              </div>
            </CardContent>
          </Card>
        </aside>

        <section>
          <Card>
            <CardHeader>
              <CardTitle>Live-Vorschau</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  "rounded-squircle-md min-h-[480px] p-8 flex flex-col items-center justify-center text-center",
                  THEMES.find((t) => t.id === tpl.themeId)?.preview ??
                    THEMES[1].preview,
                )}
              >
                <div className="aspect-video w-full max-w-md rounded-squircle-md bg-ink/20 mb-6 flex items-center justify-center text-white/70 text-sm">
                  Video-Player
                </div>
                <h2 className="text-2xl font-bold text-white drop-shadow-sm mb-3">
                  {`{{firstName}}, hier ist dein Video`}
                </h2>
                <p className="text-sm text-white/80 mb-6 max-w-md">
                  Personalisierte Outreach-Botschaft an {`{{companyName}}`}.
                </p>
                <span className="inline-flex items-center justify-center rounded-full bg-white text-ink px-6 py-3 text-sm font-semibold">
                  Termin buchen
                </span>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}
