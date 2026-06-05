/**
 * Slug-Engine für personalisierte Landingpage-URLs.
 *
 * Drei Aufgaben in einem Modul:
 *  1. Basis-Slugify: Trim/Transliteration/Lowercase/Hyphen-Normalize
 *  2. Template-Engine: {firstName}-{lastName} → "peter-mueller" aus Lead-Daten,
 *     mit aliasing zwischen englischen Keys und deutschen CSV-Feldern.
 *  3. Reserved-Slug-Guard: Pfade die mit App-Routen kollidieren (api, v, _next,
 *     track, admin, ...) bekommen automatisch einen Hex-Suffix.
 *
 * Die Template-Engine delegiert die Substitution an `substitute()` aus
 * `@/lib/placeholders/substitute`, sodass das Mapping aus dem Run (sofern
 * vorhanden) auch hier greift — UI und Worker landen am selben Lookup.
 *
 * Wichtig: Diese Datei ist server-safe (keine "use client"). Wird in
 * Worker + API + UI-Validierung gleichermaßen genutzt.
 */
import { substitute } from "./placeholders/substitute";
import type {
  LegacyMapping,
  PlaceholderMapping,
} from "./placeholders/types";

// ── Basis-Slugify ──────────────────────────────────────────────────────────

const TRANSLIT: Record<string, string> = {
  "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss",
  "Ä": "Ae", "Ö": "Oe", "Ü": "Ue",
  "à": "a", "á": "a", "â": "a", "ã": "a", "å": "a",
  "è": "e", "é": "e", "ê": "e", "ë": "e",
  "ì": "i", "í": "i", "î": "i", "ï": "i",
  "ò": "o", "ó": "o", "ô": "o", "õ": "o",
  "ù": "u", "ú": "u", "û": "u",
  "ñ": "n", "ç": "c", "ý": "y", "ÿ": "y",
};
const TRANSLIT_RE = /[äöüÄÖÜßàáâãåèéêëìíîïòóôõùúûñçýÿ]/g;

/** Normalisiert einen String zu einem URL-sicheren Slug-Fragment. */
export function slugifyBasic(input: string): string {
  let s = (input ?? "").trim();
  if (!s) return "";
  s = s.replace(TRANSLIT_RE, (c) => TRANSLIT[c] ?? c);
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  return s.slice(0, 80);
}

/**
 * Hex-Suffix wie bisher (`a4f2`) — niemals Buchstabe `b`/`e`/`x` allein, also
 * standard hex chars 0-9a-f. 4 Zeichen → ~65k Kollisions-Spielraum pro Basis.
 */
export function slugHexSuffix(): string {
  return Math.random().toString(16).slice(2, 6).padStart(4, "0");
}

// ── Reserved-Slugs ─────────────────────────────────────────────────────────

/**
 * Slugs die wir nicht vergeben dürfen, weil sie mit App-Routen kollidieren
 * würden wenn die Domain als <hostname>/<slug> verwendet wird (Custom-Domain).
 *
 * Pflicht: alle Top-Level-Pfade aus src/app/ + alle public files +
 * Tracking-Endpoints + Service-Pfade.
 */
