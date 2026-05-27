import Link from "next/link";
import { LayoutTemplate, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { listUserTpls } from "@/lib/db/queries/landingPageTemplates";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LpList } from "./lp-list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LandingpagesPage() {
  const { user } = await requireUser();
  const items = await listUserTpls(user.id);

  return (
    <>
      <PageHeader
        title="Landingpage-Vorlagen"
        subtitle="Erstelle Themes für deine personalisierten Landingpages."
        actions={
          <Button asChild iconLeft={<Plus className="size-4" />}>
            <Link href="/landingpages/neu">Neue Vorlage</Link>
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<LayoutTemplate />}
          title="Noch keine Vorlagen"
          subtitle="Lege eine erste Landingpage-Vorlage an. Du kannst Theme, Farben und Inhalte vollstaendig anpassen."
          action={
            <Button asChild iconLeft={<Plus className="size-4" />}>
              <Link href="/landingpages/neu">Erste Vorlage erstellen</Link>
            </Button>
          }
        />
      ) : (
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
        />
      )}
    </>
  );
}
