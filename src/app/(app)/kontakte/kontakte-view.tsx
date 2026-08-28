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
  Download,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  Trash2,
  Users2,
} from "lucide-react";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { useRouter } from "next/navigation";
import { ContactDetailSlideOver } from "./contact-detail-slideover";
import { FilterBar } from "./filter-bar";
import { ImportModal } from "./import-modal";
import { StartRunModal } from "./start-run-modal";
import { FieldsModal } from "./fields-modal";
import { EMPTY_FILTER, type FilterDefinition } from "@/lib/contacts/filter";
import { useShiftSelect } from "@/lib/use-shift-select";

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
  labels: Array<{ id: string; name: string; color: string }>;
}

interface ContactLabelInfo {
  id: string;
  name: string;
  color: string;
  contactCount: number;
}

/** Farbpalette für neue Labels — gleiche Liste wie serverseitig
 * (LABEL_COLOR_PALETTE in contact-labels.ts). */
const LABEL_COLORS = [
  "#AA8CF5",
  "#5EC26A",
  "#F59E0B",
  "#3B82F6",
  "#EC4899",
  "#14B8A6",
  "#EF4444",
  "#8B5CF6",
  "#F97316",
  "#06B6D4",
  "#84CC16",
  "#E11D48",
  "#6366F1",
  "#D97706",
  "#0EA5E9",
  "#A3A3A3",
];

/** Lesbare Textfarbe: weiß oder dunkel — je nachdem, was auf der
 * Hintergrundfarbe den höheren WCAG-Kontrast hat. */
function labelTextColor(hex: string): string {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const contrastWhite = 1.05 / (L + 0.05);
  // 0.0157 = relative Luminanz von #1f2328
  const contrastDark = (L + 0.05) / (0.0157 + 0.05);
  return contrastWhite >= contrastDark ? "#ffffff" : "#1f2328";
}

/** Vollfarbiger Label-Chip — bewusst klein, damit viele/lange Labels
 * nicht überladen wirken (Daniels Feedback 2026-08-28). */
function LabelChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex max-w-[140px] items-center truncate rounded-full px-1.5 py-[1px] text-[10px] font-medium leading-4"
      style={{ backgroundColor: color, color: labelTextColor(color) }}
      title={name}
    >
      {name}
    </span>
  );
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
  const [showExportMenu, setShowExportMenu] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  // Labels (Migration 0069): Liste aller Labels + aktiver Filter + Bulk-Menü
  const [labels, setLabels] = React.useState<ContactLabelInfo[]>([]);
  const [labelFilterId, setLabelFilterId] = React.useState<string | null>(null);
  const [showLabelFilterMenu, setShowLabelFilterMenu] = React.useState(false);
  const [showLabelMenu, setShowLabelMenu] = React.useState(false);
  const [newLabelName, setNewLabelName] = React.useState("");
  const [labelBusy, setLabelBusy] = React.useState(false);
  // Label bearbeiten (Umbenennen + Farbe): welches Label ist im Edit-Dialog?
  const [editLabel, setEditLabel] = React.useState<ContactLabelInfo | null>(null);
  // Detail-Slide-Over (Etappe 3): welchen Contact anzeigen?
  const [detailContactId, setDetailContactId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<FilterDefinition>(EMPTY_FILTER);
  const [showImportModal, setShowImportModal] = React.useState(false);
  const [showStartRunModal, setShowStartRunModal] = React.useState(false);
  const [showFieldsModal, setShowFieldsModal] = React.useState(false);
  const [showFilterBar, setShowFilterBar] = React.useState(false);
  const [showMoreMenu, setShowMoreMenu] = React.useState(false);
  const { setAnchor, getRange } = useShiftSelect();

  // Escape hebt die Auswahl auf — aber nicht, wenn gerade ein Dialog offen ist.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (
        detailContactId ||
        showNewListModal ||
        showImportModal ||
        showStartRunModal ||
        showFieldsModal ||
        editLabel
      )
        return;
      setSelectedContactIds(new Set());
      setShowLabelMenu(false);
      setShowLabelFilterMenu(false);
      setShowAddToListMenu(false);
      setShowExportMenu(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    detailContactId,
    showNewListModal,
    showImportModal,
    showStartRunModal,
    showFieldsModal,
    editLabel,
  ]);

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
      toastError(toast, err);
    }
  }, [toast]);

  const loadLabels = React.useCallback(async () => {
    try {
      const res = await fetch("/api/contact-labels");
      const body = await res.json();
      if (res.ok) setLabels(body.labels ?? []);
    } catch {
      // Labels sind nie kritisch fürs Laden der Seite.
    }
  }, []);

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
        if (labelFilterId) params.set("labelId", labelFilterId);
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
      toastError(toast, err);
    } finally {
      setLoading(false);
    }
  }, [selectedListId, labelFilterId, search, sort, filter, toast]);

  React.useEffect(() => {
    void loadLists();
    void loadLabels();
  }, [loadLists, loadLabels]);
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

  // Welche Labels tragen die aktuell ausgewählten Kontakte? (fürs Entfernen-Menü)
  const labelsOnSelection = React.useMemo(() => {
    if (selectedContactIds.size === 0) return [];
    return labels.filter((l) =>
      contacts.some(
        (c) =>
          selectedContactIds.has(c.id) &&
          (c.labels ?? []).some((x) => x.id === l.id),
      ),
    );
  }, [labels, contacts, selectedContactIds]);

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

  function handleCheckboxClick(id: string, shiftKey: boolean) {
    const range = shiftKey ? getRange(id, contacts.map((c) => c.id)) : null;
    if (range) {
      // Bereich bekommt den neuen Zustand der geklickten Zeile —
      // Shift-Klick kann also auch einen Bereich ENTmarkieren.
      const target = !selectedContactIds.has(id);
      setSelectedContactIds((prev) => {
        const next = new Set(prev);
        for (const rid of range) {
          if (target) next.add(rid);
          else next.delete(rid);
        }
        return next;
      });
    } else {
      toggleOne(id);
    }
    setAnchor(id);
  }

  async function handleExport(format: "csv" | "xlsx", idsOverride?: string[]) {
    const ids = idsOverride ?? Array.from(selectedContactIds);
    if (ids.length === 0) return;
    setShowExportMenu(false);
    setExporting(true);
    try {
      const res = await fetch("/api/contacts/v2/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: ids, format }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Fehler beim Export");
      }
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `videocomet-kontakte-${stamp}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: `${ids.length} Kontakt(e) exportiert` });
    } catch (err) {
      toastError(toast, err);
    } finally {
      setExporting(false);
    }
  }

  async function handleLabelAction(
    input: { labelId?: string; createName?: string },
    action: "add" | "remove",
  ) {
    const ids = Array.from(selectedContactIds);
    if (ids.length === 0) return;
    setLabelBusy(true);
    try {
      const res = await fetch("/api/contact-labels/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactIds: ids,
          action,
          labelId: input.labelId,
          create: input.createName
            ? { name: input.createName }
            : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Aktion fehlgeschlagen");
      toast({
        title:
          action === "add"
            ? `Label an ${body.count} Kontakt(e) vergeben`
            : `Label von ${body.count} Kontakt(en) entfernt`,
      });
      setShowLabelMenu(false);
      setNewLabelName("");
      await Promise.all([loadLabels(), loadContacts()]);
    } catch (err) {
      toastError(toast, err);
    } finally {
      setLabelBusy(false);
    }
  }

  async function handleDeleteLabel(label: ContactLabelInfo) {
    if (
      !confirm(
        `Label "${label.name}" komplett löschen? Es wird von allen Kontakten entfernt. Die Kontakte selbst bleiben erhalten.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/contact-labels/${label.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Fehler beim Löschen");
      }
      if (labelFilterId === label.id) setLabelFilterId(null);
      toast({ title: `Label "${label.name}" gelöscht` });
      await Promise.all([loadLabels(), loadContacts()]);
    } catch (err) {
      toastError(toast, err);
    }
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
      toastError(toast, err);
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
      toastError(toast, err);
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
      toastError(toast, err);
    }
  }

  return (
    <div className="min-h-full">
      <PageHeader title="Kontakte & Listen" />

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
              <div
                key={list.id}
                className={cn(
                  "group relative rounded-lg flex items-center",
                  selectedListId === list.id
                    ? "bg-canvas-deep"
                    : "hover:bg-canvas",
                )}
                title={list.description ?? undefined}
              >
                <button
                  type="button"
                  onClick={() => setSelectedListId(list.id)}
                  className={cn(
                    "flex-1 text-left px-2 py-1.5 text-sm flex items-center justify-between min-w-0",
                    selectedListId === list.id
                      ? "font-semibold text-ink"
                      : "text-ink-muted",
                  )}
                >
                  <span className="truncate">{list.name}</span>
                  <span className="text-xs text-ink-muted ml-2 shrink-0 group-hover:hidden">
                    {list.contactCount}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (
                      !confirm(
                        `Liste "${list.name}" löschen? Die Kontakte selbst bleiben erhalten.`,
                      )
                    )
                      return;
                    try {
                      const res = await fetch(`/api/contact-lists/${list.id}`, {
                        method: "DELETE",
                      });
                      if (!res.ok) {
                        const body = await res.json().catch(() => ({}));
                        throw new Error(body?.error ?? "Fehler beim Löschen");
                      }
                      if (selectedListId === list.id) setSelectedListId(null);
                      await loadLists();
                      toast({ title: `Liste "${list.name}" gelöscht` });
                    } catch (err) {
                      toastError(toast, err);
                    }
                  }}
                  className="hidden group-hover:block text-ink-muted hover:text-danger p-1 mr-1 rounded"
                  title="Liste löschen"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
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
              {labels.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowLabelFilterMenu((v) => !v)}
                    title="Nur Kontakte mit einem bestimmten Label anzeigen"
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg border text-sm flex items-center gap-1.5",
                      labelFilterId
                        ? "border-brand bg-brand-soft text-brand-deep font-semibold"
                        : "border-line bg-canvas text-ink-muted",
                    )}
                  >
                    <Tag className="size-3.5" />
                    {labelFilterId
                      ? labels.find((l) => l.id === labelFilterId)?.name ?? "Label"
                      : "Label"}
                    <ChevronDown className="size-3" />
                  </button>
                  {showLabelFilterMenu && (
                    <div
                      className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg border border-line py-1 min-w-[230px] z-20 max-h-72 overflow-y-auto"
                      onMouseLeave={() => setShowLabelFilterMenu(false)}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setLabelFilterId(null);
                          setShowLabelFilterMenu(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-xs hover:bg-canvas",
                          !labelFilterId && "font-semibold",
                        )}
                      >
                        Alle Kontakte (kein Label-Filter)
                      </button>
                      {labels.map((l) => (
                        <div key={l.id} className="group flex items-center">
                          <button
                            type="button"
                            onClick={() => {
                              setLabelFilterId(l.id);
                              setShowLabelFilterMenu(false);
                            }}
                            className={cn(
                              "flex-1 text-left px-3 py-1.5 text-xs hover:bg-canvas flex items-center gap-2 min-w-0",
                              labelFilterId === l.id && "font-semibold",
                            )}
                          >
                            <LabelChip name={l.name} color={l.color} />
                            <span className="ml-auto text-ink-muted shrink-0">
                              {l.contactCount}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowLabelFilterMenu(false);
                              setEditLabel(l);
                            }}
                            className="hidden group-hover:block text-ink-muted hover:text-ink p-1 rounded"
                            title="Label umbenennen oder Farbe ändern"
                          >
                            <Pencil className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteLabel(l)}
                            className="hidden group-hover:block text-ink-muted hover:text-danger p-1 mr-1 rounded"
                            title="Label löschen"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
              <button
                type="button"
                onClick={() => setShowFilterBar((v) => !v)}
                title="Kontakte nach Bedingungen filtern — z. B. „hat E-Mail-Adresse“ oder „war in Kampagne X“"
                className={cn(
                  "px-2.5 py-1.5 rounded-lg border text-sm flex items-center gap-1.5",
                  showFilterBar || filter.conditions.length > 0
                    ? "border-brand bg-brand-soft text-brand-deep font-semibold"
                    : "border-line bg-canvas text-ink-muted",
                )}
              >
                <SlidersHorizontal className="size-3.5" />
                Filter
                {filter.conditions.length > 0 && ` (${filter.conditions.length})`}
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMoreMenu((v) => !v)}
                  title="Weitere Aktionen"
                  className="px-2 py-1.5 rounded-lg border border-line bg-canvas text-ink-muted hover:bg-canvas-deep"
                >
                  <MoreHorizontal className="size-4" />
                </button>
                {showMoreMenu && (
                  <div
                    className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg border border-line py-1 min-w-[260px] z-20"
                    onMouseLeave={() => setShowMoreMenu(false)}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setShowMoreMenu(false);
                        setShowFieldsModal(true);
                      }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-canvas"
                    >
                      <span className="font-semibold block">⚙ Eigene Felder verwalten</span>
                      <span className="text-ink-muted block">
                        Eigene Felder wie Priorität oder Praxis-Größe anlegen —
                        gilt für alle Kontakte
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={exporting || contacts.length === 0}
                      onClick={() => {
                        setShowMoreMenu(false);
                        void handleExport("xlsx", contacts.map((c) => c.id));
                      }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-canvas disabled:opacity-50"
                    >
                      <span className="font-semibold block">
                        Angezeigte Kontakte exportieren (Excel)
                      </span>
                      <span className="text-ink-muted block">
                        Lädt alle {contacts.length} gerade angezeigten Kontakte
                        als Excel-Datei herunter
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Filter-Bar — nur sichtbar nach Klick auf „Filter" oder mit aktiven Bedingungen */}
          {(showFilterBar || filter.conditions.length > 0) && (
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
          )}

          {/* Bulk-Aktion-Bar */}
          {selectedContactIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-brand-soft border-b border-line">
              <span className="text-sm text-brand-deep font-semibold">
                {selectedContactIds.size} ausgewählt
              </span>
              <span className="text-[11px] text-brand-deep/70 hidden md:inline">
                Shift-Klick wählt einen Bereich · Esc hebt die Auswahl auf
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

                <div className="relative">
                  <button
                    type="button"
                    disabled={labelBusy}
                    onClick={() => setShowLabelMenu((v) => !v)}
                    title="Ausgewählte Kontakte mit einem Label markieren — z. B. „Versand 28.08.2026“ oder „Rückläufer“"
                    className="px-3 py-1.5 rounded-lg bg-white text-ink text-xs font-semibold shadow-sm hover:bg-canvas flex items-center gap-1 disabled:opacity-60"
                  >
                    {labelBusy ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Tag className="size-3" />
                    )}
                    Label vergeben
                    <ChevronDown className="size-3" />
                  </button>
                  {showLabelMenu && (
                    <div
                      className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg border border-line py-1 w-[260px] z-10"
                      onMouseLeave={() => setShowLabelMenu(false)}
                    >
                      <div className="px-3 pt-1.5 pb-2 flex gap-1.5">
                        <input
                          type="text"
                          value={newLabelName}
                          onChange={(e) => setNewLabelName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && newLabelName.trim() && !labelBusy) {
                              void handleLabelAction(
                                { createName: newLabelName.trim() },
                                "add",
                              );
                            }
                          }}
                          maxLength={60}
                          placeholder="Neues Label, z. B. Rückläufer"
                          className="flex-1 px-2 py-1.5 rounded-lg border border-line bg-canvas text-xs focus:outline-none focus:border-brand"
                        />
                        <button
                          type="button"
                          disabled={!newLabelName.trim() || labelBusy}
                          onClick={() =>
                            handleLabelAction({ createName: newLabelName.trim() }, "add")
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-ink text-white text-xs font-semibold disabled:opacity-50"
                        >
                          OK
                        </button>
                      </div>
                      <p className="px-3 pb-2 text-[11px] text-ink-muted">
                        Neue Labels bekommen automatisch eine Farbe — änderbar
                        über das Stift-Symbol im Label-Filter.
                      </p>
                      {labels.length > 0 && (
                        <div className="max-h-40 overflow-y-auto border-t border-line pt-1">
                          {labels.map((l) => (
                            <button
                              key={l.id}
                              type="button"
                              disabled={labelBusy}
                              onClick={() => handleLabelAction({ labelId: l.id }, "add")}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-canvas flex items-center gap-2"
                            >
                              <LabelChip name={l.name} color={l.color} />
                            </button>
                          ))}
                        </div>
                      )}
                      {labelsOnSelection.length > 0 && (
                        <>
                          <p className="px-3 pt-2 pb-1 text-[11px] font-semibold text-ink-muted uppercase tracking-wide border-t border-line mt-1">
                            Label entfernen
                          </p>
                          <div className="max-h-32 overflow-y-auto">
                            {labelsOnSelection.map((l) => (
                              <button
                                key={l.id}
                                type="button"
                                disabled={labelBusy}
                                onClick={() =>
                                  handleLabelAction({ labelId: l.id }, "remove")
                                }
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-danger-soft text-danger flex items-center gap-2"
                              >
                                <span
                                  className="size-2 rounded-full shrink-0"
                                  style={{ backgroundColor: l.color }}
                                />
                                <span className="truncate">{l.name} entfernen</span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    disabled={exporting}
                    onClick={() => setShowExportMenu((v) => !v)}
                    title="Ausgewählte Kontakte als Datei herunterladen — mit allen Daten, Kampagnen, Aktivitäten und Links"
                    className="px-3 py-1.5 rounded-lg bg-white text-ink text-xs font-semibold shadow-sm hover:bg-canvas flex items-center gap-1 disabled:opacity-60"
                  >
                    {exporting ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Download className="size-3" />
                    )}
                    Exportieren
                    <ChevronDown className="size-3" />
                  </button>
                  {showExportMenu && (
                    <div
                      className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg border border-line py-1 min-w-[280px] z-10"
                      onMouseLeave={() => setShowExportMenu(false)}
                    >
                      <button
                        type="button"
                        onClick={() => handleExport("xlsx")}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-canvas"
                      >
                        <span className="font-semibold block">Als Excel (.xlsx) — empfohlen</span>
                        <span className="text-ink-muted block">
                          Kontakte, Kampagnen &amp; Links in einer Tabelle +
                          Aktivitäten-Protokoll als eigenes Blatt
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExport("csv")}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-canvas"
                      >
                        <span className="font-semibold block">Als CSV (.csv)</span>
                        <span className="text-ink-muted block">
                          Eine Tabelle für andere Programme — eine Zeile pro
                          Kampagnen-Teilnahme
                        </span>
                      </button>
                    </div>
                  )}
                </div>

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

          {/* Listen-Kontext-Banner: für welche Kampagne/Runde wurde die Liste verwendet */}
          {selectedListId && <ListUsageBanner listId={selectedListId} />}

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
                  <th className="px-3 py-2 text-left">E-Mail</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Labels</th>
                  <th className="px-3 py-2 text-left">Letzte Aktivität</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-ink-muted">
                      <Loader2 className="size-4 inline animate-spin mr-2" />
                      Lade Kontakte…
                    </td>
                  </tr>
                )}
                {!loading && contacts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-ink-muted text-sm">
                      {selectedListId
                        ? 'Diese Liste ist noch leer. Wähle links "Alle Kontakte", markiere ein paar und stecke sie in diese Liste.'
                        : "Noch keine Kontakte. Erstelle eine Kampagne mit CSV-Upload — deine Kontakte landen dann automatisch hier."}
                    </td>
                  </tr>
                )}
                {!loading &&
                  contacts.map((c) => {
                    const status = classifyContactStatus(c);
                    return (
                      <tr
                        key={c.id}
                        className={cn(
                          "border-t border-line hover:bg-canvas cursor-pointer",
                          selectedContactIds.has(c.id) && "bg-brand-soft",
                          detailContactId === c.id && "bg-brand-soft/60",
                        )}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).tagName === "INPUT") return;
                          setDetailContactId(c.id);
                        }}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedContactIds.has(c.id)}
                            onChange={() => {}}
                            onMouseDown={(e) => {
                              if (e.shiftKey) e.preventDefault();
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCheckboxClick(c.id, e.shiftKey);
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="block font-medium text-ink">
                            {c.displayName}
                          </span>
                          {(c.companyDisplay ?? c.company) && (
                            <span className="block text-xs text-ink-muted max-w-[200px] truncate">
                              {c.companyDisplay ?? c.company}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-ink-muted whitespace-nowrap max-w-[200px] truncate">
                          {c.email ?? ""}
                        </td>
                        <td className="px-3 py-2">
                          <StatusPill status={status} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1 max-w-[240px]">
                            {(c.labels ?? []).map((l) => (
                              <LabelChip key={l.id} name={l.name} color={l.color} />
                            ))}
                          </div>
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
                    );
                  })}
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

      {editLabel && (
        <EditLabelModal
          label={editLabel}
          onClose={() => setEditLabel(null)}
          onSaved={() => {
            setEditLabel(null);
            void loadLabels();
            void loadContacts();
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
      if (!res.ok) throw new Error(body?.error ?? "Das hat gerade nicht geklappt.");
      onCreated(body.list);
    } catch (err) {
      // Server-Fehlermeldung DIREKT als Titel — sie ist schon deutsch und
      // für den User geschrieben.
      toast({
        title: err instanceof Error ? err.message : String(err),
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

/** Modal zum Bearbeiten eines Labels: Umbenennen + Farbe im 4×4-Grid. */
function EditLabelModal({
  label,
  onClose,
  onSaved,
}: {
  label: ContactLabelInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState(label.name);
  const [color, setColor] = React.useState(label.color);
  const [busy, setBusy] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/contact-labels/${label.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Das hat gerade nicht geklappt.");
      toast({ title: "Label gespeichert" });
      onSaved();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : String(err),
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
        className="bg-surface rounded-2xl p-6 w-full max-w-sm shadow-xl"
      >
        <h3 className="text-lg font-semibold text-ink mb-2">Label bearbeiten</h3>
        <p className="text-xs text-ink-muted mb-4">
          Name und Farbe gelten überall, wo dieses Label vergeben ist.
        </p>
        <label className="block text-xs font-semibold text-ink mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoFocus
          className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-sm mb-3 focus:outline-none focus:border-brand"
        />
        <label className="block text-xs font-semibold text-ink mb-1">Farbe</label>
        <div className="grid grid-cols-4 gap-2 mb-4 w-fit">
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Farbe ${c} wählen`}
              className={cn(
                "size-7 rounded-full transition-transform hover:scale-110",
                color === c && "ring-2 ring-ink ring-offset-2",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="mb-4 flex items-center gap-2 text-xs text-ink-muted">
          Vorschau:
          <LabelChip name={name.trim() || label.name} color={color} />
        </div>
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
            {busy ? "Speichern…" : "Speichern"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Status: heiß / warm / kalt / neu — abgeleitet aus Aktivitäten ────── */

type ContactStatus = "hot" | "warm" | "cold" | "new";

function classifyContactStatus(c: ContactRow): ContactStatus {
  if (c.campaignCount === 0) return "new";
  if (c.totalCta > 0) return "hot";
  if (c.totalPlays > 0 || c.totalOpens >= 3) return "warm";
  return "cold";
}

function StatusPill({ status }: { status: ContactStatus }) {
  const cfg: Record<ContactStatus, { label: string; bg: string; text: string }> = {
    hot: { label: "Heiß", bg: "bg-danger-soft", text: "text-danger" },
    warm: { label: "Warm", bg: "bg-warn-soft", text: "text-warn" },
    cold: { label: "Kalt", bg: "bg-info-soft", text: "text-info" },
    new: { label: "Neu", bg: "bg-canvas-deep", text: "text-ink-muted" },
  };
  const c = cfg[status];
  return (
    <span className={cn("text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full", c.bg, c.text)}>
      {c.label}
    </span>
  );
}

/* ── Listen-Kontext: für welche Kampagnen/Runden wurde die Liste verwendet ── */

interface ListUsage {
  runs: Array<{
    runId: string;
    runName: string;
    campaignId: string;
    campaignName: string;
    startedAt: string | null;
    leadCount: number;
  }>;
}

function ListUsageBanner({ listId }: { listId: string }) {
  const [usage, setUsage] = React.useState<ListUsage | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    fetch(`/api/contact-lists/${listId}/usage`)
      .then((r) => r.ok ? r.json() : { runs: [] })
      .then((b) => setUsage(b))
      .catch(() => setUsage({ runs: [] }))
      .finally(() => setLoading(false));
  }, [listId]);

  if (loading) return null;
  if (!usage || usage.runs.length === 0) {
    return (
      <div className="px-3 py-2 bg-canvas-deep text-xs text-ink-muted border-b border-line">
        Diese Liste wurde noch für keine Runde verwendet.
      </div>
    );
  }

  // Gruppieren nach Kampagne
  const byCampaign = new Map<string, { campaignName: string; runs: ListUsage["runs"] }>();
  for (const r of usage.runs) {
    const ex = byCampaign.get(r.campaignId);
    if (ex) ex.runs.push(r);
    else byCampaign.set(r.campaignId, { campaignName: r.campaignName, runs: [r] });
  }
  const campaignsUsed = Array.from(byCampaign.entries());

  return (
    <div className="px-3 py-2 bg-brand-soft border-b border-line text-xs text-ink flex items-center gap-2 flex-wrap">
      <span className="font-semibold text-brand-deep">Verwendet in:</span>
      {campaignsUsed.map(([cid, { campaignName, runs }]) => (
        <span key={cid} className="inline-flex items-center gap-1">
          <a
            href={`/kampagnen/${cid}`}
            className="font-semibold text-ink hover:underline"
          >
            {campaignName}
          </a>
          <span className="text-ink-muted">
            ({runs.length} Runde{runs.length === 1 ? "" : "n"})
          </span>
        </span>
      ))}
    </div>
  );
}
