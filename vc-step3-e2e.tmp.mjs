import puppeteer from "puppeteer-core";

const SESSION_ID = process.argv[2];
const CAMPAIGN = "29bf5df8-49a1-4cc4-870f-dd1202408482";
const BASE = "https://app.videocomet.de";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitText(page, text, timeout = 20000) {
  const upper = text.toUpperCase();
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await page.evaluate(
      (t) => document.body.innerText.toUpperCase().includes(t),
      upper,
    );
    if (found) return;
    await sleep(300);
  }
  throw new Error(`waitText timeout: ${text}`);
}

async function clickByText(page, text, tag = "button") {
  const handle = await page.evaluateHandle(
    (t, tg) => {
      const els = [...document.querySelectorAll(tg)];
      return els.find((el) => el.innerText.trim().includes(t)) ?? null;
    },
    text,
    tag,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`clickByText not found: ${text}`);
  await el.evaluate((n) => n.scrollIntoView({ block: "center" }));
  await sleep(200);
  const box = await el.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const browser = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
await page.setCookie({
  name: "videocomet_session",
  value: SESSION_ID,
  domain: "app.videocomet.de",
  path: "/",
  httpOnly: true,
  secure: true,
});

await page.goto(`${BASE}/kampagnen/${CAMPAIGN}/runs/neu`, {
  waitUntil: "networkidle2",
  timeout: 45000,
});
await waitText(page, "Adressliste");
await sleep(500);

// Step 1: Datei hochladen
const input = await page.$("input#lead-file");
if (!input) throw new Error("input#lead-file not found");
await input.uploadFile("/tmp/vc-step3/leads.csv");
await sleep(800);
await clickByText(page, "Datei einlesen");

// Step 2: Vorschau & Duplikate
await waitText(page, "Spalten erkannt", 30000);
await waitText(page, "Duplikate erkennen", 30000);
await sleep(1000);
await page.screenshot({
  path: "/tmp/vc-step3/step2-vorschau-duplikate.png",
  fullPage: true,
});

// Weiter → Step 3: Mapping
await clickByText(page, "Weiter");
await waitText(page, "Spalten zuweisen", 30000);
await sleep(2500);
await page.screenshot({
  path: "/tmp/vc-step3/step3-mapping.png",
  fullPage: true,
});

// Zurück-Navigation prüfen (Mapping → Vorschau)
await clickByText(page, "Zurück");
await waitText(page, "Duplikate erkennen", 15000);
console.log("BACK_NAV_OK");

await browser.close();
console.log("E2E_DONE");
