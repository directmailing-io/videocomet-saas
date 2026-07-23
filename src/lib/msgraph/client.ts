/**
 * Microsoft-Graph-Client für M365-Postfächer (Multi-Tenant, delegated).
 *
 * OAuth: login.microsoftonline.com/common, Scopes
 * `offline_access Mail.Send Mail.Read User.Read`.
 *
 * WICHTIG: Microsoft ROTIERT Refresh-Tokens — jede Token-Antwort enthält
 * einen neuen Refresh-Token, der alte wird ungültig. `getFreshAccessToken`
 * persistiert deshalb nach jedem Refresh sofort den neuen Token.
 *
 * `invalid_grant`/`AADSTS70000` ⇒ Verbindung auf `token_expired` setzen,
 * laufende Blasts pausieren und den Kontoinhaber per Systemmail informieren.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  emailBlasts,
  mailboxConnections,
  users,
  type MailboxConnection,
} from "@/lib/db/schema";
import { sendMailboxDisconnectedMail } from "@/lib/mail";
import {
  decryptMailboxSecret,
  encryptMailboxSecret,
} from "@/lib/mailbox/crypto";

const AUTH_BASE = "https://login.microsoftonline.com/common";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export const M365_SCOPES = "offline_access Mail.Send Mail.Read User.Read";

export function getM365ClientId(): string | null {
  return process.env.MS_CLIENT_ID ?? null;
}

export function isM365Configured(): boolean {
  return Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

export function getAppBaseUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://app.videocomet.de"
  ).replace(/\/+$/, "");
}

export function getM365RedirectUri(): string {
  return `${getAppBaseUrl()}/api/auth/m365/callback`;
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: getM365RedirectUri(),
    response_mode: "query",
    scope: M365_SCOPES,
    state,
    prompt: "select_account",
  });
  return `${AUTH_BASE}/oauth2/v2.0/authorize?${params.toString()}`;
}

/**
 * Fertiger Admin-Consent-Link für Tenants, in denen User-Consent gesperrt
 * ist (AADSTS65001) — der IT-Admin des Kunden öffnet diesen Link einmal.
 */
export function buildAdminConsentUrl(): string | null {
  const clientId = getM365ClientId();
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getM365RedirectUri(),
  });
  return `${AUTH_BASE}/adminconsent?${params.toString()}`;
}

// ── OAuth-State (HMAC-signiert, gegen CSRF/Login-Injection) ─────────────────

const STATE_MAX_AGE_SEC = 600;

function stateSecret(): string {
  // MAILBOX_KEY_SECRET ist fuer das Feature ohnehin Pflicht — als HMAC-Key
  // wiederverwendet, damit kein zusaetzliches Env noetig ist.
  const v = process.env.MAILBOX_KEY_SECRET;
  if (!v) throw new Error("Missing MAILBOX_KEY_SECRET env var.");
  return v;
}

export function signOAuthState(userId: string): string {
  const payload = `${userId}.${Math.floor(Date.now() / 1000)}.${randomBytes(8).toString("hex")}`;
  const sig = createHmac("sha256", stateSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`, "utf8").toString("base64url");
}

export function verifyOAuthState(state: string): { userId: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = decoded.split(".");
  if (parts.length !== 4) return null;
  const [userId, tsRaw, nonce, sig] = parts as [string, string, string, string];
  const payload = `${userId}.${tsRaw}.${nonce}`;
  const expected = createHmac("sha256", stateSecret()).update(payload).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > STATE_MAX_AGE_SEC) {
    return null;
  }
  return { userId };
}

export class M365AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** true = Refresh-Token endgültig ungültig ⇒ Neu-Verbinden nötig. */
    public readonly tokenExpired: boolean = false,
  ) {
    super(message);
    this.name = "M365AuthError";
  }
}

export interface M365TokenSet {
  accessToken: string;
  /** Immer der NEUE (rotierte) Refresh-Token — sofort persistieren! */
  refreshToken: string;
  expiresInSec: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function isTokenExpiredError(error: string, description: string): boolean {
  return (
    error === "invalid_grant" ||
    description.includes("AADSTS70000") ||
    description.includes("AADSTS70008")
  );
}

async function requestToken(body: URLSearchParams): Promise<M365TokenSet> {
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new M365AuthError(
      "not_configured",
      "MS_CLIENT_ID / MS_CLIENT_SECRET sind nicht gesetzt.",
    );
  }
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  const res = await fetch(`${AUTH_BASE}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;

  if (!res.ok || !json.access_token || !json.refresh_token) {
    const error = json.error ?? `http_${res.status}`;
    const description = json.error_description ?? "Token-Anfrage fehlgeschlagen.";
    throw new M365AuthError(
      error,
      description,
      isTokenExpiredError(error, description),
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresInSec: json.expires_in ?? 3600,
  };
}

export async function exchangeCodeForTokens(code: string): Promise<M365TokenSet> {
  return requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getM365RedirectUri(),
      scope: M365_SCOPES,
    }),
  );
}

