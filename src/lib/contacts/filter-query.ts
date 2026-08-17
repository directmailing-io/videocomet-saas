/**
 * Filter → SQL-Fragment (Mini-CRM Etappe 4).
 *
 * Baut aus einer normalisierten FilterDefinition ein WHERE-Fragment gegen
 * die contacts-Tabelle. Aggregate-Felder (activity.opens etc.) werden über
 * korrelierte Sub-Queries auf leads/lead_events aufgelöst — teuer bei
 * &gt;10k Kontakten, ok für erste Version.
 *
 * WICHTIG: alle User-Werte fließen NUR über drizzle-`sql`-Bind-Parameter
 * (`${value}`), damit kein SQL-Injection möglich ist. Felder werden gegen
 * eine feste Whitelist geprüft.
 */

import { sql, type SQL } from "drizzle-orm";
import type { FilterCondition, FilterDefinition, FilterGroup, FilterOp } from "./filter";

/** Baut das WHERE-Fragment. Bei leerem Filter: `TRUE` (matcht alles). */
export function buildFilterSql(filter: FilterDefinition, userId: string): SQL {
  const combined = combineGroup(filter as unknown as FilterGroup, userId);
  return combined ?? sql`TRUE`;
}

function combineGroup(group: FilterGroup | FilterDefinition, userId: string): SQL | null {
  const parts: SQL[] = [];
  for (const node of group.conditions) {
    if (node.type === "group") {
      const sub = combineGroup(node, userId);
      if (sub) parts.push(sql`(${sub})`);
    } else {
      const s = conditionToSql(node, userId);
      if (s) parts.push(s);
    }
  }
  if (parts.length === 0) return null;
  const joiner = group.logic === "or" ? sql` OR ` : sql` AND `;
  return parts.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}${joiner}${cur}`));
}

function conditionToSql(c: FilterCondition, userId: string): SQL | null {
  switch (c.field) {
    // ── Kampagne & Runde ────────────────────────────────────────────
    case "campaign_id":
      return leadListExists(userId, sql`l.campaign_id`, c.op, c.value);
    case "run_id":
      return leadListExists(userId, sql`l.run_id`, c.op, c.value);
    case "campaign_count": {
      const count = sql`(SELECT COUNT(DISTINCT l.campaign_id) FROM leads l WHERE l.contact_id = c.id AND l.removed_at IS NULL)`;
      return numericOp(count, c.op, toNumber(c.value));
    }
    case "created_at":
      return dateOp(sql`c.created_at`, c.op, c.value);
    case "last_seen_at":
      return dateOp(sql`c.last_activity_at`, c.op, c.value);

    // ── Aktivität ───────────────────────────────────────────────────
    case "activity.opens":
      return numericOp(
        sql`(SELECT COALESCE(SUM(l.view_count),0) FROM leads l WHERE l.contact_id = c.id AND l.removed_at IS NULL)`,
        c.op,
        toNumber(c.value),
      );
    case "activity.plays":
      return numericOp(
        sql`(SELECT COALESCE(SUM(l.play_count),0) FROM leads l WHERE l.contact_id = c.id AND l.removed_at IS NULL)`,
        c.op,
        toNumber(c.value),
      );
    case "activity.cta":
      return numericOp(
        sql`(SELECT COALESCE(SUM(l.cta_click_count),0) FROM leads l WHERE l.contact_id = c.id AND l.removed_at IS NULL)`,
        c.op,
        toNumber(c.value),
      );
    case "activity.watch_time_sec":
      return numericOp(
        sql`(SELECT COALESCE(SUM(l.watch_time_sec),0) FROM leads l WHERE l.contact_id = c.id AND l.removed_at IS NULL)`,
        c.op,
        toNumber(c.value),
      );
    case "activity.last_activity_at":
      return dateOp(sql`c.last_activity_at`, c.op, c.value);

    // ── Kontakt-Daten ───────────────────────────────────────────────
    case "email":
      return stringPresenceOp(sql`c.email`, c.op, c.value);
    case "email_domain": {
      const val = toStringOrNull(c.value);
      if (val === null) return null;
      const term = "%@" + val.toLowerCase();
      return c.op === "eq" || c.op === "contains"
        ? sql`LOWER(COALESCE(c.email,'')) LIKE ${term}`
        : sql`LOWER(COALESCE(c.email,'')) NOT LIKE ${term}`;
    }
    case "first_name":
      return stringLikeOp(sql`c.first_name`, c.op, c.value);
    case "last_name":
      return stringLikeOp(sql`c.last_name`, c.op, c.value);
    case "company":
      return stringLikeOp(sql`COALESCE(c.company_display, c.company)`, c.op, c.value);
    case "phone_present":
      return c.op === "is_true"
        ? sql`c.phone IS NOT NULL AND c.phone <> ''`
        : sql`c.phone IS NULL OR c.phone = ''`;
    case "linkedin_present":
      return c.op === "is_true"
        ? sql`c.linkedin_url IS NOT NULL AND c.linkedin_url <> ''`
        : sql`c.linkedin_url IS NULL OR c.linkedin_url = ''`;
    case "custom_field": {
      if (!c.fieldKey) return null;
      const val = toStringOrNull(c.value);
      const expr = sql`(c.data->>${c.fieldKey})`;
      if (c.op === "is_true") return sql`${expr} IS NOT NULL AND ${expr} <> ''`;
      if (c.op === "is_false") return sql`${expr} IS NULL OR ${expr} = ''`;
      if (val === null) return null;
      if (c.op === "eq") return sql`LOWER(COALESCE(${expr},'')) = ${val.toLowerCase()}`;
      if (c.op === "ne") return sql`LOWER(COALESCE(${expr},'')) <> ${val.toLowerCase()}`;
      if (c.op === "contains") return sql`LOWER(COALESCE(${expr},'')) LIKE ${"%" + val.toLowerCase() + "%"}`;
      if (c.op === "not_contains") return sql`LOWER(COALESCE(${expr},'')) NOT LIKE ${"%" + val.toLowerCase() + "%"}`;
      return null;
    }

    // ── Listen & Meta ───────────────────────────────────────────────
    case "in_list": {
      const ids = toIdArray(c.value);
      if (ids.length === 0) return null;
      return sql`EXISTS (SELECT 1 FROM list_memberships lm WHERE lm.contact_id = c.id AND lm.list_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}))`;
    }
    case "not_in_list": {
      const ids = toIdArray(c.value);
      if (ids.length === 0) return null;
      return sql`NOT EXISTS (SELECT 1 FROM list_memberships lm WHERE lm.contact_id = c.id AND lm.list_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}))`;
    }
    case "added_via": {
      const val = toStringOrNull(c.value);
      if (val === null) return null;
      return sql`EXISTS (SELECT 1 FROM list_memberships lm WHERE lm.contact_id = c.id AND lm.added_via = ${val})`;
    }
    case "is_duplicate":
      // Duplikate: gleiche normalized_email in >1 Contact des Users.
      return c.op === "is_true"
        ? sql`c.email IS NOT NULL AND (SELECT COUNT(*) FROM contacts c2 WHERE c2.user_id = c.user_id AND c2.email = c.email AND c2.deleted_at IS NULL) > 1`
        : sql`c.email IS NULL OR (SELECT COUNT(*) FROM contacts c2 WHERE c2.user_id = c.user_id AND c2.email = c.email AND c2.deleted_at IS NULL) <= 1`;

    default:
      return null;
  }
}

/* ── Op-Helper ──────────────────────────────────────────────────────── */

function leadListExists(
  userId: string,
  col: SQL,
  op: FilterOp,
  value: unknown,
): SQL | null {
  const ids = toIdArray(value);
  if (ids.length === 0) return null;
  const inClause = sql`${col} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`;
  const inverse = op === "not_in" || op === "ne";
  return inverse
    ? sql`NOT EXISTS (SELECT 1 FROM leads l WHERE l.contact_id = c.id AND l.removed_at IS NULL AND ${inClause})`
    : sql`EXISTS (SELECT 1 FROM leads l WHERE l.contact_id = c.id AND l.removed_at IS NULL AND ${inClause})`;
}

function numericOp(col: SQL, op: FilterOp, val: number | null): SQL | null {
  if (val === null) return null;
  switch (op) {
    case "eq":
      return sql`${col} = ${val}`;
    case "ne":
      return sql`${col} <> ${val}`;
    case "gte":
      return sql`${col} >= ${val}`;
    case "lte":
      return sql`${col} <= ${val}`;
    case "gt":
      return sql`${col} > ${val}`;
    case "lt":
      return sql`${col} < ${val}`;
    default:
      return null;
  }
}

function dateOp(col: SQL, op: FilterOp, value: unknown): SQL | null {
  if (op === "within_days") {
    const n = toNumber(value);
    if (n === null) return null;
    return sql`${col} >= (now() - (${n} || ' days')::interval)`;
  }
  if (op === "before" || op === "lte" || op === "lt") {
    const val = toStringOrNull(value);
    if (!val) return null;
    return sql`${col} < ${val}::timestamptz`;
  }
  if (op === "after" || op === "gte" || op === "gt") {
    const val = toStringOrNull(value);
    if (!val) return null;
    return sql`${col} > ${val}::timestamptz`;
  }
  if (op === "is_true") return sql`${col} IS NOT NULL`;
  if (op === "is_false") return sql`${col} IS NULL`;
  return null;
}

function stringPresenceOp(col: SQL, op: FilterOp, value: unknown): SQL | null {
  if (op === "is_true") return sql`${col} IS NOT NULL AND ${col} <> ''`;
  if (op === "is_false") return sql`${col} IS NULL OR ${col} = ''`;
  const val = toStringOrNull(value);
  if (val === null) return null;
  if (op === "eq") return sql`LOWER(COALESCE(${col},'')) = ${val.toLowerCase()}`;
  if (op === "ne") return sql`LOWER(COALESCE(${col},'')) <> ${val.toLowerCase()}`;
  if (op === "contains") return sql`LOWER(COALESCE(${col},'')) LIKE ${"%" + val.toLowerCase() + "%"}`;
  if (op === "not_contains") return sql`LOWER(COALESCE(${col},'')) NOT LIKE ${"%" + val.toLowerCase() + "%"}`;
  return null;
}

function stringLikeOp(col: SQL, op: FilterOp, value: unknown): SQL | null {
  const val = toStringOrNull(value);
  if (val === null) {
    if (op === "is_true") return sql`${col} IS NOT NULL AND ${col} <> ''`;
    if (op === "is_false") return sql`${col} IS NULL OR ${col} = ''`;
    return null;
  }
  const lower = val.toLowerCase();
  switch (op) {
    case "eq":
      return sql`LOWER(COALESCE(${col},'')) = ${lower}`;
    case "ne":
      return sql`LOWER(COALESCE(${col},'')) <> ${lower}`;
    case "contains":
      return sql`LOWER(COALESCE(${col},'')) LIKE ${"%" + lower + "%"}`;
    case "not_contains":
      return sql`LOWER(COALESCE(${col},'')) NOT LIKE ${"%" + lower + "%"}`;
    default:
      return null;
  }
}

/* ── Value-Coercion ─────────────────────────────────────────────────── */

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStringOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number") return String(v);
  return null;
}

function toIdArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.length > 0);
  if (typeof v === "string" && v.length > 0) return [v];
  return [];
}
