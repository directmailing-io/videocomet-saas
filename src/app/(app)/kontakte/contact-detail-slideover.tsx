"use client";

/**
 * Contact-Detail-Slide-Over (Mini-CRM Etappe 3).
 *
 * Öffnet sich rechts über die Kontakt-Tabelle. 4 Tabs:
 *   - Übersicht (Basis-Felder + Custom-Felder, inline editierbar)
 *   - Aktivität (Timeline aus lead_events + Statistik-Kacheln)
 *   - Kampagnen  (alle Runs des Contacts mit Metriken)
 *   - Listen     (Chips + „Aus dieser Liste entfernen"-Aktion)
 *
 * Pfeiltasten ↑↓ blättern durch die aktuell sichtbare Kontakt-Liste ohne
 * den Slide-Over zu schließen.
 */

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  Phone,
  X,
  ExternalLink,
  Play,
  MousePointerClick,
  Eye,
  FileText,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";

interface ContactDetailEvent {
  id: string;
  leadId: string;
  campaignName: string;
  runName: string;
  kind: string;
  ts: string;
  payload: Record<string, unknown> | null;
}

interface ContactDetailOccurrence {
  leadId: string;
  campaignId: string;
  campaignName: string;
  runId: string;
  runName: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  viewCount: number;
  playCount: number;
  ctaClickCount: number;
  pdfUrl: string | null;
  videoUrl: string | null;
  slug: string | null;
}

interface ContactDetailList {
  id: string;
  name: string;
  type: "static" | "smart";
}

interface ContactDetailData {
  contact: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    companyDisplay: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    salutation: string | null;
    title: string | null;
    externalId: string | null;
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
    position: string | null;
    website: string | null;
    gender: string | null;
    data: Record<string, string>;
    createdAt: string;
    lastActivityAt: string | null;
  };
  lists: ContactDetailList[];
  events: ContactDetailEvent[];
  occurrences: ContactDetailOccurrence[];
}

interface ContactDetailSlideOverProps {
  contactId: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onChanged?: () => void;
}

type Tab = "overview" | "activity" | "campaigns" | "lists";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Übersicht" },
  { key: "activity", label: "Aktivität" },
  { key: "campaigns", label: "Kampagnen" },
  { key: "lists", label: "Listen" },
];

