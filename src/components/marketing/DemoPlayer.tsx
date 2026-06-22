"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import { Info } from "lucide-react";
import type { Player as PlayerType, PlayerRef } from "@remotion/player";
import { cn } from "@/lib/utils";
import { DemoToggleGroup } from "./DemoToggleGroup";
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

// `next/dynamic` widens the generic Player signature to a non-generic one,
// which loses the link between `component` and `inputProps`. We cast back to
// the original Player type so TS can still infer the prop type from the
// composition component.
const Player = dynamic(
  () => import("@remotion/player").then((m) => m.Player),
  {
    ssr: false,
    loading: () => <PlayerSkeleton />,
  },
) as unknown as typeof PlayerType;

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

function GhostLeadPill({
  name,
  industry,
}: {
  name: string;
  industry: string;
}) {
  return (
    <div
      aria-hidden
      className="hidden md:inline-flex flex-col items-center justify-center px-3 py-2 rounded-full pointer-events-none select-none w-[136px] grayscale whitespace-nowrap leading-tight"
    >
      <span className="text-xs font-semibold text-white/40">An {name}</span>
      <span className="text-[10px] font-normal text-white/25 mt-0.5">
        {industry}
      </span>
    </div>
  );
}

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
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {/* Lead-Picker — full width with edge fade suggesting "infinite leads" */}
      <div className="relative w-full max-w-4xl mx-auto">
        <div
          role="radiogroup"
          aria-label="Lead auswählen"
          className="flex items-center justify-center gap-1 rounded-full bg-white/[0.06] border border-white/10 backdrop-blur-md p-1 overflow-hidden md:[mask-image:linear-gradient(to_right,transparent_0%,black_14%,black_86%,transparent_100%)] md:[-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_14%,black_86%,transparent_100%)]"
        >
          {/* Ghost leads left — non-clickable, faded into transparency */}
          <GhostLeadPill name="Stefan" industry="SaaS-Agentur" />
          <GhostLeadPill name="Sofia" industry="Coaching" />

          {LEADS.map((l) => {
            const active = l.id === leadId;
            return (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setLeadId(l.id)}
                className={cn(
                  "inline-flex flex-col items-center justify-center px-3 py-2 rounded-full transition-colors w-[136px] whitespace-nowrap leading-tight",
                  active
                    ? "bg-brand text-white shadow-brand"
                    : "text-white/85 hover:bg-white/10",
                )}
              >
                <span className="text-xs font-semibold">An {l.firstName}</span>
                <span
                  className={cn(
                    "text-[10px] font-normal mt-0.5",
                    active ? "text-white/80" : "text-white/50",
                  )}
                >
                  {l.industryLabel}
                </span>
              </button>
            );
          })}

          {/* Ghost leads right */}
          <GhostLeadPill name="Tobias" industry="Hotellerie" />
          <GhostLeadPill name="Nadine" industry="Immobilien" />
        </div>
        <p className="mt-2 text-center text-[11px] text-white/50">
          Demo zeigt 3 Beispiel-Leads. In deinem Account beliebig viele.
        </p>
      </div>

      <DemoToggleGroup value={mode} onChange={setMode} />
      <div className="relative w-full max-w-4xl mx-auto aspect-video rounded-2xl overflow-hidden shadow-2xl bg-black">
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
          style={{ width: "100%", height: "100%" }}
        />
        {canScroll ? (
          <button
            type="button"
            onClick={() => setScrollEnabled((v) => !v)}
            className={cn(
              "absolute bottom-3 left-3 z-10 inline-flex items-center gap-2 rounded-full backdrop-blur px-3.5 py-1.5 text-xs font-medium transition-colors",
              scrollEnabled
                ? "bg-brand text-white hover:bg-brand-deep"
                : "bg-black/60 text-white hover:bg-black/80",
            )}
            aria-pressed={scrollEnabled}
          >
            <span
              className={cn(
                "relative inline-flex h-3.5 w-6 rounded-full transition-colors",
                scrollEnabled ? "bg-white/40" : "bg-white/25",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-2.5 rounded-full bg-white transition-all",
                  scrollEnabled ? "left-3" : "left-0.5",
                )}
              />
            </span>
            Scrollen aktivieren
          </button>
        ) : null}
      </div>
      {canScroll && scrollEnabled ? (
        <div className="mx-auto max-w-2xl rounded-squircle-md border border-warn/30 bg-warn/[0.10] backdrop-blur-md px-4 py-3 text-xs text-white/75 flex items-start gap-2.5">
          <Info className="size-4 text-warn shrink-0 mt-0.5" aria-hidden />
          <span>
            <strong className="text-white font-semibold">
              Hinweis zur Demo:
            </strong>{" "}
            Das Scroll-Verhalten hier ist generiert und wirkt etwas
            mechanisch. In deinem echten Video zeichnest du das Scrollen
            vorab einmal selbst auf. Dadurch sieht es natürlich aus.
          </span>
        </div>
      ) : (
        <p className="text-center text-xs text-white/55">
          Gleiches Video, drei verschiedene Leads. Wechsle oben durch und
          schau, wie sich Name, Firma und Webseite live anpassen, während
          das Video an genau derselben Stelle weiterläuft.
        </p>
      )}
    </div>
  );
}
