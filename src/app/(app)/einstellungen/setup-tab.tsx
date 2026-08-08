import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { SetupStatus } from "@/lib/setup-status";

/**
 * Setup-Tab: Übersicht, was schon eingerichtet ist und was noch fehlt.
 * Server-gerendert, Daten kommen aus getSetupStatus() in page.tsx.
 */
export function SetupTab({ status }: { status: SetupStatus }) {
  const progressPct =
    status.requiredCount > 0
      ? Math.round((status.doneCount / status.requiredCount) * 100)
      : 0;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-5">
          <h2 className="text-base font-semibold text-ink">
            {status.allDone
              ? "Alles eingerichtet!"
              : "Dein Konto einrichten"}
          </h2>
          <p className="text-sm text-ink-muted mt-1">
            {status.allDone
              ? "Du hast alle Schritte erledigt. Hier siehst du jederzeit den Überblick."
              : "Hier siehst du auf einen Blick, was schon eingerichtet ist und was noch fehlt. Alles wird automatisch abgehakt."}
          </p>
          <div className="mt-4 max-w-md">
            <div className="flex items-center justify-between text-xs text-ink-muted mb-1.5">
              <span className="font-semibold">
                {status.doneCount} von {status.requiredCount} erledigt
              </span>
              <span className="tabular-nums">{progressPct} %</span>
            </div>
            <Progress value={progressPct} />
          </div>
        </div>

        <ul className="flex flex-col gap-2">
          {status.items.map((item) => (
            <li
              key={item.key}
              className={cn(
                "flex items-start gap-3 rounded-squircle-sm border px-4 py-3",
                item.done
                  ? "border-ok/20 bg-ok-soft/50"
                  : "border-line-soft bg-surface-soft",
              )}
            >
              {item.done ? (
                <CheckCircle2 className="size-5 shrink-0 mt-0.5 text-ok" />
              ) : (
                <Circle className="size-5 shrink-0 mt-0.5 text-ink-muted/50" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      item.done ? "text-ink-muted" : "text-ink",
                    )}
                  >
                    {item.title}
                  </span>
                  {item.optional && !item.done && (
                    <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                      Optional
                    </span>
                  )}
                  {item.done && (
                    <span className="rounded-full bg-ok/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ok">
                      Erledigt
                    </span>
                  )}
                </div>
                {!item.done && (
                  <p className="mt-0.5 text-xs text-ink-muted leading-relaxed">
                    {item.hint}
                  </p>
                )}
              </div>
              {!item.done && (
                <Link
                  href={item.href}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-ink/85"
                >
                  Einrichten
                  <ArrowRight className="size-3.5" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
