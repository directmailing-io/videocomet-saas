/* Finale Abnahme: Panel zu beim Laden, saubere Headline, Geräte, Beispiel-Lead. */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const SHOTS = "/tmp/lp3-shots";
const BASE = "http://localhost:3000";
const TEMPLATE = "90374beb-364d-45e4-b413-2acc684c5622";
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
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await wait(1200);
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
  const [btn] = await page.$$("xpath/.//button[contains(., 'Anmelden')]");
  await btn.click();
  try {
    await page.waitForFunction(() => !location.pathname.startsWith("/login"), {
      timeout: 15000,
    });
    break;
  } catch {}
}
console.log("logged in");

await page.goto(`${BASE}/landingpages/${TEMPLATE}`, {
  waitUntil: "networkidle2",
});
await wait(2500);
await page.screenshot({ path: `${SHOTS}/f-01-initial.png` });

// Panel darf beim Laden NICHT offen sein
const panelOpen = await page.evaluate(() =>
  document.body.innerText.includes("Sektion entfernen"),
);
const headlineClean = await page.evaluate(
  () => !document.body.innerText.includes("QA123"),
);
console.log("PANEL_CLOSED_ON_LOAD:", !panelOpen);
console.log("HEADLINE_CLEAN:", headlineClean);

// Klick auf Hero → Panel öffnet
await page.evaluate(() => {
  document
    .querySelector("section")
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await wait(900);
const panelAfterClick = await page.evaluate(() =>
  document.body.innerText.includes("Sektion entfernen"),
);
console.log("PANEL_OPENS_ON_CLICK:", panelAfterClick);
await page.screenshot({ path: `${SHOTS}/f-02-panel.png` });
await page.keyboard.press("Escape");
const [closeBtn] = await page.$$('button[aria-label*="schließen"], button[aria-label*="Schließen"]');
if (closeBtn) await closeBtn.click();
await wait(500);

// Beispiel-Lead-Modus
const [sampleBtn] = await page.$$(
  "xpath/.//button[contains(., 'Beispiel-Lead')]",
);
if (sampleBtn) {
  await sampleBtn.click();
  await wait(900);
  await page.screenshot({ path: `${SHOTS}/f-03-beispiel-lead.png` });
  const hasSample = await page.evaluate(
    () => !document.querySelector('[data-ph-key]'),
  );
  console.log("SAMPLE_NO_CHIPS:", hasSample);
  await sampleBtn.click();
  await wait(500);
}

// Geräte
for (const [title, name] of [
  ["Smartphone", "f-04-phone"],
  ["Tablet", "f-05-tablet"],
  ["Smartphone quer", "f-06-phone-quer"],
]) {
  const btn = await page.$(`button[title="${title}"]`);
  if (btn) {
    await btn.click();
    await wait(900);
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
    console.log("SHOT", name);
  } else {
    console.log("MISSING_DEVICE_BTN:", title);
  }
}

await browser.close();
console.log("DONE");
