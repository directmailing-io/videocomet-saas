/**
 * Ops-Alerting an den Betreiber (Reliability 2026-08-20).
 *
 * Schickt kurze Klartext-Mails an ADMIN_ALERT_EMAIL, wenn das System
 * einen Zustand erreicht, den ein Mensch ansehen sollte (Runde mit
 * Fehlschlägen abgeschlossen, Worker-Heartbeat tot, ...).
 *
 * Eigenschaften:
 *   - Fire-and-forget-sicher: wirft NIE, ein Mail-Fehler darf niemals
 *     die Pipeline oder den Worker anhalten.
 *   - Pro `topic` gedrosselt (Default 30 min, prozess-lokal): ein
 *     wiederkehrender Zustand spamt nicht das Postfach voll.
 *   - Ohne ADMIN_ALERT_EMAIL oder RESEND_API_KEY: No-Op mit Log-Zeile.
 */

import { Resend } from "resend";

const THROTTLE_MS = 30 * 60 * 1000;
const lastSentByTopic = new Map<string, number>();

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function fromAddress(): string {
  return process.env.RESEND_FROM ?? "VIDEOCOMET <onboarding@resend.dev>";
}

export interface OpsAlertInput {
  /** Drossel-Schlüssel: gleiche topic-Werte werden max. 1×/30min gemailt. */
  topic: string;
  subject: string;
  text: string;
}

/** Nur für Tests: Drossel-Zustand zurücksetzen. */
export function resetOpsAlertThrottle(): void {
  lastSentByTopic.clear();
}

export async function sendOpsAlert(input: OpsAlertInput): Promise<void> {
  try {
    const to = process.env.ADMIN_ALERT_EMAIL;
    if (!to) {
      console.warn(
        `[ops-alert] ADMIN_ALERT_EMAIL nicht gesetzt, Alert unterdrückt: ${input.subject}`,
      );
      return;
    }
    const now = Date.now();
    const last = lastSentByTopic.get(input.topic) ?? 0;
    if (now - last < THROTTLE_MS) return;
    lastSentByTopic.set(input.topic, now);

    const resend = getResend();
    if (!resend) {
      console.warn(
        `[ops-alert] RESEND_API_KEY nicht gesetzt, Alert unterdrückt: ${input.subject}`,
      );
      return;
    }
    await resend.emails.send({
      from: fromAddress(),
      to,
      subject: `[VIDEOCOMET Ops] ${input.subject}`,
      text: input.text,
    });
    console.log(`[ops-alert] sent: ${input.subject}`);
  } catch (err) {
    console.warn(
      `[ops-alert] send failed (${input.subject}):`,
      err instanceof Error ? err.message : err,
    );
  }
}
