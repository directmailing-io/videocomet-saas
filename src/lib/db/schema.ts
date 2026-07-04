import { pgTable, uuid, text, timestamp, boolean, integer, smallint, jsonb, pgEnum, index, unique, uniqueIndex, bigserial, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { CampaignThumbnailImage } from "@/lib/segments/types";

// ── Enums ───────────────────────────────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", ["admin", "user"]);
// Migration 0006 erweitert die Postgres-ENUM um drei Werte (preflighting,
// awaiting_approval, approved). Reihenfolge muss zur Postgres-ENUM-Reihenfolge
// passen (alte Werte zuerst, neue ans Ende).
export const runStatusEnum = pgEnum("run_status", [
  "draft",
  "mapping",
  "generating",
  "completed",
  "failed",
  "cancelled",
  "preflighting",
  "awaiting_approval",
  "approved",
]);
export const leadStatusEnum = pgEnum("lead_status", ["pending", "rendering", "uploading", "completed", "failed"]);
export const mediaTypeEnum = pgEnum("media_type", ["webcam", "image", "video", "logo"]);
export const mediaUrlTypeEnum = pgEnum("media_url_type", [
  "gdoc",
  "gsheet",
  "gslides",
  "gform",
  "gdrive_file",
  "youtube",
  "generic",
]);
export const mediaUrlPreviewStatusEnum = pgEnum("media_url_preview_status", [
  "pending",
  "ready",
  "error",
  "private",
]);

// ── Billing-Enums (Migration 0027) ───────────────────────────────────────
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",          // laufend bezahlt
  "past_due",        // Zahlung fehlgeschlagen, Gnadenfrist
  "canceled",        // gekündigt, Lese-Zugriff bleibt
  "incomplete",      // erste Zahlung noch nicht erfolgreich
  "trialing",        // Trial-Period (Phase 2 Feature)
  "unpaid",          // Zahlung endgueltig fehlgeschlagen
]);
export const creditTxKindEnum = pgEnum("credit_tx_kind", [
  "topup",           // Credit-Kauf (positive Delta)
  "video_charge",    // Verbrauch fuer Video-Generation (negative Delta)
  "admin_adjust",    // Manuelle Korrektur (Refund/Goodwill, +/-)
  "promo_grant",     // Promo-Code / Welcome-Bonus (positive Delta)
]);

// ── Users (Admins + App-Users in einer Tabelle, Rolle bestimmt Zugang) ──────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("user"),
  isActive: boolean("is_active").notNull().default(true),

  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  companyName: text("company_name"),
  vatId: text("vat_id"),

  // Rechnungsadresse
  billingStreet: text("billing_street"),
  billingZip: text("billing_zip"),
  billingCity: text("billing_city"),
  billingCountry: text("billing_country").default("DE"),

  // ── Billing-Felder (Migration 0027) ────────────────────────────────────
  // Stripe-Customer-ID — der User existiert auch ohne Stripe-Konto (Admin-
  // Invite kann passieren bevor er checkout macht). Erste Checkout-Session
  // erzeugt den Customer und schreibt die ID hier rein.
  stripeCustomerId: text("stripe_customer_id"),
  // Aktueller Subscription-Status (synced via Stripe-Webhooks). NULL = keine
  // Subscription je angelegt.
  subscriptionStatus: subscriptionStatusEnum("subscription_status"),
  // Stripe-Subscription-ID — wenn aktiv, koennen wir hier Customer-Portal
  // und Cancel direkt addressieren.
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Wann endet der aktuelle bezahlte Zyklus? Bei `canceled` heisst das
  // weiterhin Zugriff bis zu diesem Datum (Stripe-Standard).
  subscriptionCurrentPeriodEnd: timestamp("subscription_current_period_end", {
    withTimezone: true,
  }),
  // Cached Credit-Balance fuer schnelle UI-Lookups. Source-of-Truth bleibt
  // das credit_transactions-Ledger (SUM(delta)). Wir sync'en den Cache bei
  // jeder Mutation atomar im selben Transaction-Scope.
  creditBalance: integer("credit_balance").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
}, (t) => ({
  emailIdx: index("users_email_idx").on(t.email),
  stripeCustomerIdx: index("users_stripe_customer_idx").on(t.stripeCustomerId),
}));

// ── Sessions (Lucia) ────────────────────────────────────────────────────────
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => ({
  userIdx: index("sessions_user_idx").on(t.userId),
}));

// ── Password-Reset-Tokens ───────────────────────────────────────────────────
export const passwordResets = pgTable("password_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tokenIdx: index("pwreset_token_idx").on(t.tokenHash),
}));

// ── Mediathek ───────────────────────────────────────────────────────────────
export const mediaItems = pgTable("media_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: mediaTypeEnum("type").notNull(),
  name: text("name").notNull(),
  filename: text("filename").notNull(),
  publicUrl: text("public_url").notNull(),
  durationSec: integer("duration_sec"),
  bytes: integer("bytes"),
  // Native Pixel-Dimensionen der Quelle. Wird beim Upload via ffprobe befüllt
  // (siehe `media-upload-service.ts`). NULL für Altbestand und für nicht-
  // probte Image/Logo-Uploads (deren Aspect spielt für die Render-Pipeline
  // keine Rolle). Worker und UI behandeln NULL als "16:9 / Landscape default"
  // — das matched das frühere implizite Verhalten.
  width: integer("width"),
  height: integer("height"),
  // ── Bunny-Stream availableResolutions (Migration 0016) ────────────────
  // Real von Bunny gerenderte Resolutions-Labels (`["240p", "480p", ...]`).
  // Wird vom MP4-Fallback-Helper `pickBunnyMp4Fallback()` gelesen, um die
  // höchste tatsächlich existierende Auflösung zu wählen — verhindert
  // 404s für Portrait-Quellen (kein 720p-Render).
  // NULL = unbekannt / Altbestand → Helper nutzt safe-default `play_480p`.
  availableResolutions: text("available_resolutions").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("media_user_idx").on(t.userId),
}));

// ── Landingpage-Templates ───────────────────────────────────────────────────
export const landingPageTemplates = pgTable("landing_page_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  themeId: text("theme_id").notNull().default("clean"),
  content: jsonb("content").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("lptpl_user_idx").on(t.userId),
}));

