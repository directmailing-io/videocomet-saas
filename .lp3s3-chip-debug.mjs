import puppeteer from "puppeteer-core";
const BASE = "http://localhost:3000";
const TEMPLATE = "90374beb-364d-45e4-b413-2acc684c5622";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1512,982"],
  defaultViewport: { width: 1512, height: 900 },
});
const page = await browser.newPage();
page.setDefaultTimeout(60000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await wait(1200);
const [cb] = await page.$$("xpath/.//button[contains(., 'Nur notwendige')]");
if (cb) await cb.click();
for (let a = 0; a < 3; a++) {
  const email = await page.$('input[type="email"]');
  await email.click({ clickCount: 3 });
  await email.type("testuser@videocomet.de", { delay: 20 });
  const pw = await page.$('input[type="password"]');
  await pw.click({ clickCount: 3 });
  await pw.type("studio-test-2026", { delay: 20 });
  const [btn] = await page.$$("xpath/.//button[contains(., 'Anmelden')]");
  await btn.click();
  try { await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 15000 }); break; } catch {}
}
await page.goto(`${BASE}/landingpages/${TEMPLATE}`, { waitUntil: "networkidle2" });
await wait(2000);
await page.keyboard.press("Escape");
await wait(300);
const target = await page.evaluateHandle(() => {
  const els = [...document.querySelectorAll('[contenteditable="true"]')];
  return els.find((e) => e.closest("section")) ?? null;
});
await page.evaluate((el) => el.scrollIntoView({ block: "center" }), target);
await wait(500);
const box = await target.asElement().boundingBox();
await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2);
await wait(400);
await page.evaluate((el) => {
  const r = document.createRange();
  r.selectNodeContents(el); r.collapse(false);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
}, target);
await page.keyboard.type(" {{", { delay: 60 });
await wait(900);
// Menü-Eintrag "Firma" anklicken: Element mit Text "Firma" im Menü suchen
const clicked = await page.evaluate(() => {
  const candidates = [...document.querySelectorAll("button, [role='option'], [role='menuitem'], li, div")]
    .filter((el) => el.childElementCount <= 2 && /^Firma/.test(el.textContent?.trim() ?? ""));
  const el = candidates[0];
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
console.log("MENU_ITEM:", JSON.stringify(clicked));
if (clicked) {
  await page.mouse.click(clicked.x, clicked.y);
  await wait(600);
  await page.screenshot({ path: "/tmp/lp3-shots/s3-14-chip-eingefuegt.png" });
  await page.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await wait(1500);
  const after = await page.evaluate(async (id) => {
    const res = await fetch(`/api/landing-page-templates/${id}`);
    const json = await res.json();
    const tpl = json.template ?? json;
    const hero = (tpl.content?.blocks ?? []).find((b) => b.type === "hero");
    return hero?.data?.headline ?? "";
  }, TEMPLATE);
  console.log("AFTER_CHIP:", JSON.stringify(after));
}
await browser.close();
console.log("DONE");
