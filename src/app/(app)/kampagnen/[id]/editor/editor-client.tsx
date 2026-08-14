"use client";

/**
 * Client-Hülle für den Editor-Re-Entry: hält Segments + PiP-Einstellungen
 * als State, rendert den bekannten Wizard-Schritt-3-Editor und speichert
 * per PATCH /api/campaigns/[id]. Dirty-Guard via beforeunload.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Save } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import type { Segment } from "@/lib/segments/types";
import { WizardStep3Editor } from "@/app/(app)/kampagnen/neu/wizard-step3-editor";

export interface EditorClientProps {
  campaignId: string;
  campaignName: string;
  initialSegments: Segment[];
  initialPipPosition: "bottom-left" | "bottom-right";
  initialPipShape: "square" | "rounded" | "circle";
  webcamUrl: string | null;
  webcamDurationSec: number | null;
  mediaItems: Array<{
    id: string;
    name: string;
    publicUrl: string;
    type: string;
  }>;
  /** Anzahl Runden in laufenden Status (mapping…generating) → Warn-Banner. */
  activeRunCount: number;
}

export function EditorClient({
  campaignId,
  campaignName,
  initialSegments,
  initialPipPosition,
  initialPipShape,
  webcamUrl,
  webcamDurationSec,
  mediaItems,
  activeRunCount,
}: EditorClientProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [segments, setSegments] = React.useState<Segment[]>(initialSegments);
  const [pipPosition, setPipPosition] = React.useState<
    "bottom-left" | "bottom-right"
  >(initialPipPosition);
  const [pipShape, setPipShape] = React.useState<
    "square" | "rounded" | "circle"
  >(initialPipShape);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Dirty-Guard: Browser-Navigation/Tab-Schließen mit ungespeicherten
  // Änderungen abfangen (Standard-Browser-Dialog).
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome verlangt returnValue für den Dialog.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments, pipPosition, pipShape }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast({
          title: "Speichern fehlgeschlagen",
          description: data.error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      setDirty(false);
      toast({
        title: "Video-Editor gespeichert",
        description: "Die Segment-Timeline wurde aktualisiert.",
        variant: "success",
      });
      router.refresh();
    } catch {
      toast({
        title: "Speichern fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={campaignName}
        subtitle="Video-Editor: Segment-Timeline und Bild-in-Bild anpassen."
        actions={
          <>
            <Button
              variant="ghost"
              asChild
              iconLeft={<ArrowLeft className="size-4" />}
            >
              <Link href={`/kampagnen/${campaignId}`}>Zurück</Link>
            </Button>
            <Button
              onClick={() => {
                void save();
              }}
              loading={saving}
              disabled={saving}
              iconLeft={<Save className="size-4" />}
            >
              Speichern
            </Button>
          </>
        }
      />

      {activeRunCount > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-squircle-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-ink">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-warn" />
          <p>
            Laufende Runde: Bereits gerenderte Videos bleiben unverändert,
            noch ausstehende Leads verwenden den neuen Stand.
          </p>
        </div>
      )}

      <WizardStep3Editor
        segments={segments}
        pipPosition={pipPosition}
        pipShape={pipShape}
        webcamUrl={webcamUrl}
        webcamDurationSec={webcamDurationSec}
        mediaItems={mediaItems}
        onSegmentsChange={(next) => {
          setSegments(next);
          setDirty(true);
        }}
        onPipPositionChange={(pos) => {
          setPipPosition(pos);
          setDirty(true);
        }}
        onPipShapeChange={(shape) => {
          setPipShape(shape);
          setDirty(true);
        }}
      />
    </>
  );
}
