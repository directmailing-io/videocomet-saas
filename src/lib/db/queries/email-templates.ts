/**
 * CRUD-Queries für E-Mail-Vorlagen (email_templates).
 *
 * Soft-Delete-Muster analog envelopeTemplates (deletedAt + partial index).
 * `isComplete` wird NICHT persistiert, sondern abgeleitet: eine Vorlage
 * ohne Impressum (oder ohne Betreff/Text) darf gespeichert, aber nicht
 * in einem Blast verwendet werden.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  emailTemplates,
  type EmailTemplate,
} from "@/lib/db/schema";

function htmlHasText(html: string | null | undefined): boolean {
  if (!html) return false;
  return (
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .trim().length > 0
  );
}

/** Blast-Fähigkeit: Impressum ist Pflicht, Betreff + Text müssen stehen. */
export function isEmailTemplateComplete(
  t: Pick<EmailTemplate, "subject" | "bodyHtml" | "impressumHtml">,
): boolean {
  return (
    t.subject.trim().length > 0 &&
    htmlHasText(t.bodyHtml) &&
    htmlHasText(t.impressumHtml)
  );
}

export function serializeEmailTemplate(t: EmailTemplate) {
  return {
    id: t.id,
    name: t.name,
    subject: t.subject,
    bodyJson: t.bodyJson,
    bodyHtml: t.bodyHtml,
    ctaLabel: t.ctaLabel,
    ctaUrl: t.ctaUrl,
    signatureHtml: t.signatureHtml,
    impressumHtml: t.impressumHtml,
    isComplete: isEmailTemplateComplete(t),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export type SerializedEmailTemplate = ReturnType<typeof serializeEmailTemplate>;

export async function listEmailTemplates(
  userId: string,
): Promise<EmailTemplate[]> {
  return db
    .select()
    .from(emailTemplates)
    .where(
      and(eq(emailTemplates.userId, userId), isNull(emailTemplates.deletedAt)),
    )
    .orderBy(desc(emailTemplates.updatedAt));
}

export async function getEmailTemplate(
  id: string,
  userId: string,
): Promise<EmailTemplate | null> {
  const [row] = await db
    .select()
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.id, id),
        eq(emailTemplates.userId, userId),
        isNull(emailTemplates.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface CreateEmailTemplateInput {
  name: string;
}

export async function createEmailTemplate(
  userId: string,
  input: CreateEmailTemplateInput,
): Promise<EmailTemplate> {
  const [row] = await db
    .insert(emailTemplates)
    .values({
      userId,
      name: input.name,
      subject: "",
      bodyHtml: "",
      impressumHtml: "",
    })
    .returning();
  return row;
}

export interface UpdateEmailTemplateInput {
  name?: string;
  subject?: string;
  bodyJson?: unknown;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  signatureHtml?: string | null;
  impressumHtml?: string;
}

export async function updateEmailTemplate(
  id: string,
  userId: string,
  patch: UpdateEmailTemplateInput,
): Promise<EmailTemplate | null> {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.subject !== undefined) update.subject = patch.subject;
  if (patch.bodyJson !== undefined) update.bodyJson = patch.bodyJson;
  if (patch.bodyHtml !== undefined) update.bodyHtml = patch.bodyHtml;
  if (patch.ctaLabel !== undefined) update.ctaLabel = patch.ctaLabel;
  if (patch.ctaUrl !== undefined) update.ctaUrl = patch.ctaUrl;
  if (patch.signatureHtml !== undefined)
    update.signatureHtml = patch.signatureHtml;
  if (patch.impressumHtml !== undefined)
    update.impressumHtml = patch.impressumHtml;

  const [row] = await db
    .update(emailTemplates)
    .set(update)
    .where(
      and(
        eq(emailTemplates.id, id),
        eq(emailTemplates.userId, userId),
        isNull(emailTemplates.deletedAt),
      ),
    )
    .returning();
  return row ?? null;
}

export async function softDeleteEmailTemplate(
  id: string,
  userId: string,
): Promise<void> {
  await db
    .update(emailTemplates)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(emailTemplates.id, id), eq(emailTemplates.userId, userId)),
    );
}
