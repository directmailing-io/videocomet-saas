"use client";

import * as React from "react";
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
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

interface ContactSummary {
  masterLeadId: string;
  displayName: string;
  email: string | null;
  company: string | null;
  city: string | null;
  campaignCount: number;
  runCount: number;
  lastSeenAt: string;
}

interface Occurrence {
  leadId: string;
  campaignId: string;
  campaignName: string;
  runId: string;
  runName: string;
  slug: string | null;
  videoUrl: string | null;
  pdfUrl: string | null;
  status: string;
  createdAt: string;
  rawData: Record<string, unknown>;
}

interface ContactDetail extends ContactSummary {
  occurrences: Occurrence[];
}

export function ContactsView({ userId: _userId }: { userId: string }) {
  const { toast } = useToast();
  const [contacts, setContacts] = React.useState<ContactSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [selectedDetail, setSelectedDetail] = React.useState<ContactDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const load = React.useCallback(async (searchQuery: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/contacts", window.location.origin);
      if (searchQuery.trim().length >= 2) url.searchParams.set("search", searchQuery.trim());
      url.searchParams.set("limit", "100");
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error("Load failed");
      const json = await res.json();
      setContacts(json.contacts ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      toast({
        variant: "danger",
        title: "Kontakte konnten nicht geladen werden",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void load(search);
    // Debounce für search
    const t = setTimeout(() => void load(search), 300);
    return () => clearTimeout(t);
  }, [search, load]);

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

  return (
    <>
      <PageHeader
        title="Alle Kontakte"
        subtitle={
          loading
            ? "Lade …"
            : `${total.toLocaleString("de-DE")} eindeutige Kontakte über alle Kampagnen`
        }
      />

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-muted" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nach Name, E-Mail oder Firma suchen …"
          className="pl-10"
        />
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
                : "Noch keine Kontakte importiert. Starte eine Runde in einer Kampagne."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-line">
              {contacts.map((c) => (
                <button
                  key={c.masterLeadId}
                  type="button"
                  onClick={() => openDetail(c.masterLeadId)}
                  className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-surface-muted/60 transition-colors"
                >
                  <div className="size-9 rounded-full bg-brand-soft flex items-center justify-center text-brand-deep font-semibold text-sm shrink-0">
                    {c.displayName.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ink truncate">
                      {c.displayName}
                    </div>
                    <div className="text-xs text-ink-muted truncate flex items-center gap-3 mt-0.5">
                      {c.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="size-3" />
                          {c.email}
                        </span>
                      )}
                      {c.company && (
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="size-3" />
                          {c.company}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.campaignCount > 1 && (
                      <Badge variant="brand" className="text-[10px]">
                        {c.campaignCount} Kampagnen
                      </Badge>
                    )}
                    <Badge variant="neutral" className="text-[10px]">
                      {c.runCount} {c.runCount === 1 ? "Runde" : "Runden"}
                    </Badge>
                  </div>
                </button>
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
            void load(search);
          }}
        />
      )}
    </>
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
  const [deleteConfirm, setDeleteConfirm] = React.useState<string>("");
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
        body: JSON.stringify({
          reason: "user_request",
          confirmation: requiredConfirmation,
        }),
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
        {/* Header */}
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

        {/* Content */}
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
                    <div
                      key={occ.leadId}
                      className="rounded-squircle-md border border-line p-3 text-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-ink truncate">
                            {occ.campaignName}
                          </div>
                          <div className="text-xs text-ink-muted">
                            Runde: {occ.runName} · {new Date(occ.createdAt).toLocaleDateString("de-DE")}
                          </div>
                        </div>
                        <Badge
                          variant={occ.status === "completed" ? "success" : "neutral"}
                          className="text-[10px] shrink-0"
                        >
                          {occ.status}
                        </Badge>
                      </div>
                      {occ.slug && (
                        <div className="mt-2 flex items-center gap-2 text-xs">
                          <ExternalLink className="size-3 text-ink-muted" />
                          <code className="text-ink-muted truncate">
                            /{occ.slug}
                          </code>
                        </div>
                      )}
                    </div>
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

        {/* Delete-Zone */}
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
