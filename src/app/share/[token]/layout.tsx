import type { Metadata } from "next";
import { Logo } from "@/components/ui/logo";
import { fontClasses } from "@/lib/fonts";
import "../../globals.css";

export const metadata: Metadata = {
  title: "Geteilte Ansicht · VIDEOCOMET",
  robots: { index: false, follow: false },
};

/**
 * Minimal standalone layout for public, password-protected share views.
 *
 * Intentionally bypasses the AppShell — share recipients see neither the
 * sidebar nor the tenant nav. We only mount the global stylesheet plus a
 * thin top-header (VideoComet logo + read-only label) and a footer.
 */
export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de" className={fontClasses}>
      <head>
        <meta name="referrer" content="no-referrer-when-downgrade" />
      </head>
      <body>
        <div className="min-h-screen flex flex-col bg-surface-soft">
          <header className="border-b border-line/60 bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
            <div className="mx-auto w-full max-w-6xl flex items-center justify-between px-5 py-3">
              <Logo />
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-deep">
                Geteilte Ansicht
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
