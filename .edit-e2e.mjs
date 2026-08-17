/* Bearbeiten-Redesign + Canva-Kachel: Screenshots der neuen Tab-Ansicht
 * und der Studio-Regie mit PowerPoint-Kachel.
 * Aufruf: node .edit-e2e.mjs  (Dev-Server auf :3000, System-Chrome) */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const SHOTS = "/tmp/edit-shots";
const BASE = "http://localhost:3000";
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1512,982"],
  defaultViewport: { width: 1512, height: 900 },
});
const page = await browser.newPage();
page.setDefaultTimeout(60000);

const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log("SHOT", name);
};
const clickText = async (text, tag = "button") => {
  const [el] = await page.$$(
    `xpath/.//${tag}[contains(., ${JSON.stringify(text)})]`,
  );
  if (!el) throw new Error(`clickText: "${text}" nicht gefunden`);
  await el.click();
  return el;
};

// ---- Login ----
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
const [cookieBtn] = await page.$$(
  "xpath/.//button[contains(., 'Nur notwendige')]",
);
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
  if (!typed) {
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }
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

// ---- Kampagne finden ----
await page.goto(`${BASE}/kampagnen`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));
const [noMore] = await page.$$(
  "xpath/.//button[contains(., 'Nicht mehr anzeigen')]",
);
if (noMore) {
  await noMore.click();
  await new Promise((r) => setTimeout(r, 600));
}
const campaignId = await page.evaluate(() => {
  const a = Array.from(document.querySelectorAll("a[href^='/kampagnen/']")).find(
    (el) => /\/kampagnen\/[0-9a-f-]{36}/.test(el.getAttribute("href") ?? ""),
  );
  return a ? a.getAttribute("href").split("/")[2] : null;
});
if (!campaignId) throw new Error("Keine Kampagne gefunden");
console.log("campaign:", campaignId);

// ---- Bearbeiten-Seite: 3 Tabs ----
await page.goto(`${BASE}/kampagnen/${campaignId}/bearbeiten`, {
  waitUntil: "networkidle2",
});
await new Promise((r) => setTimeout(r, 1200));
await shot("edit-01-video-tab");
await clickText("Landingpage");
await shot("edit-02-landingpage-tab");
await clickText("PDF-Brief");
await shot("edit-03-brief-tab");
// Scrollen für Vorschaubild-Karte
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await shot("edit-04-brief-tab-unten");

// ---- Studio-Regie: Canva-Kachel ----
await page.goto(`${BASE}/kampagnen/neu`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));
const [noMore2] = await page.$$(
  "xpath/.//button[contains(., 'Nicht mehr anzeigen')]",
);
if (noMore2) {
  await noMore2.click();
  await new Promise((r) => setTimeout(r, 600));
}
await clickText("Studio öffnen");
await page.waitForSelector("xpath/.//*[contains(text(),'Neue Szene')]");
await new Promise((r) => setTimeout(r, 800));
await shot("edit-05-studio-regie-canva-kachel");
const hasCanva = await page.evaluate(() =>
  document.body.innerText.includes("PowerPoint-Datei (Canva)"),
);
console.log("canva-kachel sichtbar:", hasCanva);

await browser.close();
console.log("DONE");
