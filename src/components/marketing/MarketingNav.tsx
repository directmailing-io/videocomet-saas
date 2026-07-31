"use client";

import Link from "next/link";
import * as React from "react";
import {
  ArrowRight,
  Bell,
  ChevronDown,
  FlaskConical,
  Globe,
  LineChart,
  Mail,
  Menu,
  Plug,
  Video,
  X,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Squircle } from "./Squircle";
import { cn } from "@/lib/utils";

/**
 * Marketing-Topnav mit drei Bereichen:
 *  - Links: Logo
 *  - Center: Live-Demo · Ablauf · Features (Mega-Menue)
 *  - Rechts: Login + "Zugang erhalten"-CTA
 */
export function MarketingNav() {
  const [scrolled, setScrolled] = React.useState(false);
  const [featuresOpen, setFeaturesOpen] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const menuWrapperRef = React.useRef<HTMLDivElement>(null);

  // Transparent am Seitenanfang, sichtbare Glas-Bar sobald gescrollt wird
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Mega-Menue: Click-Outside + Esc schliesst
  React.useEffect(() => {
    if (!featuresOpen) return;
    const onClick = (e: MouseEvent) => {
      if (
        menuWrapperRef.current &&
        !menuWrapperRef.current.contains(e.target as Node)
      ) {
        setFeaturesOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFeaturesOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [featuresOpen]);

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled || mobileOpen || featuresOpen
          ? "backdrop-blur-xl bg-white/70 border-b border-white/50 shadow-[0_4px_24px_-12px_rgba(60,50,110,0.15)]"
          : "bg-transparent border-b border-transparent",
      )}
    >
      <div className="max-w-6xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between gap-6">
        <Link
          href="/"
          aria-label="Zur Startseite"
          className="inline-flex items-center shrink-0"
        >
          <Logo />
        </Link>

        {/* Center nav */}
        <nav
          ref={menuWrapperRef}
          className="hidden md:flex items-center gap-1 relative"
        >
          <NavLink href="#demo">Live-Demo</NavLink>
          <NavLink href="#how-it-works">Ablauf</NavLink>
          <button
            type="button"
            onClick={() => setFeaturesOpen((v) => !v)}
            aria-expanded={featuresOpen}
            aria-haspopup="true"
            className={cn(
              "inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
              "text-ink hover:bg-surface-soft hover:text-brand-deep",
              featuresOpen && "bg-surface-soft text-brand-deep",
            )}
          >
            Features
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                featuresOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>

          {featuresOpen ? (
            <FeaturesMegaMenu onClose={() => setFeaturesOpen(false)} />
          ) : null}
        </nav>

        {/* Rechts: Login + CTA + Mobile-Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/login"
            className="hidden sm:inline-flex text-sm font-medium transition-colors px-3 py-1.5 rounded-full text-ink hover:text-brand-deep"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-full transition-all bg-ink text-white hover:bg-ink/90 shadow-[0_4px_18px_-4px_rgba(15,23,42,0.45)]"
          >
            Zugang erhalten
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Menü schließen" : "Menü öffnen"}
            className="md:hidden inline-flex items-center justify-center size-9 rounded-full transition-colors text-ink hover:bg-surface-soft"
          >
            {mobileOpen ? (
              <X className="size-5" aria-hidden />
            ) : (
              <Menu className="size-5" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {/* Mobile-Menü */}
      {mobileOpen ? (
        <nav className="md:hidden border-t px-6 py-3 flex flex-col border-line">
          {[
            { href: "#demo", label: "Live-Demo" },
            { href: "#how-it-works", label: "Ablauf" },
            { href: "#features", label: "Features" },
            { href: "#pricing", label: "Preise" },
            { href: "#faq", label: "FAQ" },
            { href: "/login", label: "Login" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className="py-2.5 text-[15px] font-medium transition-colors text-ink hover:text-brand-deep"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-full text-sm font-medium transition-colors text-ink hover:bg-surface-soft hover:text-brand-deep"
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Features Mega-Menue
// ---------------------------------------------------------------------------

type Feature = {
  id: string;
  label: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  gradient: [string, string];
};

const FEATURES: ReadonlyArray<Feature> = [
  {
    id: "video",
    label: "Videogenerierung",
    sub: "Persönliche Outreach-Videos in Serie",
    icon: Video,
    gradient: ["#EC4899", "#BE185D"],
  },
  {
    id: "landingpage",
    label: "Landingpage-Generierung",
    sub: "Eigene Landingpage pro Lead, automatisch",
    icon: Globe,
    gradient: ["#7C5CE8", "#5232C7"],
  },
  {
    id: "letter",
    label: "Briefgenerierung",
    sub: "Druckfertige PDFs mit QR-Code",
    icon: Mail,
    gradient: ["#F97316", "#C2410C"],
  },
  {
    id: "analytics",
    label: "Analytics",
    sub: "Öffnungen, Watch-Time und Klicks live",
    icon: LineChart,
    gradient: ["#0EA5E9", "#0369A1"],
  },
  {
    id: "push",
    label: "Push-Notifications",
    sub: "Sofort wissen, wer reagiert",
    icon: Bell,
    gradient: ["#10B981", "#047857"],
  },
  {
    id: "ab",
    label: "A/B-Testing",
    sub: "Templates und CTAs gegeneinander testen",
    icon: FlaskConical,
    gradient: ["#FBBF24", "#B45309"],
  },
  {
    id: "integrations",
    label: "Anbindungen",
    sub: "HubSpot, Salessuite, Close, Zapier, Make",
    icon: Plug,
    gradient: ["#8B5CF6", "#6D28D9"],
  },
];

function FeaturesMegaMenu({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="menu"
      className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-[680px] vc-mega-fade-in"
    >
      <Squircle radius={22} shadow="float" className="bg-white">
      <div className="p-3 grid grid-cols-2 gap-1">
        {FEATURES.map((f) => (
          <FeatureItem key={f.id} feature={f} />
        ))}
        {/* Letzter Slot = "Alle Features"-CTA */}
        <Link
          href="#how-it-works"
          onClick={onClose}
          className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl transition-colors group text-ink hover:bg-surface-soft"
        >
          <div>
            <div className="text-sm font-semibold">Wie alles zusammenspielt</div>
            <div className="text-xs mt-0.5 text-ink-muted">
              Drei Schritte vom Take zur Antwort
            </div>
          </div>
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5 text-ink-muted"
            aria-hidden
          />
        </Link>
      </div>

      <style>{`
        @keyframes vc-mega-fade-in {
          0%   { opacity: 0; transform: translate(-50%, -6px); }
          100% { opacity: 1; transform: translate(-50%, 0); }
        }
        .vc-mega-fade-in { animation: vc-mega-fade-in 220ms cubic-bezier(0.2,0.8,0.2,1) forwards; }
      `}</style>
      </Squircle>
    </div>
  );
}

function FeatureItem({ feature }: { feature: Feature }) {
  const Icon = feature.icon;
  return (
    <Link
      href={`#${feature.id}`}
      role="menuitem"
      className="flex items-start gap-3 px-3 py-3 rounded-xl transition-colors group hover:bg-surface-soft"
    >
      <div
        className="shrink-0 size-10 rounded-xl flex items-center justify-center text-white shadow-lg"
        style={{
          background: `linear-gradient(135deg, ${feature.gradient[0]}, ${feature.gradient[1]})`,
          boxShadow: `0 6px 16px -4px ${feature.gradient[1]}55`,
        }}
      >
        <Icon className="size-5" />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="text-sm font-semibold leading-tight text-ink">
          {feature.label}
        </div>
        <div className="text-xs mt-0.5 leading-snug text-ink-muted">
          {feature.sub}
        </div>
      </div>
    </Link>
  );
}
