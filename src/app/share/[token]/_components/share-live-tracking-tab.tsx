"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SerializableShareEvent } from "../share-dashboard";
import { formatRelativeDE, formatTimeDE } from "../share-dashboard";

interface ShareLiveTrackingTabProps {
  token: string;
  initialEvents: SerializableShareEvent[];
  appUrl: string;
}

/**
 * Bucket-Map: rohe Event-Kinds → grobe UI-Kategorie. Die Filter unten sind
 * nach diesen Buckets gruppiert (statt nach den 13+ einzelnen kinds), damit
 * der Empfänger drei einfache Toggles statt einer Wand aus Checkboxen sieht.
 */
type Bucket = "view" | "video" | "cta" | "other";

const KIND_BUCKET: Record<string, Bucket> = {
  // View
  page_view: "view",
  lead_open: "view",
  section_view: "view",
  scroll_depth: "view",
  time_on_page: "view",
  // Video
  video_play: "video",
  video_progress: "video",
  video_ended: "video",
  video_mute: "video",
  video_unmute: "video",
  // CTA
  cta_click: "cta",
  cta_hover: "cta",
  cta_view: "cta",
  link_click: "cta",
};

function bucketFor(kind: string): Bucket {
  return KIND_BUCKET[kind] ?? "other";
}

const BUCKET_DOT_COLOR: Record<Bucket, string> = {
  view: "bg-ink-muted",
  video: "bg-brand",
  cta: "bg-warn",
  other: "bg-line",
};

/**
 * Mensch-lesbare Beschreibung pro Event-Kind. Bewusst auf Recipient-Sprache
 * getrimmt — keine internen Begriffe wie "section_view" oder "scroll_depth"
 * im UI sichtbar.
 */
function describeKind(
  kind: string,
  payload?: Record<string, unknown> | null,
): string {
  switch (kind) {
    case "page_view":
    case "lead_open":
      return "hat die Landingpage geöffnet";
    case "section_view":
      return "hat einen Abschnitt betrachtet";
    case "scroll_depth": {
      const raw =
        payload && typeof payload.maxPct === "number"
          ? (payload.maxPct as number)
          : payload && typeof payload.percent === "number"
            ? (payload.percent as number)
            : null;
      return raw !== null
        ? `hat ${Math.round(raw)} % der Seite gescrollt`
        : "hat weit gescrollt";
    }
    case "time_on_page": {
      const sec =
        payload && typeof payload.seconds === "number"
          ? Math.round(payload.seconds as number)
          : null;
      return sec !== null ? `war ${sec} s auf der Seite` : "verweilte auf der Seite";
    }
    case "video_play":
      return "hat das Video gestartet";
    case "video_progress": {
      const atSec =
        payload && typeof payload.atSec === "number"
          ? (payload.atSec as number)
          : null;
      const duration =
        payload && typeof payload.duration === "number"
          ? (payload.duration as number)
          : null;
      if (atSec !== null && duration && duration > 0) {
        const pct = Math.min(100, Math.round((atSec / duration) * 100));
        return `hat ${pct} % des Videos gesehen`;
      }
      return "hat das Video weitergesehen";
    }
    case "video_ended":
      return "hat das Video komplett gesehen";
    case "video_mute":
      return "hat den Ton stumm geschaltet";
    case "video_unmute":
      return "hat den Ton eingeschaltet";
    case "cta_click": {
      const label =
        payload && typeof payload.label === "string"
          ? (payload.label as string)
          : null;
      return label ? `hat den CTA „${label}" geklickt` : "hat den CTA geklickt";
    }
    case "cta_view":
      return "hat den CTA gesehen";
    case "cta_hover":
      return "hat den CTA überflogen";
    case "link_click": {
      const href =
        payload && typeof payload.href === "string"
          ? (payload.href as string)
          : null;
      return href ? `hat einen Link geklickt: ${href}` : "hat einen Link geklickt";
    }
    default:
      return `Aktivität: ${kind.replace(/_/g, " ")}`;
  }
}

