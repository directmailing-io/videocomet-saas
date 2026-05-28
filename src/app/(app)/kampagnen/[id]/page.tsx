import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { listCampaignRunsWithCounts } from "@/lib/db/queries/runs";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { RunsTable, type RunRow } from "./runs-table";
import { CampaignActions } from "./campaign-actions";

function formatDate(d: Date | null): string {
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(d));
  } catch {
    return "";
  }
}

function modeLabel(mode: string): string {
  if (mode === "with-presentation") return "Mit Präsentation";
  return "Nur Webcam";
}

function pipPositionLabel(pos: string | null): string {
  if (pos === "bottom-right" || pos === "right") return "Rechts";
  return "Links";
}

function pipShapeLabel(shape: string | null): string {
  if (shape === "circle") return "Rund";
  if (shape === "square") return "Eckig";
  return "Abgerundet";
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireUser();

  let campaign;
  try {
    campaign = await getCampaign(id, user.id);
  } catch {
    notFound();
  }

  const runsWithCounts = await listCampaignRunsWithCounts(campaign.id, user.id);
  const initialRuns: RunRow[] = runsWithCounts.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    totalLeads: r.totalLeads,
    completedLeads: r.completedLeads,
    failedLeads: r.failedLeads,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  }));

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={`Modus: ${modeLabel(campaign.mode)} . Erstellt am ${formatDate(campaign.createdAt)}`}
        actions={
          <CampaignActions
            campaignId={campaign.id}
            campaignName={campaign.name}
          />
        }
      />

      <Tabs defaultValue="übersicht">
        <TabsList>
          <TabsTrigger value="übersicht">Übersicht</TabsTrigger>
          <TabsTrigger value="runden">Runden</TabsTrigger>
          <TabsTrigger value="einstellungen">Einstellungen</TabsTrigger>
        </TabsList>

        <TabsContent value="übersicht">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Gesamt-Leads</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-ink">
                  {initialRuns.reduce((s, r) => s + (r.totalLeads ?? 0), 0)}
                </div>
                <p className="text-xs text-ink-muted mt-1">
                  Über alle Runden dieser Kampagne
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Oeffnungsquote</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-ink">0%</div>
                <p className="text-xs text-ink-muted mt-1">
                  Wird nach erstem Versand berechnet.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>CTA-Quote</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-ink">0%</div>
                <p className="text-xs text-ink-muted mt-1">
                  Klicks auf Call-to-Action.
                </p>
              </CardContent>
            </Card>
          </div>

          {campaign.webcamMediaId && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Webcam-Vorschau</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="aspect-video w-full max-w-md rounded-squircle-md bg-surface-muted flex items-center justify-center text-ink-muted text-sm">
                  Vorschau nicht verfuegbar
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="runden">
          <div className="flex justify-end mb-4">
            <Button asChild iconLeft={<Plus className="size-4" />}>
              <Link href={`/kampagnen/${campaign.id}/runs/neu`}>
                Neue Runde
              </Link>
            </Button>
          </div>
          {initialRuns.length === 0 ? (
            <EmptyState
              title="Noch keine Runden"
              subtitle="Starte eine Runde, um diese Kampagne an deine Lead-Liste zu schicken."
              action={
                <Button asChild iconLeft={<Plus className="size-4" />}>
                  <Link href={`/kampagnen/${campaign.id}/runs/neu`}>
                    Neue Runde
                  </Link>
                </Button>
              }
            />
          ) : (
            <RunsTable campaignId={campaign.id} initialRuns={initialRuns} />
          )}
        </TabsContent>

        <TabsContent value="einstellungen">
          <Card>
            <CardHeader>
              <CardTitle>Konfiguration</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                    Modus
                  </dt>
                  <dd className="text-ink">{modeLabel(campaign.mode)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                    PiP-Position
                  </dt>
                  <dd className="text-ink">
                    {pipPositionLabel(campaign.pipPosition)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                    PiP-Form
                  </dt>
                  <dd className="text-ink">{pipShapeLabel(campaign.pipShape)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                    Landingpage-Vorlage
                  </dt>
                  <dd className="text-ink">
                    {campaign.landingPageTemplateId ? (
                      <Link
                        href={`/landingpages/${campaign.landingPageTemplateId}`}
                        className="text-brand-deep hover:underline"
                      >
                        Vorlage öffnen
                      </Link>
                    ) : (
                      <span className="text-ink-muted">Keine</span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="mt-6 pt-6 border-t border-line">
                <h4 className="text-sm font-semibold text-ink mb-3">
                  PDF-Brief
                </h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                      Status
                    </dt>
                    <dd>
                      <Badge
                        variant={campaign.pdfEnabled ? "success" : "neutral"}
                        dot
                      >
                        {campaign.pdfEnabled ? "Aktiv" : "Deaktiviert"}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                      QR-Code
                    </dt>
                    <dd className="text-ink">
                      {campaign.pdfQrEnabled ? "Ja" : "Nein"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                      Thumbnail
                    </dt>
                    <dd className="text-ink">
                      {campaign.pdfThumbnailEnabled ? "Ja" : "Nein"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                      Google-Docs-URL
                    </dt>
                    <dd className="text-ink truncate">
                      {campaign.pdfGoogleDocsUrl || (
                        <span className="text-ink-muted">Keine</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
