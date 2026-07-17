import type { Page } from "puppeteer-core";

/**
 * Schicht 4 des Clean-Render-Systems: QA-Gate vor der Aufnahme.
 *
 * Entdeckt Fehler-/Interstitial-Seiten, die technisch mit HTTP 200 laden,
 * aber nicht die Ziel-Webseite zeigen (der inuvet/fenou-Fall: Shopify
 * lieferte "There was a problem loading this website" — das Video sah aus
 * wie fertig, zeigte aber nur die Fehlerseite).
 *
 * assessRenderReadiness() liefert einen Befund; der Orchestrator entscheidet
 * über Reload-Retry oder harten Fehler.
 */

export type ReadinessProblem =
  | "platform_error_page" // Shopify/Wix/Cloudflare-Fehlerseite
  | "bot_interstitial" // Cloudflare "Just a moment", Captcha
  | "empty_page"; // fast kein Inhalt gerendert

export type ReadinessResult =
  | { ok: true }
  | { ok: false; problem: ReadinessProblem; detail: string };

/**
 * Signaturen bekannter Fehler-/Interstitial-Seiten. Bewusst sehr spezifische
 * Phrasen, damit reguläre Seiten (Blogartikel über Cloudflare o. ä.) nicht
 * fälschlich matchen — geprüft wird nur gegen Titel + die ersten 3000
 * Zeichen sichtbaren Texts.
 */
const ERROR_PAGE_SIGNATURES: Array<{
  re: RegExp;
  problem: ReadinessProblem;
  label: string;
}> = [
  // Shopify
  {
    re: /there was a problem loading this website|this store is unavailable|diese website ist derzeit nicht verf/i,
    problem: "platform_error_page",
    label: "shopify-error",
  },
  // Cloudflare Interstitials / Fehlerseiten
  {
    re: /just a moment|checking your browser before accessing|attention required!?\s*\|\s*cloudflare/i,
    problem: "bot_interstitial",
    label: "cloudflare-challenge",
  },
  {
    re: /error\s*52[0-6]|web server is down|origin is unreachable/i,
    problem: "platform_error_page",
    label: "cloudflare-52x",
  },
  // Captcha-Walls
  {
    re: /verify you are human|bestätigen sie, dass sie ein mensch sind|enable javascript and cookies to continue/i,
    problem: "bot_interstitial",
    label: "captcha-wall",
  },
  // Wix
  {
    re: /this site can.t be reached right now|wix\.com.{0,40}error/i,
    problem: "platform_error_page",
    label: "wix-error",
  },
  // Squarespace / generische Hoster
  {
    re: /website expired|this account has been suspended|domain has expired/i,
    problem: "platform_error_page",
    label: "hosting-error",
  },
  // WordPress
  {
    re: /error establishing a database connection|es ist ein kritischer fehler auf deiner website aufgetreten|there has been a critical error on this website/i,
    problem: "platform_error_page",
    label: "wordpress-error",
  },
  // Generisch
  {
    re: /^(service unavailable|502 bad gateway|503 service|504 gateway)/i,
    problem: "platform_error_page",
    label: "gateway-error",
  },
];

function collectPageSignals(): {
  title: string;
  text: string;
  docHeight: number;
  imgCount: number;
} {
  const title = document.title ?? "";
  const text = (document.body?.innerText ?? "").slice(0, 3000);
  const docHeight = Math.max(
    document.documentElement?.scrollHeight ?? 0,
    document.body?.scrollHeight ?? 0,
  );
  const imgCount = document.querySelectorAll("img, picture, svg, video, canvas").length;
  return { title, text, docHeight, imgCount };
}

/**
 * Prüft die geladene Page auf bekannte Fehlerseiten und Fast-Leere.
 * Nie throwend — wenn die Signale nicht lesbar sind, gilt die Seite als ok
 * (lieber ein fragwürdiges Video als ein falscher Hard-Fail).
 */
export async function assessRenderReadiness(page: Page): Promise<ReadinessResult> {
  let signals: ReturnType<typeof collectPageSignals>;
  try {
    signals = await page.evaluate(collectPageSignals);
  } catch {
    return { ok: true };
  }

  const haystack = `${signals.title}\n${signals.text}`;
  for (const sig of ERROR_PAGE_SIGNATURES) {
    if (sig.re.test(haystack)) {
      return {
        ok: false,
        problem: sig.problem,
        detail: `${sig.label}: "${signals.title || signals.text.slice(0, 80)}"`,
      };
    }
  }

  // Fast-Leere: kaum Höhe, kaum Text, keine Medien → vermutlich kaputt.
  const textLen = signals.text.replace(/\s+/g, " ").trim().length;
  if (signals.docHeight < 300 && textLen < 80 && signals.imgCount === 0) {
    return {
      ok: false,
      problem: "empty_page",
      detail: `docHeight=${signals.docHeight}, textLen=${textLen}, media=0`,
    };
  }

  return { ok: true };
}

/** Fehler, den der Orchestrator wirft, wenn auch der Reload scheitert. */
export class RenderNotReadyError extends Error {
  readonly problem: ReadinessProblem;
  constructor(problem: ReadinessProblem, detail: string) {
    super(`Seite nicht aufnahmebereit (${problem}): ${detail}`);
    this.name = "RenderNotReadyError";
    this.problem = problem;
  }
}
