"use client";

/**
 * scene-icon — Typ-Icon einer Studio-Szene (geteilt von Regie, Live-Tabs
 * und Review-Liste).
 */

import * as React from "react";
import {
  FileText,
  FileType2,
  Globe,
  Globe2,
  Image as ImageIcon,
  MonitorUp,
  PlaySquare,
  Presentation,
  Type,
} from "lucide-react";
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
    case "ownsite":
      return <Globe2 className={cls} />;
    case "gdocs":
      return <FileText className={cls} />;
    case "gslide":
      return <Presentation className={cls} />;
    case "canva":
      return <MonitorUp className={cls} />;
    case "pdf":
      return <FileType2 className={cls} />;
    case "image":
      return <ImageIcon className={cls} />;
    case "video":
      return <PlaySquare className={cls} />;
    case "text":
    default:
      return <Type className={cls} />;
  }
}