// ── Campaigns ───────────────────────────────────────────────────────────────
export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),

  // Webcam
  webcamMediaId: uuid("webcam_media_id").references(() => mediaItems.id, { onDelete: "set null" }),

  // Modus
  mode: text("mode").notNull().default("webcam-only"), // 'webcam-only' | 'with-presentation'

  // Segmente (Editor-Konfiguration)
  segments: jsonb("segments").$type<unknown[]>().default([]),
  pipPosition: text("pip_position").default("bottom-left"), // 'bottom-left' | 'bottom-right'
  pipShape: text("pip_shape").default("rounded"), // 'square' | 'rounded' | 'circle'

  // Landingpage
  landingPageTemplateId: uuid("landing_page_template_id").references(() => landingPageTemplates.id, { onDelete: "set null" }),
  /**
   * Optional: Custom-HTML/CSS/JS Landingpage-Template, das vom Kunden als ZIP
   * hochgeladen wurde. Wenn gesetzt, hat es Vorrang vor dem Block-basierten
   * `landingPageTemplateId`. NULL = Default-/Blocks-Landingpage wird benutzt.
   * FK wird in Migration 0005 hinzugefügt (Vorwärtsreferenz auf
   * `custom_lp_templates`).
   */
  customLpTemplateId: uuid("custom_lp_template_id"),
  /** Custom-Domain für die Landingpage-URL. NULL = Default `app.videocomet.de/v/<slug>`. */
  domainId: uuid("domain_id"),
  /**
   * Slug-Template für Leads dieser Kampagne, z.B. `{firstName}-{lastName}`.
   * Felder werden aus `leads.data` (oder bekannten Aliases wie `firstName`
   * ↔ `Vorname`) befüllt. NULL → Default `{firstName}-{lastName}`.
   */
  slugTemplate: text("slug_template"),

  // PDF-Brief
  pdfEnabled: boolean("pdf_enabled").notNull().default(false),
  pdfGoogleDocsUrl: text("pdf_google_docs_url"),
  pdfQrEnabled: boolean("pdf_qr_enabled").notNull().default(false),
  pdfThumbnailEnabled: boolean("pdf_thumbnail_enabled").notNull().default(false),
  pdfThumbnailFrameMs: integer("pdf_thumbnail_frame_ms"),

  // ── Thumbnail-Generator (Migration 0018) ─────────────────────────────
  // Feature-Toggle + Slide-artige Konfiguration für ein eigenes Thumbnail-
  // Bild der Kampagne. Wenn `thumbnailImage` Platzhalter enthält, rendert
  // die Pipeline pro Lead (siehe `leads.customThumbnailUrl`); sonst genau
  // einmal pro Run (siehe `runs.sharedThumbnailUrl`).
  thumbnailImageEnabled: boolean("thumbnail_image_enabled").notNull().default(false),
  thumbnailImage: jsonb("thumbnail_image").$type<CampaignThumbnailImage | null>(),

  // ── Thumbnail-Modus (Migration 0019) ──────────────────────────────────
  // Single-Source-of-Truth für die Art des Vorschaubilds. Drei Modi:
  //   • 'frame'                  → Standbild aus dem Video
  //   • 'custom_image'           → personalisierte Folie (siehe `thumbnailImage`)
  //   • 'landingpage_screenshot' → Auto-Screenshot der Lead-LP
  // Frontend hält `thumbnailImageEnabled` als computed mirror von
  // (thumbnailMode === 'custom_image'), bis Paket B/C den Pipeline-Code
  // konsequent auf `thumbnailMode` umzieht.
  thumbnailMode: text("thumbnail_mode")
    .notNull()
    .default("frame")
    .$type<"frame" | "custom_image" | "landingpage_screenshot">(),
  // Globales Play-Icon-Overlay (gilt für alle 3 Modi). Composite-Logik
  // landet in Paket C (Sharp-Komposition).
  thumbnailPlayIcon: boolean("thumbnail_play_icon").notNull().default(false),

  /**
   * Optionaler Tenant-Suffix für Lead-Slugs dieser Kampagne (Migration 0014).
   * Format: `^[a-z0-9-]{1,32}$` (CHECK-Constraint). NULL = kein Suffix.
   */
  slugSuffix: text("slug_suffix"),

  /**
   * Migration 0020 — kommagetrennte User-Aliase fuer {{pageUrl}}.
   * Beispiel: "lp,kundenlink,seite". Wird zusaetzlich zu den built-in
   * Aliasen (pageUrl, landingpage-url, uname, ...) case-insensitive
   * erkannt. NULL/leer = nur built-in Aliase aktiv.
   */
  pageUrlAliases: text("page_url_aliases"),

  /**
   * Optional: Umschlag-Vorlage die pro Lead als personalisiertes PDF
   * generiert wird (Migration 0031). NULL = kein Umschlag.
   * Bei Bundle-Export erscheinen die Umschlaege im Unter-Ordner "umschlaege/".
   */
  envelopeTemplateId: uuid("envelope_template_id"),

  /** Soft-Delete-Marker (Migration 0015). NULL = aktiv. Queries werden
   * in Paket G angepasst — bis dahin keine Verhaltensänderung. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("campaigns_user_idx").on(t.userId),
  domainIdx: index("campaigns_domain_idx").on(t.domainId),
}));

// ── Envelope-Templates (Migration 0031) ─────────────────────────────────
export type EnvelopeFieldFont =
  | "LiebeHeide"
  | "LiebeHeideFineliner"
  | "BiroScript"
  | "Helvetica";

export interface EnvelopeField {
  id: string;
  label: string;
  content: string; // mit {{Placeholder}}-Tags
  /** Position in Prozent des Umschlag-Formats (0-100). */
  x: number;
  y: number;
  width: number;
  fontSize: number; // pt
  lineHeight: number; // Multiplikator (1.0-4.0)
  font: EnvelopeFieldFont;
  color: string; // Hex #RRGGBB
}

export interface EnvelopeSender {
  name?: string;
  street?: string;
  zip?: string;
  city?: string;
}

export const envelopeTemplates = pgTable("envelope_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  format: text("format").$type<"DIN_LANG" | "C4" | "C5" | "C6">().notNull().default("DIN_LANG"),
  fields: jsonb("fields").$type<EnvelopeField[]>().notNull().default(sql`'[]'::jsonb`),
  sender: jsonb("sender").$type<EnvelopeSender>().notNull().default(sql`'{}'::jsonb`),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("envelope_templates_user_idx").on(t.userId).where(sql`${t.deletedAt} IS NULL`),
}));

