import Link from "next/link";
import { Megaphone, Plus, MoreHorizontal, Pencil, Copy, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { listUserCampaigns } from "@/lib/db/queries/campaigns";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { eq, sql, inArray } from "drizzle-orm";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

function modeLabel(mode: string): string {
  if (mode === "with-presentation") return "Mit Präsentation";
  return "Nur Webcam";
}

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

export default async function KampagnenPage() {
  const { user } = await requireUser();
  const items = await listUserCampaigns(user.id);

  // Count runs per campaign in one query
  let runsByCampaign: Map<string, number> = new Map();
  if (items.length > 0) {
    const ids = items.map((c) => c.id);
    const rows = await db
      .select({
        campaignId: runs.campaignId,
        count: sql<number>`count(*)::int`,
      })
      .from(runs)
      .where(inArray(runs.campaignId, ids))
      .groupBy(runs.campaignId);
    runsByCampaign = new Map(rows.map((r) => [r.campaignId, r.count ?? 0]));
  }

  return (
    <>
      <PageHeader
        title="Kampagnen"
        subtitle="Verwalte deine Outreach-Kampagnen und starte neue Runden."
        actions={
          <Button asChild iconLeft={<Plus className="size-4" />}>
            <Link href="/kampagnen/neu">Neue Kampagne</Link>
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title="Noch keine Kampagnen"
          subtitle="Lege deine erste Kampagne an, um personalisierte Videos zu erzeugen."
          action={
            <Button asChild iconLeft={<Plus className="size-4" />}>
              <Link href="/kampagnen/neu">Erste Kampagne erstellen</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((c) => {
            const runCount = runsByCampaign.get(c.id) ?? 0;
            return (
              <Card key={c.id} hover className="relative overflow-visible">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{c.name}</CardTitle>
                      <CardDescription className="mt-1">
                        Erstellt am {formatDate(c.createdAt)}
                      </CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex size-8 items-center justify-center rounded-full hover:bg-line-soft transition-colors"
                          aria-label="Kampagnen-Aktionen"
                        >
                          <MoreHorizontal className="size-4 text-ink-muted" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/kampagnen/${c.id}`}>
                            <Pencil className="size-4 text-ink-muted" />
                            Bearbeiten
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                          }}
                        >
                          <Copy className="size-4 text-ink-muted" />
                          Duplizieren
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          danger
                          onSelect={(e) => {
                            e.preventDefault();
                          }}
                        >
                          <Trash2 className="size-4" />
                          Löschen
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent>
                  <Link
                    href={`/kampagnen/${c.id}`}
                    className="absolute inset-0 z-0 rounded-squircle-md"
                    aria-label={`${c.name} öffnen`}
                  />
                  <div className="relative z-10 flex items-center gap-2 flex-wrap pointer-events-none">
                    <Badge variant="brand">{modeLabel(c.mode)}</Badge>
                    <Badge variant="neutral">
                      {runCount} {runCount === 1 ? "Runde" : "Runden"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
