"use client";

/**
 * Einheitliches CRM-Detail-Modal — zentriertes Modal mit Avatar-Header und
 * Tab-Leiste. Wird von der Lead-Detailansicht (Run-Detail) und der
 * Kontakt-Detailansicht (/kontakte) geteilt, damit beide gleich aussehen.
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCompanyName, formatPersonName } from "@/lib/format-name";

export interface CrmTab {
  id: string;
  label: string;
  badge?: number;
}

export interface CrmDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initials: string;
  title: string;
  subtitle?: string;
  /** Badges/Pills unter dem Titel (Status, Temperatur, …). */
  badges?: React.ReactNode;
  /** Aktionen rechts im Header (z.B. Vorschau-Link). */
  headerActions?: React.ReactNode;
  tabs: CrmTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /** Optionaler Bereich unter dem scrollbaren Inhalt (z.B. DSGVO-Löschen). */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function CrmDetailModal({
  open,
  onOpenChange,
  initials,
  title,
  subtitle,
  badges,
  headerActions,
  tabs,
  activeTab,
  onTabChange,
  footer,
  children,
}: CrmDetailModalProps): React.JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(94vw,44rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "rounded-squircle-xl bg-surface shadow-lift",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            "duration-200",
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-6 pt-5">
            <div className="flex min-w-0 items-center gap-3.5">
              <span
                aria-hidden
                className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-soft text-base font-bold text-brand-deep"
              >
                {initials}
              </span>
              <div className="min-w-0">
                <DialogPrimitive.Title className="truncate text-lg font-bold leading-tight text-ink">
                  {title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-0.5 truncate text-sm text-ink-muted">
                  {subtitle || "Detailansicht"}
                </DialogPrimitive.Description>
                {badges && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {badges}
                  </div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {headerActions}
              <DialogPrimitive.Close
                className="rounded-full p-1.5 text-ink-muted opacity-70 transition-opacity hover:bg-line-soft hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                aria-label="Schließen"
              >
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Tab-Leiste */}
          <div className="px-6 pb-4 pt-4">
            <div
              role="tablist"
              className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-surface-soft p-1"
            >
              {tabs.map((t) => {
                const active = t.id === activeTab;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onTabChange(t.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
                      active
                        ? "bg-surface text-ink shadow-card"
                        : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {t.label}
                    {typeof t.badge === "number" && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                          active
                            ? "bg-brand-soft text-brand-deep"
                            : "bg-surface text-ink-muted",
                        )}
                      >
                        {t.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Inhalt */}
          <div className="flex-1 overflow-y-auto px-6 pb-6">{children}</div>

          {footer && (
            <div className="border-t border-line-soft px-6 py-4">{footer}</div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ */
/*  Feld-Raster für importierte Lead-Daten                             */
/* ------------------------------------------------------------------ */

function normalizeFieldKey(key: string): string {
  return key
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

const NAME_FIELD_KEYS = new Set([
  "vorname",
  "firstname",
  "nachname",
  "lastname",
  "name",
  "fullname",
  "ansprechpartner",
]);

const COMPANY_FIELD_KEYS = new Set([
  "firma",
  "company",
  "companyname",
  "unternehmen",
  "firmenname",
]);

/** Bekannte Felder zuerst — der Rest folgt in Import-Reihenfolge. */
const FIELD_PRIORITY = [
  "vorname",
  "firstname",
  "nachname",
  "lastname",
  "name",
  "fullname",
  "email",
  "mail",
  "telefon",
  "phone",
  "tel",
  "mobil",
  "firma",
  "company",
  "companyname",
  "unternehmen",
  "position",
  "strasse",
  "street",
  "adresse",
  "address",
  "hausnummer",
  "plz",
  "zip",
  "postleitzahl",
  "ort",
  "stadt",
  "city",
  "land",
  "country",
  "website",
  "url",
  "webseite",
];

function FieldValue({
  fieldKey,
  value,
}: {
  fieldKey: string;
  value: string;
}): React.JSX.Element {
  const norm = normalizeFieldKey(fieldKey);
  if (NAME_FIELD_KEYS.has(norm)) return <>{formatPersonName(value)}</>;
  if (COMPANY_FIELD_KEYS.has(norm)) return <>{formatCompanyName(value)}</>;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return (
      <a href={`mailto:${value}`} className="text-brand-deep hover:underline">
        {value}
      </a>
    );
  }
  if (/^https?:\/\//i.test(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-brand-deep hover:underline"
      >
        {value}
      </a>
    );
  }
  return <>{value}</>;
}

/**
 * Alle importierten Lead-Felder als aufgeräumtes Raster: bekannte
 * Kontaktfelder zuerst, Namen/Firmen formatiert, E-Mails/URLs verlinkt,
 * lange Werte über die volle Breite.
 */
export function LeadFieldGrid({
  data,
}: {
  data: Record<string, unknown> | null | undefined;
}): React.JSX.Element {
  const entries = React.useMemo(() => {
    const all = Object.entries(data ?? {})
      .map(([k, v]) => [k, String(v ?? "").trim()] as const)
      .filter(([, v]) => v !== "");
    const rank = (key: string) => {
      const i = FIELD_PRIORITY.indexOf(normalizeFieldKey(key));
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return all
      .map(([k, v], idx) => ({ k, v, idx }))
      .sort((a, b) => rank(a.k) - rank(b.k) || a.idx - b.idx);
  }, [data]);

  if (entries.length === 0) {
    return (
      <div className="rounded-squircle-md bg-surface-soft px-4 py-6 text-center text-sm text-ink-muted">
        Keine Daten importiert.
      </div>
    );
  }

  return (
    <dl className="grid grid-cols-1 gap-x-5 gap-y-3.5 rounded-squircle-md bg-surface-soft px-5 py-4 sm:grid-cols-2">
      {entries.map(({ k, v }) => (
        <div key={k} className={cn("min-w-0", v.length > 60 && "sm:col-span-2")}>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            {k}
          </dt>
          <dd className="mt-0.5 break-words text-sm text-ink">
            <FieldValue fieldKey={k} value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Initialen aus einem (bereits formatierten) Anzeigenamen. */
export function crmInitials(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toLocaleUpperCase("de-DE"))
      .join("") || "?"
  );
}