// ── Runs (Runden) ───────────────────────────────────────────────────────────
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: runStatusEnum("status").notNull().default("draft"),

  // Mapping
  columnMapping: jsonb("column_mapping").$type<Record<string, string>>(),
  /**
   * Persistierte Duplikat-Erkennungs-Regeln für diesen Run (Migration 0021).
   * Format wird von Paket A (`@/lib/dedupe/types`) definiert; bis Paket A
   * gemerged ist, wird der Typ hier lokal als `unknown` gehalten.
   * NULL = noch nicht konfiguriert (Default-Regeln des Dedupe-Detectors).
   */
  // TODO Paket A: ersetze `unknown` durch `DedupeConfig` aus "@/lib/dedupe/types"
  dedupeConfig: jsonb("dedupe_config").$type<DedupeConfig | null>(),
  totalLeads: integer("total_leads").notNull().default(0),
  completedLeads: integer("completed_leads").notNull().default(0),
  failedLeads: integer("failed_leads").notNull().default(0),

  /**
   * Optional: an diesen Run gepinnte Custom-LP-Version. Wenn gesetzt, wird
   * für alle Leads dieses Runs genau diese Version ausgespielt (immutable).
   * Bei NULL fällt der Renderer auf `campaigns.customLpTemplateId →
   * activeVersionId` zurück. FK wird in Migration 0005 hinzugefügt
   * (Vorwärtsreferenz auf `custom_lp_versions`).
   */
  customLpVersionId: uuid("custom_lp_version_id"),

  // ── Preflight (Phase 1) ──────────────────────────────────────────────
  // Lifecycle-Marker für die Lead-Quality-Check-Phase. NULL solange der
  // Run noch nicht durch die Preflight-Pipeline gelaufen ist.
  preflightStartedAt: timestamp("preflight_started_at", { withTimezone: true }),
  preflightCompletedAt: timestamp("preflight_completed_at", { withTimezone: true }),
  /**
   * Optional: Wenn gesetzt, kann ein späterer Cron alle ok-Leads nach
   * Ablauf dieses Zeitpunkts automatisch approven. NULL = manuelle
   * Freigabe (Default, Sicherheit zuerst).
   */
  autoApproveAfter: timestamp("auto_approve_after", { withTimezone: true }),
  approvedLeadCount: integer("approved_lead_count").notNull().default(0),
  rejectedLeadCount: integer("rejected_lead_count").notNull().default(0),
  preflightFailedCount: integer("preflight_failed_count").notNull().default(0),
  /**
   * Audit-Marker für den 7-Tage-Bunny-Cleanup. Wenn gesetzt, wurden alle
   * Preflight-Screenshots dieses Runs bereits aus Bunny entfernt; die DB-
   * URLs in `leads.preflight_screenshot_*` zeigen ins Leere. Spalte kommt
   * aus Migration 0007.
   */
  preflightPurgedAt: timestamp("preflight_purged_at", { withTimezone: true }),

  // ── Shared-Video (Webcam-only-Optimierung, Migration 0012) ────────────
  // In webcam-only Mode ist das Video fuer ALLE Leads identisch — keine
  // Personalisierung (kein Greenscreen, kein Slide-Render). Statt N×Upload
  // nach Bunny Stream laden wir es EINMAL pro Run hoch (oder reusen den
  // bestehenden Bunny-Stream-GUID, wenn der webcam-Source bereits in
  // Stream liegt). Alle Leads in diesem Run teilen sich diese IDs.
  // NULL = noch nicht aufgeloest (with-presentation, oder erster Job
  // resolved gerade).
  sharedBunnyVideoId: text("shared_bunny_video_id"),
  sharedVideoUrl: text("shared_video_url"),
  /**
   * Doppelte Nutzung (Migration 0012 + 0018):
   *   - 0012: Bunny-Stream-Thumbnail des Shared-Webcam-Videos.
   *   - 0018: Geteiltes Custom-Thumbnail aus dem Kampagnen-Thumbnail-
   *     Generator, wenn dessen Template KEINE Lead-Platzhalter enthält
   *     (ein Bild für alle Leads). Welche Bedeutung greift, ergibt sich
   *     aus `campaigns.thumbnailImageEnabled` + Render-Mode.
   */
  sharedThumbnailUrl: text("shared_thumbnail_url"),
  // Optimistic-Lock: erster Worker, der das setzt, ist verantwortlich fuer
  // den Upload. Andere Worker pollen `sharedBunnyVideoId`. Lock wird als
  // stale behandelt, wenn aelter als 5 min und sharedBunnyVideoId NULL
  // (z.B. weil der erste Worker crashed ist).
  sharedVideoUploadStartedAt: timestamp("shared_video_upload_started_at", { withTimezone: true }),

  /**
   * Lifecycle-State für das Shared-Video (Migration 0015):
   *   pending → compressing → uploading → ready
   *   (oder failed bei Fehlern). CHECK-Constraint hält das in der DB
   *   konsistent. Default 'pending' für Bestände.
   */
  sharedVideoState: text("shared_video_state").notNull().default("pending"),

  /** Soft-Delete-Marker (Migration 0015). NULL = aktiv. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),

  // ── Source-Tracking (Migration 0028) ──────────────────────────────────
  // Aus welcher Quelle stammt die Leadliste dieser Runde?
  // Motivation: Multi-Tab-Google-Sheets-Import — bei 5 gewaehlten Tabs
  // werden 5 Runden erzeugt, jede mit ihrem eigenen sourceTabGid/-Title.
  // Alle nullable — bestehende Runden behalten NULL.
  sourceType: text("source_type").$type<"csv" | "xlsx" | "google-sheets" | null>(),
  sourceUrl: text("source_url"),
  sourceTabGid: integer("source_tab_gid"),
  sourceTabTitle: text("source_tab_title"),

  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  campaignIdx: index("runs_campaign_idx").on(t.campaignId),
  userIdx: index("runs_user_idx").on(t.userId),
  customLpVersionIdx: index("runs_custom_lp_version_idx").on(t.customLpVersionId),
}));

// ── Leads ───────────────────────────────────────────────────────────────────
export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),

  /**
   * Denormalisierte FK auf campaigns (Migration 0014). Wird beim Insert
   * aus `runs.campaign_id` befüllt. NOT NULL nach Backfill — neue Lead-
   * Slug-Eindeutigkeit ist campaign-scoped, deshalb brauchen wir die
   * Spalte direkt am Lead-Row.
   */
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),

  rowIndex: integer("row_index").notNull(),
  data: jsonb("data").notNull().$type<Record<string, string>>(),

  // Slug für Landingpage
  slug: text("slug"),
  /** Custom-Domain für diesen Lead. NULL = Default `app.videocomet.de/v/<slug>`. */
  domainId: uuid("domain_id"),

  status: leadStatusEnum("status").notNull().default("pending"),

  // Assets
  bunnyVideoId: text("bunny_video_id"),
  videoUrl: text("video_url"),
  thumbnailUrl: text("thumbnail_url"),
  /**
   * Per-Lead-gerendertes Custom-Thumbnail aus dem Kampagnen-Thumbnail-
   * Generator (Migration 0018). Nur belegt, wenn das Kampagnen-Thumbnail-
   * Template Platzhalter enthält und damit pro Lead personalisiert werden
   * muss; sonst wird das geteilte Bild aus `runs.sharedThumbnailUrl`
   * verwendet. NULL = Feature inaktiv ODER Lead nutzt den Run-Cache.
   */
  customThumbnailUrl: text("custom_thumbnail_url"),
  pdfUrl: text("pdf_url"),
  pdfExpiresAt: timestamp("pdf_expires_at", { withTimezone: true }),
  /** Umschlag-PDF pro Lead (Migration 0031). */
  envelopePdfUrl: text("envelope_pdf_url"),
  envelopePdfExpiresAt: timestamp("envelope_pdf_expires_at", { withTimezone: true }),

  // ── Video-Dimensionen (Migration 0015) ─────────────────────────────────
  // Vom Bunny-Resolver berechnet & gecached, damit Player + PDF-Thumbnail-
  // Pipeline nicht jedesmal die Bunny-Stream-API anfragen muessen.
  videoWidth: integer("video_width"),
  videoHeight: integer("video_height"),
  /** 'landscape' | 'portrait' | 'square' — CHECK-Constraint in DB. */
  videoOrientation: text("video_orientation"),
  /** Beste verfuegbare MP4-URL (z.B. Bunny-Stream-MP4-Fallback). */
  videoMp4Url: text("video_mp4_url"),

  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),

  // Aktive Pipeline-Stage (z.B. 'videoRender', 'docxToPdf'). Wird beim Eintritt
  // jeder Stage gesetzt und am Ende der Pipeline (Erfolg ODER Fehler) wieder
  // auf NULL gesetzt, damit Stuck-Recovery erkennt wo ein Job zuletzt hing.
  currentStage: text("current_stage"),

  // ── Preflight (Phase 1) ────────────────────────────────────────────────
  // Werte: pending | running | ok | url_dead | url_redirect | missing_field
  //        | duplicate | tls_error | slow | bot_block | screenshot_unavailable
  //        | unknown_error
  preflightStatus: text("preflight_status").notNull().default("pending"),
  preflightScreenshotUrl: text("preflight_screenshot_url"),
  /** Bunny-Object-Key des Screenshots (für späteres Bulk-Delete). */
  preflightScreenshotKey: text("preflight_screenshot_key"),
  /** Endgültige URL nach Redirect-Chain (für Phase-2-Re-Check). */
  preflightFinalUrl: text("preflight_final_url"),
  preflightHttpStatus: smallint("preflight_http_status"),
  preflightErrorMessage: text("preflight_error_message"),
  preflightDurationMs: integer("preflight_duration_ms"),
  preflightAttempts: smallint("preflight_attempts").notNull().default(0),
  preflightCompletedAt: timestamp("preflight_completed_at", { withTimezone: true }),
  /**
   * Wenn dieser Lead als Duplikat eines anderen Leads im selben Run erkannt
   * wurde, zeigt die FK auf das "Original" (erstes Vorkommen). Self-Ref ist
   * über AnyPgColumn aufgelöst, weil Drizzle den Tabellen-Type erst nach
   * dem Closure auflöst.
   */
  duplicateOfLeadId: uuid("duplicate_of_lead_id").references((): AnyPgColumn => leads.id, { onDelete: "set null" }),
  /** Vom User im Grid (oder per Auto-Approve-Cron) freigegeben. */
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  /** Soft-Delete-Marker. */
  removedAt: timestamp("removed_at", { withTimezone: true }),
  /**
   * Grund für das Entfernen aus dem Run-Export. CHECK-Constraint in DB
   * (Migration 0021) hält die Werte synchron mit `RemovedReason` unten.
   */
  removedReason: text("removed_reason").$type<RemovedReason | null>(),
  /**
   * Strukturierte Zusatzdaten zum `removedReason` (Migration 0021). Form
   * hängt vom `reason` ab — siehe `RemovedDetail` unten. Wird vom Duplikat-
   * Detector (Paket A) sowie der Pipeline (Paket D) befüllt; Lead-Export
   * (Paket C) liest es für strukturierte CSV-Spalten aus.
   */
  removedDetail: jsonb("removed_detail").$type<RemovedDetail | null>(),

  // ── Denormalized Tracking-Aggregate ────────────────────────────────────
  // Aggregiert aus lead_events bei jedem insert (siehe queries/lead-events).
  // Erlaubt dem UI, ohne Sub-Query auf Aggregaten zu filtern/sortieren.
  viewCount: integer("view_count").notNull().default(0),
  firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
  playCount: integer("play_count").notNull().default(0),
  watchTimeSec: integer("watch_time_sec").notNull().default(0),
  ctaClickCount: integer("cta_click_count").notNull().default(0),
  lastCtaAt: timestamp("last_cta_at", { withTimezone: true }),

  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  // ── Generated Columns fuer Kontakt-Match (Migration 0030) ─────────────
  // Postgres-generated: bei jedem Insert/Update aus data JSONB extrahiert
  // und normalisiert. Nur lesbar von der App — nicht direkt setzen.
  normalizedEmail: text("normalized_email"),
  normalizedName: text("normalized_name"),
  normalizedCompany: text("normalized_company"),
}, (t) => ({
  runIdx: index("leads_run_idx").on(t.runId),
  campaignIdx: index("leads_campaign_idx").on(t.campaignId),
  domainIdx: index("leads_domain_idx").on(t.domainId),
  statusIdx: index("leads_status_idx").on(t.status),
  // Campaign-scoped Slug-Eindeutigkeit (Migration 0014).
  // Default-LP: slug pro Kampagne eindeutig.
  campaignDefaultSlugUq: uniqueIndex("leads_campaign_default_slug_uq")
    .on(t.campaignId, t.slug)
    .where(sql`${t.domainId} IS NULL AND ${t.slug} IS NOT NULL`),
  // Custom-Domain-LP: slug pro (Kampagne, Domain) eindeutig.
  campaignCustomSlugUq: uniqueIndex("leads_campaign_custom_slug_uq")
    .on(t.campaignId, t.domainId, t.slug)
    .where(sql`${t.domainId} IS NOT NULL AND ${t.slug} IS NOT NULL`),
}));

