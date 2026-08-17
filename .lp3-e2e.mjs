/* Etappe 1: Landingpage-Wizard (/landingpages/neu) + Styleguide-Panel im Editor.
 * Aufruf: node .lp3-e2e.mjs  (Dev-Server auf :3000, System-Chrome) */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const SHOTS = "/tmp/lp3-shots";
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
  await new Promise((r) => setTimeout(r, 500));
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

// ---- Listen-Seite: Neue Vorlage → /landingpages/neu ----
await page.goto(`${BASE}/landingpages`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1000));
await shot("lp3-01-liste");
await page.goto(`${BASE}/landingpages/neu`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 800));
await shot("lp3-02-wizard-einstieg");

// ---- Weg B: Eigenen Look wählen ----
await clickText("Eigenen Look");
await new Promise((r) => setTimeout(r, 800));
await shot("lp3-03-wizard-manuell");

// Radius-Stufe "Rund" + dunklen Modus testen, wenn sichtbar
const pageText = await page.evaluate(() => document.body.innerText);
console.log("WIZARD_HAS_FARBEN:", pageText.includes("Farben"));
console.log("WIZARD_HAS_SCHRIFT:", pageText.includes("Schrift"));
console.log("WIZARD_HAS_FORM:", pageText.includes("Form"));

// Vorlage anlegen (Button-Text im Wizard finden)
const createBtn = "Landingpage erstellen";
console.log("CREATE_BTN:", createBtn);
if (createBtn) {
  await clickText(createBtn);
  await page.waitForFunction(
    () => /\/landingpages\/[0-9a-f-]{36}/.test(location.pathname),
    { timeout: 20000 },
  );
  await new Promise((r) => setTimeout(r, 1500));
  await shot("lp3-04-editor-startseite");

  // ---- Styleguide-Panel ----
  await clickText("Styleguide");
  await new Promise((r) => setTimeout(r, 800));
  await shot("lp3-05-styleguide-panel");
  const panelText = await page.evaluate(() => document.body.innerText);
  for (const k of ["Logo", "Farben", "Schrift", "Form", "Tiefe"]) {
    console.log(`PANEL_${k}:`, panelText.includes(k));
  }
  // Dunkel-Modus umschalten, wenn Schalter existiert
  const [darkBtn] = await page.$$(
    "xpath/.//button[contains(., 'Dunkel')]",
  );
  if (darkBtn) {
    await darkBtn.click();
    await new Promise((r) => setTimeout(r, 1000));
    await shot("lp3-06-dunkel");
  } else {
    console.log("DARK_SWITCH: nicht gefunden");
  }
}

await browser.close();
console.log("DONE");
