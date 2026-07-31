import Link from "next/link";
import Image from "next/image";
import { Logo } from "@/components/ui/logo";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

/**
 * Signup-Layout im hellen Startseiten-Stil: Himmel-Bild oben,
 * fliessender Verlauf in die helle Seitenfarbe darunter.
 */
export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f7f5fd] text-ink flex flex-col">
      <div className="relative w-full h-[220px] sm:h-[300px] md:h-[360px] lg:h-[420px] overflow-hidden">
        <Image
          src="/hero-sky.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[center_30%]"
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(247,245,253,0) 0%, rgba(247,245,253,0.55) 55%, #f7f5fd 100%)",
          }}
        />
        <header className="absolute top-0 inset-x-0 z-10">
          <div className="max-w-6xl mx-auto px-4 h-14 sm:h-16 flex items-center justify-between">
            <Link href="/" className="inline-flex items-center gap-2">
              <Logo variant="horizontal" height={28} />
            </Link>
            <div className="text-xs sm:text-sm text-ink/80">
              Schon Kunde?{" "}
              <Link
                href="/login"
                className="text-ink font-semibold hover:underline"
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
      <MarketingFooter />
    </div>
  );
}