/**
 * Alte Slugs die auf einen aktuellen Lead zeigen — Backward-Compat fuer
 * gedruckte QR-Codes und Briefe wenn wir einen Slug ueberschreiben.
 *
 * Wird gefuellt bei:
 *   - Migration 0029 (HEX-Suffix-Backfill fuer alle bestehenden Leads)
 *   - Rename eines Leads (wenn wir es je erlauben)
 *   - Delete + Re-Add (der alte Slug faellt ins Alias, der neue Lead
 *     bekommt einen neuen HEX-Suffix)
 *
 * Lookup-Reihenfolge in `/v/[slug]`:
 *   1. leads.slug direkt
 *   2. lead_slug_aliases.slug (mit expires_at check) → 301-Redirect
 *      auf canonical URL
 */
export const leadSlugAliases = pgTable("lead_slug_aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  /**
   * Optional — NULL fuer Default-Domain-Leads (app.videocomet.de/v/<slug>),
   * gesetzt fuer Custom-Domain-Leads. Analog zu leads.domain_id.
   */
  domainId: uuid("domain_id").references(() => userDomains.id, { onDelete: "cascade" }),
  /**
   * NULL = permanenter Alias (z.B. fuer aktive gedruckte Briefe).
   * Sonst: nach diesem Datum 410 Gone.
   */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Zwei partial-Indices analog zur leads-Table.
  lookupCustomIdx: index("lead_slug_aliases_lookup_custom_idx")
    .on(t.domainId, t.slug)
    .where(sql`${t.domainId} IS NOT NULL`),
  lookupDefaultIdx: index("lead_slug_aliases_lookup_default_idx")
    .on(t.slug)
    .where(sql`${t.domainId} IS NULL`),
}));

// ── User-scoped Kontakt-Match-Regeln (Migration 0030) ───────────────────
// Konfiguration WELCHE Spalten pruefen wir um zwei Leads als "dieselbe
// Person" zu identifizieren. Analog zu runs.dedupeConfig, aber User-Scope
// statt Run-Scope — weil das Kontakt-CRM ueber alle Kampagnen des Users geht.
export const userLeadMatchConfig = pgTable("user_lead_match_config", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  config: jsonb("config").$type<{
    autoMergeOnEmail: boolean;
    suggestMergeOnNameCompany: boolean;
    levenshteinThreshold: number;
  }>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── DSGVO-Deletion-Audit (Migration 0030) ───────────────────────────────
// Art. 30 DSGVO: Verzeichnis der Verarbeitungstaetigkeiten. Wer hat wann
// welchen Lead geloescht — der Lead selbst ist danach weg, deshalb keine FK.
export const leadDeletionAudit = pgTable("lead_deletion_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull(),
  campaignId: uuid("campaign_id"),
  runId: uuid("run_id"),
  reason: text("reason").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("lead_deletion_audit_user_idx").on(t.userId, t.createdAt),
}));

// ── Analytics-Events ────────────────────────────────────────────────────────
export const analyticsEvents = pgTable("analytics_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // 'page_view' | 'video_start' | 'video_progress' | 'cta_click'
  eventData: jsonb("event_data").$type<Record<string, unknown>>(),
  userAgent: text("user_agent"),
  ipHash: text("ip_hash"), // gehashed wegen DSGVO
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  leadIdx: index("analytics_lead_idx").on(t.leadId),
  typeIdx: index("analytics_type_idx").on(t.eventType),
}));

// ── Job-Stats für Worker-Health ─────────────────────────────────────────────
export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  hostname: text("hostname").notNull(),
  capabilities: jsonb("capabilities").$type<string[]>().default([]),
  currentJobs: integer("current_jobs").notNull().default(0),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Pipeline-Events (Live-Log pro Run / Lead) ───────────────────────────────
// Append-only Log mit Stage-Start/Stop/Fehler-Events für den Live-Log im
// Run-Detail-UI. `leadId` ist nullbar für Run-Level-Events (z.B.
// "lead pipeline started" oder "run completed: X done, Y failed in Z min").
export const pipelineEvents = pgTable("pipeline_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  level: text("level").notNull(), // 'info' | 'warn' | 'error'
  stage: text("stage").notNull(), // 'render' | 'upload' | 'landingpage' | 'qr' | 'docx' | 'pdf' | 'thumbnail' | 'run' | ...
  message: text("message").notNull(),
  durationMs: integer("duration_ms"),
}, (t) => ({
  runTsIdx: index("pipeline_events_run_ts_idx").on(t.runId, t.ts),
}));

// ── Lead-Events (Tracking aus Landingpage / Player) ─────────────────────────
// Persistentes Event-Log pro Lead (page_view, video_play, video_progress,
// video_ended, cta_click). Wird vom oeffentlichen /api/track/event Endpoint
// gefuettert. Aggregate werden inline in die leads-Tabelle geschrieben, damit
// Filter im UI ohne Sub-Query auskommen (viewCount, watchTimeSec, ...).
//
// Privacy:
//  - `ipHash` = sha256(ip).slice(0,16); raw IP wird nie gespeichert
//  - `sessionId` = sha256(ip+ua+YYYY-MM-DD).slice(0,16); rotiert taeglich
export const leadEvents = pgTable("lead_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'page_view' | 'video_play' | 'video_progress' | 'video_ended' | 'cta_click'
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  sessionId: text("session_id"),
  ipHash: text("ip_hash"),
}, (t) => ({
  leadTsIdx: index("lead_events_lead_ts_idx").on(t.leadId, t.ts),
  leadKindIdx: index("lead_events_lead_kind_idx").on(t.leadId, t.kind),
}));

