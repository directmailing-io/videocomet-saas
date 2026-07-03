"use client";

import * as React from "react";
import Link from "next/link";
import {
  Search,
  Users,
  Mail,
  Building2,
  Trash2,
  Loader2,
  ExternalLink,
  X,
  AlertTriangle,
  ArrowUpDown,
  Filter,
  Eye,
  Play,
  MousePointerClick,
  Clock,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

interface OccurrenceSummary {
  campaignId: string;
  campaignName: string;
  runId: string;
  runName: string;
  leadId: string;
  slug: string | null;
  pageUrl: string | null;
}

interface ContactSummary {
  masterLeadId: string;
  displayName: string;
  email: string | null;
  company: string | null;
  city: string | null;
  campaignCount: number;
  runCount: number;
  lastSeenAt: string;
  occurrences: OccurrenceSummary[];
}

interface Occurrence extends OccurrenceSummary {
  videoUrl: string | null;
  pdfUrl: string | null;
  status: string;
  createdAt: string;
  rawData: Record<string, unknown>;
  viewCount: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  playCount: number;
  watchTimeSec: number;
  ctaClickCount: number;
  lastCtaAt: string | null;
}

interface ContactDetail extends ContactSummary {
  occurrences: Occurrence[];
}

type SortKey = "recent" | "name-asc" | "occurrences-desc";

export function ContactsView({ userId: _userId }: { userId: string }) {
  const { toast } = useToast();
  const [contacts, setContacts] = React.useState<ContactSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<SortKey>("recent");
  const [duplicatesOnly, setDuplicatesOnly] = React.useState(false);
  const [campaignFilter, setCampaignFilter] = React.useState<string>("__all__");
  const [campaignOptions, setCampaignOptions] = React.useState<
    Array<{ id: string; name: string }>
  >([]);
  const [selectedDetail, setSelectedDetail] = React.useState<ContactDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const load = React.useCallback(
    async (
      searchQuery: string,
      sortKey: SortKey,
      dupOnly: boolean,
      campaignId: string,
      withOptions: boolean,
    ) => {
      setLoading(true);
      try {
        const url = new URL("/api/contacts", window.location.origin);
        if (searchQuery.trim().length >= 2) url.searchParams.set("search", searchQuery.trim());
        url.searchParams.set("sort", sortKey);
        if (dupOnly) url.searchParams.set("duplicatesOnly", "1");
        if (campaignId && campaignId !== "__all__") {
          url.searchParams.set("campaignId", campaignId);
        }
        if (withOptions) url.searchParams.set("withOptions", "1");
        url.searchParams.set("limit", "100");
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) throw new Error("Load failed");
        const json = await res.json();
        setContacts(json.contacts ?? []);
        setTotal(json.total ?? 0);
        if (json.options) setCampaignOptions(json.options.campaigns ?? []);
      } catch (err) {
        toast({
          variant: "danger",
          title: "Kontakte konnten nicht geladen werden",
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  // Initial load + optionen
  React.useEffect(() => {
    void load("", "recent", false, "__all__", true);
  }, [load]);

  // Reload bei Filter-Änderungen (debounced)
  React.useEffect(() => {
    const t = setTimeout(() => {
      void load(search, sort, duplicatesOnly, campaignFilter, false);
    }, 250);
    return () => clearTimeout(t);
  }, [search, sort, duplicatesOnly, campaignFilter, load]);

  async function openDetail(masterLeadId: string) {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/contacts/${masterLeadId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Detail load failed");
      const json = (await res.json()) as ContactDetail;
      setSelectedDetail(json);
    } catch (err) {
      toast({
        variant: "danger",
        title: "Detail konnte nicht geladen werden",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDetailLoading(false);
    }
  }

  const hasActiveFilter = duplicatesOnly || campaignFilter !== "__all__";

  return (
    <>
      <PageHeader
        title="Alle Kontakte"
        subtitle={
          loading
            ? "Lade …"
            : `${total.toLocaleString("de-DE")} ${hasActiveFilter ? "gefilterte" : "eindeutige"} Kontakte`
        }
      />

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nach Name, E-Mail oder Firma suchen …"
            className="pl-10"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="sm:w-52">
            <ArrowUpDown className="size-3.5 mr-1 text-ink-muted" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Zuletzt kontaktiert</SelectItem>
            <SelectItem value="name-asc">Name (A-Z)</SelectItem>
            <SelectItem value="occurrences-desc">Meiste Vorkommen</SelectItem>
          </SelectContent>
        </Select>
        <Select value={campaignFilter} onValueChange={setCampaignFilter}>
          <SelectTrigger className="sm:w-56">
            <Filter className="size-3.5 mr-1 text-ink-muted" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Alle Kampagnen</SelectItem>
            {campaignOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => setDuplicatesOnly((v) => !v)}
          className={cn(
            "px-3 py-2 rounded-squircle-sm text-xs font-semibold border transition-colors whitespace-nowrap",
            duplicatesOnly
              ? "bg-brand-soft border-brand text-brand-deep"
              : "bg-white border-line text-ink-muted hover:text-ink",
          )}
        >
          Nur Duplikate
        </button>
      </div>

      {loading && contacts.length === 0 ? (
        <div className="py-24 text-center text-ink-muted text-sm">
          <Loader2 className="size-4 animate-spin inline mr-2" /> Lade Kontakte …
        </div>
      ) : contacts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-ink-muted">
            <Users className="size-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              {search
                ? `Keine Kontakte für „${search}" gefunden.`
                : hasActiveFilter
                  ? "Keine Kontakte mit diesen Filtern."
                  : "Noch keine Kontakte importiert. Starte eine Runde in einer Kampagne."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-line">
              {contacts.map((c) => (
                <ContactRow key={c.masterLeadId} contact={c} onOpen={openDetail} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedDetail && (
        <ContactDetailDrawer
          detail={selectedDetail}
          loading={detailLoading}
          onClose={() => setSelectedDetail(null)}
          onDeleted={() => {
            setSelectedDetail(null);
            void load(search, sort, duplicatesOnly, campaignFilter, false);
          }}
        />
      )}
    </>
  );
}

function ContactRow({
  contact,
  onOpen,
}: {
  contact: ContactSummary;
  onOpen: (masterLeadId: string) => void;
}) {
  // Zeige max 3 Kampagnen/Runden inline, Rest als "+N mehr" Badge.
  const uniqueCampaigns = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const o of contact.occurrences) m.set(o.campaignId, o.campaignName);
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [contact.occurrences]);

  const visibleCampaigns = uniqueCampaigns.slice(0, 3);
  const hiddenCount = uniqueCampaigns.length - visibleCampaigns.length;

  return (
    <div className="px-4 py-3 hover:bg-surface-muted/40 transition-colors">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => onOpen(contact.masterLeadId)}
          className="size-9 rounded-full bg-brand-soft flex items-center justify-center text-brand-deep font-semibold text-sm shrink-0"
        >
          {contact.displayName.substring(0, 2).toUpperCase()}
        </button>
        <button
          type="button"
          onClick={() => onOpen(contact.masterLeadId)}
          className="flex-1 min-w-0 text-left"
        >
          <div className="text-sm font-semibold text-ink truncate">
            {contact.displayName}
          </div>
          <div className="text-xs text-ink-muted truncate flex items-center gap-3 mt-0.5">
            {contact.email && (
              <span className="inline-flex items-center gap-1">
                <Mail className="size-3" />
                {contact.email}
              </span>
            )}
            {contact.company && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3" />
                {contact.company}
              </span>
            )}
          </div>
        </button>
      </div>
      {/* Kampagnen-Chips + URL-Chips inline */}
      <div className="mt-2 ml-13 pl-1 flex flex-wrap gap-1.5">
        {visibleCampaigns.map((c) => (
          <Link
            key={c.id}
            href={`/kampagnen/${c.id}`}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-brand-soft/60 text-brand-deep hover:bg-brand-soft transition-colors"
          >
            {c.name}
          </Link>
        ))}
        {hiddenCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-surface-muted text-ink-muted">
            +{hiddenCount} mehr
          </span>
        )}
        <Badge variant="neutral" className="text-[10px]">
          {contact.runCount} {contact.runCount === 1 ? "Runde" : "Runden"}
        </Badge>
        {contact.occurrences
          .filter((o) => o.pageUrl)
          .slice(0, 3)
          .map((o) => (
            <a
              key={o.leadId}
              href={o.pageUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-white border border-line text-ink-muted hover:text-brand-deep hover:border-brand-soft transition-colors"
              title={o.pageUrl ?? undefined}
            >
              <ExternalLink className="size-2.5" />
              {o.slug}
            </a>
          ))}
      </div>
    </div>
  );
}

/**
 * Zeigt ein einzelnes Vorkommen: Kampagne + Runde als Links, Status,
 * URLs (Landingpage/Video/PDF) UND das Tracking der Aktivität.
 *
 * Tracking-Anzeige richtet sich nach dem was passiert ist:
 *   - Keine Aktivität → "Noch nicht geöffnet"
 *   - Views > 0       → Anzahl + letzter Öffnung
 *   - Video-Plays     → Anzahl + gesamte Watch-Time
 *   - CTA-Clicks      → Anzahl + letzter Klick
 */
function OccurrenceCard({ occ }: { occ: Occurrence }) {
  const hasActivity =
    occ.viewCount > 0 || occ.playCount > 0 || occ.ctaClickCount > 0;

  const formatWatchTime = (sec: number): string => {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")} min`;
  };

  const formatRelative = (iso: string): string => {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "gerade eben";
    if (diffMin < 60) return `vor ${diffMin} Min.`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `vor ${diffH} Std.`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `vor ${diffD} Tag${diffD === 1 ? "" : "en"}`;
    return d.toLocaleDateString("de-DE");
  };

  return (
    <div className="rounded-squircle-md border border-line p-3 text-sm">
      {/* Kopf: Kampagne + Runde + Status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/kampagnen/${occ.campaignId}`}
            className="font-semibold text-ink truncate hover:text-brand-deep"
          >
            {occ.campaignName}
          </Link>
          <div className="text-xs text-ink-muted">
            <Link
              href={`/kampagnen/${occ.campaignId}/runs/${occ.runId}`}
              className="hover:text-brand-deep"
            >
              Runde: {occ.runName}
            </Link>
            {" · "}
            {new Date(occ.createdAt).toLocaleDateString("de-DE")}
          </div>
        </div>
        <Badge
          variant={occ.status === "completed" ? "success" : "neutral"}
          className="text-[10px] shrink-0"
        >
          {occ.status}
        </Badge>
      </div>

      {/* URLs */}
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {occ.pageUrl && (
          <a
            href={occ.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-brand-soft/60 text-brand-deep hover:bg-brand-soft"
          >
            <ExternalLink className="size-3" />
            Landingpage
          </a>
        )}
        {occ.videoUrl && (
          <a
            href={occ.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white border border-line text-ink-muted hover:text-ink"
          >
            <ExternalLink className="size-3" />
            Video
          </a>
        )}
        {occ.pdfUrl && (
          <a
            href={occ.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white border border-line text-ink-muted hover:text-ink"
          >
            <ExternalLink className="size-3" />
            PDF
          </a>
        )}
      </div>

      {/* Tracking / Aktivität */}
      <div className="mt-3 pt-3 border-t border-line-soft">
        <div className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-2">
          Aktivität
        </div>
        {!hasActivity ? (
          <div className="text-xs text-ink-muted italic">
            Noch keine Aktivität — der Kontakt hat die Landingpage noch nicht
            geöffnet.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ActivityStat
              icon={<Eye className="size-3.5" />}
              label="Aufrufe"
              value={occ.viewCount.toString()}
              detail={
                occ.lastViewedAt
                  ? `Zuletzt ${formatRelative(occ.lastViewedAt)}`
                  : undefined
              }
              active={occ.viewCount > 0}
            />
            <ActivityStat
              icon={<Play className="size-3.5" />}
              label="Video gestartet"
              value={occ.playCount.toString()}
              detail={
                occ.watchTimeSec > 0
                  ? `${formatWatchTime(occ.watchTimeSec)} gesehen`
                  : undefined
              }
              active={occ.playCount > 0}
            />
            <ActivityStat
              icon={<MousePointerClick className="size-3.5" />}
              label="CTA geklickt"
              value={occ.ctaClickCount.toString()}
              detail={
                occ.lastCtaAt
                  ? `Zuletzt ${formatRelative(occ.lastCtaAt)}`
                  : undefined
              }
              active={occ.ctaClickCount > 0}
            />
            <ActivityStat
              icon={<Clock className="size-3.5" />}
              label="Erst-Öffnung"
              value={occ.firstViewedAt ? formatRelative(occ.firstViewedAt) : "—"}
              detail={undefined}
              active={Boolean(occ.firstViewedAt)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityStat({
  icon,
  label,
  value,
  detail,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string | undefined;
  active: boolean;
}) {
  return (
    <div className={cn("min-w-0", !active && "opacity-40")}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-muted mb-0.5">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-sm font-semibold text-ink tabular-nums">
        {value}
      </div>
      {detail && (
        <div className="text-[10px] text-ink-muted truncate mt-0.5">
          {detail}
        </div>
      )}
    </div>
  );
}

function ContactDetailDrawer({
  detail,
  loading,
  onClose,
  onDeleted,
}: {
  detail: ContactDetail;
  loading: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [deleteConfirm, setDeleteConfirm] = React.useState("");
  const [showDeleteBox, setShowDeleteBox] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const requiredConfirmation = "DAUERHAFT LÖSCHEN";
  const canDelete = deleteConfirm === requiredConfirmation;

  async function handleDelete() {
    if (!canDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/contacts/${detail.masterLeadId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "user_request", confirmation: requiredConfirmation }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Delete failed");
      toast({
        variant: "success",
        title: `${json.deleted} Vorkommen gelöscht`,
        description: `Alle Spuren dieses Kontakts wurden aus ${detail.campaignCount} Kampagnen entfernt.`,
      });
      onDeleted();
    } catch (err) {
      toast({
        variant: "danger",
        title: "Löschen fehlgeschlagen",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-2xl sm:rounded-t-3xl sm:rounded-b-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5 border-b border-line">
          <div className="size-12 rounded-full bg-brand-soft flex items-center justify-center text-brand-deep font-bold shrink-0">
            {detail.displayName.substring(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold text-ink truncate">
              {detail.displayName}
            </div>
            <div className="text-xs text-ink-muted mt-0.5 flex flex-wrap gap-3">
              {detail.email && (
                <span className="inline-flex items-center gap-1">
                  <Mail className="size-3" /> {detail.email}
                </span>
              )}
              {detail.company && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="size-3" /> {detail.company}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-ink"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="py-8 text-center text-sm text-ink-muted">
              <Loader2 className="size-4 animate-spin inline mr-2" /> Lade Details …
            </div>
          ) : (
            <>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                  Vorkommen ({detail.occurrences.length})
                </h3>
                <div className="space-y-2">
                  {detail.occurrences.map((occ) => (
                    <OccurrenceCard key={occ.leadId} occ={occ} />
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                  Importierte Daten
                </h3>
                <div className="rounded-squircle-md border border-line p-3 bg-surface-muted/40">
                  <dl className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                    {Object.entries(detail.occurrences[0]?.rawData ?? {}).map(
                      ([k, v]) => (
                        <React.Fragment key={k}>
                          <dt className="text-ink-muted truncate">{k}</dt>
                          <dd className="text-ink font-mono truncate">
                            {String(v ?? "—")}
                          </dd>
                        </React.Fragment>
                      ),
                    )}
                  </dl>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-line p-4 bg-red-50/50">
          {!showDeleteBox ? (
            <Button
              variant="ghost"
              onClick={() => setShowDeleteBox(true)}
              iconLeft={<Trash2 className="size-4" />}
              className="text-red-600 hover:bg-red-100"
            >
              Kontakt endgültig löschen (DSGVO)
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 text-red-600 shrink-0 mt-0.5" />
                <div className="text-xs text-red-900">
                  <strong>Achtung:</strong> Diese Aktion entfernt alle Spuren
                  dieses Kontakts aus{" "}
                  <strong>{detail.campaignCount} Kampagnen</strong>,{" "}
                  <strong>{detail.runCount} Runden</strong>, inkl. aller
                  personalisierten Videos, PDFs, QR-Codes und URLs. Nicht
                  rückgängig zu machen. Tippe unten „DAUERHAFT LÖSCHEN".
                </div>
              </div>
              <Input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder="DAUERHAFT LÖSCHEN eintippen"
                className={cn(
                  "text-sm",
                  canDelete && "border-red-500 focus:ring-red-500/20",
                )}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowDeleteBox(false);
                    setDeleteConfirm("");
                  }}
                  disabled={deleting}
                >
                  Abbrechen
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDelete}
                  disabled={!canDelete || deleting}
                  iconLeft={
                    deleting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )
                  }
                >
                  Endgültig löschen
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
