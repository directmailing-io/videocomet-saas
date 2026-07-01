import Link from "next/link";
import Image from "next/image";
import { Logo } from "@/components/ui/logo";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

/**
 * Signup-Layout im Darkmode — vollflaechiges Hero-Bild ganz oben,
 * fliessender Verlauf ins dunkle Formular darunter. Footer identisch
 * zur Startseite, nur in der Dark-Variante.
 */
export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0B0B12] text-white flex flex-col">
      {/* Hero-Bild ganz oben. Fixe Bildhöhe damit Look&Feel konstant,
          overflow-hidden weil das Bild rechts über den Rand ragt.
          Das Gradient-Overlay unten laeuft zur Seitenhintergrund-Farbe
          (#0B0B12), damit der Uebergang ins Formular fliessend wirkt. */}
      <div className="relative w-full h-[220px] sm:h-[300px] md:h-[360px] lg:h-[420px] overflow-hidden">
        <Image
          src="/marketing/signup-hero.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(11,11,18,0) 0%, rgba(11,11,18,0.55) 55%, rgba(11,11,18,1) 100%)",
          }}
        />
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
      <main className="flex-1 -mt-16 sm:-mt-24 md:-mt-32 relative z-10">
        {children}
      </main>
      <MarketingFooter variant="dark" />
    </div>
  );
}
