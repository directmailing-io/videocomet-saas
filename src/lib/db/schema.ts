import { pgTable, uuid, text, timestamp, boolean, integer, smallint, jsonb, pgEnum, index, unique, type AnyPgColumn } from "drizzle-orm/pg-core";

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

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
}, (t) => ({
  emailIdx: index("users_email_idx").on(t.email),
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

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("campaigns_user_idx").on(t.userId),
  domainIdx: index("campaigns_domain_idx").on(t.domainId),
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
  pdfUrl: text("pdf_url"),
  pdfExpiresAt: timestamp("pdf_expires_at", { withTimezone: true }),

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
  /** user_rejected | auto_failed | duplicate */
  removedReason: text("removed_reason"),

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
}, (t) => ({
  runIdx: index("leads_run_idx").on(t.runId),
  // Slug-Eindeutigkeit ist als zwei partielle Unique-Indexes definiert
  // (Migration 0004) — Drizzle-Schema-Builder kann partial-unique nicht
  // ausdruecken, daher bewusst kein .unique() hier.
  domainIdx: index("leads_domain_idx").on(t.domainId),
  statusIdx: index("leads_status_idx").on(t.status),
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
  slugUq: unique("webcam_share_links_slug_uq").on(t.slug),
  userIdx: index("webcam_share_links_user_idx").on(t.userId),
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
