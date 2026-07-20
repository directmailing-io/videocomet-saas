"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Copy,
  MoreVertical,
  Pencil,
  Trash2,
  FileArchive,
  LayoutTemplate,
  Plus,
  Download,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

interface LpListItem {
  id: string;
  name: string;
  themeId: string;
  content: Record<string, unknown>;
  createdAt: string | null;
}

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

/**
 * Theme swatches for the block-template cards.
 */
const THEME_SWATCH: Record<string, { bg: string; accent: string }> = {
  noir: { bg: "#07070f", accent: "#818cf8" },
  clean: { bg: "#ffffff", accent: "#2563eb" },
  gradient: {
    bg: "linear-gradient(135deg, #a855f7, #6366f1 55%, #2563eb)",
    accent: "#f59e0b",
  },
  warm: { bg: "#fdf8f3", accent: "#c2622c" },
};

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

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Two-tab list: Block-Vorlagen + Custom HTML-Vorlagen.
 *
 * Custom-Liste wird beim Mount des Custom-Tabs lazy geladen (kein doppelter
 * Server-Roundtrip beim ersten Seitenaufruf wenn der Kunde nur Block-Vorlagen
 * anschauen will).
 */
export function LpList({
  items,
  emptyState,
}: {
  items: LpListItem[];
  emptyState?: React.ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<"block" | "custom">("block");

  // ── Custom-LP lazy load ─────────────────────────────────────────────────
  const [customItems, setCustomItems] = React.useState<CustomLpRow[] | null>(
    null,
  );
  const loadCustom = React.useCallback(async () => {
    try {
      const res = await fetch("/api/custom-lp", { cache: "no-store" });
      if (!res.ok) {
        setCustomItems([]);
        return;
      }
      const data = (await res.json()) as { templates?: CustomLpRow[] };
      setCustomItems(Array.isArray(data.templates) ? data.templates : []);
    } catch {
      setCustomItems([]);
    }
  }, []);

  React.useEffect(() => {
    if (tab === "custom" && customItems === null) {
      void loadCustom();
    }
  }, [tab, customItems, loadCustom]);

  // ── Block-Vorlagen Aktionen ─────────────────────────────────────────────
  async function onDuplicate(item: LpListItem) {
    setPendingId(item.id);
    try {
      const res = await fetch("/api/landing-page-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `${item.name} (Kopie)`,
          themeId: item.themeId,
          content: item.content,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: "Duplizieren fehlgeschlagen",
          description: data.error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Vorlage dupliziert",
        description: `${item.name} wurde kopiert.`,
        variant: "success",
      });
      const newId = data.template?.id;
      if (newId) {
        router.push(`/landingpages/${newId}`);
      } else {
        router.refresh();
      }
    } catch {
      toast({
        title: "Duplizieren fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setPendingId(null);
    }
  }

  async function onDelete(item: LpListItem) {
    const confirmed = window.confirm(
      `Vorlage "${item.name}" wirklich löschen?`,
    );
    if (!confirmed) return;
    setPendingId(item.id);
    try {
      const res = await fetch(`/api/landing-page-templates/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
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
      router.refresh();
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

  // ── Custom-LP Aktionen ──────────────────────────────────────────────────
  async function onDeleteCustom(item: CustomLpRow) {
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
      void loadCustom();
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

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "block" | "custom")}>
      <TabsList>
        <TabsTrigger value="block">
          Block-Vorlagen
          <Badge variant="neutral" className="ml-2">
            {items.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="custom">
          Eigene HTML-Vorlagen
          {customItems !== null && (
            <Badge variant="neutral" className="ml-2">
              {customItems.length}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      {/* ── Block-Vorlagen ──────────────────────────────────────────────── */}
      <TabsContent value="block">
        {items.length === 0
          ? (emptyState ?? (
              <EmptyState
                icon={<LayoutTemplate />}
                title="Noch keine Block-Vorlagen"
                subtitle="Legen Sie eine erste Vorlage an."
                action={
                  <Button asChild iconLeft={<Plus className="size-4" />}>
                    <Link href="/landingpages/neu">Erste Vorlage erstellen</Link>
                  </Button>
                }
              />
            ))
          : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {items.map((tpl) => {
                const swatch = THEME_SWATCH[tpl.themeId] ?? THEME_SWATCH.clean!;
                const bgOverride = asString(tpl.content.bgColor);
                const accentOverride = asString(tpl.content.accentColor);
                const bg = bgOverride || swatch.bg;
                const accent = accentOverride || swatch.accent;
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
                      href={`/landingpages/${tpl.id}`}
                      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded-squircle-md"
                      aria-label={`Vorlage ${tpl.name} bearbeiten`}
                    >
                      <CardContent className="p-4">
                        <div
                          className="aspect-[4/3] rounded-squircle-sm mb-3 flex items-end justify-start p-3 ring-1 ring-inset ring-ink/5"
                          style={{ background: bg }}
                        >
                          <span
                            className="size-6 rounded-full shadow-sm"
                            style={{ background: accent }}
                          />
                        </div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-base font-semibold text-ink truncate flex-1 pr-8">
                            {tpl.name}
                          </p>
                          <Badge variant="neutral">Block</Badge>
                        </div>
                        <p className="text-xs text-ink-muted mt-0.5">
                          Theme: {tpl.themeId} · {formatDate(tpl.createdAt)}
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
                            <Link href={`/landingpages/${tpl.id}`}>
                              <Pencil className="size-4" />
                              Bearbeiten
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={(e) => {
                              e.preventDefault();
                              void onDuplicate(tpl);
                            }}
                          >
                            <Copy className="size-4" />
                            Duplizieren
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
      </TabsContent>

      {/* ── Eigene HTML-Vorlagen ─────────────────────────────────────────── */}
      <TabsContent value="custom">
        {customItems === null ? (
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
        ) : customItems.length === 0 ? (
          <EmptyState
            icon={<FileArchive />}
            title="Noch keine HTML-Vorlagen"
            subtitle="Laden Sie ein ZIP mit Ihrer eigenen, statischen Landingpage hoch. Wir validieren, sandboxen und liefern sie personalisiert pro Lead aus."
            action={
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Button asChild iconLeft={<Plus className="size-4" />}>
                  <Link href="/landingpages/custom/neu">
                    Erste HTML-Vorlage anlegen
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
          <>
            <div className="flex items-center justify-end mb-4 gap-2">
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
                <Link href="/landingpages/custom/neu">
                  Neue HTML-Vorlage
                </Link>
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {customItems.map((tpl) => {
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
                            <>
                              {" · "}
                              {tpl.versionCount} Version
                              {tpl.versionCount === 1 ? "" : "en"}
                            </>
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
                              void onDeleteCustom(tpl);
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
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}
