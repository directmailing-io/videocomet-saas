/* Geräte-iframe-Test: Mobile-Layout korrekt + Inline-Editing im iframe. */
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

// Phone-Modus
await page.click('button[title="Smartphone"]');
await wait(2000);
await page.screenshot({ path: "/tmp/lp3-shots/g-01-phone-iframe.png" });

const frame = page
  .frames()
  .find((f) => f !== page.mainFrame() && f.parentFrame() === page.mainFrame());
console.log("IFRAME_FOUND:", !!frame);
if (!frame) process.exit(1);

// Mobile-Layout: Hero-Grid muss einspaltig sein (grid-cols-1 aktiv)
const layout = await frame.evaluate(() => {
  const grid = document.querySelector("section .grid");
  if (!grid) return "kein grid";
  return getComputedStyle(grid).gridTemplateColumns;
});
console.log("HERO_GRID_COLS:", layout);

// Inline-Editing im iframe: Headline fokussieren, tippen, Blur, API-Check
const h = await frame.$('[contenteditable="true"]');
console.log("EDITABLE_IN_IFRAME:", !!h);
if (h) {
  await frame.evaluate((el) => {
    el.scrollIntoView({ block: "center" });
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = el.ownerDocument.defaultView.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }, h);
  await wait(300);
  await page.keyboard.type(" IF9", { delay: 40 });
  await wait(300);
  await frame.evaluate((el) => el.blur(), h);
  await wait(1800);
  const saved = await page.evaluate(async (id) => {
    const res = await fetch(`/api/landing-page-templates/${id}`);
    const json = await res.json();
    const tpl = json.template ?? json;
    const hero = (tpl.content?.blocks ?? []).find((b) => b.type === "hero");
    return hero?.data?.headline ?? "";
  }, TEMPLATE);
  console.log("SAVED_IN_IFRAME:", JSON.stringify(saved));
}

// zurück auf Desktop + Screenshot
await page.click('button[title="Desktop"]');
await wait(1200);
await page.screenshot({ path: "/tmp/lp3-shots/g-02-back-desktop.png" });

await browser.close();
console.log("DONE");
