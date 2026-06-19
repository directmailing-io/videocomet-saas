/**
 * Provider-übergreifende Typen für die CRM-Integration.
 *
 * Jeder konkrete Provider (HubSpot, Salessuite, Close) implementiert das
 * `CrmProvider`-Interface. Phase-2-Code (REST + Worker + UI) konsumiert
 * NUR diese Abstraktion und kennt die einzelnen Provider nicht namentlich.
 */

export type CrmProviderId = "hubspot" | "salessuite" | "close";

/**
 * Ein im CRM existierendes Feld (system oder custom). `key` ist der
 * provider-spezifische Identifier, mit dem Phase-2 schreibt:
 *   - HubSpot:    der `name` (z.B. "videocomet_last_view")
 *   - Salessuite: der `propertyIdentifier` (z.B. "x_videocomet_klick")
 *   - Close:      die `cf_xxx`-Id
 */
export interface CrmField {
  key: string;
  label: string;
  type: "datetime" | "text" | "number" | "boolean" | "other";
  /** Read-Only-System-Felder dürfen wir nicht überschreiben. */
  readonly: boolean;
}

/** Ein im CRM gefundener Kontakt (Lookup-Ergebnis). */
export interface CrmContact {
  id: string;
  email: string | null;
  /** Roh-Antwort des Providers, nur für Debug-/Audit-Zwecke. */
  raw?: Record<string, unknown>;
}

/**
 * Beschreibt ein neu anzulegendes Feld. HubSpot braucht zusätzlich einen
 * maschinen-lesbaren `name` — wenn der Caller keinen mitgibt, leitet der
 * HubSpot-Provider ihn aus dem `label` ab.
 */
export interface CrmFieldSpec {
  label: string;
  type: "datetime" | "text";
  name?: string;
}

export interface CrmProvider {
  id: CrmProviderId;

  /**
   * Prüft den API-Key gegen die Provider-API. Bei Erfolg liefern wir
   * optional Provider-Metadaten zurück (z.B. Tenant-Id), die in
   * `crm_integrations.metadata` gespeichert werden können.
   */
  testConnection(
    apiKey: string,
  ): Promise<{ ok: boolean; error?: string; metadata?: Record<string, unknown> }>;

  /** Liefert alle Kontakt-Felder (System + Custom). */
  listContactFields(apiKey: string): Promise<CrmField[]>;

  /**
   * Legt ein neues Custom-Feld am Contact-Objekt an. Salessuite wirft hier
   * `CrmFeatureUnsupportedError` — dort werden Felder ausschließlich im
   * Salessuite-Backend gepflegt.
   */
  createContactField(apiKey: string, spec: CrmFieldSpec): Promise<CrmField>;

  /**
   * Sucht alle Kontakte, deren `field` (email/phone) den `value` exakt
   * matched. Gibt ALLE Treffer zurück; der Caller entscheidet, ob er bei
   * >1 Treffer warnt oder den ersten nimmt.
   */
  findContactByField(
    apiKey: string,
    field: "email" | "phone",
    value: string,
  ): Promise<CrmContact[]>;

  /**
   * Schreibt die übergebenen Felder am Kontakt zurück. `fields`-Keys sind
   * provider-spezifische Identifier — siehe `CrmField.key`.
   */
  updateContactFields(
    apiKey: string,
    contactId: string,
    fields: Record<string, string>,
  ): Promise<{ ok: true; raw?: unknown }>;
}

/**
 * Wird geworfen, wenn ein Provider eine Operation strukturell nicht
 * anbietet (z.B. Salessuite `createContactField` — Custom-Fields werden
 * dort nur via Salessuite-UI angelegt). Der Caller zeigt die `message`
 * dem User an.
 */
export class CrmFeatureUnsupportedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CrmFeatureUnsupportedError";
  }
}

/**
 * Strukturierter HTTP-Fehler einer CRM-API. `retryAfterMs` ist gesetzt,
 * wenn die Antwort einen `Retry-After`-Header geliefert hat — Phase 2
 * nutzt den Wert für Worker-Backoff.
 */
export class CrmHttpError extends Error {
  status: number;
  body: unknown;
  retryAfterMs?: number;
  constructor(opts: {
    status: number;
    body: unknown;
    retryAfterMs?: number;
    message?: string;
  }) {
    super(opts.message ?? `CRM HTTP ${opts.status}`);
    this.name = "CrmHttpError";
    this.status = opts.status;
    this.body = opts.body;
    this.retryAfterMs = opts.retryAfterMs;
  }
}
