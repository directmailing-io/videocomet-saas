"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Eye,
  Download,
  Copy,
  ExternalLink,
  Trash2,
} from "lucide-react";
import type { PreflightLead } from "./lead-card";

/**
 * Rechtsklick-Menü auf einer Lead-Karte. Vier User-Wünsche:
 *   - Details öffnen   (alte Lightbox)
 *   - Bild herunterladen
 *   - Website-URL kopieren
 *   - Website-URL im neuen Tab öffnen
 * Plus: "Lead entfernen" als praktische fünfte Aktion, weil Rechtsklick
 * der natürliche Ort dafür ist.
 *
 * Implementiert als Portal-Renderer an `clientX/clientY`, mit Click-
 * Outside-Close, Esc-Close und Edge-Clamp (rutscht nach links/oben, wenn
 * der Viewport-Rand kommt).
 */
export interface LeadContextMenuProps {
  lead: PreflightLead;
  position: { x: number; y: number };
  onClose: () => void;
  onOpenDetails: () => void;
  onRequestRemove: () => void;
  onToast: (msg: string, variant?: "success" | "danger") => void;
}

const MENU_WIDTH = 240;
const MENU_HEIGHT_ESTIMATE = 220;

export function LeadContextMenu({
  lead,
  position,
  onClose,
  onOpenDetails,
  onRequestRemove,
  onToast,
}: LeadContextMenuProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!mounted) return null;

  const url = lead.preflightFinalUrl ?? lead.websiteUrl;
  const screenshotUrl = lead.preflightScreenshotUrl;

  // Edge-Clamp damit das Menü nie aus dem Viewport rutscht.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
  const left = Math.min(position.x, vw - MENU_WIDTH - 8);
  const top = Math.min(position.y, vh - MENU_HEIGHT_ESTIMATE - 8);

  async function handleCopyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      onToast("URL kopiert.", "success");
    } catch {
      onToast("Kopieren fehlgeschlagen.", "danger");
    }
    onClose();
  }

  function handleOpenInTab() {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
    onClose();
  }

  async function handleDownloadImage() {
    if (!screenshotUrl) return;
    try {
      const res = await fetch(screenshotUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      const safeName =
        (lead.fullName || `${lead.firstName ?? ""}-${lead.lastName ?? ""}` || "lead")
          .toString()
          .replace(/[^a-zA-Z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .toLowerCase() || "lead";
      a.href = objectUrl;
      a.download = `${safeName}.webp`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      onToast("Bild gespeichert.", "success");
    } catch {
      onToast("Download fehlgeschlagen.", "danger");
    }
    onClose();
  }

  function handleDetails() {
    onOpenDetails();
    onClose();
  }

  function handleRemove() {
    onRequestRemove();
    onClose();
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ position: "fixed", left, top, width: MENU_WIDTH, zIndex: 100 }}
      className="rounded-squircle-sm bg-surface shadow-lg backdrop-blur-md py-1.5"
    >
      <MenuItem
        icon={<Eye className="size-4" />}
        label="Details öffnen"
        onClick={handleDetails}
      />
      <MenuItem
        icon={<Download className="size-4" />}
        label="Bild herunterladen"
        onClick={handleDownloadImage}
        disabled={!screenshotUrl}
      />
      <Separator />
      <MenuItem
        icon={<Copy className="size-4" />}
        label="URL kopieren"
        onClick={handleCopyUrl}
        disabled={!url}
        sublabel={url ?? "—"}
      />
      <MenuItem
        icon={<ExternalLink className="size-4" />}
        label="In neuem Tab öffnen"
        onClick={handleOpenInTab}
        disabled={!url}
      />
      <Separator />
      <MenuItem
        icon={<Trash2 className="size-4" />}
        label="Lead entfernen"
        onClick={handleRemove}
        variant="danger"
        disabled={Boolean(lead.removedAt)}
      />
    </div>,
    document.body,
  );
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  sublabel?: string;
  variant?: "default" | "danger";
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  sublabel,
  variant = "default",
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={[
        "w-full px-3 py-2 flex items-start gap-2.5 text-left rounded-sm transition-colors",
        "text-sm",
        disabled && "opacity-40 cursor-not-allowed",
        !disabled && variant === "default" && "hover:bg-line-soft text-ink",
        !disabled && variant === "danger" && "hover:bg-danger-soft text-danger",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="shrink-0 mt-0.5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {sublabel ? (
          <span className="block truncate text-[11px] text-ink-muted font-mono">
            {sublabel}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function Separator() {
  return <div className="my-1 mx-2 h-px bg-line-soft" />;
}
