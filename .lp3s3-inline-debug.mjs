/* Gezielter Inline-Editing-Test: Fokus, Tippen, Commit, {{-Menü. */
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3000";
const TEMPLATE = "90374beb-364d-45e4-b413-2acc684c5622";

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

// Login
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
await wait(2000);
// Panel schließen falls offen
await page.keyboard.press("Escape");
await wait(300);

// Hero-Headline (erstes contenteditable im Canvas) anvisieren
const target = await page.evaluateHandle(() => {
  const els = [...document.querySelectorAll('[contenteditable="true"]')];
  return els.find((e) => e.closest("section")) ?? null;
});
const exists = await page.evaluate((el) => !!el, target);
console.log("EDITABLE_FOUND:", exists);
if (!exists) process.exit(1);

await page.evaluate(
  (el) => el.scrollIntoView({ block: "center" }),
  target,
);
await wait(600);
const before = await page.evaluate((el) => el.innerText, target);
console.log("BEFORE:", JSON.stringify(before));

const box = await target.asElement().boundingBox();
console.log("BOX:", JSON.stringify(box));
// ans Textende klicken
await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2);
await wait(500);
const focused = await page.evaluate(
  (el) => el === document.activeElement || el.contains(document.activeElement),
  target,
);
console.log("FOCUSED:", focused);
await page.screenshot({ path: "/tmp/lp3-shots/s3-11-fokus.png" });

// Ans Ende springen und tippen
await page.evaluate((el) => {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}, target);
await page.keyboard.type(" QA123", { delay: 30 });
await wait(300);
await page.screenshot({ path: "/tmp/lp3-shots/s3-12-getippt.png" });

// Blur → Commit
await page.evaluate(() => {
  const el = document.activeElement;
  if (el && el instanceof HTMLElement) el.blur();
});
await wait(1500);
const savedHeadline = await page.evaluate(async (id) => {
  const res = await fetch(`/api/landing-page-templates/${id}`);
  if (!res.ok) return `HTTP ${res.status}`;
  const json = await res.json();
  const tpl = json.template ?? json;
  const blocks = tpl.content?.blocks ?? [];
  const hero = blocks.find((b) => b.type === "hero");
  return hero?.data?.headline ?? "(kein hero)";
}, TEMPLATE);
console.log("SAVED_HEADLINE:", JSON.stringify(savedHeadline));

// {{-Menü: erneut fokussieren und {{ tippen
await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2);
await wait(400);
await page.evaluate((el) => {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}, target);
await page.keyboard.type("{{", { delay: 60 });
await wait(900);
await page.screenshot({ path: "/tmp/lp3-shots/s3-13-ph-menue.png" });
const menu = await page.evaluate(() =>
  /Vorname des Leads|Firma/.test(document.body.innerText),
);
console.log("PH_MENU:", menu);

// Platzhalter „Firma" wählen falls Menü da
if (menu) {
  const [item] = await page.$$(
    "xpath/.//*[self::button or self::li or self::div][contains(., 'Firma')][not(.//*[contains(., 'Firma')])]",
  );
  if (item) {
    await item.click();
    await wait(500);
    await page.screenshot({ path: "/tmp/lp3-shots/s3-14-chip-eingefuegt.png" });
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el && el instanceof HTMLElement) el.blur();
    });
    await wait(1500);
    const after = await page.evaluate(async (id) => {
      const res = await fetch(`/api/landing-page-templates/${id}`);
      const json = await res.json();
      const tpl = json.template ?? json;
      const hero = (tpl.content?.blocks ?? []).find((b) => b.type === "hero");
      return hero?.data?.headline ?? "";
    }, TEMPLATE);
    console.log("AFTER_CHIP:", JSON.stringify(after));
  } else {
    console.log("PH_ITEM: nicht gefunden");
  }
}

await browser.close();
console.log("DONE");
