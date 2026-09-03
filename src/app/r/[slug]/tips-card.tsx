/**
 * TipsCard — kompakte, dezente Hinweis-Liste unterhalb des Recorders.
 *
 * Bewusst klein und unaufdringlich: das Video oben ist die Hauptaktion,
 * Tips sind sekundär. Daher: einspaltig (auf sm+ 2-spaltig), text-xs,
 * kleine Icons, surface-soft Hintergrund — kein "Karten-Look".
 */

import {
  Sparkles,
  HandMetal,
  Mic,
  Monitor,
  Smartphone,
  Smile,
  Users,
  Timer,
  Wallpaper,
} from "lucide-react";
import * as React from "react";

const TIPS: Array<{
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}> = [
  {
    icon: HandMetal,
    text: "Hände entspannt unten lassen, sonst verdecken sie später den Inhalt dahinter.",
  },
  {
    icon: Mic,
    text: "Authentisch sprechen, nicht ablesen.",
  },
  {
    icon: Smile,
    text: "Freundlich wirken, kurz lächeln.",
  },
  {
    icon: Users,
    text: "Stell dir EINEN Lead vor, sprich ihn direkt an.",
  },
  {
    icon: Timer,
    text: "Kurz halten, 20 bis 40 Sekunden reichen meist.",
  },
  {
    icon: Wallpaper,
    text: "Ruhiger Hintergrund, neutrale Kleidung.",
  },
];

export function TipsCard({
  orientation = null,
}: {
  orientation?: "landscape" | "portrait" | null;
}) {
  const tips =
    orientation === "portrait"
      ? [
          {
            icon: Smartphone,
            text: "Handy senkrecht halten, Kamera auf Augenhöhe.",
          },
          ...TIPS,
        ]
      : orientation === "landscape"
        ? [
            {
              icon: Monitor,
              text: "Am Rechner aufnehmen oder das Handy quer halten.",
            },
            ...TIPS,
          ]
        : TIPS;
  return (
    <aside className="mx-auto max-w-sm rounded-squircle-md bg-surface-soft px-4 py-3.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-brand-deep" />
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          Tipps für die Aufnahme
        </h2>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {tips.map(({ icon: Icon, text }) => (
          <li key={text} className="flex gap-2 text-xs leading-snug text-ink-muted">
            <Icon className="size-3.5 shrink-0 mt-0.5 text-brand-deep/70" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
