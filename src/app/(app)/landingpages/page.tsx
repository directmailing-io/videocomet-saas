import Link from "next/link";
import { LayoutTemplate, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { listUserTpls } from "@/lib/db/queries/landingPageTemplates";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const THEME_PREVIEW: Record<string, string> = {
  noir: "bg-gradient-to-br from-ink to-ink-soft",
  clean: "bg-gradient-to-br from-surface to-surface-muted border border-line",
  gradient: "bg-gradient-to-br from-brand to-brand-deep",
  warm: "bg-gradient-to-br from-warn to-brand",
};

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

export default async function LandingpagesPage() {
  const { user } = await requireUser();
  const items = await listUserTpls(user.id);

  return (
    <>
      <PageHeader
        title="Landingpage-Vorlagen"
        subtitle="Erstelle Themes fuer deine personalisierten Landingpages."
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((tpl) => {
            const preview = THEME_PREVIEW[tpl.themeId] ?? THEME_PREVIEW.clean;
            return (
              <Link
                key={tpl.id}
                href={`/landingpages/${tpl.id}`}
                className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded-squircle-md"
              >
                <Card hover>
                  <CardContent className="p-4">
                    <div
                      className={cn(
                        "aspect-[4/3] rounded-squircle-sm mb-3",
                        preview,
                      )}
                    />
                    <p className="text-base font-semibold text-ink truncate">
                      {tpl.name}
                    </p>
                    <p className="text-xs text-ink-muted mt-0.5">
                      Theme: {tpl.themeId} . {formatDate(tpl.createdAt)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
