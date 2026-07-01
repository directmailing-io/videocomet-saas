import Link from "next/link";
import Image from "next/image";
import { Logo } from "@/components/ui/logo";

/**
 * Signup-Layout — minimalistisch, ohne Marketing-Nav-Ablenkung.
 * Header nur mit Logo (klickbar zurück zur Homepage) + Login-Link.
 * Über dem Formular ein vollflächiges Hero-Bild mit weichem Verlauf
 * nach unten, damit das Formular fliessend in die Bildwelt uebergeht.
 * Mobile-first responsive.
 */
export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-soft/40 via-white to-white flex flex-col">
      {/* Hero-Bild ganz oben. Fixe Bildhöhe damit Look&Feel konstant,
          Overflow-hidden weil das Bild rechts über den Rand ragt, und
          absoluter Gradient unten der von transparent auf die Seiten-
          Hintergrundfarbe (brand-soft/40 → weiss) überblendet. */}
      <div className="relative w-full h-[220px] sm:h-[300px] md:h-[360px] lg:h-[420px] overflow-hidden">
        <Image
          src="/marketing/signup-hero.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        {/* Transparent-Gradient nach unten fuer den fliessenden Uebergang
            in die Formular-Sektion. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(245,241,255,0.55) 55%, rgba(255,255,255,1) 100%)",
          }}
        />
        {/* Header on top of the hero, so the logo bleibt sichtbar */}
        <header className="absolute top-0 inset-x-0 z-10">
          <div className="max-w-6xl mx-auto px-4 h-14 sm:h-16 flex items-center justify-between">
            <Link href="/" className="inline-flex items-center gap-2">
              <Logo variant="horizontal" height={28} className="brightness-0 invert" />
            </Link>
            <div className="text-xs sm:text-sm text-white/85">
              Schon Kunde?{" "}
              <Link
                href="/login"
                className="text-white font-semibold hover:underline"
              >
                Einloggen
              </Link>
            </div>
          </div>
        </header>
      </div>
      {/* Formular-Sektion — negativer Top-Margin, damit sie ins
          Verlaufsende des Hero-Bildes greift. */}
      <main className="flex-1 -mt-16 sm:-mt-24 md:-mt-32 relative z-10">
        {children}
      </main>
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
