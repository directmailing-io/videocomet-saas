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
  /** Bereits zusammengesetzte URL-Basis pro Lead — `${leadBaseUrl}/${slug}`. */
  leadBaseUrl: string;
}

/**
 * Bucket-Map: rohe Event-Kinds → grobe UI-Kategorie. Die Public-Share-Sicht
 * zeigt bewusst nur drei Buckets — alle anderen Kinds werden serverseitig
 * bereits gefiltert (siehe `SHARE_ALLOWED_EVENT_KINDS`).
 */
type Bucket = "open" | "play" | "cta";

const KIND_BUCKET: Record<string, Bucket> = {
  // Page open
  page_view: "open",
  lead_open: "open",
  landingpage_open: "open",
  view: "open",
  // Video play
  video_play: "play",
  video_start: "play",
  play: "play",
  // CTA click
  cta_click: "cta",
};

function bucketFor(kind: string): Bucket | null {
  return KIND_BUCKET[kind] ?? null;
}

const BUCKET_DOT_COLOR: Record<Bucket, string> = {
  open: "bg-ink-muted",
  play: "bg-brand",
  cta: "bg-warn",
};

const BUCKET_LABEL: Record<Bucket, string> = {
  open: "Seite geöffnet",
  play: "Video abgespielt",
  cta: "CTA-Klick",
};

/**
 * Mensch-lesbare Beschreibung pro Event-Kind. Nur die drei Whitelist-Buckets
 * tauchen hier auf — alles andere ist serverseitig schon weg.
 */
function describeKind(
  kind: string,
  payload?: Record<string, unknown> | null,
): string {
  const bucket = bucketFor(kind);
  switch (bucket) {
    case "open":
      return "hat die Seite geöffnet";
    case "play":
      return "hat das Video abgespielt";
    case "cta": {
      const label =
        payload && typeof payload.label === "string"
          ? (payload.label as string)
          : null;
      return label ? `hat den CTA „${label}" geklickt` : "hat den CTA geklickt";
    }
    default:
      // Sollte serverseitig schon herausgefiltert sein — nie rohes Kind zeigen.
      return "war aktiv";
  }
}

interface BucketFilters {
  open: boolean;
  play: boolean;
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
  leadBaseUrl,
}: ShareLiveTrackingTabProps) {
  const [events, setEvents] = React.useState<SerializableShareEvent[]>(initialEvents);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<BucketFilters>({
    open: true,
    play: true,
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
      // Events außerhalb der Whitelist (sollten nicht ankommen) ausblenden.
      if (b === null) return false;
      if (b === "open" && !filters.open) return false;
      if (b === "play" && !filters.play) return false;
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
              checked={filters.open}
              onCheckedChange={() => setFilter("open")}
              label={BUCKET_LABEL.open}
              dotClass={BUCKET_DOT_COLOR.open}
            />
            <FilterCheckbox
              checked={filters.play}
              onCheckedChange={() => setFilter("play")}
              label={BUCKET_LABEL.play}
              dotClass={BUCKET_DOT_COLOR.play}
            />
            <FilterCheckbox
              checked={filters.cta}
              onCheckedChange={() => setFilter("cta")}
              label={BUCKET_LABEL.cta}
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
              leadBaseUrl={leadBaseUrl}
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
  leadBaseUrl,
  isNew,
}: {
  event: SerializableShareEvent;
  leadBaseUrl: string;
  isNew: boolean;
}) {
  const bucket = bucketFor(event.kind);
  // Falls ein nicht-Whitelist-Kind durch alte Caches kommt: defensive
  // Fallback-Farbe, damit der Render nicht crasht.
  const dotClass = bucket ? BUCKET_DOT_COLOR[bucket] : "bg-line";
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
          dotClass,
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {event.leadSlug ? (
            <a
              href={`${leadBaseUrl}/${event.leadSlug}`}
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