export async function refreshTokenSet(refreshToken: string): Promise<M365TokenSet> {
  return requestToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: M365_SCOPES,
    }),
  );
}

export interface M365Me {
  email: string;
  displayName: string | null;
}

export async function fetchMe(accessToken: string): Promise<M365Me> {
  const res = await fetch(`${GRAPH_BASE}/me?$select=mail,userPrincipalName,displayName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new M365AuthError(
      `graph_${res.status}`,
      "Microsoft-Profil konnte nicht gelesen werden.",
    );
  }
  const json = (await res.json()) as {
    mail?: string | null;
    userPrincipalName?: string | null;
    displayName?: string | null;
  };
  const email = (json.mail ?? json.userPrincipalName ?? "").trim().toLowerCase();
  if (!email) {
    throw new M365AuthError(
      "no_mailbox",
      "Das Microsoft-Konto hat keine E-Mail-Adresse (kein Exchange-Postfach?).",
    );
  }
  return { email, displayName: json.displayName ?? null };
}

/**
 * Setzt die Verbindung auf `token_expired` und pausiert laufende Blasts,
 * damit der Drip-Worker nicht gegen ein totes Token anrennt. Nur beim
 * Status-ÜBERGANG (idempotent via WHERE status != 'token_expired') geht
 * zusätzlich eine Systemmail an den Kontoinhaber raus.
 */
export async function markMailboxTokenExpired(
  connectionId: string,
  reason: string,
): Promise<void> {
  const [transitioned] = await db
    .update(mailboxConnections)
    .set({ status: "token_expired", lastError: reason, updatedAt: new Date() })
    .where(
      and(
        eq(mailboxConnections.id, connectionId),
        ne(sql`${mailboxConnections.status}`, "token_expired"),
      ),
    )
    .returning({
      userId: mailboxConnections.userId,
      emailAddress: mailboxConnections.emailAddress,
    });
  await db
    .update(emailBlasts)
    .set({ status: "paused", updatedAt: new Date() })
    .where(
      and(
        eq(emailBlasts.mailboxConnectionId, connectionId),
        inArray(emailBlasts.status, ["running"]),
      ),
    );
  if (transitioned) {
    try {
      const [owner] = await db
        .select({ email: users.email, firstName: users.firstName })
        .from(users)
        .where(eq(users.id, transitioned.userId))
        .limit(1);
      if (owner) {
        await sendMailboxDisconnectedMail({
          to: owner.email,
          firstName: owner.firstName,
          mailboxEmail: transitioned.emailAddress,
        });
      }
    } catch (err) {
      // Benachrichtigung darf den Auth-Fehlerpfad nie zusätzlich brechen.
      console.warn("[msgraph] disconnect mail failed:", err);
    }
  }
}

/**
 * Liefert ein frisches Access-Token für eine M365-Verbindung. Persistiert
 * den rotierten Refresh-Token IMMER sofort — Aufrufer müssen nichts weiter
 * tun. Bei endgültig ungültigem Refresh-Token wird die Verbindung auf
 * `token_expired` gesetzt und die M365AuthError weitergeworfen.
 */
export async function getFreshAccessToken(
  connection: Pick<MailboxConnection, "id" | "refreshTokenEncrypted">,
): Promise<string> {
  if (!connection.refreshTokenEncrypted) {
    throw new M365AuthError(
      "no_refresh_token",
      "Für dieses Postfach ist kein Refresh-Token hinterlegt.",
      true,
    );
  }
  const refreshToken = decryptMailboxSecret(connection.refreshTokenEncrypted);
  let tokens: M365TokenSet;
  try {
    tokens = await refreshTokenSet(refreshToken);
  } catch (err) {
    if (err instanceof M365AuthError && err.tokenExpired) {
      await markMailboxTokenExpired(connection.id, err.message);
    }
    throw err;
  }
  await db
    .update(mailboxConnections)
    .set({
      refreshTokenEncrypted: encryptMailboxSecret(tokens.refreshToken),
      updatedAt: new Date(),
    })
    .where(eq(mailboxConnections.id, connection.id));
  return tokens.accessToken;
}

/**
 * Versand als base64-MIME über POST /me/sendMail — nur so kann die eigene
 * `internetMessageId` gesetzt werden (Voraussetzung für NDR-Korrelation).
 */
export async function sendMailAsMime(
  accessToken: string,
  mime: string | Buffer,
): Promise<void> {
  const raw = typeof mime === "string" ? Buffer.from(mime, "utf8") : mime;
  const res = await fetch(`${GRAPH_BASE}/me/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "text/plain",
    },
    body: raw.toString("base64"),
  });
  if (res.status !== 202) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Graph sendMail fehlgeschlagen (HTTP ${res.status}): ${detail}`);
  }
}

export interface GraphMessageDetail {
  id: string;
  conversationId?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  body?: { contentType?: string; content?: string };
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
}

/**
 * Voll-Detail einer Inbox-Message (Body + Header) — für NDR-/Reply-
 * Korrelation im mailbox-sync. 404 (Message gelöscht) ⇒ null.
 */
export async function fetchMessageDetail(
  accessToken: string,
  messageId: string,
): Promise<GraphMessageDetail | null> {
  const select = "$select=id,conversationId,from,body,internetMessageHeaders";
  const res = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}?${select}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `Graph Message-Detail fehlgeschlagen (HTTP ${res.status}): ${detail}`,
    );
  }
  return (await res.json()) as GraphMessageDetail;
}

export interface GraphDeltaMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  isDraft?: boolean;
  /** Delta-Removed-Marker. */
  "@removed"?: { reason?: string };
}

export interface InboxDeltaResult {
  messages: GraphDeltaMessage[];
  deltaLink: string;
}

/**
 * Inbox-Delta-Query. Ohne `deltaLink` wird ein initialer Sync gefahren
 * (liefert Bestand — Aufrufer entscheidet, ob er ihn ignoriert und nur den
 * neuen deltaLink persistiert). Folgt nextLink-Seiten bis zum deltaLink.
 */
export async function fetchInboxDelta(
  accessToken: string,
  deltaLink?: string | null,
): Promise<InboxDeltaResult> {
  const select =
    "$select=id,conversationId,internetMessageId,subject,receivedDateTime,from,isDraft";
  let url =
    deltaLink ??
    `${GRAPH_BASE}/me/mailFolders/inbox/messages/delta?${select}`;
  const messages: GraphDeltaMessage[] = [];

  for (let page = 0; page < 20; page += 1) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(
        `Graph Inbox-Delta fehlgeschlagen (HTTP ${res.status}): ${detail}`,
      );
    }
    const json = (await res.json()) as {
      value?: GraphDeltaMessage[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };
    messages.push(...(json.value ?? []));
    if (json["@odata.deltaLink"]) {
      return { messages, deltaLink: json["@odata.deltaLink"] };
    }
    if (!json["@odata.nextLink"]) break;
    url = json["@odata.nextLink"];
  }
  throw new Error("Graph Inbox-Delta: kein deltaLink nach 20 Seiten.");
}
