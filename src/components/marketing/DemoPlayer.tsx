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
    industryLabel: "Industrie · Maschinenbau",
    errors: [
      {
        title: "Kein technisches Datenblatt als Lead-Magnet",
        body: "Procurement-Käufer wollen vor der Anfrage ein PDF mit Drehmoment, Spannweite, Wartungsintervallen herunterladen. Bei dir führt jeder Klick auf „Mehr Infos“ zu einer Marketing-Seite — die E-Mail-Adresse ist weg, der Nurture-Loop unmöglich. Setup: 1 PDF + Mailchimp-Form. 2 Stunden Arbeit. Erfahrungswert: 3–5× mehr qualifizierte B2B-Anfragen.",
      },
      {
        title: "Keine Spec-Sheets pro Anlage",
        body: "Engineering-Käufer erstellen Excel-Vergleichslisten, bevor sie überhaupt anrufen. Bei dir steht überall „Hohe Qualität, persönliche Beratung“ — null harte Zahlen. Drei Spec-PDFs für deine Top-Anlagen reichen, damit du in diesen Listen überhaupt mitlaufen kannst.",
      },
      {
        title: "Stockfoto-Maschine im Hero-Bild",
        body: "Das Header-Bild ist eine Shutterstock-Schweißanlage, die nicht zu eurem Portfolio passt. Maschinenbauer erkennen das in zwei Sekunden — und scrollen direkt zur Konkurrenz. Halbtages-Shooting bei euch in München. Einmal investiert, jahrelang Wirkung.",
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
    industryLabel: "Naturkosmetik · D2C",
    errors: [
      {
        title: "Kein Hauttyp-Quiz beim Einstieg",
        body: "70 % deiner Besucherinnen wissen nicht, welche Pflege-Linie zu ihrer Haut passt. Ohne Quiz scrollen sie 3 Minuten lang die Produktliste durch und springen ab. Ein 4-Klick-Quiz (Hauttyp → Probleme → Routine → Empfehlung) hebt bei vergleichbaren D2C-Brands die Conversion um Faktor 2,3.",
      },
      {
        title: "Keine User-Photos in den Produktseiten",
        body: "Auf den Detailseiten zeigst du Rendering-Shots der Tiegel. Naturkosmetik-Käuferinnen brauchen UGC — echte Hände, echte Texturen, echte Hauttypen. Eine Hashtag-Aktion mit dem Probier-Set bringt dir in 2 Wochen 40+ ehrliche Instagram-Fotos. Drei davon im Produkt-Slider reichen.",
      },
      {
        title: "Konsistenz der Cremes unsichtbar",
        body: "Du schreibst „cremig wie Butter“ und „leichtes Gel“ — zeigst es aber nicht. Eine Close-Up-Foto-Serie auf dem Handrücken (Pumpstoß → Verteilen → Einziehen) macht aus dem Adjektiv ein Versprechen. 800 € Studio-Shoot, drei Stunden Aufwand, sofort spürbar bei Add-to-Cart.",
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
    industryLabel: "Handwerk · Manufaktur",
    errors: [
      {
        title: "Keine echten Werkstatt-Bilder",
        body: "Auf „Manufaktur“ sehe ich ein Stockfoto einer fremden Holzwerkstatt und ein Bild von Wilhelm Friedrich aus 1985. Käufer eines 4.200-€-Sekretärs wollen heute sehen, wo das Stück entsteht — Hände, Werkzeuge, Holzspäne, das Atelier am Vormittag. Zwei Stunden Foto-Reportage vor Ort, einmal investiert, jahrelang Vertrauen.",
      },
      {
        title: "Materialherkunft wird nicht erzählt",
        body: "Du arbeitest mit Eiche aus dem Bergischen Land und pflanzlich gegerbtem Leder — das steht aber nirgendwo. Premium-Käufer kaufen Geschichten: wo der Baum stand, welcher Gerber das Leder veredelt hat, warum gerade dieses Messing. Drei Absätze pro Material verdoppeln die wahrgenommene Wertigkeit ohne einen Cent zusätzliche Produktkosten.",
      },
      {
        title: "Lieferzeit komplett intransparent",
        body: "Bei einem 6.800-€-Bibliothekstisch will der Käufer vor der Anfrage wissen: 6 Wochen oder 6 Monate? Bei dir steht nirgendwo eine Zahl. Drei einfache Timeline-Bullets („Anfrage → Skizze in 7 Tagen → Fertigung in 8 Wochen“) räumen Bauchschmerzen aus, bevor sie überhaupt entstehen.",
      },
    ],
  },
];

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
      {/* Lead-Picker — separate row above the mode toggles */}
      <div
        role="radiogroup"
        aria-label="Lead auswählen"
        className="mx-auto inline-flex items-center gap-1 rounded-full bg-surface-soft border border-line p-1"
      >
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
                "inline-flex flex-col items-start px-4 py-1.5 rounded-full text-xs font-medium transition-colors min-w-[110px]",
                active
                  ? "bg-brand text-white shadow-brand"
                  : "text-ink hover:bg-surface-muted",
              )}
            >
              <span className="font-semibold">An {l.firstName}</span>
              <span
                className={cn(
                  "text-[10px] font-normal",
                  active ? "text-white/80" : "text-ink-muted",
                )}
              >
                {l.industryLabel}
              </span>
            </button>
          );
        })}
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
        <div className="mx-auto max-w-2xl rounded-squircle-md border border-warn/30 bg-warn-soft/50 px-4 py-3 text-xs text-ink-soft flex items-start gap-2.5">
          <Info className="size-4 text-warn shrink-0 mt-0.5" aria-hidden />
          <span>
            <strong className="text-ink font-semibold">
              Hinweis zur Demo:
            </strong>{" "}
            Das Scroll-Verhalten hier ist generiert und wirkt etwas
            mechanisch. In deinem echten Video zeichnest du das Scrollen
            vorab einmal selbst auf — dadurch sieht es 1:1 menschlich aus.
          </span>
        </div>
      ) : (
        <p className="text-center text-xs text-ink-muted">
          Gleiches Video, drei verschiedene Leads — wechsle oben durch und
          schau, wie sich Name, Firma und Webseite live anpassen, während
          das Video an exakt derselben Stelle weiterläuft.
        </p>
      )}
    </div>
  );
}