export const RESERVED_SLUGS = new Set<string>([
  // Next.js / framework
  "_next", "favicon.ico", "robots.txt", "sitemap.xml",
  // App-Routen
  "api", "v", "admin", "login", "logout", "register", "auth",
  "dashboard", "kampagnen", "runden", "mediathek", "landingpages",
  "einstellungen", "analytics", "app",
  // Tracking / health
  "track", "healthz", "health", "ping",
  // Reserved für kuenftige Features
  "settings", "billing", "support", "docs", "help",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

// ── Template-Engine ────────────────────────────────────────────────────────

/**
 * Default-Template wenn die Kampagne keines explizit gesetzt hat.
 */
export const DEFAULT_SLUG_TEMPLATE = "{firstName}-{lastName}";

/**
 * Aliase für häufige CSV-Feldnamen — so funktionieren Templates wie
 * `{firstName}-{lastName}` auch wenn das CSV "Vorname" / "Nachname" heißt.
 *
 * Lookup-Reihenfolge: erst exakter Match auf den Template-Key, dann der
 * Reihe nach durch die Aliasse.
 */
const FIELD_ALIASES: Record<string, ReadonlyArray<string>> = {
  firstName: ["firstName", "Vorname", "vorname", "Vornahme", "first_name", "first name"],
  lastName: ["lastName", "Nachname", "nachname", "last_name", "last name", "Name"],
  fullName: ["fullName", "Name", "name", "full_name"],
  email: ["email", "E-Mail", "Email", "eMail", "mail"],
  company: ["company", "companyName", "Firma", "firma", "Unternehmen"],
  companyName: ["companyName", "company", "Firma", "firma", "Unternehmen"],
  city: ["city", "Stadt", "stadt", "Ort", "ort"],
};

function lookupField(
  key: string,
  data: Record<string, string | null | undefined>,
): string {
  // Exakter Treffer
  const direct = data[key];
  if (direct != null && String(direct).trim() !== "") return String(direct).trim();
  // Alias-Liste
  const aliases = FIELD_ALIASES[key];
  if (aliases) {
    for (const a of aliases) {
      const v = data[a];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
  }
  return "";
}

/**
 * Rendert ein Slug-Template mit den Lead-Daten. Unbekannte / leere Felder
 * werden zu Leerstring. Mehrfach-Trennzeichen werden zu einem zusammengefasst.
 *
 * Wenn ein `mapping` übergeben wird (neues `PlaceholderMapping` oder
 * Legacy-Record), ist es die Vorrangs-Quelle — die `lookupField`-Alias-
 * Logik dient als Fallback wenn der User noch nichts gemappt hat (alle
 * existierenden Aufrufer bleiben funktionsgleich).
 *
 * Beispiele:
 *   render("{firstName}-{lastName}", {firstName: "Peter", lastName: "Müller"})
 *     → "peter-mueller"
 *   render("{firstName}-{lastName}", {Vorname: "Peter", Nachname: "Müller"})
 *     → "peter-mueller"   (via Alias)
 *   render("{firstName}.{lastName}", {firstName: "Peter"})  // lastName fehlt
 *     → "peter"
 *   render("{x}", {}) // kein Feld findet was
 *     → "" (Caller muss Fallback haben)
 */
export function renderSlugTemplate(
  template: string,
  data: Record<string, string | null | undefined>,
  mapping?: PlaceholderMapping | LegacyMapping,
): string {
  const tpl = template && template.trim() !== "" ? template : DEFAULT_SLUG_TEMPLATE;
  // Aliase + null-safe in einen reinen Record<string,string> giessen.
  const stringData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && v.trim() !== "") stringData[k] = v.trim();
  }
  // 1. Zentrale Substitution gibt uns das Mapping-bewusste Resultat.
  //    `single-brace` matched `{key}` ohne `{{ … }}` Konflikte.
  let replaced = substitute(tpl, stringData, mapping, "single-brace");
  // 2. Falls der zentrale Lookup für einen Key NICHTS findet, fallen wir
  //    auf das alte Alias-Verhalten zurück (firstName ↔ Vorname). Das ist
  //    wichtig für Bestands-Kampagnen, deren Slug-Template gegen ein CSV
  //    läuft, das nicht durch den Mapping-Step gegangen ist.
  replaced = replaced.replace(
    /\{\s*([a-zA-Z0-9_]+)\s*\}/g,
    (_, key: string) => lookupField(key, data),
  );
  return slugifyBasic(replaced);
}

// ── End-to-End-Generator (Template + Kollision + Reserved) ────────────────

export interface GenerateSlugOptions {
  /** Slug-Template aus der Kampagne, z.B. "{firstName}-{lastName}". */
  template?: string | null;
  /** Lead-Daten (CSV-row). */
  leadData: Record<string, string | null | undefined>;
  /**
   * Optionales Placeholder-Mapping aus `runs.column_mapping.placeholderMapping`.
   * Wenn gesetzt, gewinnt es vor der Alias-Logik. Wenn `undefined`, bleibt
   * das alte Aliasing-Verhalten unverändert (Bestandsschutz).
   */
  mapping?: PlaceholderMapping | LegacyMapping;
  /**
   * Wird mit einem Kandidaten-Slug aufgerufen und liefert true, wenn der
   * Slug noch frei ist (innerhalb der relevanten Domain-Scope).
   * Async, weil der Caller einen DB-Query macht.
   */
  isAvailable: (candidate: string) => Promise<boolean>;
  /**
   * Optional ein deterministischer Fallback (z.B. Lead-Row-Index oder Id),
   * der genutzt wird wenn das Template nichts produziert.
   */
  fallbackId?: string | number;
  /** Maximale Versuche bei Kollision/Reserved. Default 8. */
  maxAttempts?: number;
  /**
   * Wenn gesetzt, wird `-<suffix>` an JEDEN generierten Slug angehängt
   * (Tenant-Suffix aus `campaigns.slug_suffix`). Erwartet ein bereits
   * normalisiertes Token (`^[a-z0-9-]{1,32}$`); die DB-CHECK-Constraint
   * stellt das beim Schreiben sicher. Wir slugifyen hier defensiv nochmal,
   * damit ein versehentlich uebergebenes Whitespace-Token nicht durchsickert.
   */
  campaignSlugSuffix?: string | null;
  /**
   * Wie Kollisions-Suffixe aussehen sollen:
   *   - `numeric` (Default): `base`, `base-2`, `base-3`, … (lesbar, neuer Modus)
   *   - `hex`: `base-a4f2` (alter Modus, Bestandsschutz für Migrationsweg)
   */
  collisionStrategy?: "numeric" | "hex";
}

/**
 * Generiert einen Slug aus Template + Daten und garantiert Eindeutigkeit
 * via `isAvailable()` callback.
 *
 * Strategie (Reihenfolge ist wichtig — der Campaign-Suffix muss VOR dem
 * Reserved-Check sitzen, damit `reserved-test` nicht trotz Tenant-Suffix
 * mit dem App-Routen-Pfad kollidiert):
 *
 *   1. Template rendern → base
 *   2. Wenn base leer → Fallback `lead-<fallbackId>`
 *   3. Wenn `campaignSlugSuffix` gesetzt → `${base}-${suffix}` (Tenant-Marker)
 *   4. Wenn base reserved → Hex-Suffix anhaengen (collision-strategy-agnostisch:
 *      Reserved-Pfade sollen NIE als `api-2` rauskommen, das maskiert das Problem)
 *   5. isAvailable(base)? → return
 *   6. Kollisions-Loop:
 *        - numeric: `base-2`, `base-3`, … bis `base-${maxAttempts+1}`
 *        - hex:     `base-<hex4>` bis zu `maxAttempts` Versuche
 *   7. Letzter Ausweg: Epoch-Suffix `<base>-<epoch36>` (race-resistant, kollidiert
 *      praktisch nie und wird vom DB-Unique-Constraint als Safety-Net abgefangen).
 */
export async function generateSlug(opts: GenerateSlugOptions): Promise<string> {
  const maxAttempts = opts.maxAttempts ?? 8;
  const collisionStrategy = opts.collisionStrategy ?? "numeric";

  let base = renderSlugTemplate(
    opts.template ?? DEFAULT_SLUG_TEMPLATE,
    opts.leadData,
    opts.mapping,
  );

  if (!base) {
    const fb = opts.fallbackId != null ? String(opts.fallbackId) : slugHexSuffix();
    base = slugifyBasic(`lead-${fb}`);
  }

  // Tenant-Suffix (kommt VOR dem Reserved-Check, damit ein User explizit
  // einen reservierten Pfad „retten" könnte indem er einen Suffix setzt —
  // gleichzeitig schützt der Reserved-Check unten weiterhin, falls der
  // resultierende kombinierte Slug immer noch reserved ist).
  if (opts.campaignSlugSuffix && opts.campaignSlugSuffix.trim() !== "") {
    const suffix = slugifyBasic(opts.campaignSlugSuffix);
    if (suffix) base = `${base}-${suffix}`;
  }

  // Reserved → direkt mit Hex suffixen (numeric-`-2` würde das Reserved-
  // Problem visuell verstecken; Hex ist hier der korrektere Marker).
  if (isReservedSlug(base)) {
    base = `${base}-${slugHexSuffix()}`;
  }

  // Erst-Versuch ohne Kollisions-Suffix.
  if (await opts.isAvailable(base)) return base;

  if (collisionStrategy === "numeric") {
    // Start bei -2 (das erste Vorkommen sitzt ohne Suffix), aufsteigend bis
    // `-${maxAttempts+1}`. Beispiel: maxAttempts=8 → -2, -3, …, -9.
    for (let n = 2; n <= maxAttempts + 1; n += 1) {
      const candidate = `${base}-${n}`;
      if (await opts.isAvailable(candidate)) return candidate;
    }
  } else {
    for (let i = 0; i < maxAttempts; i += 1) {
      const candidate = `${base}-${slugHexSuffix()}`;
      if (await opts.isAvailable(candidate)) return candidate;
    }
  }

  // Letzter Ausweg: Epoch-basiert, fast garantiert eindeutig. Greift nur,
  // wenn `maxAttempts` Kandidaten in Folge kollidiert sind (extrem selten,
  // typisch nur bei massiver Concurrency auf identischem Namen).
  return `${base}-${Date.now().toString(36).slice(-6)}`;
}

// ── Backward-Compat: alter slugify() für bestehende Aufrufer ──────────────

/**
 * @deprecated Bevorzuge `generateSlug()` mit isAvailable-Check oder
 * `slugifyBasic()` für reines Normalisieren.
 *
 * Behaelt alte Signatur bei (mit-immer-Hex-Suffix) um existierende Aufrufer
 * (Landingpage-Templates, etc.) nicht zu brechen.
 */
export function slugify(input: string, randomSuffix = true): string {
  const base = slugifyBasic(input).slice(0, 76);
  if (!randomSuffix) return base;
  return `${base}-${slugHexSuffix()}`;
}
