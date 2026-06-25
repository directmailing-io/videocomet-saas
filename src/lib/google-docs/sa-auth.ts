/**
 * Service-Account-Authentication fuer Google Drive + Docs API.
 *
 * Setup (Schritt-fuer-Schritt fuer den Operator):
 *   1. Google Cloud Console → neues Projekt anlegen
 *   2. APIs aktivieren: "Google Drive API" + "Google Docs API"
 *   3. IAM → Service Accounts → neuer Account, Rolle "Basic > Editor" reicht
 *   4. Keys → ADD KEY → JSON download
 *   5. Kompletten JSON-Inhalt in env als GOOGLE_DRIVE_SA_KEY setzen
 *      (als JSON-String, NICHT Base64). Newlines im private_key bleiben \n.
 *   6. Brief-Template in Google Docs: Sharing → Email der SA hinzufuegen,
 *      Rolle "Viewer". Damit kann die SA `drive.files.copy()` aufrufen.
 *
 * Warum SA und nicht User-OAuth:
 *   - SA ist Server-zu-Server, kein User-Token-Refresh-Loop.
 *   - Keine zustimmungs-UI noetig (Operator macht 1× Setup).
 *   - Volume-Quota gehoert dem Cloud-Projekt, nicht dem User.
 *
 * Was wir NICHT brauchen:
 *   - User-OAuth (User muessten ihr Google-Konto verbinden — UX-Bruch)
 *   - Google-Workspace-Lizenz (SA-Drive-Quota reicht fuer ~12k req/min)
 */

import { google, type drive_v3, type docs_v1 } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
];

let cachedDrive: drive_v3.Drive | null = null;
let cachedDocs: docs_v1.Docs | null = null;
let cachedSaEmail: string | null = null;

interface SaKey {
  client_email: string;
  private_key: string;
  type: string;
  project_id?: string;
}

function loadSaKey(): SaKey {
  const raw = process.env.GOOGLE_DRIVE_SA_KEY;
  if (!raw) {
    throw new Error(
      "GOOGLE_DRIVE_SA_KEY env nicht gesetzt — Drive-Renderer kann nicht booten.",
    );
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SaKey>;
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("missing client_email/private_key");
    }
    return parsed as SaKey;
  } catch (err) {
    throw new Error(
      `GOOGLE_DRIVE_SA_KEY ist kein gueltiges Service-Account-JSON: ${err instanceof Error ? err.message : "?"}`,
    );
  }
}

function buildAuth(): InstanceType<typeof google.auth.JWT> {
  const key = loadSaKey();
  cachedSaEmail = key.client_email;
  return new google.auth.JWT({
    email: key.client_email,
    key: key.private_key.replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });
}

export function getDriveClient(): drive_v3.Drive {
  if (cachedDrive) return cachedDrive;
  const auth = buildAuth();
  cachedDrive = google.drive({ version: "v3", auth });
  return cachedDrive;
}

export function getDocsClient(): docs_v1.Docs {
  if (cachedDocs) return cachedDocs;
  const auth = buildAuth();
  cachedDocs = google.docs({ version: "v1", auth });
  return cachedDocs;
}

/** Email der konfigurierten SA — fuer Setup-UI / Diagnose-Endpoint. */
export function getServiceAccountEmail(): string | null {
  if (cachedSaEmail) return cachedSaEmail;
  try {
    const key = loadSaKey();
    cachedSaEmail = key.client_email;
    return cachedSaEmail;
  } catch {
    return null;
  }
}

/** Test-Helper: Cache reset. */
export function _resetClientsForTesting(): void {
  cachedDrive = null;
  cachedDocs = null;
  cachedSaEmail = null;
}

/** True wenn die SA konfiguriert ist + die client_email + private_key vorhanden. */
export function isDriveRendererConfigured(): boolean {
  return getServiceAccountEmail() !== null;
}

/**
 * Document-ID aus einer Google-Docs-URL extrahieren. Akzeptiert die
 * gaengigen URL-Formen.
 */
export function extractDocId(url: string): string | null {
  const m = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? null;
}
