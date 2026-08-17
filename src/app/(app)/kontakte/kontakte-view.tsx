"use client";

/**
 * Mini-CRM Kontakte-Ansicht (Etappe 2 · Attio-Style).
 *
 *   Sidebar links:   „Alle Kontakte" + eigene Listen + „+ Neue Liste"
 *   Haupt-Bereich:   Attio-artige Tabelle mit Inline-Edit
 *   Bulk-Aktion:     Ausgewählte in eine Liste stecken / entfernen / löschen
 *
 * Detail-Slide-Over kommt in Etappe 3. Filter (mit UND/ODER) kommt in
 * Etappe 4. Import kommt in Etappe 5. Import-URL + Zapier/Make in
 * Etappe 6. Diese Ansicht ist bewusst minimal, aber vollständig
 * funktional als Basis.
 */

import * as React from "react";
import Link from "next/link";
import {
  ChevronDown,
  Loader2,
  Plus,
  Search,
  Trash2,
  Users2,
} from "lucide-react";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { useRouter } from "next/navigation";
import { ContactDetailSlideOver } from "./contact-detail-slideover";
import { FilterBar } from "./filter-bar";
import { ImportModal } from "./import-modal";
import { StartRunModal } from "./start-run-modal";
import { FieldsModal } from "./fields-modal";
import { EMPTY_FILTER, type FilterDefinition } from "@/lib/contacts/filter";

interface ContactRow {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  company: string | null;
  companyDisplay: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  data: Record<string, string>;
  lastActivityAt: string | null;
  createdAt: string;
  campaignCount: number;
  runCount: number;
  totalOpens: number;
  totalPlays: number;
  totalCta: number;
  listNames: string[];
}