// ── User-Domains (Custom-Domains pro Kunde) ─────────────────────────────────
// Jeder Kunde kann bis zu 3 Domains/Subdomains anbinden, über die seine
// personalisierten Landingpages ausgeliefert werden (statt
// app.videocomet.de/v/<slug>).
//
// Lebenszyklus:
//   pending      → User hat die Domain hinzugefügt, DNS noch nicht geprüft
//   verifying    → DNS-Verifier läuft, prüft A/CNAME + TXT-Token
//   issuing_cert → DNS ok, Traefik schreibt YAML, Cert wird via Let's
//                  Encrypt HTTP-01 geholt
//   active       → Cert vorhanden, Domain produktiv nutzbar
//   failed       → Verifikation / Cert nach 24h Retries gescheitert
export const userDomains = pgTable("user_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  hostname: text("hostname").notNull(),       // case-insensitive eindeutig (Index in Migration)
  kind: text("kind").notNull(),               // 'subdomain' | 'apex'
  status: text("status").notNull().default("pending"),
  verifyToken: text("verify_token").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  sslIssuedAt: timestamp("ssl_issued_at", { withTimezone: true }),
  sslExpiresAt: timestamp("ssl_expires_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("user_domains_user_idx").on(t.userId),
  statusIdx: index("user_domains_status_idx").on(t.status),
}));

// ── Custom-Landingpages (Kunden-eigene HTML/CSS/JS Templates) ───────────────
// Kunden laden ein ZIP mit ihrer eigenen statischen Landingpage hoch. Das ZIP
// wird serverseitig validiert (Allow-Liste, Pfad-Traversal, Zip-Bomb),
// sanitiert (index.html → strip on*-Handler, javascript:-URLs etc.) und
// in Bunny Storage abgelegt. Jede Upload-Iteration ist eine eigene
// **immutable** Version. Pro Template gibt es eine `activeVersionId` für
// neu gestartete Runs; existierende Runs werden über `runs.customLpVersionId`
// auf eine konkrete Version gepinnt und bleiben somit reproduzierbar.
export const customLpTemplates = pgTable("custom_lp_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  /** Verweist auf `custom_lp_versions.id`. FK in Migration 0005. */
  activeVersionId: uuid("active_version_id"),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("custom_lp_templates_user_idx").on(t.userId),
}));

export const customLpVersions = pgTable("custom_lp_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull().references(() => customLpTemplates.id, { onDelete: "cascade" }),
  /** 1, 2, 3, … (auto-incrementiert per Template). */
  version: integer("version").notNull(),
  /** Bunny-Storage-Prefix, z.B. `custom-lp/<tplId>/v1/`. Endet mit `/`. */
  storagePath: text("storage_path").notNull(),
  /** Pfad zum Einstiegs-HTML innerhalb des ZIPs, default `index.html`. */
  entryHtml: text("entry_html").notNull().default("index.html"),
  /** Inhalt der optionalen `videocomet.json` im ZIP (parsed). */
  manifest: jsonb("manifest").$type<Record<string, unknown>>(),
  /** Liste aller hochgeladenen Dateien für die Sandbox-Auslieferung. */
  fileManifest: jsonb("file_manifest").notNull().$type<Array<{
    path: string;
    size: number;
    hash: string;
    mime: string;
  }>>(),
  /**
   * Annotationen aus dem visuellen Element-Picker (Agent C):
   * z.B. `{ videoSelector: ".hero video", primaryCta: ".btn-primary", … }`.
   */
  annotations: jsonb("annotations").$type<Record<string, unknown>>(),
  bytesTotal: integer("bytes_total").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * Soft-Delete-Marker (Migration 0017, Paket G).
   *
   * NULL = aktiv, sichtbar im Editor. Nicht-NULL = gelöscht aus Editor-
   * Sicht, aber Bestand-Runs, die auf diese `id` pinnen, lesen den
   * Storage-Pfad weiter (render-Queries filtern bewusst NICHT auf
   * `deleted_at`). Damit überlebt ein Versions-Delete jeden Pipeline-Run,
   * der bereits an die Version gebunden ist.
   */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({
  templateIdx: index("custom_lp_versions_template_idx").on(t.templateId),
  uniqueVersionPerTemplate: unique("custom_lp_versions_tpl_ver_uq").on(t.templateId, t.version),
}));

// ── Webcam-Share-Links (Gast-Aufnahme via Link) ─────────────────────────────
// Ein eingeloggter User generiert einen Share-Link. Wer den Link öffnet,
// landet auf einer auth-freien Aufnahme-Seite (`/r/<slug>`) und kann GENAU
// EINMAL ein Webcam-Video aufnehmen, das nach Absenden automatisch in die
// Mediathek des Owners landet.
//
// Idempotenz:
//   - `used_at IS NULL`  → Slot offen
//   - `used_at IS NOT NULL` → bereits verwendet, weitere Submits → 409
//   - `revoked_at`       → manuell vom Owner gesperrt
//   - `expires_at`       → optionaler Ablauf
//
// Slug-Format: 12–16 Zeichen URL-safe (nanoid-Style), global eindeutig.
export const webcamShareLinks = pgTable("webcam_share_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  /**
   * Pro-User-fortlaufende ID (1, 2, 3, …). Wird im UI als "#003" angezeigt
   * und im Namen des resultierenden Media-Items vermerkt, damit Owner
   * Link ↔ Video manuell zuordnen können.
   */
  numericId: integer("numeric_id").notNull(),
  /** Optionale Notiz „Wofür ist dieser Link?". */
  title: text("title"),
  /** Maximale Aufnahmedauer in Sekunden (Default 120s). */
  maxDurationSec: integer("max_duration_sec").notNull().default(120),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  mediaItemId: uuid("media_item_id").references(() => mediaItems.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Slug ist pro User eindeutig (Migration 0010). Crypto-random 14 Zeichen
  // → Kollisionen ZWISCHEN Usern sind faktisch ausgeschlossen, deshalb
  // reicht der per-Tenant-Scope.
  userSlugUq: unique("webcam_share_links_user_slug_uq").on(t.userId, t.slug),
  userIdx: index("webcam_share_links_user_idx").on(t.userId),
  userNumericUq: unique("webcam_share_links_user_numeric_uq").on(t.userId, t.numericId),
}));

// Verifikations- / Cert-Health-Historie pro Domain — für Admin-Diagnose.
export const domainCheckLog = pgTable("domain_check_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  domainId: uuid("domain_id").notNull().references(() => userDomains.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  kind: text("kind").notNull(),    // 'dns' | 'txt' | 'cert' | 'health'
  ok: boolean("ok").notNull(),
  message: text("message"),
}, (t) => ({
  domainTsIdx: index("domain_check_log_domain_idx").on(t.domainId, t.ts),
}));

// ── Bunny-Assets (zentrales Register für Stream + Storage Objekte) ──────────
// Jedes Bunny-Objekt (Stream-GUID oder Storage-Path) wird hier EINMAL pro
// User registriert. Owner-Tabellen (leads, runs, media_items, ...) referen-
// zieren via `bunny_asset_refs` (m:n). Sobald der letzte Ref faellt, kann
// der Purge-Worker (Paket E) die Datei physisch loeschen.
//
// `kind` ist 'stream' oder 'storage' (CHECK-Constraint in der DB).
// `purge_state` ist 'live' | 'purge_pending' | 'purged' (CHECK in DB).
//
// Migration 0013.
export const bunnyAssets = pgTable("bunny_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** 'stream' | 'storage' — CHECK-Constraint in DB. */
  kind: text("kind").notNull(),
  /** Stream-GUID oder Storage-Path (je nach `kind`). */
  bunnyId: text("bunny_id").notNull(),
  /** Kanonische CDN-/HLS-URL. */
  cdnUrl: text("cdn_url").notNull(),
  width: integer("width"),
  height: integer("height"),
  bytes: integer("bytes"),
  /** Optional sha256 fuer Dedupe. */
  sourceHash: text("source_hash"),
  /** 'live' | 'purge_pending' | 'purged' — CHECK-Constraint in DB. */
  purgeState: text("purge_state").notNull().default("live"),
  purgeAttempts: integer("purge_attempts").notNull().default(0),
  purgeLastError: text("purge_last_error"),
  purgedAt: timestamp("purged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userKindIdUq: uniqueIndex("bunny_assets_user_kind_id_uq").on(t.userId, t.kind, t.bunnyId),
  purgeStateIdx: index("bunny_assets_purge_state_idx").on(t.purgeState, t.createdAt),
}));

