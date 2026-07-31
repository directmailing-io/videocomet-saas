import Link from "next/link";
import { CookieSettingsLink } from "@/components/consent/CookieSettingsLink";
import { Logo } from "@/components/ui/logo";

/**
 * Layout fuer Legal-Pages (AGB, Datenschutz, Impressum) — minimalistisch,
 * ohne AppShell und ohne Marketing-Nav, damit die Pages auch bei
 * gesperrter Session funktionieren.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f7f5fd]">
      <header className="border-b border-line/70 bg-white/70 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <Logo variant="horizontal" height={32} />
          </Link>
          <nav className="flex gap-4 text-xs text-ink-muted">
            <Link href="/agb" className="hover:text-ink">AGB</Link>
            <Link href="/datenschutz" className="hover:text-ink">Datenschutz</Link>
            <Link href="/impressum" className="hover:text-ink">Impressum</Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-line mt-24 py-6">
        <div className="max-w-3xl mx-auto px-4 text-xs text-ink-muted text-center">
          © {new Date().getFullYear()} VIDEOCOMET GmbH · Alle Rechte vorbehalten ·{" "}
          <CookieSettingsLink className="hover:text-ink underline" />
        </div>
      </footer>
    </div>
  );
}
