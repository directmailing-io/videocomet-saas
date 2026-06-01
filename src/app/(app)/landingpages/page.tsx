import Link from "next/link";
import { LayoutTemplate, Plus, Download } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { listUserTpls } from "@/lib/db/queries/landingPageTemplates";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LpList } from "./lp-list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Landingpage-Vorlagen Übersicht.
 *
 * Die Seite zeigt jetzt ZWEI Arten:
 *   - Block-basierte Vorlagen (das alte Modell, Theme + JSON-Inhalt)
 *   - Eigene HTML-Vorlagen (Custom-LP, ZIP-Upload — Agent A/B/C)
 *
 * Wir rendern beide in einem Tab-System. Die Custom-Liste wird clientseitig
 * vom Browser nachgeladen (LpList kümmert sich darum — siehe `customMode`).
 * Server-seitig lädt diese Page nur die Block-Vorlagen für den initialen
 * Render des "Block-Vorlagen"-Tabs.
 */
export default async function LandingpagesPage() {
  const { user } = await requireUser();
  const items = await listUserTpls(user.id);

  return (
    <>
      <PageHeader
        title="Landingpage-Vorlagen"
        subtitle="Verwalten Sie Block-basierte Vorlagen und Ihre eigenen HTML-Pakete."
        actions={
          <>
            <Button
              variant="ghost"
              asChild
              iconLeft={<Download className="size-4" />}
            >
              <a href="/api/custom-lp/starter-kit" download>
                Starter-Kit
              </a>
            </Button>
            <Button asChild iconLeft={<Plus className="size-4" />}>
              <Link href="/landingpages/neu">Neue Vorlage</Link>
            </Button>
          </>
        }
      />

      <LpList
        items={items.map((tpl) => ({
          id: tpl.id,
          name: tpl.name,
          themeId: tpl.themeId,
          content: (tpl.content ?? {}) as Record<string, unknown>,
          createdAt:
            tpl.createdAt instanceof Date
              ? tpl.createdAt.toISOString()
              : (tpl.createdAt ?? null),
        }))}
        emptyState={
          <EmptyState
            icon={<LayoutTemplate />}
            title="Noch keine Block-Vorlagen"
            subtitle="Legen Sie eine Block-basierte Vorlage mit Theme, Hero und CTA an — oder laden Sie ein eigenes HTML-Paket im Tab 'Eigene HTML-Vorlagen' hoch."
            action={
              <Button asChild iconLeft={<Plus className="size-4" />}>
                <Link href="/landingpages/neu">Erste Vorlage erstellen</Link>
              </Button>
            }
          />
        }
      />
    </>
  );
}
