"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { RevealOnScroll } from "./RevealOnScroll";

type FAQItem = { q: string; a: string };

const FAQ: ReadonlyArray<FAQItem> = [
  {
    q: "Wie wird der Grundtarif abgerechnet?",
    a: "Der Grundtarif von 40 € netto pro Monat wird einmal jährlich im Voraus abgerechnet, also 480 € netto für die 12 Monate. Für jedes Video lädst du dann Credits nach, die taggenau verrechnet werden. So bleibt deine Buchhaltung übersichtlich und du zahlst nur, was du wirklich versendest.",
  },
  {
    q: "Was passiert mit Credits, die ich nicht verbrauche?",
    a: "Credits, die du gebucht hast, behältst du die gesamte Vertragslaufzeit. Sie verfallen nicht am Monatsende. Du kannst sie nutzen, wann immer du willst.",
  },
  {
    q: "Wie lange läuft der Vertrag und wie kündige ich?",
    a: "12 Monate Mindestlaufzeit. Danach läuft der Vertrag monatlich weiter und du kannst jederzeit zum Monatsende kündigen. Kein Versteckspiel mit Fristen.",
  },
  {
    q: "Brauche ich technische Kenntnisse, um VIDEOCOMET zu nutzen?",
    a: "Nein. Wenn du eine E-Mail schreiben kannst, kannst du VIDEOCOMET nutzen. Der Landingpage-Builder ist drag-and-drop, die CRM-Anbindungen sind vorgefertigt, und Briefe entstehen als druckfertige PDF auf Knopfdruck.",
  },
  {
    q: "Wo werden meine Daten gespeichert?",
    a: "Server und Datenbank stehen ausschließlich in Deutschland. Alle Daten werden DSGVO-konform verarbeitet, Backups sind verschlüsselt, und du kannst Leads jederzeit löschen lassen.",
  },
  {
    q: "Welche Tools und CRMs sind angebunden?",
    a: "HubSpot, Salessuite, Close, Zapier, Make und n8n direkt aus der Box. Für alles andere kannst du eigene Webhooks aufsetzen. So bindest du auch Tools an, die wir nicht standardmäßig unterstützen.",
  },
  {
    q: "Wer kümmert sich um Druck und Versand der Briefe?",
    a: "VIDEOCOMET erstellt die druckfertige PDF in DIN Lang oder DIN C4 inklusive QR-Code zum Video. Den Druck und Versand übernimmst du über deine bevorzugte Druckerei. Auf Wunsch vermitteln wir dir einen Partner, der das komplett für dich erledigt.",
  },
  {
    q: "Brauche ich eine eigene Webseite?",
    a: "Nein. Du kannst deine Landingpages auf einer Subdomain von uns nutzen. Wenn du eine eigene Domain anbinden willst, geht das mit wenigen Klicks und automatischer SSL-Erneuerung.",
  },
  {
    q: "Wie schnell bin ich startklar?",
    a: "Innerhalb weniger Minuten. Account anlegen, erstes Video aufnehmen, Leads importieren, versenden. Eine Onboarding-Begleitung ist im Tarif inklusive, damit du auch wirklich startest.",
  },
  {
    q: "Kann ich VIDEOCOMET vor dem Start ausprobieren?",
    a: "Ja. Buche dir eine Live-Demo, in der wir dir das Tool zeigen und gemeinsam einen Beispiel-Versand für deinen Use Case durchgehen. Erst dann musst du dich entscheiden.",
  },
];

export function FAQSection() {
  const [open, setOpen] = React.useState<Set<number>>(new Set([0]));

  const toggle = (i: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <section
      id="faq"
      className="relative z-[2] w-full bg-white py-16 md:py-32 overflow-hidden"
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 0%, rgba(243,238,255,0.4) 0%, rgba(255,255,255,0) 55%)",
        }}
      />

      <div className="relative max-w-3xl mx-auto px-6 md:px-10">
        {/* Header */}
        <div className="text-center mb-14 md:mb-20">
          <RevealOnScroll delay={0}>
            <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-brand-soft text-brand-deep text-[11px] font-semibold tracking-[0.18em] uppercase mb-6">
              FAQ
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={150}>
            <h2 className="font-light tracking-[-0.035em] text-ink leading-[1.05] text-[clamp(32px,4.2vw,56px)] mb-5 text-balance">
              Häufige Fragen.
              <br />
              <span className="font-semibold text-brand-deep">
                Kurze Antworten.
              </span>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={300}>
            <p className="text-ink-muted text-lg leading-relaxed text-balance max-w-xl mx-auto">
              Vertrag, Setup, Daten, Versand. Alles, was du vor dem
              Start wissen willst.
            </p>
          </RevealOnScroll>
        </div>

        {/* Accordion */}
        <RevealOnScroll delay={400}>
          <div className="divide-y divide-line border-y border-line">
            {FAQ.map((item, i) => (
              <Item
                key={item.q}
                item={item}
                isOpen={open.has(i)}
                onToggle={() => toggle(i)}
              />
            ))}
          </div>
        </RevealOnScroll>

        {/* Footer note */}
        <RevealOnScroll delay={500}>
          <p className="text-center text-sm text-ink-muted mt-10 leading-relaxed">
            Noch eine Frage offen?{" "}
            <a
              href="mailto:info@videocomet.de"
              className="text-brand-deep font-semibold hover:underline"
            >
              Schreib uns kurz
            </a>
            . Wir antworten persönlich.
          </p>
        </RevealOnScroll>
      </div>
    </section>
  );
}

function Item({
  item,
  isOpen,
  onToggle,
}: {
  item: FAQItem;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between gap-6 py-5 md:py-6 text-left group"
      >
        <span
          className={cn(
            "text-[16px] md:text-[17px] font-semibold transition-colors leading-snug",
            isOpen ? "text-brand-deep" : "text-ink",
          )}
        >
          {item.q}
        </span>
        <span
          className={cn(
            "size-8 shrink-0 rounded-full border flex items-center justify-center transition-all",
            isOpen
              ? "bg-brand border-brand text-white rotate-180"
              : "bg-white border-line text-ink-muted group-hover:border-brand/40 group-hover:text-brand-deep",
          )}
        >
          <ChevronDown className="size-4" strokeWidth={2.5} />
        </span>
      </button>

      {/* Answer — smooth grid-template-rows transition */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{
          gridTemplateRows: isOpen ? "1fr" : "0fr",
        }}
      >
        <div className="overflow-hidden">
          <p className="pb-6 pr-14 text-[15px] text-ink-muted leading-relaxed">
            {item.a}
          </p>
        </div>
      </div>
    </div>
  );
}
