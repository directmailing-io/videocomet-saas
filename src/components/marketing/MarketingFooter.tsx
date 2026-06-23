import Link from "next/link";
import { ArrowUpRight, Linkedin, Mail } from "lucide-react";
import { Logo } from "@/components/ui/logo";

type FooterLink = { label: string; href: string; external?: boolean };

const COLUMNS: ReadonlyArray<{ title: string; links: ReadonlyArray<FooterLink> }> = [
  {
    title: "Produkt",
    links: [
      { label: "Live-Demo", href: "#demo" },
      { label: "Ablauf", href: "#how-it-works" },
      { label: "Features", href: "#features" },
      { label: "Preise", href: "#pricing" },
    ],
  },
  {
    title: "Unternehmen",
    links: [
      { label: "Über uns", href: "/ueber-uns" },
      { label: "Kontakt", href: "/kontakt" },
      { label: "Karriere", href: "/karriere" },
      { label: "Blog", href: "/blog" },
    ],
  },
  {
    title: "Rechtliches",
    links: [
      { label: "Impressum", href: "/impressum" },
      { label: "Datenschutz", href: "/datenschutz" },
      { label: "AGB", href: "/agb" },
    ],
  },
];

export function MarketingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer
      id="page-footer"
      className="relative w-full bg-surface border-t border-line overflow-hidden"
    >
      {/* Subtle brand backdrop top-right */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(45% 60% at 90% 0%, rgba(124,92,232,0.06) 0%, transparent 60%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6 md:px-10">
        {/* Top: Brand + columns */}
        <div className="py-14 md:py-20 grid grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr] gap-10 md:gap-8 lg:gap-12">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <Link
              href="/"
              aria-label="Zur Startseite"
              className="inline-flex items-center"
            >
              <Logo />
            </Link>
            <p className="mt-5 text-[14.5px] text-ink-muted leading-relaxed max-w-[28ch]">
              Persönliche Video-Akquise per Brief.
              <br />
              Auffallen, in Erinnerung bleiben, Vertrauen aufbauen.
            </p>

            {/* Socials */}
            <div className="mt-7 flex items-center gap-2">
              <SocialIconLink
                href="https://www.linkedin.com/company/videocomet"
                label="LinkedIn"
                Icon={Linkedin}
              />
              <SocialIconLink
                href="mailto:hello@videocomet.de"
                label="E-Mail"
                Icon={Mail}
              />
            </div>
          </div>

          {/* Link columns */}
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-ink mb-5">
                {col.title}
              </div>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="group inline-flex items-center gap-1 text-[14.5px] text-ink-muted hover:text-brand-deep transition-colors"
                    >
                      {link.label}
                      {link.external ? (
                        <ArrowUpRight className="size-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition" />
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="py-6 border-t border-line flex flex-col-reverse sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-ink-muted">
          <span>
            © {year} VIDEOCOMET. Alle Rechte vorbehalten.
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-emerald-500"
            />
            Made in Germany
          </span>
        </div>
      </div>
    </footer>
  );
}

function SocialIconLink({
  href,
  label,
  Icon,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="size-9 rounded-full bg-white border border-line flex items-center justify-center text-ink-muted hover:text-brand-deep hover:border-brand-soft hover:shadow-sm transition-all"
    >
      <Icon className="size-4" />
    </a>
  );
}
