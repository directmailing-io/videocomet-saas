import { CheckCircle2 } from "lucide-react";
import { DemoPlayer } from "./DemoPlayer";

export function DemoSection() {
  return (
    <section className="w-full bg-surface-soft border-t border-line">
      <div className="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <div className="text-center mb-10 md:mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-soft text-brand-deep text-xs font-semibold mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-brand" />
            Live-Demo
          </div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-balance mb-3">
            So sieht ein personalisiertes Video aus
          </h2>
          <p className="text-ink-muted max-w-2xl mx-auto text-balance">
            Wähle einen Modus und sieh, wie VIDEOCOMET deine Webcam-Aufnahme mit
            Website, Folien oder einem Scroll-Video zu einer persönlichen Botschaft
            kombiniert.
          </p>
        </div>
        <DemoPlayer />
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 mt-10 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-ok" />
            30 Sekunden Webcam → 500 personalisierte Videos
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-ok" />
            Vollautomatisch
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-ok" />
            Eigene Landingpages für jeden Empfänger
          </span>
        </div>
      </div>
    </section>
  );
}