// m:n Bridge zwischen `bunny_assets` und den Owner-Rows. owner_type ist
// 'lead' | 'run' | 'media_item' | 'campaign_webcam' (CHECK in DB).
// Doppel-Refs sind ueber das Unique-Index ausgeschlossen.
//
// Migration 0013.
export const bunnyAssetRefs = pgTable("bunny_asset_refs", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull().references(() => bunnyAssets.id, { onDelete: "cascade" }),
  /** 'lead' | 'run' | 'media_item' | 'campaign_webcam' — CHECK in DB. */
  ownerType: text("owner_type").notNull(),
  ownerId: uuid("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerUq: uniqueIndex("bunny_asset_refs_owner_uq").on(t.assetId, t.ownerType, t.ownerId),
  ownerIdx: index("bunny_asset_refs_owner_idx").on(t.ownerType, t.ownerId),
}));

// ── Campaign-Shares (Public Password-Protected Campaign-Share) ──────────────
// Owner generiert einen Token + Passwort, der über `/share/<token>` einem
// nicht-eingeloggten Besucher Read-Only-Zugriff auf Engagement + Event-
// Stream einer ganzen Kampagne gibt. Migration 0022.
//
// Sicherheits-Invarianten:
//   - `token` ist global eindeutig (UNIQUE-Index).
//   - `passwordHash` wird via Argon2id erzeugt (hashPassword/verifyPassword
//     aus queries/users.ts).
//   - `revoked_at IS NULL` ist die Owner-sichtbare "aktive"-Bedingung;
//     Public-Lookups filtern darauf.
//   - `campaign_share_attempts` speichert nur `ip_hash` (sha256(ip)[:16]),
//     niemals raw-IP — DSGVO.
export const campaignShares = pgTable("campaign_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  passwordHash: text("password_hash").notNull(),
  label: text("label"),
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tokenUq: uniqueIndex("campaign_shares_token_uq").on(t.token),
  campaignIdx: index("campaign_shares_campaign_idx")
    .on(t.campaignId)
    .where(sql`${t.revokedAt} IS NULL`),
  userIdx: index("campaign_shares_user_idx").on(t.userId),
}));

// Audit-Log der Login-Versuche pro Token. Wird für Rate-Limiting ausgelesen
// (≥10 fails in 15 min → 429). Append-only, kein FK auf `campaign_shares`
// (Token ist hier Naturschlüssel, damit auch Versuche auf nicht-existente
// oder bereits hartgelöschte Tokens loggen / zählen).
export const campaignShareAttempts = pgTable("campaign_share_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull(),
  ipHash: text("ip_hash").notNull(),
  ok: boolean("ok").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Index ist in der Migration als (token, ts DESC) angelegt; Drizzle-Side
  // braucht die DESC-Reihenfolge nicht, da Index-Lookups auf BTREE in
  // beide Richtungen genauso schnell sind.
  tokenTsIdx: index("campaign_share_attempts_token_ts_idx").on(t.token, t.ts),
}));

// ── CRM-Integrations (Phase 1 — Datenlayer, Migration 0024) ────────────────
// Eine Connection-Konfiguration pro User für einen externen CRM-Provider
// (HubSpot, Salessuite, Close). Mehrere Connections pro Provider sind
// erlaubt, müssen sich pro User aber im `name` unterscheiden. Der API-Key
// wird via AES-256-GCM mit `CRM_KEY_SECRET` verschlüsselt abgelegt
// (Format `<iv>:<authTag>:<ciphertext>` base64) — siehe
// `src/lib/crm/crypto.ts`. `apiKeyHint` speichert nur die letzten 4
// Zeichen für die UI ("…ab12").
//
// `lastTestOk` / `lastTestError` werden vom Provider-`testConnection()`
// Aufruf befüllt und gibt dem User im UI Aufschluss darüber, ob die
// Connection noch lebt. `metadata` darf Provider-spezifischen Kontext
// halten (z.B. HubSpot-Account-Id, Salessuite-Tenant-Info).
export const crmIntegrations = pgTable("crm_integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** 'hubspot' | 'salessuite' | 'close' — CHECK-Constraint in DB. */
  provider: text("provider").notNull().$type<"hubspot" | "salessuite" | "close">(),
  name: text("name").notNull(),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  /** Letzte 4 Zeichen des Klartext-API-Keys für UI-Anzeige. */
  apiKeyHint: text("api_key_hint").notNull(),
  metadata: jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastTestOk: boolean("last_test_ok"),
  lastTestError: text("last_test_error"),
  /** Soft-Disable-Marker. NULL = aktiv. */
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
}, (t) => ({
  userIdx: index("crm_integrations_user_idx").on(t.userId),
  userNameUq: unique("crm_integrations_user_name_uq").on(t.userId, t.name),
}));

// ── Campaign ↔ CRM-Settings (Migration 0024) ──────────────────────────────
// Genau ein Eintrag pro Kampagne (PK = campaignId). Verweist auf eine
// `crm_integrations`-Row und konfiguriert pro Kampagne, wie Leads im CRM
// gematcht werden (`leadMatch`), welche Lead-Events Phase 2 nach drüben
// pushen soll (`enabledEvents`) und welche Lead-Datenfelder auf welche
// CRM-Felder gemappt werden (`fieldMapping`). ON DELETE RESTRICT auf der
// FK verhindert das versehentliche Löschen einer genutzten Integration.
export const campaignCrmSettings = pgTable("campaign_crm_settings", {
  campaignId: uuid("campaign_id").primaryKey().references(() => campaigns.id, { onDelete: "cascade" }),
  crmIntegrationId: uuid("crm_integration_id").notNull().references(() => crmIntegrations.id, { onDelete: "restrict" }),
  enabled: boolean("enabled").notNull().default(true),
  /**
   * Beschreibt, welches Feld des Leads (z.B. "email" / "phone") auf welches
   * CRM-Lookup-Feld gemappt wird — Form wird von Phase 2 (Worker + UI)
   * festgenagelt. Erwartet ein Objekt; wir typisieren bewusst offen.
   */
  leadMatch: jsonb("lead_match").notNull().$type<Record<string, unknown>>(),
  /** Liste der aktivierten Lead-Event-Kinds (`page_view`, `video_play`, …). */
  enabledEvents: jsonb("enabled_events").notNull().$type<string[]>().default(["page_view", "video_play", "cta_click"]),
  /** Mapping `<crmFieldKey> → <leadFieldOrTemplate>`. Form wird in Phase 2 verfeinert. */
  fieldMapping: jsonb("field_mapping").notNull().$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── CRM-Event-Log (Migration 0024) ─────────────────────────────────────────
// Append-only Audit-Log aller Push-Versuche zum CRM (1 Row pro HTTP-Call
// inkl. Retries). Hilft dem Support-Team bei "Warum ist mein Lead nicht
// in HubSpot aufgetaucht?". `lead_id` / `integration_id` sind ON DELETE
// SET NULL — der Log überlebt das Löschen der referenzierten Rows.
export const crmEventLog = pgTable("crm_event_log", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  integrationId: uuid("integration_id").references(() => crmIntegrations.id, { onDelete: "set null" }),
  eventKind: text("event_kind").notNull(),
  lookupField: text("lookup_field"),
  lookupValue: text("lookup_value"),
  contactId: text("contact_id"),
  httpStatus: smallint("http_status"),
  requestBody: jsonb("request_body").$type<unknown>(),
  responseBody: jsonb("response_body").$type<unknown>(),
  errorMessage: text("error_message"),
  attempt: smallint("attempt").notNull().default(1),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  campaignTsIdx: index("crm_event_log_campaign_ts_idx").on(t.campaignId, t.ts),
  leadIdx: index("crm_event_log_lead_idx").on(t.leadId),
  integrationTsIdx: index("crm_event_log_integration_idx").on(t.integrationId, t.ts),
}));

