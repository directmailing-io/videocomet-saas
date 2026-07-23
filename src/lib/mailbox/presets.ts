/**
 * DACH-SMTP/IMAP-Presets + Freemail-Blockliste.
 *
 * Domain-Erkennung: Aus der E-Mail-Adresse wird der Domain-Teil extrahiert
 * und gegen die Preset-Domain-Listen gematcht. Kunden mit eigener Domain
 * (IONOS, Strato, all-inkl, Hetzner ...) sind nicht automatisch erkennbar —
 * dafür gibt es die manuelle Anbieter-Auswahl im Wizard (alle Presets).
 */

export interface MailboxPreset {
  id: string;
  label: string;
  /** NULL = User muss den Host selbst eintragen (z. B. all-inkl). */
  smtpHost: string | null;
  smtpPort: number;
  /** true = 465 implizit TLS, false = 587 STARTTLS. */
  smtpSecure: boolean;
  imapHost: string | null;
  imapPort: number;
  /** Domains, über die das Preset aus der E-Mail-Adresse erkannt wird. */
  domains: string[];
  /** Deutscher Hinweistext, wird im Wizard unter den Feldern angezeigt. */
  hint?: string;
  /** all-inkl: Host ist pro Kunde individuell — Felder bleiben editierbar. */
  hostPlaceholder?: { smtp: string; imap: string };
  /** Gmail: geführter App-Passwort-Weg. */
  requiresAppPassword?: boolean;
}

export const MAILBOX_PRESETS: MailboxPreset[] = [
  {
    id: "ionos",
    label: "IONOS",
    smtpHost: "smtp.ionos.de",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "imap.ionos.de",
    imapPort: 993,
    domains: [],
  },
  {
    id: "strato",
    label: "Strato",
    smtpHost: "smtp.strato.de",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "imap.strato.de",
    imapPort: 993,
    domains: [],
    hint: "Strato begrenzt den Versand auf 100 E-Mails pro Stunde. Der VideoComet-Drip-Versand (max. 50/Tag) bleibt deutlich darunter.",
  },
  {
    id: "all-inkl",
    label: "all-inkl (KAS)",
    smtpHost: null,
    smtpPort: 587,
    smtpSecure: false,
    imapHost: null,
    imapPort: 993,
    domains: [],
    hint: "all-inkl nutzt einen individuellen Server-Host im Format [login].kasserver.com (z. B. w0123456.kasserver.com). Sie finden ihn im KAS unter „E-Mail“ — bitte unten selbst eintragen.",
    hostPlaceholder: { smtp: "w0123456.kasserver.com", imap: "w0123456.kasserver.com" },
  },
  {
    id: "hetzner",
    label: "Hetzner",
    smtpHost: "mail.your-server.de",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "mail.your-server.de",
    imapPort: 993,
    domains: [],
  },
  {
    id: "t-online-business",
    label: "T-Online Business",
    smtpHost: "securesmtp.t-online.de",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "secureimap.t-online.de",
    imapPort: 993,
    domains: [],
    hint: "T-Online verlangt ein separates „Passwort für E-Mail-Programme“ (nicht das normale Login-Passwort). Sie können es im T-Online E-Mail-Center unter „Einstellungen“ erstellen.",
  },
  {
    id: "mailbox-org",
    label: "mailbox.org",
    smtpHost: "smtp.mailbox.org",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "imap.mailbox.org",
    imapPort: 993,
    domains: ["mailbox.org"],
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    smtpHost: "smtp.zoho.eu",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "imap.zoho.eu",
    imapPort: 993,
    domains: ["zoho.eu", "zohomail.eu", "zoho.com"],
  },
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    domains: ["gmail.com", "googlemail.com"],
    requiresAppPassword: true,
    hint: "Gmail akzeptiert nur App-Passwörter: Aktivieren Sie die 2-Faktor-Authentifizierung und erstellen Sie unter myaccount.google.com/apppasswords ein App-Passwort (16 Zeichen). Beachten Sie die Google-Limits (ca. 500 Mails/Tag privat bzw. 2.000/Tag Workspace) — bei Workspace kann der Admin App-Passwörter gesperrt haben.",
  },
];

/**
 * Freemail-Absender werden geblockt: kein DKIM-Alignment möglich, die
 * Zustellbarkeit von Kaltakquise über Freemail ist praktisch null.
 * outlook/hotmail privat: als SMTP geblockt — der M365-Weg ist der richtige.
 */
export const FREEMAIL_BLOCKED_DOMAINS = [
  "gmx.de",
  "gmx.net",
  "web.de",
  "freenet.de",
  "t-online.de",
  "aol.com",
  "outlook.com",
  "outlook.de",
  "hotmail.com",
  "hotmail.de",
  "live.com",
  "live.de",
];

const M365_RECOMMENDED_DOMAINS = new Set([
  "outlook.com",
  "outlook.de",
  "hotmail.com",
  "hotmail.de",
  "live.com",
  "live.de",
]);

export function extractDomain(emailAddress: string): string | null {
  const at = emailAddress.lastIndexOf("@");
  if (at < 1 || at === emailAddress.length - 1) return null;
  return emailAddress.slice(at + 1).trim().toLowerCase();
}

export interface FreemailCheck {
  blocked: boolean;
  /** Deutsche Begründung für die Fehlermeldung im UI/API. */
  message?: string;
}

export function checkFreemailDomain(emailAddress: string): FreemailCheck {
  const domain = extractDomain(emailAddress);
  if (!domain) return { blocked: false };
  if (M365_RECOMMENDED_DOMAINS.has(domain)) {
    return {
      blocked: true,
      message: `Adressen von ${domain} können nicht per SMTP angebunden werden. Nutzen Sie stattdessen „Microsoft-Postfach verbinden“ — das ist der offizielle Weg für Outlook-/Microsoft-Konten.`,
    };
  }
  if (FREEMAIL_BLOCKED_DOMAINS.includes(domain)) {
    return {
      blocked: true,
      message: `Freemail-Adressen (${domain}) werden nicht unterstützt: Ohne eigene Domain ist kein DKIM-Alignment möglich und Ihre E-Mails würden fast immer im Spam landen. Bitte verwenden Sie ein Postfach auf Ihrer Firmen-Domain.`,
    };
  }
  return { blocked: false };
}

/** Preset-Erkennung aus der E-Mail-Adresse (nur für bekannte Domains). */
export function detectPreset(emailAddress: string): MailboxPreset | null {
  const domain = extractDomain(emailAddress);
  if (!domain) return null;
  for (const preset of MAILBOX_PRESETS) {
    if (preset.domains.includes(domain)) return preset;
  }
  return null;
}

export function getPresetById(id: string): MailboxPreset | null {
  return MAILBOX_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * Effektives Tageslimit unter Warmup: Stage 0 ⇒ 20, Stage 1 ⇒ 35,
 * ab Stage 2 ⇒ min(dailyCap, 50). Stage steigt nach je 5 aktiven
 * Versandtagen (Fortschritt führt der Drip-Worker).
 */
export function effectiveDailyLimit(warmupStage: number, dailyCap: number): number {
  const cap = Math.min(dailyCap, 50);
  if (warmupStage <= 0) return Math.min(20, cap);
  if (warmupStage === 1) return Math.min(35, cap);
  return cap;
}
