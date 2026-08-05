import { Check, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sprech-Hinweis für den ersten Satz einer Webcam-Aufnahme mit
 * personalisierter KI-Begrüßung. Grün/Rot-Beispiele machen deutlich,
 * warum ein elliptischer Fragment-Anfang („Hi, kurzes Video für dich
 * auf...") in der Vertonung mit einem Vornamen nicht funktioniert, ein
 * vollständiger Satz nach der Anrede dagegen sauber greift.
 *
 * `compact` blendet die Erklärung aus und zeigt nur die Beispiel-Karten
 * — für Kontexte, in denen der Hauptzweck der Seite schon offensichtlich
 * ist (z. B. Wizard-Schritt „KI-Begrüßung").
 */
export function RecordingHint({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-squircle-md border border-line bg-surface p-4 space-y-3",
        className,
      )}
    >
      {!compact && (
        <div className="flex items-start gap-2">
          <Info className="size-4 text-brand shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-ink">
              Sprich einfach natürlich
            </p>
            <p className="mt-1 text-xs text-ink-muted leading-relaxed">
              Fang direkt mit einer kurzen Anrede an („Hi!", „Hallo!",
              „Guten Tag!") und sprich dann ganz normal weiter mit einem
              vollständigen Satz. Die kleine Sprech-Pause die dabei
              automatisch zwischen Anrede und Satz entsteht, reicht der
              Analyse völlig aus — du musst nicht bewusst warten.
            </p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-squircle-sm bg-ok-soft px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ok mb-1.5">
            <Check className="size-3" /> Passt
          </p>
          <p className="text-sm text-ink italic leading-snug">
            „Hi! Ich habe dir kurz ein Video aufgenommen, weil..."
          </p>
        </div>
        <div className="rounded-squircle-sm bg-danger-soft px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-danger mb-1.5">
            <X className="size-3" /> Bitte nicht
          </p>
          <p className="text-sm text-ink italic leading-snug">
            Ohne klare Anrede: „Kurzes Video für dich aufgenommen..."
          </p>
        </div>
      </div>
    </div>
  );
}
