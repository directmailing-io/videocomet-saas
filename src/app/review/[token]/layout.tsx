import type { Metadata } from "next";
import { Logo } from "@/components/ui/logo";
import { fontClasses } from "@/lib/fonts";
import "../../globals.css";

export const metadata: Metadata = {
  title: "Feedback zum Video · VIDEOCOMET",
  robots: { index: false, follow: false },
};

/**
 * Minimales Standalone-Layout für die Public-Feedback-Ansicht. Bewusst ohne
 * App-Shell/Nav — der Empfänger soll den Player und das Kommentar-Panel
 * bildschirmfüllend sehen. Layout ist identisch aufgebaut wie /share/[token]
 * (gleiche visuelle Sprache), zeigt aber eine andere Badge.
 */
export default function ReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de" className={fontClasses}>
      <head>
        <meta name="referrer" content="no-referrer-when-downgrade" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body>
        <div className="min-h-screen flex flex-col bg-surface-soft">
          <header className="border-b border-line/60 bg-surface/80 backdrop-blur">
            <div className="mx-auto w-full max-w-6xl flex items-center justify-between px-4 py-3 sm:px-5">
              <Logo />
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-deep">
                Feedback zum Video
              </span>
            </div>
          </header>
          <main className="flex-1 w-full">{children}</main>
          <footer className="border-t border-line/60 bg-surface/60">
            <div className="mx-auto w-full max-w-6xl px-5 py-4 text-center text-[11px] text-ink-muted">
              Powered by VIDEOCOMET
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
