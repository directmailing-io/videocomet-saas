"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/analytics", label: "Übersicht", icon: BarChart3, match: "/analytics" },
  { href: "/aktivitaet", label: "Live-Feed", icon: Activity, match: "/aktivitaet" },
] as const;

export function AnalyticsSectionNav() {
  const pathname = usePathname() ?? "";
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-canvas-deep p-1">
      {TABS.map(({ href, label, icon: Icon, match }) => {
        const active = pathname === match || pathname.startsWith(match + "/");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 h-8 px-3 rounded-full text-xs font-semibold transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
              active
                ? "bg-surface text-ink shadow-card"
                : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