interface BucketFilters {
  view: boolean;
  video: boolean;
  cta: boolean;
}

const POLL_INTERVAL_MS = 10_000;
const HIGHLIGHT_DURATION_MS = 2_000;
const MAX_EVENTS_IN_MEMORY = 500;

/**
 * Live-Tracking-Tab. Pollt `GET /api/share/<token>/events?since=…` alle 10 s
 * solange das Tab sichtbar ist. Neue Events werden vorne eingefügt und kurz
 * gehighlighted, alte werden bei >500 Events abgeschnitten (Memory-Cap).
 */
export function ShareLiveTrackingTab({
  token,
  initialEvents,
  appUrl,
}: ShareLiveTrackingTabProps) {
  const [events, setEvents] = React.useState<SerializableShareEvent[]>(initialEvents);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<BucketFilters>({
    view: true,
    video: true,
    cta: true,
  });
  const [newIds, setNewIds] = React.useState<Set<string>>(new Set());

  // `lastTs` ist die jüngste bekannte Event-Zeit — wird für `?since=` genutzt.
  // Wir tracken sie in einem Ref damit der Polling-Effekt nicht bei jedem
  // neuen Event neu anspringt (das würde den Interval ständig neu starten).
  const lastTsRef = React.useRef<string | null>(
    initialEvents[0]?.ts ?? null,
  );

  // 1s-Ticker damit die relative Zeit ("vor 12 Sekunden") sichtbar weiterläuft.
  // Bewusst getrennt vom Daten-Polling, damit die UI auch bei stillen Phasen
  // refreshed.
  const [, forceTick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const id = window.setInterval(forceTick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Polling-Loop. Stoppt während `document.hidden` true ist und resumed beim
  // visibilitychange, damit ein verstecktes Tab keinen unnötigen Traffic
  // erzeugt.
  React.useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    const poll = async () => {
      if (cancelled || document.hidden) return;
      controller = new AbortController();
      try {
        const params = new URLSearchParams();
        const since = lastTsRef.current;
        if (since) params.set("since", since);
        params.set("limit", "200");
        const res = await fetch(
          `/api/share/${encodeURIComponent(token)}/events?${params.toString()}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          events?: SerializableShareEvent[];
        };
        const incoming = Array.isArray(data.events) ? data.events : [];
        if (incoming.length === 0) return;
        // Wir sortieren defensiv (Backend gibt sie DESC, aber besser safe):
        const sorted = [...incoming].sort((a, b) =>
          a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0,
        );
        // Update `lastTs` auf das jetzt Aktuellste, BEVOR wir mergen, damit
        // konkurrierende Polls keine Duplikate produzieren.
        const newest = sorted[0]?.ts;
        if (newest && (!lastTsRef.current || newest > lastTsRef.current)) {
          lastTsRef.current = newest;
        }
        setEvents((prev) => mergeEvents(prev, sorted));
        const newIdList = sorted.map((e) => e.id);
        setNewIds((cur) => {
          const next = new Set(cur);
          newIdList.forEach((id) => next.add(id));
          return next;
        });
        // Highlight wieder weg-faden.
        window.setTimeout(() => {
          setNewIds((cur) => {
            const next = new Set(cur);
            newIdList.forEach((id) => next.delete(id));
            return next;
          });
        }, HIGHLIGHT_DURATION_MS);
      } catch {
        // AbortError oder Netzwerkfehler — nächster Poll versucht's erneut.
      }
    };

    // Kickoff direkt nach Mount, dann alle 10s.
    void poll();
    const intervalId = window.setInterval(() => void poll(), POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (!document.hidden) {
        // Nach dem Wiedersichtbarwerden sofort einen Catch-up-Poll.
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      controller?.abort();
    };
  }, [token]);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return events.filter((e) => {
      const b = bucketFor(e.kind);
      if (b === "other" && !(filters.view || filters.video || filters.cta)) {
        // alles aus → other auch raus
        return false;
      }
      if (b === "view" && !filters.view) return false;
      if (b === "video" && !filters.video) return false;
      if (b === "cta" && !filters.cta) return false;
      if (!term) return true;
      const fullName = `${e.leadFirstName ?? ""} ${e.leadLastName ?? ""}`
        .trim()
        .toLowerCase();
      return fullName.includes(term);
    });
  }, [events, search, filters]);

  const setFilter = (key: keyof BucketFilters) =>
    setFilters((f) => ({ ...f, [key]: !f[key] }));

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,auto] gap-3 items-center">
          <Input
            icon={<Search />}
            placeholder="Suche nach Lead-Name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-4">
            <FilterCheckbox
              checked={filters.view}
              onCheckedChange={() => setFilter("view")}
              label="View"
              dotClass={BUCKET_DOT_COLOR.view}
            />
            <FilterCheckbox
              checked={filters.video}
              onCheckedChange={() => setFilter("video")}
              label="Video"
              dotClass={BUCKET_DOT_COLOR.video}
            />
            <FilterCheckbox
              checked={filters.cta}
              onCheckedChange={() => setFilter("cta")}
              label="CTA"
              dotClass={BUCKET_DOT_COLOR.cta}
            />
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-muted">
          Noch keine Aktivität.
        </Card>
      ) : (
        <ul className="flex flex-col gap-2" role="feed" aria-label="Live-Aktivität">
          {filtered.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              appUrl={appUrl}
              isNew={newIds.has(event.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Event Row ───────────────────────────────────────────────────────────────

function EventRow({
  event,
  appUrl,
  isNew,
}: {
  event: SerializableShareEvent;
  appUrl: string;
  isNew: boolean;
}) {
  const bucket = bucketFor(event.kind);
  const fullName = [event.leadFirstName, event.leadLastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-squircle-md border border-line bg-surface px-4 py-3 transition-colors duration-1000",
        isNew && "bg-brand-soft border-brand-300",
      )}
    >
      <span
        className={cn(
          "mt-2 size-2 shrink-0 rounded-full",
          BUCKET_DOT_COLOR[bucket],
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {event.leadSlug ? (
            <a
              href={`${appUrl}/v/${event.leadSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-ink hover:text-brand-deep hover:underline"
            >
              {fullName || "Lead"}
            </a>
          ) : (
            <span className="text-sm font-semibold text-ink">
              {fullName || "Lead"}
            </span>
          )}
          <span className="text-xs text-ink-muted truncate">
            · {event.runName}
          </span>
        </div>
        <p className="text-sm text-ink-soft leading-snug">
          {describeKind(event.kind, event.payload)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <div
          className="text-xs tabular-nums text-ink"
          title={formatRelativeDE(event.ts)}
        >
          {formatTimeDE(event.ts)}
        </div>
        <div className="text-[10px] text-ink-muted">
          {formatRelativeDE(event.ts)}
        </div>
      </div>
    </li>
  );
}

// ── Tiny filter checkbox ────────────────────────────────────────────────────

function FilterCheckbox({
  checked,
  onCheckedChange,
  label,
  dotClass,
}: {
  checked: boolean;
  onCheckedChange: () => void;
  label: string;
  dotClass: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
      <Checkbox
        checked={checked}
        onCheckedChange={() => onCheckedChange()}
        aria-label={label}
      />
      <span
        className={cn("inline-block size-2 rounded-full", dotClass)}
        aria-hidden
      />
      <span>{label}</span>
    </label>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function mergeEvents(
  prev: SerializableShareEvent[],
  incoming: SerializableShareEvent[],
): SerializableShareEvent[] {
  if (incoming.length === 0) return prev;
  const seen = new Set(prev.map((e) => e.id));
  const toAdd = incoming.filter((e) => !seen.has(e.id));
  if (toAdd.length === 0) return prev;
  // toAdd ist DESC, prev ist DESC — prepend behält Sortierung.
  const merged = [...toAdd, ...prev];
  return merged.length > MAX_EVENTS_IN_MEMORY
    ? merged.slice(0, MAX_EVENTS_IN_MEMORY)
    : merged;
}
