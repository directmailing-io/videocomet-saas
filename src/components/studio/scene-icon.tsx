"use client";

/**
 * scene-icon — Typ-Icon einer Studio-Szene (geteilt von Regie, Live-Tabs
 * und Review-Liste).
 */

import * as React from "react";
import { FileText, FileType2, Globe, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudioSceneKind } from "./internal";

export function SceneKindIcon({
  kind,
  className,
}: {
  kind: StudioSceneKind | null;
  className?: string;
}) {
  const cls = cn("size-4", className);
  switch (kind) {
    case "website":
      return <Globe className={cls} />;
    case "gdocs":
      return <FileText className={cls} />;
    case "pdf":
      return <FileType2 className={cls} />;
    case "text":
    default:
      return <Type className={cls} />;
  }
}