export type CrmIntegration = typeof crmIntegrations.$inferSelect;
export type NewCrmIntegration = typeof crmIntegrations.$inferInsert;
export type CampaignCrmSettings = typeof campaignCrmSettings.$inferSelect;
export type NewCampaignCrmSettings = typeof campaignCrmSettings.$inferInsert;
export type CrmEventLogRow = typeof crmEventLog.$inferSelect;
export type NewCrmEventLogRow = typeof crmEventLog.$inferInsert;

// ── Outgoing-Webhooks (Phase A — Datenlayer, Migration 0025) ──────────────
// Eine Endpoint-Konfiguration pro User (optional auf eine Kampagne gescoped).
// `secret` wird beim Erstellen vom Server erzeugt (csprng-Hex) und EINMAL
// dem User angezeigt — der Worker nutzt ihn für die HMAC-SHA256-Signatur
// (`signature.ts`). `enabledEvents` ist die Liste der aktivierten
// `WebhookEventKind`s; leeres Array → kein Push. `customHeaders` erlaubt
// dem Kunden, statische Auth-Header an sein Webhook-Relay mitzugeben
// (Verbot von `X-VideoComet-*` setzt die Route durch).
//
// `consecutiveFailures` + `disabledAt`/`disabledReason` werden vom Worker
// nach N Fehlversuchen gesetzt (Soft-Disable); UI zeigt das als Banner.
// `lastDeliveryAt`/`lastDeliveryOk`/`lastDeliveryError` sind Caches für die
// Listen-Ansicht, damit die UI nicht jedes Mal `webhook_deliveries`
// aggregieren muss.
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Scope-Anker. NULL = account-weit (gilt für alle Kampagnen des Users). */
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  /** HMAC-Secret im Klartext (Hex). Vom Worker für Stripe-style Signaturen genutzt. */
  secret: text("secret").notNull(),
  /** Liste der aktivierten `WebhookEventKind`s. Single-Source-of-Truth in `src/lib/webhooks/types.ts`. */
  enabledEvents: jsonb("enabled_events").notNull().$type<string[]>().default([]),
  /** Zusätzliche statische Header pro Request. `X-VideoComet-*` sind verboten (Route-Validator). */
  customHeaders: jsonb("custom_headers").notNull().$type<Record<string, string>>().default({}),
  active: boolean("active").notNull().default(true),
  /** Vom Worker nach N Fehlversuchen gesetzt (Soft-Disable). NULL = aktiv. */
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  disabledReason: text("disabled_reason"),
  consecutiveFailures: smallint("consecutive_failures").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** Letzte Delivery (Erfolg ODER Fehler) — Cache für UI-Liste. */
  lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
  lastDeliveryOk: boolean("last_delivery_ok"),
  lastDeliveryError: text("last_delivery_error"),
}, (t) => ({
  userIdx: index("webhook_endpoints_user_idx").on(t.userId),
  userNameUq: unique("webhook_endpoints_user_name_uq").on(t.userId, t.name),
}));

// ── Webhook-Deliveries (Migration 0025) ────────────────────────────────────
// Append-only Audit-Log aller Delivery-Versuche (1 Row pro HTTP-Call inkl.
// Retries). `eventId` ist der `evt_…`-Identifier aus dem Payload und
// ermöglicht Empfängern Idempotenz (sie können auf `evt_…`-Wiederholungen
// dedupen). `nextRetryAt` ist nur während des Backoff-Fensters gesetzt;
// der Worker pollt darauf. `deliveredAt` ODER `failedAt` (nicht beide).
// `lead_id`/`run_id`/`campaign_id` sind ON DELETE SET NULL — Log überlebt
// das Löschen der referenzierten Rows.
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  eventKind: text("event_kind").notNull(),
  /** `evt_<base32-uuidv7>` aus dem Payload. Empfänger nutzen das für Idempotenz. */
  eventId: text("event_id").notNull(),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  payload: jsonb("payload").notNull().$type<unknown>(),
  requestHeaders: jsonb("request_headers").$type<Record<string, string> | null>(),
  httpStatus: smallint("http_status"),
  responseBody: text("response_body"),
  errorMessage: text("error_message"),
  attempt: smallint("attempt").notNull().default(1),
  /** Nur während Backoff gesetzt; Worker pollt auf diesen Index. */
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  endpointTsIdx: index("webhook_deliveries_endpoint_ts_idx").on(t.endpointId, t.ts),
  retryIdx: index("webhook_deliveries_retry_idx").on(t.nextRetryAt),
  eventIdIdx: index("webhook_deliveries_event_id_idx").on(t.endpointId, t.eventId),
}));

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;

