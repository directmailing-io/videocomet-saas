/* Bild 19/20: Wizard-Schritt-1-Texte, Studio-Erstnutzer-Steps und
 * fokussierte URL-Formular-Ansicht in der Regie.
 * Aufruf: node .regie-e2e.mjs  (Dev-Server auf :3000, System-Chrome) */
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
console.log("logged in");

// ---- Wizard Schritt 1: neue Karten-Texte ----
await page.goto(`${BASE}/kampagnen/neu`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));
const [noMore] = await page.$$(
  "xpath/.//button[contains(., 'Nicht mehr anzeigen')]",
);
if (noMore) {
  await noMore.click();
  await new Promise((r) => setTimeout(r, 600));
}
await shot("regie-01-wizard-karten");
const cardTexts = await page.evaluate(() => ({
  studio: document.body.innerText.includes("Alles in einem Rutsch"),
  classic: document.body.innerText.includes("Bildschirm-Szenen baust du danach"),
}));
console.log("wizard-texte:", cardTexts);

// ---- Studio: Erstnutzer-Steps ----
await clickText("Studio öffnen");
await page.waitForSelector("xpath/.//*[contains(text(),'Willkommen im Studio')]");
await new Promise((r) => setTimeout(r, 800));
await shot("regie-02-willkommen-steps");
const steps = await page.evaluate(() => ({
  s1: document.body.innerText.includes("Szenen vorbereiten"),
  s2: document.body.innerText.includes("Einmal aufnehmen"),
  s3: document.body.innerText.includes("Kein Schnitt nötig"),
  cta: document.body.innerText.includes("Womit soll dein Video starten?"),
}));
console.log("steps:", steps);

// ---- Fokussierte Formular-Ansicht ----
await clickText("Website des Leads");
await new Promise((r) => setTimeout(r, 600));
await shot("regie-03-fokus-formular");
const focus = await page.evaluate(() => ({
  back: document.body.innerText.includes("Zurück zur Auswahl"),
  tilesHidden: !document.body.innerText.includes("PowerPoint-Datei (Canva)"),
  input: !!document.querySelector("form input[type='text']"),
}));
console.log("fokus:", focus);

// Zurück-Link → Kacheln wieder da
await clickText("Zurück zur Auswahl");
await new Promise((r) => setTimeout(r, 600));
const backOk = await page.evaluate(() =>
  document.body.innerText.includes("PowerPoint-Datei (Canva)"),
);
console.log("zurueck zu kacheln:", backOk);
await shot("regie-04-zurueck-kacheln");

await browser.close();
console.log("DONE");
