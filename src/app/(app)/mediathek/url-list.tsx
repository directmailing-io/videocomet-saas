"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Library, Link2 } from "lucide-react";
import { UrlCard, type UrlCardItem } from "./url-card";
import {
  TYPE_LABEL,
  type MediaUrlType,
} from "@/lib/media-urls/detect-type";
import { cn } from "@/lib/utils";

interface Props {
  items: UrlCardItem[];
}

const TYPE_ORDER: MediaUrlType[] = [
  "gdoc",
  "gsheet",
  "gslides",
  "gform",
  "gdrive_file",
  "youtube",
  "generic",
];

export function UrlList({ items }: Props) {
  const [query, setQuery] = React.useState("");
  const [activeType, setActiveType] = React.useState<MediaUrlType | "all">("all");

  // Typ-Counts fuer die Chip-Anzeige.
  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const t of TYPE_ORDER) c[t] = 0;
    for (const i of items) c[i.type] = (c[i.type] ?? 0) + 1;
    return c;
  }, [items]);

  const visible = React.useMemo(() => {
    const lower = query.trim().toLowerCase();
    return items.filter((i) => {
      if (activeType !== "all" && i.type !== activeType) return false;
      if (!lower) return true;
      return (
        i.title.toLowerCase().includes(lower) ||
        i.url.toLowerCase().includes(lower) ||
        (i.description?.toLowerCase().includes(lower) ?? false)
      );
    });
  }, [items, query, activeType]);

  // Nur Typ-Chips zeigen, die mindestens einen Eintrag haben — schlankere UI.
  const visibleTypes = TYPE_ORDER.filter((t) => (counts[t] ?? 0) > 0);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Link2 />}
        title="Noch keine Links"
        subtitle="Lege deinen ersten Link an — z.B. das Brief-Template als Google Doc."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-ink-muted" />
          <Input
            type="search"
            placeholder="In Titel oder URL suchen …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterChip
            label="Alle"
            count={counts.all}
            active={activeType === "all"}
            onClick={() => setActiveType("all")}
          />
          {visibleTypes.map((t) => (
            <FilterChip
              key={t}
              label={TYPE_LABEL[t]}
              count={counts[t] ?? 0}
              active={activeType === t}
              onClick={() => setActiveType(t)}
            />
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Library />}
          title="Kein Treffer"
          subtitle="Versuche einen anderen Suchbegriff oder Filter."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((u) => (
            <UrlCard key={u.id} item={u} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-brand bg-brand text-white"
          : "border-line bg-surface text-ink-muted hover:bg-surface-muted",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
          active ? "bg-white/20" : "bg-ink/5",
        )}
      >
        {count}
      </span>
    </button>
  );
}