interface ContactList {
  id: string;
  name: string;
  description: string | null;
  type: "static" | "smart";
  color: string | null;
  icon: string | null;
  contactCount: number;
  autoRunCampaignId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface KontakteViewProps {
  userId: string;
}

type SortKey = "activity" | "recent" | "name";

const AKTIV_LABEL: Record<SortKey, string> = {
  activity: "Letzte Aktivität",
  recent: "Neu angelegt",
  name: "Nachname A→Z",
};

export function KontakteView(_props: KontakteViewProps) {
  const { toast } = useToast();
  const router = useRouter();

  const [lists, setLists] = React.useState<ContactList[]>([]);
  const [totalAll, setTotalAll] = React.useState(0);
  const [selectedListId, setSelectedListId] = React.useState<string | null>(null);

  const [contacts, setContacts] = React.useState<ContactRow[]>([]);
  const [contactsTotal, setContactsTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<SortKey>("activity");

  const [selectedContactIds, setSelectedContactIds] = React.useState<Set<string>>(new Set());
  const [showNewListModal, setShowNewListModal] = React.useState(false);
  const [showAddToListMenu, setShowAddToListMenu] = React.useState(false);
  // Detail-Slide-Over (Etappe 3): welchen Contact anzeigen?
  const [detailContactId, setDetailContactId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<FilterDefinition>(EMPTY_FILTER);
  const [showImportModal, setShowImportModal] = React.useState(false);
  const [showStartRunModal, setShowStartRunModal] = React.useState(false);
  const [showFieldsModal, setShowFieldsModal] = React.useState(false);

  const detailIndex = React.useMemo(() => {
    if (!detailContactId) return -1;
    return contacts.findIndex((c) => c.id === detailContactId);
  }, [detailContactId, contacts]);
  const goPrev = detailIndex > 0 ? () => setDetailContactId(contacts[detailIndex - 1].id) : undefined;
  const goNext =
    detailIndex >= 0 && detailIndex < contacts.length - 1
      ? () => setDetailContactId(contacts[detailIndex + 1].id)
      : undefined;

  const loadLists = React.useCallback(async () => {
    try {
      const res = await fetch("/api/contact-lists");
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler beim Laden der Listen");
      setLists(body.lists ?? []);
    } catch (err) {
      toast({
        title: "Listen konnten nicht geladen werden",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  }, [toast]);

  const loadContacts = React.useCallback(async () => {
    setLoading(true);
    try {
      const hasFilter = filter.conditions.length > 0;
      if (hasFilter) {
        // POST /filter mit Filter-Definition
        const res = await fetch("/api/contacts/v2/filter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filter,
            listId: selectedListId,
            search: search.trim().length >= 2 ? search.trim() : undefined,
            sort,
            limit: 500,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "Fehler beim Filtern");
        setContacts(body.contacts ?? []);
        setContactsTotal(body.total ?? 0);
        setTotalAll(body.totalAll ?? 0);
      } else {
        const params = new URLSearchParams();
        if (selectedListId) params.set("listId", selectedListId);
        if (search.trim().length >= 2) params.set("search", search.trim());
        params.set("sort", sort);
        params.set("limit", "500");
        const res = await fetch(`/api/contacts/v2?${params.toString()}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "Fehler beim Laden");
        setContacts(body.contacts ?? []);
        setContactsTotal(body.total ?? 0);
        setTotalAll(body.totalAll ?? 0);
      }
    } catch (err) {
      toast({
        title: "Kontakte konnten nicht geladen werden",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, [selectedListId, search, sort, filter, toast]);

  React.useEffect(() => {
    void loadLists();
  }, [loadLists]);
  React.useEffect(() => {
    void loadContacts();
    setSelectedContactIds(new Set());
  }, [loadContacts]);

  const selectedListName = React.useMemo(() => {
    if (!selectedListId) return "Alle Kontakte";
    return lists.find((l) => l.id === selectedListId)?.name ?? "Liste";
  }, [selectedListId, lists]);

  const allSelected =
    contacts.length > 0 && contacts.every((c) => selectedContactIds.has(c.id));

  function toggleAll() {
    if (allSelected) {
      setSelectedContactIds(new Set());
    } else {
      setSelectedContactIds(new Set(contacts.map((c) => c.id)));
    }
  }
  function toggleOne(id: string) {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAddToList(listId: string) {
    const ids = Array.from(selectedContactIds);
    if (ids.length === 0) return;
    setShowAddToListMenu(false);
    try {
      const res = await fetch(`/api/contact-lists/${listId}/memberships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: ids }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler beim Hinzufügen");
      toast({
        title: `${body.added ?? 0} Kontakt(e) zur Liste hinzugefügt`,
      });
      setSelectedContactIds(new Set());
      await loadLists();
    } catch (err) {
      toast({
        title: "Konnte Kontakte nicht zur Liste hinzufügen",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  }

  async function handleRemoveFromCurrentList() {
    if (!selectedListId) return;
    const ids = Array.from(selectedContactIds);
    if (ids.length === 0) return;
    if (
      !confirm(
        `${ids.length} Kontakt(e) aus dieser Liste entfernen? Die Kontakte selbst bleiben erhalten.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/contact-lists/${selectedListId}/memberships`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: ids }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler beim Entfernen");
      toast({ title: `${body.removed ?? 0} Kontakt(e) aus der Liste entfernt` });
      setSelectedContactIds(new Set());
      await Promise.all([loadLists(), loadContacts()]);
    } catch (err) {
      toast({
        title: "Konnte Kontakte nicht entfernen",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  }

  async function handleDeleteSelected() {
    const ids = Array.from(selectedContactIds);
    if (ids.length === 0) return;
    if (
      !confirm(
        `${ids.length} Kontakt(e) endgültig löschen? Die verknüpften Runden bleiben erhalten, verlieren aber die Kontakt-Zuordnung.`,
      )
    )
      return;
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/contacts/v2/${id}`, { method: "DELETE" }).then((r) => r.ok),
        ),
      );
      const ok = results.filter(Boolean).length;
      toast({ title: `${ok} Kontakt(e) gelöscht` });
      setSelectedContactIds(new Set());
      await Promise.all([loadLists(), loadContacts()]);
    } catch (err) {
      toast({
        title: "Löschen fehlgeschlagen",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  }

  return (
    <div className="min-h-full">
      <PageHeader
        title="Kontakte & Listen"
        subtitle="Deine Kontakte an einem Ort — sortiere sie in Listen und starte daraus neue Kampagnen."
      />

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4 mt-4">
        {/* Sidebar mit Listen */}
        <aside className="bg-surface rounded-2xl p-3 shadow-sm h-fit">
          <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide px-2 py-1">
            Listen
          </div>
          <button
            type="button"
            onClick={() => setSelectedListId(null)}
            className={cn(
              "w-full text-left px-2 py-1.5 rounded-lg text-sm flex items-center justify-between",
              selectedListId === null
                ? "bg-canvas-deep font-semibold text-ink"
                : "text-ink-muted hover:bg-canvas",
            )}
          >
            <span className="flex items-center gap-2">
              <Users2 className="size-3.5" />
              Alle Kontakte
            </span>
            <span className="text-xs text-ink-muted">{totalAll}</span>
          </button>

          <div className="mt-2 space-y-0.5">
            {lists.map((list) => (
              <button
                key={list.id}
                type="button"
                onClick={() => setSelectedListId(list.id)}
                className={cn(
                  "w-full text-left px-2 py-1.5 rounded-lg text-sm flex items-center justify-between",
                  selectedListId === list.id
                    ? "bg-canvas-deep font-semibold text-ink"
                    : "text-ink-muted hover:bg-canvas",
                )}
                title={list.description ?? undefined}
              >
                <span className="truncate">{list.name}</span>
                <span className="text-xs text-ink-muted ml-2 shrink-0">
                  {list.contactCount}
                </span>
              </button>
            ))}
            {lists.length === 0 && (
              <p className="text-xs text-ink-muted px-2 py-1.5">
                Noch keine Listen. Leg unten eine an.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowNewListModal(true)}
            className="mt-3 w-full text-left px-2 py-1.5 rounded-lg text-sm text-brand-deep font-semibold hover:bg-brand-soft flex items-center gap-1.5"
          >
            <Plus className="size-3.5" />
            Neue Liste
          </button>

          <div className="mt-4 pt-3 border-t border-line">
            <button
              type="button"
              onClick={() => setShowFieldsModal(true)}
              className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-ink-muted hover:bg-canvas flex items-center gap-1.5"
              title="Eigene Felder wie Priorität oder Praxis-Größe anlegen — gilt für alle Kontakte"
            >
              ⚙ Eigene Felder verwalten
            </button>
          </div>
        </aside>

        {/* Haupt-Bereich */}
        <div className="bg-surface rounded-2xl shadow-sm overflow-hidden">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-3 p-3 border-b border-line">
            <div className="text-base font-semibold text-ink flex-shrink-0">
              {selectedListName}
            </div>
            <div className="text-xs text-ink-muted flex-shrink-0">
              {contactsTotal} Kontakt{contactsTotal === 1 ? "" : "e"}
            </div>

            <div className="ml-auto flex gap-2 items-center flex-wrap">
              {selectedListId && contactsTotal > 0 && (
                <button
                  type="button"
                  onClick={() => setShowStartRunModal(true)}
                  className="px-3 py-1.5 rounded-lg bg-brand-deep text-white text-xs font-semibold hover:bg-brand flex items-center gap-1.5"
                  title="Aus dieser Liste eine Kampagne-Runde starten"
                >
                  Runde starten →
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowImportModal(true)}
                className="px-3 py-1.5 rounded-lg bg-ink text-white text-xs font-semibold hover:bg-brand-deep flex items-center gap-1.5"
              >
                <Plus className="size-3.5" />
                Kontakte importieren
              </button>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-ink-muted" />
                <input
                  type="text"
                  placeholder="Suchen…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-7 pr-2 py-1.5 rounded-lg border border-line bg-canvas text-sm w-48 focus:outline-none focus:border-brand"
                />
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="px-2 py-1.5 rounded-lg border border-line bg-canvas text-sm"
              >
                {(Object.keys(AKTIV_LABEL) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {AKTIV_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Filter-Bar (Etappe 4) */}
          <FilterBar
            value={filter}
            onChange={setFilter}
            matched={contactsTotal}
            onSaveAsList={async (name, type) => {
              const res = await fetch("/api/contact-lists/from-filter", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name,
                  type,
                  filter,
                  listId: selectedListId,
                }),
              });
              const body = await res.json();
              if (!res.ok) {
                throw new Error(body?.error ?? "Fehler beim Anlegen der Liste");
              }
              // Nach dem Anlegen: Filter leeren + zur neuen Liste springen
              setFilter(EMPTY_FILTER);
              setSelectedListId(body.list?.id ?? null);
              await Promise.all([loadLists(), loadContacts()]);
            }}
          />

          {/* Bulk-Aktion-Bar */}
          {selectedContactIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-brand-soft border-b border-line">
              <span className="text-sm text-brand-deep font-semibold">
                {selectedContactIds.size} ausgewählt
              </span>
              <div className="relative ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddToListMenu((v) => !v)}
                  className="px-3 py-1.5 rounded-lg bg-white text-ink text-xs font-semibold shadow-sm hover:bg-canvas flex items-center gap-1"
                >
                  In Liste stecken
                  <ChevronDown className="size-3" />
                </button>
                {showAddToListMenu && (
                  <div
                    className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg border border-line py-1 min-w-[220px] z-10 max-h-64 overflow-y-auto"
                    onMouseLeave={() => setShowAddToListMenu(false)}
                  >
                    {lists.length === 0 && (
                      <p className="text-xs text-ink-muted px-3 py-2">
                        Keine Listen. Erst eine anlegen.
                      </p>
                    )}
                    {lists.map((list) => (
                      <button
                        key={list.id}
                        type="button"
                        onClick={() => handleAddToList(list.id)}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-canvas flex justify-between items-center gap-4"
                      >
                        <span className="truncate">{list.name}</span>
                        <span className="text-ink-muted shrink-0">
                          {list.contactCount}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {selectedListId && (
                  <button
                    type="button"
                    onClick={handleRemoveFromCurrentList}
                    className="px-3 py-1.5 rounded-lg bg-white text-ink text-xs font-semibold shadow-sm hover:bg-canvas"
                  >
                    Aus dieser Liste entfernen
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="px-3 py-1.5 rounded-lg bg-white text-danger text-xs font-semibold shadow-sm hover:bg-danger-soft flex items-center gap-1"
                >
                  <Trash2 className="size-3" />
                  Löschen
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-ink-muted uppercase tracking-wide">
                  <th className="w-8 px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Firma</th>
                  <th className="px-3 py-2 text-left">E-Mail</th>
                  <th className="px-3 py-2 text-left">Telefon</th>
                  <th className="px-3 py-2 text-left">Listen</th>
                  <th className="px-3 py-2 text-right">Kampagnen</th>
                  <th className="px-3 py-2 text-right">Öffnungen</th>
                  <th className="px-3 py-2 text-right">CTA</th>
                  <th className="px-3 py-2 text-left">Letzte Aktivität</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center text-ink-muted">
                      <Loader2 className="size-4 inline animate-spin mr-2" />
                      Lade Kontakte…
                    </td>
                  </tr>
                )}
                {!loading && contacts.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center text-ink-muted text-sm">
                      {selectedListId
                        ? 'Diese Liste ist noch leer. Wähle links "Alle Kontakte", markiere ein paar und stecke sie in diese Liste.'
                        : "Noch keine Kontakte. Erstelle eine Kampagne mit CSV-Upload — deine Kontakte landen dann automatisch hier."}
                    </td>
                  </tr>
                )}
                {!loading &&
                  contacts.map((c) => (
                    <tr
                      key={c.id}
                      className={cn(
                        "border-t border-line hover:bg-canvas cursor-pointer",
                        selectedContactIds.has(c.id) && "bg-brand-soft",
                        detailContactId === c.id && "bg-brand-soft/60",
                      )}
                      onClick={(e) => {
                        // Klick auf die Zeile öffnet den Detail-Slide-Over.
                        // Selektion nur über die Checkbox (verhindert
                        // versehentliches Anhaken beim Öffnen).
                        if ((e.target as HTMLElement).tagName === "INPUT") return;
                        setDetailContactId(c.id);
                      }}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedContactIds.has(c.id)}
                          onChange={() => toggleOne(c.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-ink whitespace-nowrap">
                        {c.displayName}
                      </td>
                      <td className="px-3 py-2 text-ink-muted whitespace-nowrap max-w-[200px] truncate">
                        {c.companyDisplay ?? c.company ?? ""}
                      </td>
                      <td className="px-3 py-2 text-ink-muted whitespace-nowrap max-w-[200px] truncate">
                        {c.email ?? ""}
                      </td>
                      <td className="px-3 py-2 text-ink-muted whitespace-nowrap">
                        {c.phone ?? ""}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {c.listNames.slice(0, 3).map((n) => (
                            <span
                              key={n}
                              className="text-[10px] bg-canvas-deep text-ink px-1.5 py-0.5 rounded"
                            >
                              {n}
                            </span>
                          ))}
                          {c.listNames.length > 3 && (
                            <span className="text-[10px] text-ink-muted">
                              +{c.listNames.length - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-ink-muted tabular-nums">
                        {c.campaignCount}
                      </td>
                      <td className="px-3 py-2 text-right text-ink-muted tabular-nums">
                        {c.totalOpens}
                      </td>
                      <td className="px-3 py-2 text-right text-ink-muted tabular-nums">
                        {c.totalCta}
                      </td>
                      <td className="px-3 py-2 text-ink-muted text-xs whitespace-nowrap">
                        {c.lastActivityAt
                          ? new Date(c.lastActivityAt).toLocaleDateString("de-DE", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "2-digit",
                            })
                          : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showNewListModal && (
        <NewListModal
          onClose={() => setShowNewListModal(false)}
          onCreated={(list) => {
            setShowNewListModal(false);
            setLists((prev) => [...prev, list].sort((a, b) => a.name.localeCompare(b.name)));
            setSelectedListId(list.id);
          }}
        />
      )}

      {detailContactId && (
        <ContactDetailSlideOver
          contactId={detailContactId}
          onClose={() => setDetailContactId(null)}
          onPrev={goPrev}
          onNext={goNext}
          onChanged={() => {
            void loadContacts();
            void loadLists();
          }}
        />
      )}

      {showImportModal && (
        <ImportModal
          lists={lists.map((l) => ({ id: l.id, name: l.name }))}
          initialListId={selectedListId}
          onCreateList={() => {
            setShowImportModal(false);
            setShowNewListModal(true);
          }}
          onClose={() => setShowImportModal(false)}
          onDone={() => {
            setShowImportModal(false);
            void loadLists();
            void loadContacts();
          }}
        />
      )}

      {showStartRunModal && selectedListId && (
        <StartRunModal
          listId={selectedListId}
          listName={selectedListName}
          contactCount={contactsTotal}
          onClose={() => setShowStartRunModal(false)}
          onStarted={(runId, campaignId) => {
            setShowStartRunModal(false);
            router.push(`/kampagnen/${campaignId}/runs/${runId}`);
          }}
        />
      )}

      {showFieldsModal && <FieldsModal onClose={() => setShowFieldsModal(false)} />}
    </div>
  );
}

/** Modal für neue Liste. Bewusst schlicht — kein Farb-Picker etc. */
function NewListModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (list: ContactList) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/contact-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler beim Erstellen");
      onCreated(body.list);
    } catch (err) {
      toast({
        title: "Liste konnte nicht erstellt werden",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl p-6 w-full max-w-md shadow-xl"
      >
        <h3 className="text-lg font-semibold text-ink mb-2">Neue Liste</h3>
        <p className="text-xs text-ink-muted mb-4">
          Listen helfen dir, Kontakte für bestimmte Follow-up-Kampagnen zu bündeln.
        </p>
        <label className="block text-xs font-semibold text-ink mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          autoFocus
          placeholder="z. B. Zahnärzte Q4"
          className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-sm mb-3 focus:outline-none focus:border-brand"
        />
        <label className="block text-xs font-semibold text-ink mb-1">
          Beschreibung <span className="text-ink-muted font-normal">(optional)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Wofür ist diese Liste?"
          className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-sm mb-4 focus:outline-none focus:border-brand resize-none"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-ink-muted hover:bg-canvas"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold disabled:opacity-50 hover:bg-brand-deep"
          >
            {busy ? "Anlegen…" : "Liste anlegen"}
          </button>
        </div>
      </form>
    </div>
  );
}
