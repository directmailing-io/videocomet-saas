import { Check, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sprech-Hinweis für den ersten Satz einer Webcam-Aufnahme mit
 * personalisierter KI-Begrüßung. Kernbotschaft: nach der Anrede („Hi!")
 * kurz Luft holen, denn genau in diese Lücke bauen wir später den Namen
 * ein. Die Beispiele zeigen den Unterschied mit/ohne Pause.
 *
 * `compact` blendet die Erklärung aus und zeigt nur die Beispiel-Karten.
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
              Wichtig: kurze Pause nach dem „Hi!"
            </p>
            <p className="mt-1 text-xs text-ink-muted leading-relaxed">
              Sag am Anfang nur „Hi!" oder „Hallo!" und hol dann einmal kurz
              Luft (etwa 1 bis 2 Sekunden). Danach sprichst du ganz normal
              weiter. In genau diese Pause setzen wir später den Namen ein,
              aus deinem „Hi!" wird dann zum Beispiel „Hi Sebastian!". Ohne
              Pause klingt das später gequetscht.
            </p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-squircle-sm bg-ok-soft px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ok mb-1.5">
            <Check className="size-3" /> So passt es
          </p>
          <p className="text-sm text-ink leading-snug">
            <span className="italic">„Hi!"</span>{" "}
            <span className="mx-1 inline-flex items-center rounded-full bg-ok/15 px-2 py-0.5 text-[10px] font-semibold text-ok whitespace-nowrap align-middle">
              kurz Luft holen, 1 bis 2 Sek.
            </span>{" "}
            <span className="italic">
              „Ich hab dir ein kurzes Video aufgenommen, weil ..."
            </span>
          </p>
        </div>
        <div className="rounded-squircle-sm bg-danger-soft px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-danger mb-1.5">
            <X className="size-3" /> Bitte nicht
          </p>
          <p className="text-sm text-ink italic leading-snug">
            „Hi ich hab dir ein kurzes Video aufgenommen ..."
          </p>
          <p className="mt-1 text-[11px] text-ink-muted leading-snug">
            Ohne Pause nach dem „Hi" passt der Name später nicht rein.
          </p>
        </div>
      </div>
    </div>
  );
}
