/**
 * Setup-Status: Welche Einrichtungs-Schritte hat der User schon erledigt?
 *
 * Wird von der Onboarding-Checkliste (Popup + Floating-Button) und dem
 * Setup-Tab in den Einstellungen gemeinsam genutzt. Die Detection läuft
 * rein über vorhandene Daten (kein manuelles Abhaken nötig).
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  crmIntegrations,
  customLpTemplates,
  emailTemplates,
  envelopeTemplates,
  landingPageTemplates,
  mailboxConnections,
  userDomains,
  users,
  webhookEndpoints,
} from "@/lib/db/schema";

export interface SetupItem {
  key: string;
  title: string;
  /** Wo finde ich das? Kurzer Fundort-Hinweis in du-Form. */
  hint: string;
  href: string;
  done: boolean;
  optional: boolean;
}

export interface SetupStatus {
  items: SetupItem[];
  /** Erledigte Pflicht-Schritte. */
  doneCount: number;
  /** Anzahl Pflicht-Schritte. */
  requiredCount: number;
  allDone: boolean;
  /** Gesetzt, wenn der User das Onboarding dauerhaft ausgeblendet hat. */
  onboardingDismissed: boolean;
}

async function exists(query: Promise<Array<unknown>>): Promise<boolean> {
  return (await query).length > 0;
}

export async function getSetupStatus(userId: string): Promise<SetupStatus> {
  const [
    userRow,
    hasLp,
    hasCustomLp,
    hasEmailTemplate,
    hasMailbox,
    hasEnvelope,
    hasDomain,
    hasCrm,
    hasWebhook,
    hasCampaign,
  ] = await Promise.all([
    db
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
        companyName: users.companyName,
        onboardingDismissedAt: users.onboardingDismissedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    exists(
      db
        .select({ id: landingPageTemplates.id })
        .from(landingPageTemplates)
        .where(eq(landingPageTemplates.userId, userId))
        .limit(1),
    ),
    exists(
      db
        .select({ id: customLpTemplates.id })
        .from(customLpTemplates)
        .where(eq(customLpTemplates.userId, userId))
        .limit(1),
    ),
    exists(
      db
        .select({ id: emailTemplates.id })
        .from(emailTemplates)
        .where(
          and(eq(emailTemplates.userId, userId), isNull(emailTemplates.deletedAt)),
        )
        .limit(1),
    ),
    exists(
      db
        .select({ id: mailboxConnections.id })
        .from(mailboxConnections)
        .where(
          and(
            eq(mailboxConnections.userId, userId),
            sql`${mailboxConnections.status} = 'connected'`,
          ),
        )
        .limit(1),
    ),
    exists(
      db
        .select({ id: envelopeTemplates.id })
        .from(envelopeTemplates)
        .where(
          and(
            eq(envelopeTemplates.userId, userId),
            isNull(envelopeTemplates.deletedAt),
          ),
        )
        .limit(1),
    ),
    exists(
      db
        .select({ id: userDomains.id })
        .from(userDomains)
        .where(
          and(eq(userDomains.userId, userId), sql`${userDomains.status} = 'active'`),
        )
        .limit(1),
    ),
    exists(
      db
        .select({ id: crmIntegrations.id })
        .from(crmIntegrations)
        .where(eq(crmIntegrations.userId, userId))
        .limit(1),
    ),
    exists(
      db
        .select({ id: webhookEndpoints.id })
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.userId, userId))
        .limit(1),
    ),
    exists(
      db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.userId, userId))
        .limit(1),
    ),
  ]);

  const user = userRow[0];
  const hasProfile = Boolean(
    user?.firstName && user?.lastName && user?.companyName,
  );

  const items: SetupItem[] = [
    {
      key: "stammdaten",
      title: "Stammdaten ausfüllen",
      hint: "Name und Firma eintragen. Findest du unter Einstellungen im Tab „Profil“.",
      href: "/einstellungen?tab=profil",
      done: hasProfile,
      optional: false,
    },
    {
      key: "landingpage",
      title: "Landingpage erstellen oder hochladen",
      hint: "Hier landen deine Empfänger und schauen das Video. Findest du links im Menü unter „Landingpages“.",
      href: "/landingpages",
      done: hasLp || hasCustomLp,
      optional: false,
    },
    {
      key: "email-vorlage",
      title: "E-Mail-Vorlage erstellen",
      hint: "Die Mail, die deine Empfänger bekommen. Findest du links im Menü unter „E-Mail-Vorlagen“.",
      href: "/email-vorlagen",
      done: hasEmailTemplate,
      optional: false,
    },
    {
      key: "postfach",
      title: "E-Mail-Postfach verbinden",
      hint: "Damit die Mails über deine eigene Adresse rausgehen. Findest du unter Einstellungen im Tab „E-Mail-Postfächer“.",
      href: "/einstellungen?tab=postfaecher",
      done: hasMailbox,
      optional: false,
    },
    {
      key: "umschlag",
      title: "Umschlagvorlage anlegen",
      hint: "Für den Versand per Brief mit QR-Code. Findest du links im Menü unter „Umschläge“.",
      href: "/umschlaege",
      done: hasEnvelope,
      optional: false,
    },
    {
      key: "domain",
      title: "Eigene Domain verbinden",
      hint: "Am besten eine Subdomain wie video.deine-firma.de, go.deine-firma.de oder aktion.deine-firma.de. Findest du unter Einstellungen im Tab „Domains“.",
      href: "/einstellungen?tab=domains",
      done: hasDomain,
      optional: false,
    },
    {
      key: "crm",
      title: "CRM oder Webhooks verbinden",
      hint: "Nur wenn du deine Leads automatisch weitergeben willst. Findest du unter Einstellungen in den Tabs „CRM-Integrationen“ und „Webhooks“.",
      href: "/einstellungen?tab=crm",
      done: hasCrm || hasWebhook,
      optional: true,
    },
    {
      key: "kampagne",
      title: "Erste Kampagne erstellen",
      hint: "Video aufnehmen, Leads hochladen, los. Findest du links im Menü unter „Kampagnen“.",
      href: "/kampagnen",
      done: hasCampaign,
      optional: false,
    },
  ];

  const required = items.filter((i) => !i.optional);
  const doneCount = required.filter((i) => i.done).length;

  return {
    items,
    doneCount,
    requiredCount: required.length,
    allDone: doneCount === required.length,
    onboardingDismissed: Boolean(user?.onboardingDismissedAt),
  };
}
