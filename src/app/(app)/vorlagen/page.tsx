import Link from "next/link";
import { ArrowRight, AtSign, LayoutTemplate, Mail } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Vorlagen-Hub: Einstiegspunkt für die drei Vorlagen-Bereiche
 * (Nav-Neuordnung 2026-08-28, eigener Nav-Punkt „Vorlagen").
 */
const ITEMS = [
  {
    href: "/landingpages",
    icon: LayoutTemplate,
    title: "Landingpage-Vorlagen",
    text: "Die Seiten, auf denen deine Empfänger ihr persönliches Video ansehen.",
  },
  {
    href: "/umschlaege",
    icon: Mail,
    title: "Umschlag-Vorlagen",
    text: "Gestaltung für bedruckte Briefumschläge mit QR-Code.",
  },
  {
    href: "/email-vorlagen",
    icon: AtSign,
    title: "E-Mail-Vorlagen",
    text: "Texte für den E-Mail-Versand deiner Video-Links.",
  },
];

export default function VorlagenPage() {
  return (
    <>
      <PageHeader
        title="Vorlagen"
        subtitle="Einmal gestalten, in jeder Kampagne wiederverwenden."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {ITEMS.map(({ href, icon: Icon, title, text }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-start gap-4 rounded-squircle-md bg-surface p-5 shadow-card transition-all duration-200 hover:shadow-card-hover"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft">
              <Icon className="size-5 text-brand-deep" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink group-hover:text-brand-deep">
                {title}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="mt-0.5 block text-xs text-ink-muted">{text}</span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
