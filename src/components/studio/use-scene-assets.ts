"use client";

/**
 * use-scene-assets — lädt Vorschau-Assets für Studio-Szenen im Hintergrund.
 *
 * Website + Google Docs laufen über die Screenshot-Queue
 * (`fetchSegmentPreview`, Modul-Cache dedupliziert Jobs); die permanenten
 * Bunny-URLs werden direkt in den Segment-Draft persistiert
 * (previewImageUrl/-Width/-Height bzw. previewPageUrls/previewDocWidth/
 * -Height). PDF-Szenen entstehen erst NACH dem Upload und sind sofort
 * bereit; Text-Folien brauchen keine Assets.
 */

import * as React from "react";
import { fetchSegmentPreview } from "@/components/editor/use-segment-preview";
import type { StudioTab } from "@/lib/studio/types";
import { isTabReady, type UpdateSegmentFn } from "./internal";

export type SceneAssetStatus = "loading" | "ready" | "error";

export interface UseSceneAssetsResult {
  /** Status pro Tab-ID. */
  statusById: Record<string, SceneAssetStatus>;
  /** Fehlermeldung pro Tab-ID (nur bei status === "error"). */
  errorById: Record<string, string>;
  /** „Erneut versuchen" für eine fehlgeschlagene Szene. */
  retry: (tabId: string) => void;
  /** true, wenn ≥1 Szene existiert und ALLE bereit sind. */
  allReady: boolean;
}

/** URL, über die die Vorschau einer Szene erzeugt wird (null = keine nötig). */
function previewSourceUrl(tab: StudioTab): string | null {
  const seg = tab.segment;
  if (seg.kind === "website") return seg.fallbackUrl.trim() || null;
  if (seg.kind === "gdocs") return seg.docsUrl.trim() || null;
  return null;
}

export function useSceneAssets(
  tabs: StudioTab[],
  updateSegment: UpdateSegmentFn,
): UseSceneAssetsResult {
  const [errorById, setErrorById] = React.useState<Record<string, string>>({});
  const [, setLoadTick] = React.useState(0);
  /** Aktive Ladevorgänge (verhindert Doppel-Starts bei Re-Renders). */
  const inflightRef = React.useRef<Set<string>>(new Set());
  const mountedRef = React.useRef(true);
  /** Nonce, um nach retry() den Lade-Effekt erneut anzustoßen. */
  const [retryNonce, setRetryNonce] = React.useState(0);

  const updateSegmentRef = React.useRef(updateSegment);
  React.useEffect(() => {
    updateSegmentRef.current = updateSegment;
  }, [updateSegment]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    for (const tab of tabs) {
      if (isTabReady(tab)) continue;
      if (inflightRef.current.has(tab.id)) continue;
      if (errorById[tab.id]) continue;

      const url = previewSourceUrl(tab);
      if (!url) {
        setErrorById((prev) => ({
          ...prev,
          [tab.id]: "Keine URL hinterlegt.",
        }));
        continue;
      }

      inflightRef.current.add(tab.id);
      setLoadTick((t) => t + 1);
      const tabId = tab.id;
      const kind = tab.segment.kind;

      void fetchSegmentPreview(url)
        .then((data) => {
          if (!mountedRef.current) return;
          if (kind === "website") {
            if (!data.imageUrl) {
              throw new Error("Vorschau-Antwort ohne Screenshot.");
            }
            updateSegmentRef.current(tabId, (seg) =>
              seg.kind === "website"
                ? {
                    ...seg,
                    previewImageUrl: data.imageUrl,
                    previewImageWidth: data.width,
                    previewImageHeight: data.height,
                  }
                : seg,
            );
          } else if (kind === "gdocs") {
            if (!data.pageImageUrls || data.pageImageUrls.length === 0) {
              throw new Error("Vorschau-Antwort ohne Seiten-Bilder.");
            }
            updateSegmentRef.current(tabId, (seg) =>
              seg.kind === "gdocs"
                ? {
                    ...seg,
                    previewPageUrls: data.pageImageUrls,
                    previewDocWidth: data.docWidth,
                    previewDocHeight: data.docHeight,
                  }
                : seg,
            );
          }
        })
        .catch((err: unknown) => {
          if (!mountedRef.current) return;
          setErrorById((prev) => ({
            ...prev,
            [tabId]:
              err instanceof Error ? err.message : "Vorschau fehlgeschlagen.",
          }));
        })
        .finally(() => {
          inflightRef.current.delete(tabId);
          if (mountedRef.current) setLoadTick((t) => t + 1);
        });
    }
  }, [tabs, errorById, retryNonce]);

  const retry = React.useCallback((tabId: string) => {
    setErrorById((prev) => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    setRetryNonce((n) => n + 1);
  }, []);

  const statusById = React.useMemo(() => {
    const map: Record<string, SceneAssetStatus> = {};
    for (const tab of tabs) {
      if (isTabReady(tab)) map[tab.id] = "ready";
      else if (errorById[tab.id]) map[tab.id] = "error";
      else map[tab.id] = "loading";
    }
    return map;
  }, [tabs, errorById]);

  const allReady =
    tabs.length > 0 && tabs.every((t) => statusById[t.id] === "ready");

  return { statusById, errorById, retry, allReady };
}
