"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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

/**
 * Theme swatches for the list-page card thumbnails. Kept consistent with
 * the editor's theme picker but expressed as inline-style backgrounds so
 * we can render arbitrary gradients without a Tailwind plugin.
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

export function LpList({ items }: { items: LpListItem[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

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
      `Vorlage "${item.name}" wirklich loeschen?`,
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
          title: "Loeschen fehlgeschlagen",
          description: data.error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Vorlage geloescht",
        description: `${item.name} wurde entfernt.`,
        variant: "success",
      });
      router.refresh();
    } catch {
      toast({
        title: "Loeschen fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
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
                  className="aspect-[4/3] rounded-squircle-sm mb-3 flex items-end justify-start p-3 border border-line"
                  style={{ background: bg }}
                >
                  <span
                    className="size-6 rounded-full shadow-sm"
                    style={{ background: accent }}
                  />
                </div>
                <p className="text-base font-semibold text-ink truncate pr-8">
                  {tpl.name}
                </p>
                <p className="text-xs text-ink-muted mt-0.5">
                  Theme: {tpl.themeId} . {formatDate(tpl.createdAt)}
                </p>
              </CardContent>
            </Link>

            {/* Action dropdown floats above the card link so clicks on the
                trigger don't navigate. The DropdownMenu portal handles
                positioning, and the trigger has its own focus ring. */}
            <div className="absolute top-3 right-3 z-10">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Aktionen"
                    className="inline-flex size-8 items-center justify-center rounded-full bg-surface/90 backdrop-blur border border-line text-ink-muted hover:text-ink hover:border-brand/40 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
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
                    Loeschen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
