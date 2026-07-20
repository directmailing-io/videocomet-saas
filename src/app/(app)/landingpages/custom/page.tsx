"use client";

/**
 * Custom-Landingpages — Listenseite (Client-Komponente).
 *
 * Spiegelbild zu `/landingpages` (block-basierte Vorlagen). Daten kommen
 * aus Agent As API (`GET /api/custom-lp`); wir holen sie clientseitig,
 * damit die Aktionen (Löschen, Duplizieren) ohne Server-Refresh-Tanz
 * funktionieren.
 *
 * Hinweis: die Tab-Variante ist auf `/landingpages` integriert — diese
 * Seite existiert als Deep-Link / Direkt-Aufruf.
 */

import * as React from "react";
import Link from "next/link";
import {
  FileArchive,
  Plus,
  Download,
  MoreVertical,
  Pencil,
  Trash2,
  ArrowLeft,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

interface CustomLpRow {
  id: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  versionCount: number;
  activeVersion: {
    id: string;
    version: number;
    uploadedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export default function CustomLpListPage() {
  const { toast } = useToast();
  const [items, setItems] = React.useState<CustomLpRow[] | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try {
      const res = await fetch("/api/custom-lp", { cache: "no-store" });
      if (!res.ok) {
        setItems([]);
        return;
      }
      const data = (await res.json()) as { templates?: CustomLpRow[] };
      setItems(Array.isArray(data.templates) ? data.templates : []);
    } catch {
      setItems([]);
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  async function onDelete(item: CustomLpRow) {
    const ok = window.confirm(`Vorlage "${item.name}" wirklich löschen?`);
    if (!ok) return;
    setPendingId(item.id);
    try {
      const res = await fetch(`/api/custom-lp/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast({
          title: "Löschen fehlgeschlagen",
          description: data.error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Vorlage gelöscht",
        description: `${item.name} wurde entfernt.`,
        variant: "success",
      });
      void reload();
    } catch {
      toast({
        title: "Löschen fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setPendingId(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  const isLoading = items === null;
  const isEmpty = items !== null && items.length === 0;

  return (
    <>
      <PageHeader
        title="Eigene HTML-Vorlagen"
        subtitle="Laden Sie Ihre eigenen ZIP-Pakete als Landingpage-Vorlage hoch."
        actions={
          <>
            <Button
              variant="ghost"
              asChild
              iconLeft={<ArrowLeft className="size-4" />}
            >
              <Link href="/landingpages">Übersicht</Link>
            </Button>
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
              <Link href="/landingpages/custom/neu">Neue Vorlage</Link>
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="opacity-60">
              <CardContent className="p-4">
                <div className="aspect-[4/3] rounded-squircle-sm mb-3 bg-surface-muted animate-pulse" />
                <div className="h-4 w-2/3 bg-surface-muted rounded animate-pulse mb-2" />
                <div className="h-3 w-1/2 bg-surface-muted rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : isEmpty ? (
        <EmptyState
          icon={<FileArchive />}
          title="Noch keine HTML-Vorlagen"
          subtitle="Laden Sie ein ZIP mit Ihrer eigenen Landingpage hoch. Wir prüfen die Inhalte und liefern sie personalisiert pro Lead auf lp.videocomet.de aus — wie eine ganz normale Webseite."
          action={
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Button asChild iconLeft={<Plus className="size-4" />}>
                <Link href="/landingpages/custom/neu">
                  Erste Vorlage anlegen
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                iconLeft={<Download className="size-4" />}
              >
                <a href="/api/custom-lp/starter-kit" download>
                  Starter-Kit herunterladen
                </a>
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {(items ?? []).map((tpl) => {
            const isPending = pendingId === tpl.id;
            return (
              <Card
                key={tpl.id}
                hover
                className={cn(
                  "relative group",
                  isPending && "opacity-60 pointer-events-none",
                )}
              >
                <Link
                  href={`/landingpages/custom/${tpl.id}`}
                  className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded-squircle-md"
                  aria-label={`Vorlage ${tpl.name} bearbeiten`}
                >
                  <CardContent className="p-4">
                    <div className="aspect-[4/3] rounded-squircle-sm mb-3 flex items-center justify-center bg-gradient-to-br from-brand-soft to-surface-muted text-brand-deep">
                      {tpl.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={tpl.thumbnailUrl}
                          alt=""
                          className="size-full object-cover rounded-squircle-sm"
                        />
                      ) : (
                        <FileArchive className="size-10 opacity-70" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-base font-semibold text-ink truncate flex-1 pr-8">
                        {tpl.name}
                      </p>
                      <Badge variant="brand">Custom HTML</Badge>
                    </div>
                    <p className="text-xs text-ink-muted">
                      {tpl.activeVersion
                        ? `v${tpl.activeVersion.version} aktiv`
                        : "Noch keine Version hochgeladen"}
                      {tpl.versionCount > 0 && (
                        <> · {tpl.versionCount} Version{tpl.versionCount === 1 ? "" : "en"}</>
                      )}
                      <> · {formatDate(tpl.createdAt)}</>
                    </p>
                  </CardContent>
                </Link>

                <div className="absolute top-3 right-3 z-10">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Aktionen"
                        className="inline-flex size-8 items-center justify-center rounded-full bg-surface/90 backdrop-blur shadow-card text-ink-muted hover:text-ink transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                      >
                        <MoreVertical className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/landingpages/custom/${tpl.id}`}>
                          <Pencil className="size-4" />
                          Öffnen
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        danger
                        onSelect={(e) => {
                          e.preventDefault();
                          void onDelete(tpl);
                        }}
                      >
                        <Trash2 className="size-4" />
                        Löschen
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </Card>
            );
          })}
        </div>
      )}

    </>
  );
}
