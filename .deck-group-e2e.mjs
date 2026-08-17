/* E2E: Canva-Deck erscheint als EIN Tab mit Folien-Navigation ◀ x/y ▶ */
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

// Erst eine normale Szene, damit die Gruppen-Nummerierung sichtbar prüfbar ist
await clickText("Eigene Webseite");
await page.waitForSelector('input[placeholder*="deine-firma"]');
await page.type('input[placeholder*="deine-firma"]', "videocomet.de");
await clickText("Hinzufügen");
await new Promise((r) => setTimeout(r, 1500));

// Neuer Tab → Canva-PPTX (3 Folien)
const [plus] = await page.$$('[aria-label="Szene hinzufügen"]');
await plus.click();
await page.waitForSelector("xpath/.//*[contains(text(),'Pro Lead personalisiert')]");
const fcP = page.waitForFileChooser({ timeout: 5000 });
await clickText("PowerPoint-Datei (Canva)");
const fc = await fcP;
await fc.accept(["/tmp/canva-test.pptx"]);
console.log("PPTX gewählt, warte auf Deck-Tab…");

const t0 = Date.now();
let deckInfo = null;
while (Date.now() - t0 < 120000) {
  deckInfo = await page.evaluate(() => {
    const bar = document.querySelector('[aria-label="Szene hinzufügen"]')?.parentElement;
    if (!bar) return null;
    const entries = [...bar.children].map((el) => el.textContent?.replace(/\s+/g, " ").trim());
    const slideCounter = bar.querySelector('[aria-label="Nächste Folie"]');
    return { entries, hasArrows: !!slideCounter };
  });
  if (deckInfo?.hasArrows) break;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log("TAB-LEISTE:", JSON.stringify(deckInfo));
if (!deckInfo?.hasArrows) throw new Error("Kein Deck-Tab mit Pfeilen gefunden");

// ▶ zweimal klicken → 3/3, ◀ → 2/3
const next = await page.$('[aria-label="Nächste Folie"]');
await next.click();
await new Promise((r) => setTimeout(r, 400));
await next.click();
await new Promise((r) => setTimeout(r, 400));
let counter = await page.evaluate(() => document.querySelector('[aria-label="Nächste Folie"]')?.previousElementSibling?.textContent);
console.log("nach 2× ▶:", counter);
const prev = await page.$('[aria-label="Vorherige Folie"]');
await prev.click();
await new Promise((r) => setTimeout(r, 400));
counter = await page.evaluate(() => document.querySelector('[aria-label="Nächste Folie"]')?.previousElementSibling?.textContent);
console.log("nach 1× ◀:", counter);

// Detail-Kopfzeile prüfen
const header = await page.evaluate(() => {
  const els = [...document.querySelectorAll("span")];
  return els.find((e) => e.textContent?.startsWith("Szene "))?.textContent;
});
console.log("DETAIL:", header);

await page.screenshot({ path: "/tmp/deck-group-regie.png" });
console.log("SCREENSHOT /tmp/deck-group-regie.png");
await browser.close();
