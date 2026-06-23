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
  Plug,
  Video,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

/**
 * Marketing-Topnav mit drei Bereichen:
 *  - Links: Logo
 *  - Center: Live-Demo · Ablauf · Features (Mega-Menue)
 *  - Rechts: Login + "Zugang erhalten"-CTA
 *
 * Bleibt dunkel solange Hero + DemoSection sichtbar — Switch via
 * IntersectionObserver auf #how-it-works.
 */
export function MarketingNav() {
  const [overDark, setOverDark] = React.useState(true);
  const [featuresOpen, setFeaturesOpen] = React.useState(false);
  const menuWrapperRef = React.useRef<HTMLDivElement>(null);

  // Dark/Light je nach Scroll-Position. Light = ueber #how-it-works ODER
  // #features. Dark = alles davor und dazwischen liegende Dark-Sections.
  React.useEffect(() => {
    const ids = [
      "how-it-works",
      "features",
      "pricing",
      "faq",
      "page-footer",
    ];
    const targets = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (targets.length === 0) {
      const onScroll = () =>
        setOverDark(window.scrollY < window.innerHeight * 3.5);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }

    const visible = new Set<Element>();
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        });
        setOverDark(visible.size === 0);
      },
      { rootMargin: "-60px 0px -85% 0px", threshold: 0 },
    );
    targets.forEach((t) => obs.observe(t));
    return () => obs.disconnect();
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
        "fixed top-0 left-0 right-0 z-50 transition-colors duration-300 backdrop-blur-xl",
        overDark
          ? "bg-black/40 border-b border-white/[0.06]"
          : "bg-surface/85 border-b border-line",
      )}
    >
      <div className="max-w-6xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between gap-6">
        <Link
          href="/"
          aria-label="Zur Startseite"
          className="inline-flex items-center shrink-0"
        >
          <Logo
            className={cn(
              "transition-[filter] duration-300",
              overDark && "brightness-0 invert",
            )}
          />
        </Link>

        {/* Center nav */}
        <nav
          ref={menuWrapperRef}
          className="hidden md:flex items-center gap-1 relative"
        >
          <NavLink href="#demo" overDark={overDark}>
            Live-Demo
          </NavLink>
          <NavLink href="#how-it-works" overDark={overDark}>
            Ablauf
          </NavLink>
          <button
            type="button"
            onClick={() => setFeaturesOpen((v) => !v)}
            aria-expanded={featuresOpen}
            aria-haspopup="true"
            className={cn(
              "inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
              overDark
                ? "text-white/85 hover:bg-white/10 hover:text-white"
                : "text-ink hover:bg-surface-soft hover:text-brand-deep",
              featuresOpen &&
                (overDark
                  ? "bg-white/10 text-white"
                  : "bg-surface-soft text-brand-deep"),
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
            <FeaturesMegaMenu
              overDark={overDark}
              onClose={() => setFeaturesOpen(false)}
            />
          ) : null}
        </nav>

        {/* Rechts: Login + CTA */}
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/login"
            className={cn(
              "hidden sm:inline-flex text-sm font-medium transition-colors px-3 py-1.5 rounded-full",
              overDark
                ? "text-white/85 hover:text-white hover:bg-white/10"
                : "text-ink hover:text-brand-deep",
            )}
          >
            Login
          </Link>
          <Link
            href="/login"
            className={cn(
              "inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-full transition-all",
              overDark
                ? "bg-white text-ink hover:bg-white/90 shadow-[0_4px_18px_-4px_rgba(255,255,255,0.35)]"
                : "bg-ink text-white hover:bg-ink/90 shadow-[0_4px_18px_-4px_rgba(15,23,42,0.45)]",
            )}
          >
            Zugang erhalten
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  overDark,
  children,
}: {
  href: string;
  overDark: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
        overDark
          ? "text-white/85 hover:bg-white/10 hover:text-white"
          : "text-ink hover:bg-surface-soft hover:text-brand-deep",
      )}
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

function FeaturesMegaMenu({
  overDark,
  onClose,
}: {
  overDark: boolean;
  onClose: () => void;
}) {
  return (
    <div
      role="menu"
      className={cn(
        "absolute top-full left-1/2 -translate-x-1/2 mt-3 w-[680px] rounded-2xl border shadow-2xl overflow-hidden vc-mega-fade-in",
        overDark
          ? "bg-[#0F0F14]/95 backdrop-blur-xl border-white/10"
          : "bg-white backdrop-blur-xl border-line",
      )}
    >
      <div className="p-3 grid grid-cols-2 gap-1">
        {FEATURES.map((f) => (
          <FeatureItem key={f.id} feature={f} overDark={overDark} />
        ))}
        {/* Letzter Slot = "Alle Features"-CTA */}
        <Link
          href="#how-it-works"
          onClick={onClose}
          className={cn(
            "flex items-center justify-between gap-3 px-3 py-3 rounded-xl transition-colors group",
            overDark
              ? "text-white/85 hover:bg-white/10"
              : "text-ink hover:bg-surface-soft",
          )}
        >
          <div>
            <div className="text-sm font-semibold">Wie alles zusammenspielt</div>
            <div
              className={cn(
                "text-xs mt-0.5",
                overDark ? "text-white/55" : "text-ink-muted",
              )}
            >
              Sechs Schritte vom Take zur Antwort
            </div>
          </div>
          <ArrowRight
            className={cn(
              "size-4 transition-transform group-hover:translate-x-0.5",
              overDark ? "text-white/60" : "text-ink-muted",
            )}
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
    </div>
  );
}

function FeatureItem({
  feature,
  overDark,
}: {
  feature: Feature;
  overDark: boolean;
}) {
  const Icon = feature.icon;
  return (
    <Link
      href={`#${feature.id}`}
      role="menuitem"
      className={cn(
        "flex items-start gap-3 px-3 py-3 rounded-xl transition-colors group",
        overDark ? "hover:bg-white/[0.06]" : "hover:bg-surface-soft",
      )}
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
        <div
          className={cn(
            "text-sm font-semibold leading-tight",
            overDark ? "text-white" : "text-ink",
          )}
        >
          {feature.label}
        </div>
        <div
          className={cn(
            "text-xs mt-0.5 leading-snug",
            overDark ? "text-white/55" : "text-ink-muted",
          )}
        >
          {feature.sub}
        </div>
      </div>
    </Link>
  );
}
