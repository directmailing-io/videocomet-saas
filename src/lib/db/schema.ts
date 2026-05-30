import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, pgEnum, index, unique } from "drizzle-orm/pg-core";

// ── Enums ───────────────────────────────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", ["admin", "user"]);
export const runStatusEnum = pgEnum("run_status", ["draft", "mapping", "generating", "completed", "failed", "cancelled"]);
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

  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  campaignIdx: index("runs_campaign_idx").on(t.campaignId),
  userIdx: index("runs_user_idx").on(t.userId),
}));

// ── Leads ───────────────────────────────────────────────────────────────────
export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),

  rowIndex: integer("row_index").notNull(),
  data: jsonb("data").notNull().$type<Record<string, string>>(),

  // Slug für Landingpage
  slug: text("slug"),

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

  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  runIdx: index("leads_run_idx").on(t.runId),
  slugIdx: unique("leads_slug_uq").on(t.slug),
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
// Append-only Log mit Stage-Start/Stop/Fehler-Events fuer den Live-Log im
// Run-Detail-UI. `leadId` ist nullbar fuer Run-Level-Events (z.B.
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
