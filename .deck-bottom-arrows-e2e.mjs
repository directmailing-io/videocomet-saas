/* E2E: Untere Detail-Pfeile navigieren Folien im Deck (statt still umzusortieren) */
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3000";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  defaultViewport: { width: 1512, height: 900 },
});
const page = await browser.newPage();
page.setDefaultTimeout(60000);

const clickText = async (text, tag = "button") => {
  const [el] = await page.$$(`xpath/.//${tag}[contains(., ${JSON.stringify(text)})]`);
  if (!el) throw new Error(`clickText: "${text}" nicht gefunden`);
  await el.click();
};

await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));
const [cookieBtn] = await page.$$("xpath/.//button[contains(., 'Nur notwendige')]");
if (cookieBtn) await cookieBtn.click();
await page.waitForSelector('input[type="email"]');
for (let attempt = 0; attempt < 3; attempt++) {
  const email = await page.$('input[type="email"]');
  await email.click({ clickCount: 3 });
  await email.type("testuser@videocomet.de", { delay: 15 });
  const pw = await page.$('input[type="password"]');
  await pw.click({ clickCount: 3 });
  await pw.type("studio-test-2026", { delay: 15 });
  await clickText("Anmelden");
  try {
    await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 15000 });
    break;
  } catch { console.log("login retry", attempt + 1); }
}
if (page.url().includes("/login")) throw new Error("Login fehlgeschlagen");
console.log("logged in");

await page.goto(`${BASE}/kampagnen/neu`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));
const [noMore] = await page.$$("xpath/.//button[contains(., 'Nicht mehr anzeigen')]");
if (noMore) { await noMore.click(); await new Promise((r) => setTimeout(r, 500)); }

await clickText("Studio öffnen");
await page.waitForSelector("xpath/.//*[contains(text(),'Neue Szene')]");
await new Promise((r) => setTimeout(r, 600));

// PPTX-Deck (3 Folien) hochladen
const fcP = page.waitForFileChooser({ timeout: 5000 });
await clickText("PowerPoint-Datei (Canva)");
const fc = await fcP;
await fc.accept(["/tmp/canva-test.pptx"]);
console.log("PPTX gewählt, warte auf Deck…");

const detailText = () =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll("span")];
    return els.find((e) => e.textContent?.startsWith("Szene "))?.textContent?.replace(/\s+/g, " ").trim() ?? null;
  });

const t0 = Date.now();
let detail = null;
while (Date.now() - t0 < 120000) {
  detail = await detailText();
  if (detail && detail.includes("Folie")) break;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log("DETAIL START:", detail);
const m = detail?.match(/Folie (\d+) von (\d+)/);
if (!m || m[1] !== "1") throw new Error("Deck-Detailzeile nicht gefunden");
const total = Number(m[2]);
if (total < 2) throw new Error("Test-Deck braucht mindestens 2 Folien");

// Untere Pfeile: Sie sind das ZWEITE Paar mit den Folie-Labels (erstes sitzt im Tab).
const bottomArrow = async (label) => {
  const els = await page.$$(`[aria-label="${label}"]`);
  if (els.length < 2) throw new Error(`Unterer Pfeil "${label}" fehlt (nur ${els.length} gefunden)`);
  return els[els.length - 1];
};

await (await bottomArrow("Nächste Folie")).click();
await new Promise((r) => setTimeout(r, 400));
const afterNext = await detailText();
console.log("nach 1× ▶ unten:", afterNext);
if (!afterNext?.includes(`Folie 2 von ${total}`)) throw new Error("▶ unten navigiert nicht zur Folie 2");

await (await bottomArrow("Vorherige Folie")).click();
await new Promise((r) => setTimeout(r, 400));
const afterBack = await detailText();
console.log("nach 1× ◀ unten:", afterBack);
if (!afterBack?.includes(`Folie 1 von ${total}`)) throw new Error("◀ unten navigiert nicht zurück zur Folie 1");

// Löschen-Knopf unten heißt beim Deck jetzt „Folie löschen"
const hasFolieDelete = await page.$('[aria-label="Folie löschen"]');
console.log("Folie-löschen-Button vorhanden:", !!hasFolieDelete);

await page.screenshot({ path: "/tmp/deck-bottom-arrows.png" });
console.log("OK — SCREENSHOT /tmp/deck-bottom-arrows.png");
await browser.close();
