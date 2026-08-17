/* Etappe 3: Canvas-Builder. Aufruf: node .lp3s3-e2e.mjs (Dev-Server :3000) */
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
const shot = async (name) => {
  await wait(600);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log("SHOT", name);
};

// ---- Login ----
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
  } catch {
    console.log("login retry", attempt + 1);
  }
}
if (page.url().includes("/login")) throw new Error("Login fehlgeschlagen");
console.log("logged in");

// ---- Builder öffnen ----
await page.goto(`${BASE}/landingpages/${TEMPLATE}`, {
  waitUntil: "networkidle2",
});
await wait(2000);
await shot("s3-01-builder-desktop");

// ---- Hover über ersten Block → Toolbar ----
const firstSection = await page.$("section");
if (firstSection) {
  const box = await firstSection.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(80, box.height / 2));
    await wait(600);
    await shot("s3-02-hover-toolbar");
  }
}

// ---- Klick auf Hero → Kontext-Panel ----
await page.evaluate(() => {
  const s = document.querySelector("section");
  s?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await wait(1000);
await shot("s3-03-kontext-panel");

// ---- Kontext-Panel schließen (Klick daneben) ----
await page.mouse.click(200, 450);
await wait(600);

// ---- "+"-Linie → Galerie ----
const plusButtons = await page.$$('button[title*="hinzufügen"], button[aria-label*="hinzufügen"]');
console.log("PLUS_BUTTONS:", plusButtons.length);
if (plusButtons.length > 0) {
  await plusButtons[plusButtons.length - 1].click();
} else {
  // Fallback: irgendein Button mit "+"-Text
  const [plus] = await page.$$("xpath/.//button[normalize-space(.)='+']");
  if (plus) await plus.click();
}
await wait(1000);
await shot("s3-04-galerie");
const galleryText = await page.evaluate(() => document.body.innerText);
console.log("GALERIE_GRUPPEN:", ["Überzeugen", "Erklären", "Abschluss"].map(
  (g) => `${g}=${galleryText.includes(g)}`,
).join(" "));

// Galerie schließen
await page.keyboard.press("Escape");
await wait(600);

// ---- Inline-Editing: Klick in Hero-Headline, tippen ----
const headlineInfo = await page.evaluate(() => {
  const h = document.querySelector("section h1, section h2");
  if (!h) return null;
  const ed = h.querySelector('[contenteditable="true"]') ??
    (h.getAttribute("contenteditable") === "true" ? h : null);
  const r = (ed ?? h).getBoundingClientRect();
  return { hasEditable: !!ed, x: r.x + 20, y: r.y + r.height / 2 };
});
console.log("HEADLINE_EDITABLE:", JSON.stringify(headlineInfo));
if (headlineInfo?.hasEditable) {
  await page.mouse.click(headlineInfo.x, headlineInfo.y);
  await wait(500);
  await shot("s3-05-inline-fokus");
  await page.keyboard.type(" NEU", { delay: 30 });
  await wait(300);
  // Blur → Commit
  await page.mouse.click(200, 700);
  await wait(1500);
  const committed = await page.evaluate(() =>
    document.body.innerText.includes("NEU"),
  );
  console.log("INLINE_COMMIT:", committed);
  await shot("s3-06-inline-getippt");
}

// ---- {{-Menü testen ----
if (headlineInfo?.hasEditable) {
  await page.mouse.click(headlineInfo.x, headlineInfo.y);
  await wait(400);
  await page.keyboard.type("{{", { delay: 50 });
  await wait(800);
  await shot("s3-07-platzhalter-menue");
  const menuVisible = await page.evaluate(() =>
    /Vorname|Firma/.test(document.body.innerText),
  );
  console.log("PH_MENU:", menuVisible);
  await page.keyboard.press("Escape");
  await page.mouse.click(200, 700);
  await wait(500);
}

// ---- Beispiel-Lead-Modus ----
const [sampleBtn] = await page.$$(
  "xpath/.//button[contains(., 'Beispiel-Lead')]",
);
if (sampleBtn) {
  await sampleBtn.click();
  await wait(800);
  await shot("s3-08-beispiel-lead");
  await sampleBtn.click();
  await wait(400);
}

// ---- Geräte-Umschalter: Smartphone ----
const phoneBtn = await page.$('button[title="Smartphone"]');
if (phoneBtn) {
  await phoneBtn.click();
  await wait(1000);
  await shot("s3-09-geraet-phone");
}
const tabletBtn = await page.$('button[title="Tablet"]');
if (tabletBtn) {
  await tabletBtn.click();
  await wait(800);
  await shot("s3-10-geraet-tablet");
}
const desktopBtn = await page.$('button[title="Desktop"]');
if (desktopBtn) await desktopBtn.click();
await wait(600);

// ---- Auto-Save-Status ----
const saveText = await page.evaluate(() => {
  const el = document.querySelector("header");
  return el ? el.innerText : "";
});
console.log("TOPBAR:", JSON.stringify(saveText.replace(/\n/g, " | ")));

await wait(2000);
await browser.close();
console.log("DONE");
