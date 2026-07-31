"use client";

import * as React from "react";
import {
  FileText,
  Image as ImageIcon,
  Info,
  Plus,
  Presentation,
  Video as VideoIcon,
  type LucideIcon,
} from "lucide-react";
import type { Player as PlayerType, PlayerRef } from "@remotion/player";
import { cn } from "@/lib/utils";
import MarketingDemoComposition, {
  DEMO_FPS,
  DEMO_DURATION_IN_FRAMES,
  DEMO_WIDTH,
  DEMO_HEIGHT,
  type DemoLead,
} from "./remotion/MarketingDemoComposition";

export type DemoMode = "screenshot" | "slides" | "gdocs" | "solo";

function PlayerSkeleton() {
  return <div className="absolute inset-0 bg-black animate-pulse" />;
}

// Manuell client-seitig geladen statt via next/dynamic: dessen Loadable-
// Wrapper ist eine Function-Component ohne forwardRef, wodurch `playerRef`
// nie attached und der Force-Play-Effekt ins Leere läuft.
function usePlayerComponent() {
  const [PlayerComp, setPlayerComp] = React.useState<typeof PlayerType | null>(
    null,
  );
  React.useEffect(() => {
    let cancelled = false;
    import("@remotion/player").then((m) => {
      if (!cancelled) setPlayerComp(() => m.Player);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return PlayerComp;
}

const LEADS: ReadonlyArray<DemoLead> = [
  {
    id: "max",
    firstName: "Max",
    fullName: "Max Mustermann",
    salutation: "Herr Mustermann",
    initials: "MM",
    company: "Mustermann Industrie GmbH",
    location: "München",
    domain: "mustermann-industrie.de",
    screenshot: "/demo-assets/website-max.png",
    industryLabel: "Maschinenbau",
    errors: [
      {
        title: "Kein Datenblatt zum Download",
        body: "Einkäufer wollen vor der Anfrage ein PDF mit Drehmoment, Spannweite und Wartungsintervallen. Bei dir landen sie auf einer Marketing-Seite, und du verlierst die E-Mail-Adresse. Ein Datenblatt gegen E-Mail, fertig in zwei Stunden, bringt typisch drei bis fünf Mal mehr qualifizierte Anfragen.",
      },
      {
        title: "Keine Spec-Sheets pro Anlage",
        body: "Ingenieure bauen Excel-Vergleichslisten, bevor sie anrufen. Bei dir stehen nur Werbesätze, keine Zahlen. Drei Spec-PDFs für deine Top-Anlagen reichen, damit du in diesen Listen überhaupt auftauchst.",
      },
      {
        title: "Stockfoto-Maschine im Hero-Bild",
        body: "Das Hero-Bild ist eine Shutterstock-Schweißanlage und passt nicht zu eurem Portfolio. Maschinenbauer sehen das in zwei Sekunden und scrollen weiter zur Konkurrenz. Ein halber Tag Foto-Shooting bei euch in München, einmal gemacht, hält jahrelang.",
      },
    ],
  },
  {
    id: "lisa",
    firstName: "Lisa",
    fullName: "Lisa Lust",
    salutation: "Frau Lust",
    initials: "LL",
    company: "Lust Cosmetics GmbH",
    location: "Hamburg",
    domain: "lust-cosmetics.de",
    screenshot: "/demo-assets/website-lisa.png",
    industryLabel: "Naturkosmetik",
    errors: [
      {
        title: "Kein Hauttyp-Quiz beim Einstieg",
        body: "Sieben von zehn Besucherinnen wissen nicht, welche Pflege-Linie zu ihrer Haut passt. Ohne Quiz scrollen sie ratlos durch die Produktliste und springen ab. Vier Klicks reichen: Hauttyp, Probleme, Routine, Empfehlung. Bei vergleichbaren Brands verdoppelt das die Conversion.",
      },
      {
        title: "Keine echten Kundinnen-Fotos",
        body: "Auf den Produktseiten siehst du nur Rendering-Shots der Tiegel. Käuferinnen brauchen echte Hände, echte Texturen, echte Hauttypen. Eine Hashtag-Aktion mit dem Probier-Set bringt dir in zwei Wochen über 40 ehrliche Instagram-Fotos. Drei davon im Slider reichen.",
      },
      {
        title: "Konsistenz der Cremes unsichtbar",
        body: "Du schreibst „cremig wie Butter“ und „leichtes Gel“. Zeigst es aber nicht. Drei Close-Up-Fotos auf dem Handrücken: Pumpstoß, Verteilen, Einziehen. Macht aus dem Versprechen einen Beweis. 800 Euro Shoot, drei Stunden Aufwand, sofort spürbar bei Add-to-Cart.",
      },
    ],
  },
  {
    id: "franz",
    firstName: "Franz",
    fullName: "Franz Friedrich",
    salutation: "Herr Friedrich",
    initials: "FF",
    company: "Friedrich Manufaktur",
    location: "Köln",
    domain: "friedrich-manufaktur.de",
    screenshot: "/demo-assets/website-franz.png",
    industryLabel: "Manufaktur",
    errors: [
      {
        title: "Keine echten Werkstatt-Bilder",
        body: "Auf „Manufaktur“ sehe ich ein Stockfoto einer fremden Werkstatt und ein Bild von Wilhelm aus 1985. Käufer eines 4.200-Euro-Sekretärs wollen sehen, wo das Stück heute entsteht: Hände, Werkzeuge, Holzspäne, das Atelier am Vormittag. Zwei Stunden Foto-Reportage vor Ort, einmal gemacht, hält jahrelang.",
      },
      {
        title: "Materialherkunft wird nicht erzählt",
        body: "Du arbeitest mit Eiche aus dem Bergischen Land und pflanzlich gegerbtem Leder. Das steht aber nirgendwo. Premium-Käufer kaufen Geschichten: wo der Baum stand, welcher Gerber das Leder veredelt hat, warum dieses Messing. Drei Absätze pro Material verdoppeln die wahrgenommene Wertigkeit ohne einen Cent zusätzliche Kosten.",
      },
      {
        title: "Lieferzeit komplett intransparent",
        body: "Bei einem 6.800-Euro-Bibliothekstisch will der Käufer wissen: sechs Wochen oder sechs Monate? Bei dir steht keine Zahl. Drei Punkte reichen: Anfrage, Skizze in sieben Tagen, Fertigung in acht Wochen. Räumt Bauchschmerzen aus, bevor sie entstehen.",
      },
    ],
  },
];

const MODES: ReadonlyArray<{ value: DemoMode; label: string; icon: LucideIcon }> = [
  { value: "screenshot", label: "Website", icon: ImageIcon },
  { value: "slides", label: "Folien", icon: Presentation },
  { value: "gdocs", label: "Google Docs", icon: FileText },
  { value: "solo", label: "Nur Webcam", icon: VideoIcon },
];

const AVATAR_GRADIENTS: Record<string, string> = {
  max: "linear-gradient(135deg, #7C5CE8, #5232C7)",
  lisa: "linear-gradient(135deg, #EC4899, #BE185D)",
  franz: "linear-gradient(135deg, #F97316, #C2410C)",
};

const PRELOAD_IMAGES = [
  ...LEADS.map((l) => l.screenshot),
  "/demo-assets/slide-2.png",
  "/demo-assets/slide-3.png",
  "/demo-assets/slide-4.png",
];

export function DemoPlayer() {
  const [mode, setMode] = React.useState<DemoMode>("screenshot");
  const [leadId, setLeadId] = React.useState<string>(LEADS[0].id);
  const [scrollEnabled, setScrollEnabled] = React.useState(false);
  const playerRef = React.useRef<PlayerRef>(null);
  const Player = usePlayerComponent();

  const lead = React.useMemo(
    () => LEADS.find((l) => l.id === leadId) ?? LEADS[0],
    [leadId],
  );
  const canScroll = mode === "screenshot" || mode === "gdocs";

  // Preload images so background switches are instant
  React.useEffect(() => {
    PRELOAD_IMAGES.forEach((src) => {
      const img = new window.Image();
      img.src = src;
    });
  }, []);

  // Force-start playback. Remotion Player's `autoPlay` prop is unreliable in
  // some browsers (Safari + strict Chrome policies). Player is permanently
  // muted, play() works without user gesture.
  React.useEffect(() => {
    const tryPlay = () => {
      const p = playerRef.current;
      if (!p) return;
      try {
        p.mute();
        p.play();
      } catch {
        /* noop — Player may not be ready yet */
      }
    };
    tryPlay();
    const t1 = window.setTimeout(tryPlay, 300);
    const t2 = window.setTimeout(tryPlay, 1000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [Player]);

  return (
    <div className="flex flex-col gap-5">
      {/* Empfänger-Tabs — außerhalb des Editors */}
      <div
        role="tablist"
        aria-label="Video pro Empfänger"
        className="flex items-center gap-2 overflow-x-auto pb-1"
      >
        {LEADS.map((l) => {
          const active = l.id === leadId;
          return (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setLeadId(l.id)}
              className={cn(
                "flex items-center gap-2.5 shrink-0 pl-1.5 pr-4 py-1.5 rounded-full text-[13px] font-medium transition-all",
                active
                  ? "bg-ink text-white shadow-ink"
                  : "bg-white/70 border border-white/80 text-ink-soft shadow-[0_2px_10px_-4px_rgba(80,60,150,0.2)] hover:bg-white hover:text-ink",
              )}
            >
              <span
                className="size-7 shrink-0 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                style={{ background: AVATAR_GRADIENTS[l.id] }}
                aria-hidden
              >
                {l.initials}
              </span>
              <span className="whitespace-nowrap">Video für {l.fullName}</span>
            </button>
          );
        })}
        <span
          aria-hidden
          className="flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 text-[13px] text-ink-muted/70 select-none"
        >
          <Plus className="size-4" />
          <span className="whitespace-nowrap">weitere Empfänger</span>
        </span>
      </div>

      {/* Editor-Fenster — hell, minimal */}
      <div className="rounded-3xl bg-white border border-line overflow-hidden shadow-[0_30px_80px_-30px_rgba(60,40,130,0.35),0_8px_28px_-14px_rgba(60,40,130,0.2)]">
        {/* Titelleiste */}
        <div className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-line bg-surface-soft">
          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="size-3 rounded-full bg-[#FF5F57]" />
            <span className="size-3 rounded-full bg-[#FEBC2E]" />
            <span className="size-3 rounded-full bg-[#28C840]" />
          </div>
          <div className="flex-1 flex justify-center min-w-0">
            <span className="text-[12px] text-ink-muted truncate">
              VIDEOCOMET Editor — Kampagne „Neukunden Q3“
            </span>
          </div>
          <span
            className="hidden sm:inline-flex items-center rounded-full bg-ink text-white text-[11px] font-semibold px-3 py-1.5"
            aria-hidden
          >
            Videos generieren
          </span>
        </div>

        <div className="p-4 md:p-6 flex flex-col gap-4 md:gap-5">
          {/* Canvas */}
          <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black ring-1 ring-line">
            {Player ? (
              <Player
                ref={playerRef}
                component={MarketingDemoComposition}
                inputProps={{ mode, scrollEnabled, lead }}
                durationInFrames={DEMO_DURATION_IN_FRAMES}
                fps={DEMO_FPS}
                compositionWidth={DEMO_WIDTH}
                compositionHeight={DEMO_HEIGHT}
                autoPlay
                loop
                controls={false}
                acknowledgeRemotionLicense
                style={{ width: "100%", height: "100%" }}
              />
            ) : (
              <PlayerSkeleton />
            )}
          </div>

          {/* Sequenz-Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-ink-muted mr-1">
              Video-Sequenz
            </span>
            <div
              role="radiogroup"
              aria-label="Video-Sequenz auswählen"
              className="flex flex-wrap items-center gap-1.5"
            >
              {MODES.map((m) => {
                const Icon = m.icon;
                const active = mode === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setMode(m.value)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                      active
                        ? "bg-ink text-white shadow-ink"
                        : "bg-surface-muted text-ink-soft hover:bg-surface-soft hover:text-ink",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    {m.label}
                  </button>
                );
              })}
            </div>

            {canScroll ? (
              <button
                type="button"
                onClick={() => setScrollEnabled((v) => !v)}
                aria-pressed={scrollEnabled}
                className="ml-auto inline-flex items-center gap-2 px-1 py-1.5 text-[12.5px] font-medium text-ink-soft hover:text-ink transition-colors"
              >
                Scrollen aktivieren
                <span
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors",
                    scrollEnabled ? "bg-brand" : "bg-ink/15",
                  )}
                  aria-hidden
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-4 rounded-full bg-white shadow transition-all",
                      scrollEnabled ? "left-[18px]" : "left-0.5",
                    )}
                  />
                </span>
              </button>
            ) : null}
          </div>

          <EditorTimeline
            mode={mode}
            durationSeconds={DEMO_DURATION_IN_FRAMES / DEMO_FPS}
          />
        </div>
      </div>

      {canScroll && scrollEnabled ? (
        <div className="mx-auto max-w-2xl rounded-squircle-md border border-warn/30 bg-warn-soft px-4 py-3 text-xs text-ink-soft flex items-start gap-2.5">
          <Info className="size-4 text-warn shrink-0 mt-0.5" aria-hidden />
          <span>
            <strong className="text-ink font-semibold">
              Hinweis zur Demo:
            </strong>{" "}
            Das Scroll-Verhalten hier ist generiert und wirkt etwas
            mechanisch. In deinem echten Video zeichnest du das Scrollen
            vorab einmal selbst auf. Dadurch sieht es natürlich aus.
          </span>
        </div>
      ) : (
        <p className="text-center text-xs text-ink-muted max-w-2xl mx-auto leading-relaxed">
          Für jeden Lead ein eigenes, persönliches Video. Du kannst auch
          mehrere Ansichten in einem Video kombinieren: erst die Webseite,
          dann ein Google Doc, dann eine Folie.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor-Timeline — dekorativ, Playhead läuft synchron zur Loop-Dauer
// ---------------------------------------------------------------------------

function EditorTimeline({
  mode,
  durationSeconds,
}: {
  mode: DemoMode;
  durationSeconds: number;
}) {
  const rulerMarks = [0, 5, 10, 15, 20];

  return (
    <div aria-hidden className="select-none">
      {/* Zeitleiste */}
      <div className="relative ml-[88px] mb-1 flex justify-between text-[9px] font-medium text-ink-muted/70 tabular-nums">
        {rulerMarks.map((s) => (
          <span key={s}>{s}s</span>
        ))}
      </div>

      <div className="relative">
        <div className="flex flex-col gap-1.5">
          <TimelineTrack label="Webcam-Video">
            <div
              className="h-full rounded-md"
              style={{
                width: "100%",
                background: "linear-gradient(90deg, #7C5CE8, #9573EE)",
              }}
            />
          </TimelineTrack>

          {mode !== "solo" ? (
            <TimelineTrack label="Bildschirm">
              <div
                className="h-full rounded-md"
                style={{
                  width: "100%",
                  background: "linear-gradient(90deg, #0EA5E9, #38BDF8)",
                }}
              />
            </TimelineTrack>
          ) : null}
        </div>

        {/* Playhead: läuft synchron zur Videodauer über die Track-Fläche */}
        <div className="absolute top-[-14px] bottom-0 left-[88px] right-0 pointer-events-none">
          <div
            key={`${mode}-${durationSeconds}`}
            className="vc-playhead absolute top-0 bottom-0 left-0 w-px bg-ink/60"
            style={{
              animation: `vc-playhead-run ${durationSeconds}s linear infinite`,
            }}
          >
            <span className="absolute -top-[3px] left-1/2 -translate-x-1/2 size-2 rounded-full bg-ink" />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes vc-playhead-run {
          0%   { left: 0%; }
          100% { left: 100%; }
        }
      `}</style>
    </div>
  );
}

function TimelineTrack({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[76px] shrink-0 text-right text-[10px] font-medium text-ink-muted truncate">
        {label}
      </span>
      <div className="flex-1 h-7 rounded-md bg-ink/[0.05] overflow-hidden">
        {children}
      </div>
    </div>
  );
}
