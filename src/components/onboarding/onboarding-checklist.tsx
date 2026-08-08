"use client";

/**
 * Onboarding-Checkliste: Popup mit Setup-Schritten + Floating-Button.
 *
 * Verhalten:
 *   - Öffnet sich automatisch, wenn noch Pflicht-Schritte offen sind und
 *     der User es weder in dieser Session ("Später") noch dauerhaft
 *     ("Nicht mehr anzeigen", DB-Spalte) weggeklickt hat.
 *   - Der Floating-Button unten rechts bleibt erreichbar, solange noch
 *     etwas offen ist, und öffnet das Popup jederzeit wieder.
 *   - Erledigte Schritte werden automatisch erkannt (kein Abhaken nötig).
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, CheckCircle2, ListChecks } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface SetupItem {
  key: string;
  title: string;
  hint: string;
  href: string;
  done: boolean;
  optional: boolean;
}

interface SetupStatus {
  items: SetupItem[];
  doneCount: number;
  requiredCount: number;
  allDone: boolean;
  onboardingDismissed: boolean;
}

const SESSION_KEY = "vc-onboarding-dismissed-session";

export function OnboardingChecklist() {
  const pathname = usePathname();
  const [status, setStatus] = React.useState<SetupStatus | null>(null);
  const [open, setOpen] = React.useState(false);
  const [hiddenForever, setHiddenForever] = React.useState(false);
  const autoOpenedRef = React.useRef(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/setup-status", { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as SetupStatus;
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  // Initial laden + einmalig auto-öffnen.
  React.useEffect(() => {
    void (async () => {
      const data = await load();
      if (!data || autoOpenedRef.current) return;
      autoOpenedRef.current = true;
      const sessionDismissed =
        window.sessionStorage.getItem(SESSION_KEY) === "1";
      if (!data.onboardingDismissed && !data.allDone && !sessionDismissed) {
        setOpen(true);
      }
    })();
  }, [load]);

  // Bei Seitenwechsel Status auffrischen (z.B. gerade Vorlage angelegt).
  React.useEffect(() => {
    if (!status || status.onboardingDismissed || hiddenForever) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!status || status.onboardingDismissed || hiddenForever) return null;

  const dismissSession = () => {
    window.sessionStorage.setItem(SESSION_KEY, "1");
    setOpen(false);
  };

  const dismissForever = async () => {
    setOpen(false);
    setHiddenForever(true);
    try {
      await fetch("/api/setup-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dismissForever: true }),
      });
    } catch {
      // Schlimmstenfalls taucht das Popup beim nächsten Login wieder auf.
    }
  };

  const progressPct =
    status.requiredCount > 0
      ? Math.round((status.doneCount / status.requiredCount) * 100)
      : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {status.allDone ? "Alles startklar!" : "Schnell startklar werden"}
            </DialogTitle>
            <DialogDescription>
              {status.allDone
                ? "Du hast alle Schritte erledigt. Viel Erfolg mit deinen Kampagnen!"
                : "Diese Schritte brauchst du, damit deine erste Kampagne rund läuft. Alles wird automatisch abgehakt, sobald du es erledigt hast."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-1">
            <div className="flex items-center justify-between text-xs text-ink-muted mb-1.5">
              <span className="font-semibold">
                {status.doneCount} von {status.requiredCount} erledigt
              </span>
              <span className="tabular-nums">{progressPct} %</span>
            </div>
            <Progress value={progressPct} />
          </div>

          <ul className="mt-3 flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto pr-1">
            {status.items.map((item) => (
              <li key={item.key}>
                {item.done ? (
                  <div className="flex items-start gap-3 rounded-squircle-sm bg-ok-soft/60 px-3 py-2.5">
                    <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-ok" />
                    <span className="text-sm font-medium text-ink-muted line-through decoration-ink-muted/40">
                      {item.title}
                    </span>
                  </div>
                ) : (
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="group flex items-start gap-3 rounded-squircle-sm bg-surface-soft px-3 py-2.5 transition-colors hover:bg-brand-soft"
                  >
                    <span className="inline-flex size-4 shrink-0 mt-0.5 items-center justify-center rounded-full border-2 border-line" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                        {item.title}
                        {item.optional && (
                          <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                            Optional
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-muted leading-relaxed">
                        {item.hint}
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 mt-0.5 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void dismissForever()}
              className="text-xs text-ink-muted hover:text-ink underline underline-offset-2 transition-colors"
            >
              Nicht mehr anzeigen
            </button>
            <Button variant="ghost" size="sm" onClick={dismissSession}>
              Später
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Floating-Button: bleibt sichtbar, solange etwas offen ist */}
      {!status.allDone && !open && (
        <button
          type="button"
          onClick={() => {
            void load();
            setOpen(true);
          }}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105"
          aria-label="Setup-Checkliste öffnen"
        >
          <ListChecks className="size-4" />
          <span className={cn("tabular-nums")}>
            Setup {status.doneCount}/{status.requiredCount}
          </span>
        </button>
      )}
    </>
  );
}
