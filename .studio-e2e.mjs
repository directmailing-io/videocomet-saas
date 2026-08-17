/* Studio-v4-E2E: Wizard-Karten, Regie-Gruppen, Website-Guard, URL-Validierung,
 * Teleprompter-Toggle, Standby-Hinweis, Bild/Video-Szenen, Live-Play/Pause.
 * Aufruf: node .studio-e2e.mjs  (Dev-Server auf :3000, System-Chrome) */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const SHOTS = "/tmp/studio-shots";
const BASE = "http://localhost:3000";
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--window-size=1512,982",
    "--autoplay-policy=no-user-gesture-required",
  ],
  defaultViewport: { width: 1512, height: 900 },
});
const page = await browser.newPage();
page.setDefaultTimeout(60000);

const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 350));
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log("SHOT", name);
};
const clickText = async (text, tag = "button") => {
  const [el] = await page.$$(`xpath/.//${tag}[contains(., ${JSON.stringify(text)})]`);
  if (!el) throw new Error(`clickText: "${text}" nicht gefunden`);
  await el.click();
  return el;
};
const exists = async (text) =>
  (await page.$$(`xpath/.//*[contains(text(), ${JSON.stringify(text)})]`)).length > 0;

// ---- Login (hydration-fest, Cookie-Banner zuerst wegklicken) ----
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
const [cookieBtn] = await page.$$("xpath/.//button[contains(., 'Nur notwendige')]");
if (cookieBtn) await cookieBtn.click();
for (let attempt = 0; attempt < 3; attempt++) {
  const email = await page.$('input[type="email"]');
  await email.click({ clickCount: 3 });
  await email.type("testuser@videocomet.de", { delay: 20 });
  const pw = await page.$('input[type="password"]');
  await pw.click({ clickCount: 3 });
  await pw.type("studio-test-2026", { delay: 20 });
  const typed = await page.evaluate(
    () => document.querySelector('input[type="email"]').value,
  );
  if (!typed) { await new Promise((r) => setTimeout(r, 1000)); continue; }
  await clickText("Anmelden");
  try {
    await page.waitForFunction(() => !location.pathname.startsWith("/login"), {
      timeout: 15000,
    });
    break;
  } catch {
    console.log("login retry", attempt + 1);
  }
}
if (page.url().includes("/login")) throw new Error("Login fehlgeschlagen");
console.log("logged in:", page.url());

// ---- Wizard Schritt 1 ----
await page.goto(`${BASE}/kampagnen/neu`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));
// Onboarding-Modal („Schnell startklar werden") dauerhaft wegklicken
const [noMore] = await page.$$("xpath/.//button[contains(., 'Nicht mehr anzeigen')]");
if (noMore) { await noMore.click(); await new Promise((r) => setTimeout(r, 600)); }
await shot("v4-01-wizard-karten");

// ---- Studio öffnen → Regie / Neue-Szene-Seite ----
await clickText("Studio öffnen");
await page.waitForSelector("xpath/.//*[contains(text(),'Neue Szene')]");
await shot("v4-02-regie-gruppen");

// ---- URL-Validierung: unvollständige Adresse ----
await clickText("Eigene Webseite");
await page.waitForSelector('input[placeholder*="deine-firma"]');
await page.type('input[placeholder*="deine-firma"]', "videocomet");
await clickText("Hinzufügen");
await new Promise((r) => setTimeout(r, 300));
if (!(await exists("vollständige Adresse"))) throw new Error("URL-Validierung fehlt!");
await shot("v4-03-url-validierung");
const urlInput = await page.$('input[placeholder*="deine-firma"]');
await urlInput.click({ clickCount: 3 });
await urlInput.type("videocomet.de");
await clickText("Hinzufügen");
console.log("ownsite added");

// Warten bis Szene bereit (ggf. Redis-Erstzugriff → „Erneut versuchen")
const waitScenesReady = async (timeoutMs = 120000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await exists("Alle Szenen sind bereit")) return;
    const [retry] = await page.$$("xpath/.//button[contains(., 'Erneut versuchen')]");
    if (retry) { console.log("retry click"); await retry.click(); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Szenen nicht bereit (Timeout)");
};
await waitScenesReady();

// ---- Empfänger-Website 1 ----
await clickText("Szene hinzufügen", "*[@aria-label='Szene hinzufügen'] | //button[@aria-label='Szene hinzufügen']").catch(async () => {
  const [plus] = await page.$$('[aria-label="Szene hinzufügen"]');
  await plus.click();
});
await page.waitForSelector("xpath/.//*[contains(text(),'Pro Lead personalisiert')]");
await clickText("Website des Leads");
await page.waitForSelector('input[placeholder*="beispiel-firma"]');
await page.type('input[placeholder*="beispiel-firma"]', "example.com");
await clickText("Hinzufügen");
await waitScenesReady();
console.log("website 1 added");

