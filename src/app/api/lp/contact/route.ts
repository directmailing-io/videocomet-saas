export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Resend } from "resend";

/**
 * Kontakt-Endpoint fuer die per Custom-LP eingebetteten Beratungs-
 * Formulare. Wird vom Formular-JS auf einer Custom-Domain per fetch()
 * aufgerufen — deshalb IMMER mit CORS-Antwort (Wildcard, weil das
 * Formular auf beliebigen Custom-Domains laufen kann).
 *
 * Empfaenger sind aktuell hardcoded fuer BODYTIME concept. Wenn andere
 * Kunden das Formular auch nutzen sollen: pro Custom-Domain-ID ein
 * Empfaenger-Set konfigurierbar machen (spaeter).
 */

const bodySchema = z.object({
  first_name: z.string().trim().min(1, "Vorname fehlt.").max(200),
  last_name: z.string().trim().min(1, "Nachname fehlt.").max(200),
  phone: z.string().trim().min(3, "Telefon fehlt.").max(60),
  phone_country: z.string().trim().max(10).optional().default(""),
  email: z.string().trim().email("E-Mail ungueltig.").optional(),
  city: z.string().trim().max(200).optional(),
  slots: z.array(z.string().trim().max(60)).max(20).optional().default([]),
});

// Erste Kunden-Konfiguration — spaeter aus DB pro Custom-Domain.
const RECIPIENTS = [
  "christoph@daniel-kurzeja.de",
  "info@bodytime-concept.de",
];

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Ungueltiger JSON-Body." },
      { status: 400, headers: corsHeaders() },
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "Pflichtfelder fehlen.";
    return NextResponse.json(
      { success: false, error: firstIssue },
      { status: 400, headers: corsHeaders() },
    );
  }
  const data = parsed.data;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[lp/contact] RESEND_API_KEY not set — cannot send mail");
    return NextResponse.json(
      { success: false, error: "Mailversand nicht konfiguriert." },
      { status: 500, headers: corsHeaders() },
    );
  }

  const from = process.env.RESEND_FROM ?? "VIDEOCOMET <no-reply@videocomet.de>";
  const subject = `Neue Beratungsanfrage: ${data.first_name} ${data.last_name}`;
  const slotsText = data.slots.length > 0 ? data.slots.join(", ") : "—";
  const referer = req.headers.get("referer") ?? "unbekannt";

  const textLines = [
    `Vorname: ${data.first_name}`,
    `Nachname: ${data.last_name}`,
    `Telefon: ${data.phone_country ?? ""} ${data.phone}`.trim(),
    data.email ? `E-Mail: ${data.email}` : null,
    data.city ? `Ort: ${data.city}` : null,
    `Wunsch-Zeiten: ${slotsText}`,
    "",
    `Quelle: ${referer}`,
  ].filter((l): l is string => l !== null);

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px;">
      <h2 style="margin:0 0 16px 0;">Neue Beratungsanfrage</h2>
      <table style="border-collapse: collapse; width: 100%;">
        <tr><td style="padding:6px 12px 6px 0; color:#666;">Vorname</td><td>${escapeHtml(data.first_name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0; color:#666;">Nachname</td><td>${escapeHtml(data.last_name)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0; color:#666;">Telefon</td><td>${escapeHtml(`${data.phone_country ?? ""} ${data.phone}`.trim())}</td></tr>
        ${data.email ? `<tr><td style="padding:6px 12px 6px 0; color:#666;">E-Mail</td><td>${escapeHtml(data.email)}</td></tr>` : ""}
        ${data.city ? `<tr><td style="padding:6px 12px 6px 0; color:#666;">Ort</td><td>${escapeHtml(data.city)}</td></tr>` : ""}
        <tr><td style="padding:6px 12px 6px 0; color:#666;">Wunsch-Zeiten</td><td>${escapeHtml(slotsText)}</td></tr>
      </table>
      <p style="color:#888; font-size:12px; margin-top:20px;">Quelle: ${escapeHtml(referer)}</p>
    </div>
  `;

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to: RECIPIENTS,
      subject,
      text: textLines.join("\n"),
      html,
      replyTo: data.email,
    });
  } catch (err) {
    console.error("[lp/contact] resend failed:", err);
    return NextResponse.json(
      { success: false, error: "Mailversand fehlgeschlagen. Bitte spaeter erneut versuchen." },
      { status: 502, headers: corsHeaders() },
    );
  }

  return NextResponse.json(
    { success: true },
    { status: 200, headers: corsHeaders() },
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