export function ContactDetailSlideOver({
  contactId,
  onClose,
  onPrev,
  onNext,
  onChanged,
}: ContactDetailSlideOverProps) {
  const { toast } = useToast();
  const [data, setData] = React.useState<ContactDetailData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<Tab>("overview");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contacts/v2/${contactId}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler beim Laden");
      setData(body);
    } catch (err) {
      toastError(toast, err);
    } finally {
      setLoading(false);
    }
  }, [contactId, toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Keyboard: Esc = schließen, ↑/↓ = prev/next
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.key === "ArrowDown" || e.key === "ArrowRight") && onNext) {
        e.preventDefault();
        onNext();
      } else if ((e.key === "ArrowUp" || e.key === "ArrowLeft") && onPrev) {
        e.preventDefault();
        onPrev();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onNext, onPrev]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 animate-in fade-in duration-150"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[640px] bg-surface shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header mit Prev/Next + Close */}
        <div className="flex items-center gap-2 p-3 border-b border-line shrink-0">
          <button
            type="button"
            onClick={onPrev}
            disabled={!onPrev}
            className="p-1.5 rounded-lg hover:bg-canvas disabled:opacity-30"
            title="Vorheriger Kontakt (↑)"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!onNext}
            className="p-1.5 rounded-lg hover:bg-canvas disabled:opacity-30"
            title="Nächster Kontakt (↓)"
          >
            <ChevronRight className="size-4" />
          </button>
          <div className="ml-auto text-xs text-ink-muted">Esc zum Schließen</div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-canvas"
          >
            <X className="size-4" />
          </button>
        </div>

        {loading || !data ? (
          <div className="flex-1 flex items-center justify-center text-ink-muted">
            <Loader2 className="size-4 animate-spin mr-2" />
            Lade Kontakt…
          </div>
        ) : (
          <>
            <ContactHeader data={data} />
            <TabBar tab={tab} onChange={setTab} />
            <div className="flex-1 overflow-y-auto">
              {tab === "overview" && (
                <OverviewTab data={data} onChanged={onChanged} reload={load} />
              )}
              {tab === "activity" && <ActivityTab data={data} />}
              {tab === "campaigns" && <CampaignsTab data={data} />}
              {tab === "lists" && (
                <ListsTab
                  data={data}
                  onChanged={() => {
                    onChanged?.();
                    void load();
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function initials(data: ContactDetailData): string {
  const f = data.contact.firstName?.[0]?.toUpperCase() ?? "";
  const l = data.contact.lastName?.[0]?.toUpperCase() ?? "";
  const both = (f + l).trim();
  if (both) return both;
  if (data.contact.email) return data.contact.email[0]?.toUpperCase() ?? "?";
  return "?";
}

function displayName(data: ContactDetailData): string {
  const parts = [data.contact.firstName, data.contact.lastName].filter(Boolean);
  return parts.join(" ") || data.contact.companyDisplay || data.contact.email || "Ohne Namen";
}

function ContactHeader({ data }: { data: ContactDetailData }) {
  return (
    <div className="p-5 flex items-center gap-4 border-b border-line shrink-0">
      <div className="size-14 rounded-full bg-gradient-to-br from-brand to-brand-deep text-white font-bold text-lg flex items-center justify-center shrink-0">
        {initials(data)}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-semibold text-ink truncate">{displayName(data)}</h2>
        <p className="text-sm text-ink-muted truncate">
          {data.contact.companyDisplay ?? data.contact.company ?? "—"}
          {" · Kontakt seit "}
          {new Date(data.contact.createdAt).toLocaleDateString("de-DE")}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        {data.contact.email && (
          <a
            href={`mailto:${data.contact.email}`}
            className="px-2.5 py-1.5 rounded-lg bg-canvas text-xs font-semibold text-ink hover:bg-canvas-deep flex items-center gap-1"
            title="E-Mail schreiben"
          >
            <Mail className="size-3" />
            Mail
          </a>
        )}
        {data.contact.phone && (
          <a
            href={`tel:${data.contact.phone}`}
            className="px-2.5 py-1.5 rounded-lg bg-canvas text-xs font-semibold text-ink hover:bg-canvas-deep flex items-center gap-1"
            title="Anrufen"
          >
            <Phone className="size-3" />
            Anrufen
          </a>
        )}
      </div>
    </div>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex gap-1 px-4 pt-2 border-b border-line shrink-0 bg-canvas-deep">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            "px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors",
            tab === t.key
              ? "text-brand-deep border-brand-deep bg-surface rounded-t-lg"
              : "text-ink-muted border-transparent hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ── Tab 1: Übersicht (Basis + Custom-Felder, inline editierbar) ────── */
function OverviewTab({
  data,
  onChanged,
  reload,
}: {
  data: ContactDetailData;
  onChanged?: () => void;
  reload: () => Promise<void>;
}) {
  const c = data.contact;
  const onSaved = () => {
    onChanged?.();
    void reload();
  };
  return (
    <div className="p-5 space-y-6">
      <FieldGroup title="Person">
        <EditableField contactId={c.id} field="salutation" label="Anrede" value={c.salutation ?? ""} onSaved={onSaved} />
        <EditableField contactId={c.id} field="title" label="Titel" value={c.title ?? ""} onSaved={onSaved} />
        <EditableField contactId={c.id} field="firstName" label="Vorname" value={c.firstName ?? ""} onSaved={onSaved} />
        <EditableField contactId={c.id} field="lastName" label="Nachname" value={c.lastName ?? ""} onSaved={onSaved} />
        <EditableField contactId={c.id} field="gender" label="Geschlecht" value={c.gender ?? ""} onSaved={onSaved} />
        <EditableField contactId={c.id} field="externalId" label="ID" value={c.externalId ?? ""} onSaved={onSaved} />
      </FieldGroup>

      <FieldGroup title="Kontakt">
        <EditableField contactId={c.id} field="email" label="E-Mail" value={c.email ?? ""} onSaved={onSaved} />
        <EditableField contactId={c.id} field="phone" label="Telefon" value={c.phone ?? ""} onSaved={onSaved} />
        <EditableField contactId={c.id} field="website" label="Website" value={c.website ?? ""} onSaved={onSaved} />
        <EditableField contactId={c.id} field="linkedinUrl" label="LinkedIn" value={c.linkedinUrl ?? ""} onSaved={onSaved} />
      </FieldGroup>

      <FieldGroup title="Firma">
        <EditableField
          contactId={c.id}
          field="company"
          label="Firma"
          value={c.companyDisplay ?? c.company ?? ""}
          onSaved={onSaved}
        />
        <EditableField contactId={c.id} field="position" label="Position" value={c.position ?? ""} onSaved={onSaved} />
      </FieldGroup>

      <FieldGroup title="Adresse">
        <EditableField contactId={c.id} field="street" label="Straße" value={c.street ?? ""} onSaved={onSaved} full />
        <EditableField contactId={c.id} field="postalCode" label="PLZ" value={c.postalCode ?? ""} onSaved={onSaved} />
        <EditableField contactId={c.id} field="city" label="Ort" value={c.city ?? ""} onSaved={onSaved} />
        <EditableField contactId={c.id} field="country" label="Land" value={c.country ?? ""} onSaved={onSaved} />
      </FieldGroup>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide">
            Weitere Felder
          </h4>
          <AddFieldButton
            contactId={data.contact.id}
            existingData={data.contact.data}
            onSaved={() => {
              onChanged?.();
              void reload();
            }}
          />
        </div>
        {Object.keys(data.contact.data).length === 0 ? (
          <p className="text-xs text-ink-muted italic">
            Noch keine eigenen Felder. Über „+ Feld hinzufügen" oben rechts kannst
            du z. B. „Praxis-Größe" oder „Priorität" anlegen — dieselben Felder
            stehen dann auch bei anderen Kontakten und in Filtern zur Verfügung.
          </p>
        ) : (
          <div className="divide-y divide-canvas-deep rounded-lg border border-line bg-surface">
            {Object.entries(data.contact.data)
              .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
              .map(([k, v]) => (
              <EditableCustomField
                key={k}
                contactId={data.contact.id}
                allData={data.contact.data}
                fieldKey={k}
                value={v}
                onSaved={() => {
                  onChanged?.();
                  void reload();
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AddFieldButton({
  contactId,
  existingData,
  onSaved,
}: {
  contactId: string;
  existingData: Record<string, string>;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function save() {
    if (!label.trim()) return;
    const key = slugifyLocal(label);
    if (!key) {
      toast({ title: "Bitte einen gültigen Namen verwenden", variant: "danger" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/contacts/v2/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: { ...existingData, [key]: value },
          registerCustomField: { key, label: label.trim() },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler beim Speichern");
      setOpen(false);
      setLabel("");
      setValue("");
      onSaved?.();
    } catch (err) {
      toastError(toast, err);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] font-semibold text-brand-deep hover:bg-brand-soft px-2 py-1 rounded-md"
      >
        + Feld hinzufügen
      </button>
    );
  }
  return (
    <div className="flex gap-1.5 items-center bg-canvas rounded-lg p-1.5">
      <input
        type="text"
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Name des Feldes"
        className="text-xs px-2 py-1 border border-line rounded w-28 bg-white"
        maxLength={40}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Wert"
        className="text-xs px-2 py-1 border border-line rounded w-28 bg-white"
      />
      <button
        type="button"
        onClick={save}
        disabled={busy || !label.trim()}
        className="px-2 py-1 rounded bg-ink text-white text-xs font-semibold disabled:opacity-50"
      >
        {busy ? "…" : "OK"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/** Existierendes Custom-Feld inline editierbar (nicht nur read-only). */
function EditableCustomField({
  contactId,
  allData,
  fieldKey,
  value,
  onSaved,
}: {
  contactId: string;
  allData: Record<string, string>;
  fieldKey: string;
  value: string;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setDraft(value), [value]);

  async function save() {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/contacts/v2/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: { ...allData, [fieldKey]: draft },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler beim Speichern");
      setEditing(false);
      onSaved?.();
    } catch (err) {
      toastError(toast, err);
      setDraft(value);
    } finally {
      setBusy(false);
    }
  }

  const isUrl = value.startsWith("http://") || value.startsWith("https://");

  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 px-3 py-2 items-start hover:bg-canvas">
      <span
        className="text-[11px] text-ink-muted truncate pt-0.5"
        title={fieldKey}
      >
        {fieldKey}
      </span>
      {editing ? (
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          disabled={busy}
          className="text-xs text-ink px-1.5 py-0.5 border border-brand rounded outline-none w-full min-w-0"
        />
      ) : (
        <div className="min-w-0 flex items-start gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-ink font-medium text-left hover:underline break-all flex-1 min-w-0"
            title="Klicken zum Bearbeiten"
          >
            {value || <span className="text-ink-muted italic">— leer —</span>}
          </button>
          {isUrl && (
            <a
              href={value}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-brand-deep hover:text-ink"
              onClick={(e) => e.stopPropagation()}
              title="Link öffnen"
            >
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function slugifyLocal(label: string): string {
  return label
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide mb-2">
        {title}
      </h4>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl border border-line bg-surface px-3 py-1.5">
        {children}
      </div>
    </section>
  );
}

function EditableField({
  contactId,
  field,
  label,
  value,
  onSaved,
  full,
}: {
  contactId: string;
  field: string;
  label: string;
  value: string;
  onSaved?: () => void;
  full?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [busy, setBusy] = React.useState(false);
  const { toast } = useToast();

  React.useEffect(() => setDraft(value), [value]);

  async function save() {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/contacts/v2/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: draft }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler beim Speichern");
      setEditing(false);
      onSaved?.();
    } catch (err) {
      toastError(toast, err);
      setDraft(value);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "text-xs flex flex-col border-b border-canvas-deep last:border-b-0 py-1.5 min-w-0",
        full && "col-span-2",
      )}
    >
      <span className="text-ink-muted mb-0.5">{label}</span>
      {editing ? (
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          disabled={busy}
          className="text-sm text-ink px-1 py-0.5 border border-brand rounded outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-sm text-ink text-left hover:bg-canvas rounded px-1 py-0.5 truncate min-w-0"
          title={value || "Klicken zum Ausfüllen"}
        >
          {value || <span className="text-ink-muted italic">leer</span>}
        </button>
      )}
    </div>
  );
}

/* ── Tab 2: Aktivität — Timeline + Statistik-Kacheln ─────────────────── */
function ActivityTab({ data }: { data: ContactDetailData }) {
  const totals = data.occurrences.reduce(
    (acc, o) => ({
      opens: acc.opens + o.viewCount,
      plays: acc.plays + o.playCount,
      cta: acc.cta + o.ctaClickCount,
    }),
    { opens: 0, plays: 0, cta: 0 },
  );
  return (
    <div className="p-5 space-y-5">
      <div className="grid grid-cols-4 gap-2">
        <StatTile
          icon={<Eye className="size-3.5" />}
          label="Öffnungen"
          value={totals.opens}
        />
        <StatTile
          icon={<Play className="size-3.5" />}
          label="Video-Plays"
          value={totals.plays}
        />
        <StatTile
          icon={<MousePointerClick className="size-3.5" />}
          label="CTA-Klicks"
          value={totals.cta}
        />
        <StatTile
          icon={<Clock className="size-3.5" />}
          label="Letzte Aktion"
          value={
            data.contact.lastActivityAt
              ? relativeTime(data.contact.lastActivityAt)
              : "—"
          }
          small
        />
      </div>

      <section>
        <h4 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide mb-2">
          Zeitleiste (letzte 50 Ereignisse)
        </h4>
        {data.events.length === 0 ? (
          <p className="text-xs text-ink-muted italic py-4">
            Noch keine Aktivität für diesen Kontakt.
          </p>
        ) : (
          <ul className="relative pl-6 space-y-2">
            <div className="absolute left-2 top-1 bottom-1 w-0.5 bg-canvas-deep" />
            {data.events.map((e) => (
              <li key={e.id} className="relative text-sm">
                <div
                  className={cn(
                    "absolute -left-[18px] top-1.5 size-3 rounded-full border-2 border-surface",
                    eventDotColor(e.kind),
                  )}
                />
                <div className="text-ink">
                  <strong className="font-semibold">{eventLabel(e.kind)}</strong>
                  {" · "}
                  <span className="text-ink-muted text-xs">
                    {e.campaignName} · {e.runName}
                  </span>
                </div>
                <div className="text-[11px] text-ink-muted">
                  {new Date(e.ts).toLocaleString("de-DE", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  small,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  small?: boolean;
}) {
  return (
    <div className="bg-canvas rounded-xl p-3 flex flex-col gap-1">
      <div className="text-ink-muted flex items-center gap-1 text-[10px] uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className={cn("font-bold text-ink tabular-nums", small ? "text-sm" : "text-lg")}>
        {value}
      </div>
    </div>
  );
}

function eventLabel(kind: string): string {
  switch (kind) {
    case "page_view":
      return "Landingpage geöffnet";
    case "video_play":
      return "Video gestartet";
    case "video_progress":
      return "Video-Fortschritt";
    case "video_ended":
      return "Video zu Ende gesehen";
    case "cta_click":
      return "CTA geklickt";
    case "form_submit":
      return "Formular gesendet";
    default:
      return kind;
  }
}
function eventDotColor(kind: string): string {
  switch (kind) {
    case "page_view":
      return "bg-info";
    case "video_play":
    case "video_progress":
      return "bg-ok";
    case "video_ended":
      return "bg-ok";
    case "cta_click":
      return "bg-brand-deep";
    case "form_submit":
      return "bg-brand";
    default:
      return "bg-ink-muted";
  }
}
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.round((now - then) / 60000);
  if (diff < 1) return "gerade eben";
  if (diff < 60) return `vor ${diff} Min.`;
  const hours = Math.round(diff / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days < 30) return `vor ${days} Tag${days === 1 ? "" : "en"}`;
  return new Date(iso).toLocaleDateString("de-DE");
}

/* ── Tab 3: Kampagnen ──────────────────────────────────────────────── */
function CampaignsTab({ data }: { data: ContactDetailData }) {
  if (data.occurrences.length === 0) {
    return (
      <p className="p-5 text-sm text-ink-muted italic">
        Dieser Kontakt war noch in keiner Kampagne.
      </p>
    );
  }
  // Nach Kampagne gruppieren, in jeder Kampagne Runden nach Datum absteigend
  const grouped = new Map<string, {
    campaignName: string;
    campaignId: string;
    runs: ContactDetailOccurrence[];
    totals: { views: number; plays: number; cta: number };
  }>();
  for (const occ of data.occurrences) {
    const existing = grouped.get(occ.campaignId);
    if (existing) {
      existing.runs.push(occ);
      existing.totals.views += occ.viewCount;
      existing.totals.plays += occ.playCount;
      existing.totals.cta += occ.ctaClickCount;
    } else {
      grouped.set(occ.campaignId, {
        campaignId: occ.campaignId,
        campaignName: occ.campaignName,
        runs: [occ],
        totals: { views: occ.viewCount, plays: occ.playCount, cta: occ.ctaClickCount },
      });
    }
  }
  const campaigns = Array.from(grouped.values()).map((c) => ({
    ...c,
    runs: c.runs.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
  }));

  return (
    <div className="p-5 space-y-4">
      {campaigns.map((c) => (
        <div key={c.campaignId} className="bg-canvas rounded-xl border border-line overflow-hidden">
          {/* Kampagnen-Header */}
          <div className="px-4 py-3 border-b border-line bg-surface">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-ink truncate">{c.campaignName}</h4>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  {c.runs.length} Runde{c.runs.length === 1 ? "" : "n"} · Insgesamt{" "}
                  <strong className="text-ink">{c.totals.views}</strong> Öffnungen,{" "}
                  <strong className="text-ink">{c.totals.cta}</strong> CTA
                </p>
              </div>
              <a
                href={`/kampagnen/${c.campaignId}`}
                className="text-[11px] text-brand-deep hover:underline shrink-0 font-semibold"
              >
                Öffnen →
              </a>
            </div>
          </div>
          {/* Runden als kompakte Tabelle */}
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-ink-muted uppercase tracking-wide">
                <th className="text-left px-4 py-2 font-semibold">Runde</th>
                <th className="text-right px-2 py-2 font-semibold">Öffn.</th>
                <th className="text-right px-2 py-2 font-semibold">CTA</th>
                <th className="text-left px-2 py-2 font-semibold">Status</th>
                <th className="text-right px-4 py-2 font-semibold">Links</th>
              </tr>
            </thead>
            <tbody>
              {c.runs.map((occ) => (
                <tr key={occ.leadId} className="border-t border-line">
                  <td className="px-4 py-2">
                    <div className="text-ink font-medium">{occ.runName}</div>
                    <div className="text-[10px] text-ink-muted">
                      {new Date(occ.createdAt).toLocaleDateString("de-DE")}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {occ.viewCount}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">
                    {occ.ctaClickCount}
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={cn(
                        "text-[9px] font-bold px-1.5 py-0.5 rounded uppercase",
                        occ.status === "completed"
                          ? "bg-ok-soft text-ok"
                          : occ.status === "failed"
                            ? "bg-danger-soft text-danger"
                            : "bg-canvas-deep text-ink-muted",
                      )}
                    >
                      {occ.status === "completed"
                        ? "Fertig"
                        : occ.status === "failed"
                          ? "Fehler"
                          : occ.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <div className="inline-flex gap-2 items-center">
                      {occ.slug && (
                        <a
                          href={`/v/${occ.slug}?preview=1`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-deep hover:underline inline-flex items-center gap-0.5"
                          title="Landingpage öffnen"
                        >
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                      {occ.videoUrl && (
                        <a
                          href={occ.videoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-deep hover:underline inline-flex items-center gap-0.5"
                          title="Video öffnen"
                        >
                          <Play className="size-3" />
                        </a>
                      )}
                      {occ.pdfUrl && (
                        <a
                          href={occ.pdfUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-deep hover:underline inline-flex items-center gap-0.5"
                          title="Brief öffnen"
                        >
                          <FileText className="size-3" />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/* ── Tab 4: Listen ─────────────────────────────────────────────────── */
function ListsTab({
  data,
  onChanged,
}: {
  data: ContactDetailData;
  onChanged: () => void;
}) {
  const { toast } = useToast();

  async function removeFromList(listId: string) {
    if (!confirm("Diesen Kontakt aus der Liste entfernen?")) return;
    try {
      const res = await fetch(`/api/contact-lists/${listId}/memberships`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: [data.contact.id] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler beim Entfernen");
      toast({ title: "Aus der Liste entfernt" });
      onChanged();
    } catch (err) {
      toastError(toast, err);
    }
  }

  return (
    <div className="p-5">
      {data.lists.length === 0 ? (
        <p className="text-sm text-ink-muted italic">
          Dieser Kontakt ist noch in keiner Liste. Wähle ihn in der Übersicht
          aus und klicke „In Liste stecken".
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.lists.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => removeFromList(l.id)}
              className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-canvas hover:bg-danger-soft text-ink hover:text-danger text-xs font-semibold transition-colors"
              title="Klicken, um Kontakt aus dieser Liste zu entfernen"
            >
              {l.name}
              <X className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
