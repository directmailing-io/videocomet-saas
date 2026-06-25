"use client";

/**
 * Setup-Banner fuer den Drive-Renderer.
 *
 * Zeigt im Brief-Wizard direkt unter dem Google-Docs-URL-Input einen
 * actionable State an:
 *   - Renderer aktiv → gruener Hinweis "Layouttreu (Google-Renderer)"
 *   - Renderer Setup-bereit (SA configured, Flag off) → blauer Hinweis
 *   - Renderer fehlt SA → gelber Hinweis mit 5-Schritte-Setup-Anleitung
 *
 * Holt den Status von /api/render-engine. Niemals werfend — bei Fehler
 * rendert nichts.
 */

import * as React from "react";
import { CheckCircle2, AlertTriangle, Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

interface State {
  active: boolean;
  configured: boolean;
  flag: boolean;
  serviceAccountEmail: string | null;
}

export function DriveRendererBanner() {
  const { toast } = useToast();
  const [state, setState] = React.useState<State | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/render-engine", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as State;
        if (!cancelled) setState(body);
      } catch {
        // still
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) return null;

  // 1) Aktiv: kurzer gruener Hinweis
  if (state.active) {
    return (
      <div className="mt-3 text-xs flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
        <CheckCircle2 className="size-3.5" />
        <span>
          Layouttreuer Renderer aktiv — Google rendert das PDF, identisch zur
          Browseransicht.
        </span>
      </div>
    );
  }

  // 2) SA konfiguriert aber Flag off → minimal-info
  if (state.configured && !state.flag) {
    return (
      <div className="mt-3 text-xs flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-800">
        <CheckCircle2 className="size-3.5" />
        <span>
          Drive-Renderer bereit, aber per Env-Flag noch nicht aktiv. Operator
          setzt <code>USE_GOOGLE_DRIVE_RENDERER=1</code>.
        </span>
      </div>
    );
  }

  // 3) Nicht konfiguriert → Setup-Anleitung
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 font-medium w-full text-left"
      >
        <AlertTriangle className="size-4 shrink-0" />
        <span>
          Achtung: aktuell rendert LibreOffice. Komplexe Floating-Layouts
          (Bilder + Tabellen-Boxen) können verschoben werden.
        </span>
        <span className="ml-auto underline">
          {open ? "Schließen" : "Setup zeigen"}
        </span>
      </button>
      {open ? (
        <div className="mt-3 space-y-2 leading-relaxed">
          <p>
            Layouttreues Rendering: einmalig Google-Cloud-Service-Account
            einrichten, dann rendert Google selbst (1:1 wie im Browser).
          </p>
          <ol className="list-decimal list-inside space-y-1 ml-1">
            <li>
              Google Cloud Console →{" "}
              <a
                className="underline"
                href="https://console.cloud.google.com/projectcreate"
                target="_blank"
                rel="noopener noreferrer"
              >
                neues Projekt
              </a>
              .
            </li>
            <li>
              APIs aktivieren:{" "}
              <a
                className="underline"
                href="https://console.cloud.google.com/apis/library/drive.googleapis.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Drive API
              </a>{" "}
              +{" "}
              <a
                className="underline"
                href="https://console.cloud.google.com/apis/library/docs.googleapis.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Docs API
              </a>
              .
            </li>
            <li>
              IAM → Service Accounts → neuer Account → Keys → ADD KEY → JSON
              herunterladen.
            </li>
            <li>
              JSON-Inhalt als <code>GOOGLE_DRIVE_SA_KEY</code> in die
              Server-Env setzen + <code>USE_GOOGLE_DRIVE_RENDERER=1</code>.
            </li>
            <li>
              In Google Docs jedes Brief-Template → „Freigeben" → die SA-Email
              als <strong>Viewer</strong> hinzufügen.
            </li>
          </ol>
          <CopySaEmail email={state.serviceAccountEmail} />
        </div>
      ) : null}
    </div>
  );

  function CopySaEmail({ email }: { email: string | null }) {
    if (!email) return null;
    return (
      <div className="mt-2 flex items-center gap-2 rounded bg-white border border-amber-300 px-2 py-1.5">
        <span className="font-mono text-[11px] truncate flex-1">{email}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(email);
            toast({ variant: "success", title: "SA-Email kopiert" });
          }}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-300 hover:bg-amber-100",
          )}
        >
          <Copy className="size-3" />
          Kopieren
        </button>
      </div>
    );
  }
}

void ExternalLink; // keep import for future use
