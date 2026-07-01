import Link from "next/link";
import { Logo } from "@/components/ui/logo";

/**
 * Signup-Layout — minimalistisch, ohne Marketing-Nav-Ablenkung.
 * Header nur mit Logo (klickbar zurück zur Homepage) + Login-Link.
 * Mobile-first responsive.
 */
export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-soft/40 via-white to-white flex flex-col">
      <header className="border-b border-line/60 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 sm:h-16 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2">
            <Logo variant="horizontal" height={28} />
          </Link>
          <div className="text-xs sm:text-sm text-ink-muted">
            Schon Kunde?{" "}
            <Link
              href="/login"
              className="text-brand font-medium hover:underline"
            >
              Einloggen
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line/60 py-6">
        <div className="max-w-6xl mx-auto px-4 flex flex-wrap gap-4 justify-center text-xs text-ink-muted">
          <Link href="/agb" className="hover:text-ink">
            AGB
          </Link>
          <Link href="/datenschutz" className="hover:text-ink">
            Datenschutz
          </Link>
          <Link href="/impressum" className="hover:text-ink">
            Impressum
          </Link>
        </div>
      </footer>
    </div>
  );
}