// ---- Empfänger-Website 2 → Guard: Seiten-Name nötig ----
const [plus2] = await page.$$('[aria-label="Szene hinzufügen"]');
await plus2.click();
await page.waitForSelector("xpath/.//*[contains(text(),'Pro Lead personalisiert')]");
await clickText("Website des Leads");
await page.waitForSelector("xpath/.//*[contains(text(),'Welche Seite des Leads')]");
await shot("v4-04-website-guard");
// Erst ohne Namen: Fehler erwartet
await page.type('input[placeholder*="beispiel-firma"]', "example.org");
await clickText("Hinzufügen");
await new Promise((r) => setTimeout(r, 300));
if (!(await exists("welche Seite des Leads gezeigt"))) throw new Error("Guard-Fehlertext fehlt!");
await shot("v4-05-guard-fehler");
await page.type('input[placeholder*="Karriereseite"]', "Karriereseite");
await clickText("Hinzufügen");
await waitScenesReady();
if (!(await exists("Karriereseite"))) throw new Error("Karriereseite-Tab fehlt!");
await shot("v4-06-karriereseite");

// ---- Bild-Szene ----
const [plus3] = await page.$$('[aria-label="Szene hinzufügen"]');
await plus3.click();
await page.waitForSelector("xpath/.//*[contains(text(),'Für alle gleich')]");
{
  const inputs = await page.$$('input[type="file"]');
  const mediaInput = inputs[inputs.length - 1];
  const [tile] = await page.$$("xpath/.//button[.//span[text()='Bild']]");
  await tile.click();
  await new Promise((r) => setTimeout(r, 200));
  await mediaInput.uploadFile("/tmp/test-image.png");
}
await waitScenesReady(180000);
console.log("image added");

// ---- Video-Szene ----
const [plus4] = await page.$$('[aria-label="Szene hinzufügen"]');
await plus4.click();
await page.waitForSelector("xpath/.//*[contains(text(),'Für alle gleich')]");
{
  const inputs = await page.$$('input[type="file"]');
  const mediaInput = inputs[inputs.length - 1];
  const [tile] = await page.$$("xpath/.//button[.//span[text()='Video']]");
  await tile.click();
  await new Promise((r) => setTimeout(r, 200));
  await mediaInput.uploadFile("/tmp/test-video.mp4");
}
await waitScenesReady(180000);
await shot("v4-07-alle-szenen");

// ---- Teleprompter-Toggle im Header ----
await clickText("Teleprompter");
await page.waitForSelector("textarea");
await page.type("textarea", "Hallo! Ich habe mir eure Website angeschaut und dabei ist mir aufgefallen, dass ihr aktuell viel Potenzial verschenkt. In diesem kurzen Video zeige ich euch drei konkrete Ideen.");
await shot("v4-08-teleprompter-regie");

// ---- Weiter → Technik-Check (Klick wiederholen, bis Phase wechselt) ----
for (let i = 0; i < 6; i++) {
  const btns = await page.$$("xpath/.//button[contains(., 'Weiter') and not(contains(., 'Ansicht'))]");
  if (btns.length) await btns[btns.length - 1].click().catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  if (await exists("Technik-Check")) break;
  if (i === 5) throw new Error("Technik-Check nicht erreicht");
}
await new Promise((r) => setTimeout(r, 1500));
await shot("v4-09-technik-check");

// ---- Weiter zur Aufnahme-Ansicht (Standby) ----
await clickText("Aufnahme-Ansicht");
await new Promise((r) => setTimeout(r, 1500));
await shot("v4-10-standby-hinweis");
if (!(await exists("Kurz bevor es losgeht"))) throw new Error("Standby-Hinweiskarte fehlt!");
await clickText("Alles klar");
await new Promise((r) => setTimeout(r, 500));
// Teleprompter ist standardmäßig aus → per Chip einblenden
await clickText("Teleprompter");
await new Promise((r) => setTimeout(r, 500));
await shot("v4-11-standby-prompter");

// ---- Aufnahme starten → live ----
await clickText("Aufnahme starten");
await new Promise((r) => setTimeout(r, 5500)); // Countdown + kurz live
await shot("v4-12-live");

// ---- Zur Video-Szene wechseln, Play klicken ----
await page.keyboard.press("5"); // 5. Szene = Video
await new Promise((r) => setTimeout(r, 800));
await shot("v4-13-live-video-standbild");
// Bunny-Transkodierung kann direkt nach dem Upload noch laufen →
// „Erneut versuchen" klicken, bis der Play-Button da ist (max ~2 min).
{
  let clicked = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    const [play] = await page.$$('[aria-label="Video abspielen"]');
    if (play) { await play.click(); clicked = true; break; }
    const [retryBtn] = await page.$$("xpath/.//button[contains(., 'Erneut versuchen')]");
    if (retryBtn) await retryBtn.click().catch(() => {});
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!clicked) throw new Error("Play-Button nie erschienen (Video-Transkodierung)");
  console.log("video play clicked");
}
await new Promise((r) => setTimeout(r, 2500));
await shot("v4-14-live-video-play");

// ---- Aufnahme beenden → Review ----
await clickText("Aufnahme beenden");
await new Promise((r) => setTimeout(r, 4000));
await shot("v4-15-review");

console.log("E2E DONE");
await browser.close();
