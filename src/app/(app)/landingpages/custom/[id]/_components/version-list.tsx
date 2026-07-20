"use client";

/**
 * Versions-Liste der Custom-LP-Vorlage.
 *
 * Zeigt alle bisher hochgeladenen Versionen (immutable) mit:
 *   - Versions-Nummer + Upload-Datum + Größe
 *   - "Aktiv"-Marker (`activeVersionId`)
 *   - Aktion "Als aktive Version setzen" (mit Update-Prompt-Dialog vom Parent)
 *
 * Die Liste wird typischerweise in einer Seitenleiste oder als Drawer
 * gerendert — wir liefern das Markup, der Parent regelt das Layout.
 */

import * as React from "react";
import { History, CheckCircle2, ArrowUpRightFromSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface VersionListItem {
  id: string;
  version: number;
  uploadedAt: string;
  bytesTotal: number;
  entryHtml: string;
  isActive: boolean;
}

interface VersionListProps {
  versions: VersionListItem[];
  /** Welche Version-ID gerade aktiv ist (für Hervorhebung). */
  activeVersionId: string | null;
  /** Wird beim Klick auf "Aktivieren" gerufen (Parent öffnet Update-Prompt). */
  onActivate: (version: VersionListItem) => void;
  /** Optional: lädt die Vorschau einer alten Version in den Picker. */
  onPreview?: (version: VersionListItem) => void;
}

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function VersionList({
  versions,
  activeVersionId,
  onActivate,
  onPreview,
}: VersionListProps) {
  if (versions.length === 0) {
    return (
      <Card>
        <CardContent className="p-5 text-center text-sm text-ink-muted">
          <History className="size-6 mx-auto mb-2 text-ink-muted opacity-60" />
          Noch keine Versionen hochgeladen.
        </CardContent>
      </Card>
    );
  }

  // Neueste zuerst
  const sorted = [...versions].sort((a, b) => b.version - a.version);

  return (
    <div className="space-y-2.5">
      {sorted.map((v) => {
        const isActive = v.isActive || v.id === activeVersionId;
        return (
          <Card
            key={v.id}
            className={cn(
              "transition-colors",
              isActive && "bg-brand-soft/40",
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-ink">
                      Version {v.version}
                    </p>
                    {isActive && (
                      <Badge variant="success" dot>
                        Aktiv
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-ink-muted">
                    {fmtDate(v.uploadedAt)} · {fmtBytes(v.bytesTotal)}
                  </p>
                  <p className="text-[11px] text-ink-muted font-mono mt-0.5 truncate">
                    {v.entryHtml}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  {onPreview && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onPreview(v)}
                      iconLeft={<ArrowUpRightFromSquare className="size-3.5" />}
                    >
                      Vorschau
                    </Button>
                  )}
                  {!isActive && (
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() => onActivate(v)}
                      iconLeft={<CheckCircle2 className="size-3.5" />}
                    >
                      Aktivieren
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
