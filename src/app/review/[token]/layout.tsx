import type { Metadata } from "next";
import { Toaster } from "@/components/ui/toaster";
import { fontClasses } from "@/lib/fonts";
import "../../globals.css";

export const metadata: Metadata = {
  title: "Feedback zum Video · VIDEOCOMET",
  robots: { index: false, follow: false },
};

/**
 * Minimales Standalone-Layout für die Public-Feedback-Ansicht.
 *
 * Der Kopf (Logo/Kampagne/Name) sitzt bewusst IN der Reviewer-Komponente,
 * weil er den Kampagnen-Namen kennen muss (der beim Layout noch nicht
 * geladen ist). Layout ist bewusst leer bis auf Gradient + Footer.
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
        <Toaster>
          <div
            className="min-h-screen flex flex-col"
            style={{
              backgroundImage:
                "linear-gradient(180deg, rgba(170,140,245,0.20) 0%, rgba(170,140,245,0.10) 20%, rgba(255,255,255,0.6) 55%, #ffffff 100%)",
              backgroundColor: "#ffffff",
            }}
          >
            <main className="flex-1 w-full">{children}</main>
            <footer className="mt-8">
              <div className="mx-auto w-full max-w-6xl px-5 py-4 text-center text-[11px] text-ink-muted">
                Powered by VIDEOCOMET
              </div>
            </footer>
          </div>
        </Toaster>
      </body>
    </html>
  );
}
