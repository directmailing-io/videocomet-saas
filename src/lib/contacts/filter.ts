/**
 * Filter-Definition für die Kontakte-Zentrale (Mini-CRM Etappe 4).
 *
 * Frei kombinierbar über 4 Kategorien (Kampagne, Aktivität, Kontakt-Daten,
 * Listen/Meta). Root-Ebene ist UND-verknüpft; explizite ODER-Gruppen können
 * darunter platziert werden.
 *
 * Persistiert in `contact_lists.smart_filter` (jsonb) für Smart-Listen und
 * (später) in `saved_filters` für Bookmark-Filter ohne Liste.
 */

/** Alle unterstützten Felder + ihre erlaubten Operatoren. */
export type FilterField =
  // Kampagne & Runde
  | "campaign_id"
  | "run_id"
  | "campaign_count"
  | "created_at"
  | "last_seen_at"
  // Aktivität & Engagement
  | "activity.opens"
  | "activity.plays"
  | "activity.cta"
  | "activity.watch_time_sec"
  | "activity.last_activity_at"
  // Kontakt-Daten
  | "email"
  | "email_domain"
  | "first_name"
  | "last_name"
  | "company"
  | "phone_present"
  | "linkedin_present"
  | "custom_field"
  // Listen & Meta
  | "in_list"
  | "not_in_list"
  | "added_via"
  | "is_duplicate";

export type FilterOp =
  | "eq"
  | "ne"
  | "in"
  | "not_in"
  | "gte"
  | "lte"
  | "gt"
  | "lt"
  | "is_true"
  | "is_false"
  | "contains"
  | "not_contains"
  | "before"
  | "after"
  | "within_days"; // Value = Anzahl Tage (letzte N Tage)

export interface FilterCondition {
  type: "condition";
  field: FilterField;
  op: FilterOp;
  value?: string | number | boolean | Array<string | number> | null;
  /** Für `custom_field`: welcher Schlüssel im contacts.data-jsonb. */
  fieldKey?: string;
}

export interface FilterGroup {
  type: "group";
  logic: "and" | "or";
  conditions: Array<FilterCondition | FilterGroup>;
}

export interface FilterDefinition {
  logic: "and" | "or";
  conditions: Array<FilterCondition | FilterGroup>;
}

/** Leerer Filter — matched alle Kontakte des Users. */
export const EMPTY_FILTER: FilterDefinition = { logic: "and", conditions: [] };

/**
 * Voreingestellte Filter aus dem Pitch v2 (6 Presets). Wandern in die UI
 * als Ein-Klick-Vorlagen. Werte sind bewusst konservativ (14/30/60/90d).
 */
export const FILTER_PRESETS: Array<{
  key: string;
  label: string;
  description: string;
  definition: FilterDefinition;
}> = [
  {
    key: "not_opened",
    label: "Follow-up: Nicht geöffnet",
    description: "Video versendet, keine Landingpage-Öffnung in den letzten 14 Tagen.",
    definition: {
      logic: "and",
      conditions: [
        { type: "condition", field: "campaign_count", op: "gte", value: 1 },
        { type: "condition", field: "activity.opens", op: "eq", value: 0 },
        { type: "condition", field: "created_at", op: "before", value: daysAgoIso(14) },
      ],
    },
  },
  {
    key: "warm_leads",
    label: "Warme Leads",
    description: "Video gesehen + CTA geklickt in den letzten 30 Tagen.",
    definition: {
      logic: "and",
      conditions: [
        { type: "condition", field: "activity.plays", op: "gte", value: 1 },
        { type: "condition", field: "activity.cta", op: "gte", value: 1 },
        { type: "condition", field: "activity.last_activity_at", op: "within_days", value: 30 },
      ],
    },
  },
  {
    key: "stalled",
    label: "Zurückgebliebene",
    description: "Nur eine Kampagne, keine Aktivität seit 60 Tagen.",
    definition: {
      logic: "and",
      conditions: [
        { type: "condition", field: "campaign_count", op: "eq", value: 1 },
        { type: "condition", field: "activity.opens", op: "eq", value: 0 },
        { type: "condition", field: "created_at", op: "before", value: daysAgoIso(60) },
      ],
    },
  },
  {
    key: "reactivation",
    label: "Reaktivierung",
    description: "Waren mal aktiv (CTA), keine Aktivität seit 90 Tagen.",
    definition: {
      logic: "and",
      conditions: [
        { type: "condition", field: "activity.cta", op: "gte", value: 1 },
        { type: "condition", field: "activity.last_activity_at", op: "before", value: daysAgoIso(90) },
      ],
    },
  },
  {
    key: "fresh",
    label: "Frische Importe",
    description: "Diese Woche angelegt, noch keine Kampagne gelaufen.",
    definition: {
      logic: "and",
      conditions: [
        { type: "condition", field: "created_at", op: "within_days", value: 7 },
        { type: "condition", field: "campaign_count", op: "eq", value: 0 },
      ],
    },
  },
  {
    key: "no_email",
    label: "Ohne E-Mail-Adresse",
    description: "Kontakte, denen die E-Mail fehlt (Import unvollständig).",
    definition: {
      logic: "and",
      conditions: [
        { type: "condition", field: "email", op: "is_false" },
      ],
    },
  },
];

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

/**
 * Sehr defensive Server-seitige Validierung: unerwartete Werte werden
 * verworfen, nicht als Query verarbeitet. Der Query-Builder unten setzt
 * das voraus.
 */
export function normalizeFilter(input: unknown): FilterDefinition {
  if (!input || typeof input !== "object") return EMPTY_FILTER;
  const root = input as Record<string, unknown>;
  const logic = root.logic === "or" ? "or" : "and";
  const conditions = Array.isArray(root.conditions)
    ? root.conditions.map(normalizeNode).filter((n): n is FilterCondition | FilterGroup => n !== null)
    : [];
  return { logic, conditions };
}

function normalizeNode(node: unknown): FilterCondition | FilterGroup | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  if (n.type === "group") {
    const logic = n.logic === "or" ? "or" : "and";
    const conds = Array.isArray(n.conditions)
      ? n.conditions.map(normalizeNode).filter((c): c is FilterCondition | FilterGroup => c !== null)
      : [];
    return { type: "group", logic, conditions: conds };
  }
  if (n.type === "condition" && typeof n.field === "string" && typeof n.op === "string") {
    return {
      type: "condition",
      field: n.field as FilterField,
      op: n.op as FilterOp,
      value: n.value as FilterCondition["value"],
      fieldKey: typeof n.fieldKey === "string" ? n.fieldKey : undefined,
    };
  }
  return null;
}