// ── Media URLs (Migration 0026) ────────────────────────────────────────────
// User-gespeicherte URLs (Google Docs, Sheets, Slides, beliebige Links) mit
// auto-generiertem Preview-Bild. Wird im Campaign-Wizard als Auto-Complete
// fuer Brief-Template-URLs angeboten und vermeidet, dass User dieselbe
// Google-Docs-URL pro Kampagne neu eintippen.
//
// Lifecycle:
//   - User legt URL an  → status='pending', Worker enqueues Preview-Job.
//   - Worker fetched die URL (Google-Export-Endpunkt fuer Docs/Sheets,
//     ansonsten Puppeteer-Screenshot), rendert ein JPEG und uploaded zu
//     Bunny PDF-Zone. status='ready' + previewBunnyPath gesetzt.
//   - Preview kann manuell refreshed werden (Card-Button). Hard-TTL 7d fuer
//     Google-Docs (Content aendert sich), 30d fuer YouTube/generic.
//   - Hard-Delete (kein Soft-Delete im v1 — Mediathek-Dateien haben auch
//     keinen, Konsistenz).
//
// Sicherheits-Invarianten:
//   - urlHash + Partial-Unique verhindert Duplikate pro User.
//   - SSRF-Guard prueft URL VOR Insert UND VOR Preview-Job (Defense-in-Depth).
export const mediaUrls = pgTable(
  "media_urls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Original-URL wie vom User eingegeben (mit allen Query-Params). */
    url: text("url").notNull(),
    /** sha256 der normalisierten URL — fuer Duplicate-Detection. */
    urlHash: text("url_hash").notNull(),
    type: mediaUrlTypeEnum("type").notNull().default("generic"),
    title: text("title").notNull(),
    description: text("description"),
    /** Google-Doc-ID / YouTube-Video-ID / etc. — fuer spaetere Drive-API. */
    externalResourceId: text("external_resource_id"),
    /** Bunny-Storage-Pfad (`url-previews/<userId>/<id>.jpg`). NULL bis Job done. */
    previewBunnyPath: text("preview_bunny_path"),
    /** Vollständige CDN-URL des Previews (fuer UI). */
    previewUrl: text("preview_url"),
    previewStatus: mediaUrlPreviewStatusEnum("preview_status")
      .notNull()
      .default("pending"),
    previewGeneratedAt: timestamp("preview_generated_at", { withTimezone: true }),
    /** Wann wird das Preview als stale betrachtet? Fuer User-UI-Badge "veraltet". */
    previewExpiresAt: timestamp("preview_expires_at", { withTimezone: true }),
    /** Letzter Worker-Fehler — fuer Debug + UI-Tooltip. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("media_urls_user_idx").on(t.userId, t.createdAt),
    userTypeIdx: index("media_urls_user_type_idx").on(t.userId, t.type),
    userHashUq: unique("media_urls_user_hash_uq").on(t.userId, t.urlHash),
  }),
);

export type MediaUrl = typeof mediaUrls.$inferSelect;
export type NewMediaUrl = typeof mediaUrls.$inferInsert;

// ── Credit-Transactions (Migration 0027) ─────────────────────────────────
// Append-Only Ledger jeder Credit-Bewegung. Nie UPDATE, nur INSERT.
// Aktuelle Balance = SUM(delta) — wir cachen das in users.creditBalance
// fuer schnelle Lookups, der Cache wird in derselben Transaktion atomar
// fortgeschrieben.
//
// Idempotenz-Garantien:
//   - `lead_id` UNIQUE bei `kind='video_charge'` verhindert Doppel-Charge
//     pro Lead (auch wenn der Worker-Job mal retry'd wird).
//   - `stripe_event_id` UNIQUE bei `kind='topup'` verhindert Doppel-Top-Up
//     bei Stripe-Webhook-Retries.
//   - `admin_adjust` und `promo_grant` haben keine externe Idempotenz —
//     der Admin/Promo-Engine trackt das selbst.
//
// Sicherheits-Invarianten:
//   - `delta` NICHT NULL, kann +/- sein. Positiv = Zugang, Negativ = Verbrauch.
//   - `balance_after` ist der Snapshot der Balance NACH dieser Zeile (fuer
//     Audit-Trail und Drift-Detection vs cached Balance).
//   - `reason` ist Pflicht-Freitext fuer admin_adjust (Refund-Grund etc.).
export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: creditTxKindEnum("kind").notNull(),
    /** Positive = Zugang (topup, promo), Negative = Verbrauch (video_charge). */
    delta: integer("delta").notNull(),
    /** Snapshot der Balance NACH dieser Bewegung — fuer Audit/Drift-Check. */
    balanceAfter: integer("balance_after").notNull(),
    /** Bei video_charge: der konkrete Lead. Erzwingt 1 Charge pro Lead. */
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    /** Bei video_charge: der Run-Kontext (fuer Reporting). */
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    /** Bei topup: Referenz auf Stripe-Event (gegen Webhook-Replay). */
    stripeEventId: text("stripe_event_id"),
    /** Bei topup: Stripe-Payment-Intent / Checkout-Session. */
    stripeRef: text("stripe_ref"),
    /** Bei admin_adjust: wer hat es gemacht. */
    adminUserId: uuid("admin_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Freitext-Grund (Refund-Reason, Promo-Code, etc.). */
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byUser: index("credit_tx_user_ts_idx").on(t.userId, t.createdAt),
    // UNIQUE pro Lead bei video_charge — verhindert Doppel-Charge bei
    // Worker-Retry. Partial-Index, damit nicht-charge Rows nicht erfasst.
    uniqLeadCharge: uniqueIndex("credit_tx_lead_charge_uq")
      .on(t.leadId)
      .where(sql`${t.kind} = 'video_charge'`),
    // UNIQUE pro Stripe-Event bei topup — Idempotenz gegen Webhook-Replay.
    uniqStripeEvent: uniqueIndex("credit_tx_stripe_event_uq")
      .on(t.stripeEventId)
      .where(sql`${t.kind} = 'topup' AND ${t.stripeEventId} IS NOT NULL`),
  }),
);

export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type NewCreditTransaction = typeof creditTransactions.$inferInsert;

// ── Stripe-Webhook-Events (Migration 0027) ───────────────────────────────
// Idempotenz-Tabelle gegen Stripe-Webhook-Replay. Stripe sendet bei
// Timeouts denselben Event mehrfach — wir muessen jeden Event genau einmal
// verarbeiten. PRIMARY KEY auf der Event-ID.
//
// Verarbeitungsmodell:
//   1. Webhook-Receiver verifiziert Signatur.
//   2. INSERT INTO stripe_webhook_events (id) — wenn DUP-KEY-VIOLATION,
//      Event wurde schon verarbeitet, sofort 200 zurueck.
//   3. Verarbeite Event in Transaction. Bei Erfolg: UPDATE processed_at.
//   4. Bei Fail: behalte processed_at = NULL, Stripe wird retry'n.
export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  /** Stripe-Event-ID (evt_...). */
  id: text("id").primaryKey(),
  /** Event-Type wie "checkout.session.completed". */
  type: text("type").notNull(),
  /** Volle Payload als JSONB — fuer Replay/Debug. */
  payload: jsonb("payload").notNull().$type<unknown>(),
  /** Wann verarbeitet (NULL = noch nicht / Fehler). */
  processedAt: timestamp("processed_at", { withTimezone: true }),
  /** Fehler bei Verarbeitung — fuer Debug. */
  errorMessage: text("error_message"),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
export type NewStripeWebhookEvent = typeof stripeWebhookEvents.$inferInsert;

// ── Index-Namen als Konstanten ────────────────────────────────────────────
//
// Werden vom Worker (`landingpage-create.ts`) zur Erkennung von
// UNIQUE-Constraint-Violations genutzt — Single-Source-of-Truth, damit
// Migrations und Drift-Checks denselben Namen referenzieren.
export const LEADS_CAMPAIGN_DEFAULT_SLUG_UQ = "leads_campaign_default_slug_uq";
export const LEADS_CAMPAIGN_CUSTOM_SLUG_UQ = "leads_campaign_custom_slug_uq";
/** @deprecated Pre-Migration-0014. Hier für Bestandsschutz (z.B. Branching). */
export const LEGACY_LEADS_DEFAULT_SLUG_UQ = "leads_default_slug_uq";
/** @deprecated Pre-Migration-0014. Hier für Bestandsschutz (z.B. Branching). */
export const LEGACY_LEADS_CUSTOM_SLUG_UQ = "leads_custom_slug_uq";

// ── Dedupe & Exclusion Types (Migration 0021) ───────────────────────────────
//
// Werden sowohl vom Schema (jsonb-`$type<>`-Anker) als auch von Pipeline-,
// Export- und UI-Code (Paket A/C/D) konsumiert. Single-Source-of-Truth liegt
// hier am Schema, damit DB-Werte und TS-Typen synchron bleiben.

/**
 * Erlaubte Werte für `leads.removed_reason`. Synchron mit dem CHECK-Constraint
 * `leads_removed_reason_check` aus Migration 0021.
 */
export type RemovedReason =
  | "user_rejected"
  | "auto_failed"
  | "duplicate"
  | "pipeline_failed"
  | "incomplete_data";

/**
 * Strukturierte Begründung in `leads.removed_detail`. Form hängt vom `reason`
 * ab. Reine Statusgründe (`pipeline_failed`, `user_rejected`, `auto_failed`)
 * tragen kein Zusatzpayload; `duplicate` und `incomplete_data` liefern die
 * Daten, die der Export (Paket C) für strukturierte Spalten braucht.
 */
export type RemovedDetail =
  | {
      reason: "duplicate";
      matchedRule: { id: string; label: string; columns: string[] };
      duplicateOfRowIndex: number;
    }
  | {
      reason: "incomplete_data";
      missingColumns: string[];
    }
  | {
      reason: "pipeline_failed" | "user_rejected" | "auto_failed";
    };

/**
 * Persistierte Duplikat-Erkennungs-Regeln pro Run (`runs.dedupe_config`).
 *
 * TODO Paket A: Diese lokale Definition wird durch den Import aus
 *   `@/lib/dedupe/types` ersetzt, sobald Paket A gemerged ist. Bis dahin
 *   bleibt der Typ bewusst offen (`unknown`-Record), damit das Schema
 *   ohne Paket-A-Abhängigkeit typecheckt.
 */
export type DedupeConfig = Record<string, unknown>;
