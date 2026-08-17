/* Repro: Klick auf "PowerPoint-Datei (Canva)" im Studio — öffnet der Datei-Dialog? */
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3000";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1512,982"],
  defaultViewport: { width: 1512, height: 900 },
});
const page = await browser.newPage();
page.setDefaultTimeout(60000);
page.on("console", (m) => {
  if (m.type() === "error") console.log("PAGE-ERROR:", m.text().slice(0, 300));
});

const clickText = async (text, tag = "button") => {
  const [el] = await page.$$(`xpath/.//${tag}[contains(., ${JSON.stringify(text)})]`);
  if (!el) throw new Error(`clickText: "${text}" nicht gefunden`);
  await el.click();
  return el;
};

await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
const [cookieBtn] = await page.$$("xpath/.//button[contains(., 'Nur notwendige')]");
if (cookieBtn) await cookieBtn.click();
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
for (let attempt = 0; attempt < 3; attempt++) {
  const email = await page.$('input[type="email"]');
  await email.click({ clickCount: 3 });
  await email.type("testuser@videocomet.de", { delay: 20 });
  const pw = await page.$('input[type="password"]');
  await pw.click({ clickCount: 3 });
  await pw.type("studio-test-2026", { delay: 20 });
  const typed = await page.evaluate(() => document.querySelector('input[type="email"]').value);
  if (!typed) { await new Promise((r) => setTimeout(r, 1000)); continue; }
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
if (noMore) { await noMore.click(); await new Promise((r) => setTimeout(r, 600)); }

await clickText("Studio öffnen");
await page.waitForSelector("xpath/.//*[contains(text(),'Neue Szene')]");
console.log("Regie offen");
await new Promise((r) => setTimeout(r, 800));

// Daniels Zustand nachstellen: erst eine Szene anlegen, dann über "+" in den Picker
await clickText("Eigene Webseite");
await page.waitForSelector('input[placeholder*="deine-firma"]');
await page.type('input[placeholder*="deine-firma"]', "videocomet.de");
await clickText("Hinzufügen");
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  const ready = (await page.$$("xpath/.//*[contains(text(),'Alle Szenen sind bereit')]")).length > 0;
  if (ready) break;
  const [retry] = await page.$$("xpath/.//button[contains(., 'Erneut versuchen')]");
  if (retry) await retry.click();
  await new Promise((r) => setTimeout(r, 1500));
}
console.log("Szene 1 bereit");
const [plus] = await page.$$('[aria-label="Szene hinzufügen"]');
await plus.click();
await page.waitForSelector("xpath/.//*[contains(text(),'Pro Lead personalisiert')]");
await new Promise((r) => setTimeout(r, 500));

// Test 1: PDF-Kachel (Vergleich)
let chooserOpened = false;
const t1 = page.waitForFileChooser({ timeout: 4000 }).then((fc) => { chooserOpened = true; return fc.cancel(); }).catch(() => {});
await clickText("PDF-Folien");
await t1;
console.log("PDF-Kachel → Datei-Dialog:", chooserOpened ? "JA" : "NEIN");

await new Promise((r) => setTimeout(r, 500));

// Test 2: Canva/PowerPoint-Kachel — Datei wirklich auswählen und Flow beobachten
page.on("requestfinished", (req) => {
  if (req.url().includes("/api/canva")) {
    console.log("NET:", req.method(), req.url().split("3000")[1], "→", req.response()?.status());
  }
});
const t2 = page.waitForFileChooser({ timeout: 4000 });
await clickText("PowerPoint-Datei (Canva)");
const fc = await t2;
await fc.accept(["/tmp/canva-test.pptx"]);
console.log("PPTX ausgewählt, warte auf Verarbeitung…");
const tWait = Date.now();
while (Date.now() - tWait < 150000) {
  const tabCount = (await page.$$("xpath/.//*[contains(text(),'Folie ')]")).length;
  const err = await page.evaluate(() => {
    const els = [...document.querySelectorAll("p,span,div")];
    const e = els.find((x) => x.className?.includes?.("danger") || x.className?.includes?.("red"));
    return e?.textContent?.slice(0, 200) ?? null;
  });
  if (err) { console.log("UI-FEHLER:", err); break; }
  if (tabCount > 0) { console.log("FOLIEN-TABS:", tabCount); break; }
  await new Promise((r) => setTimeout(r, 2000));
}
await page.screenshot({ path: "/tmp/canva-repro.png" });
await browser.close();
