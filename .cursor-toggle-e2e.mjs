/* E2E: Mauszeiger-Toggle im Live-Standby — default aktiv, Wahl wird gemerkt. */
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3000";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--window-size=1512,982",
    "--autoplay-policy=no-user-gesture-required",
  ],
  defaultViewport: { width: 1512, height: 900 },
});
const page = await browser.newPage();
page.setDefaultTimeout(60000);

const clickText = async (text) => {
  const [el] = await page.$$(`xpath/.//button[contains(., ${JSON.stringify(text)})]`);
  if (!el) throw new Error(`clickText: "${text}" nicht gefunden`);
  await el.click();
};
const exists = async (text) =>
  (await page.$$(`xpath/.//*[contains(text(), ${JSON.stringify(text)})]`)).length > 0;

await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await page.evaluate(async () => {
  await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "testuser@videocomet.de",
      password: "studio-test-2026",
      expectedRole: "user",
    }),
  });
});
await page.goto(`${BASE}/kampagnen/neu`, { waitUntil: "networkidle2" });
if (page.url().includes("/login")) throw new Error("Login fehlgeschlagen");
await new Promise((r) => setTimeout(r, 1200));
const [noMore] = await page.$$("xpath/.//button[contains(., 'Nicht mehr anzeigen')]");
if (noMore) { await noMore.click(); await new Promise((r) => setTimeout(r, 600)); }

await clickText("Studio öffnen");
await page.waitForSelector("xpath/.//*[contains(text(),'Neue Szene')]");
const fcP = page.waitForFileChooser({ timeout: 5000 });
await clickText("PowerPoint-Datei (Canva)");
const fc = await fcP;
await fc.accept(["/tmp/canva-test.pptx"]);

const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  if (await exists("Alle Szenen sind bereit")) break;
  const [retry] = await page.$$("xpath/.//button[contains(., 'Erneut versuchen')]");
  if (retry) await retry.click();
  await new Promise((r) => setTimeout(r, 1500));
}

for (let i = 0; i < 6; i++) {
  const btns = await page.$$("xpath/.//button[contains(., 'Weiter') and not(contains(., 'Ansicht'))]");
  if (btns.length) await btns[btns.length - 1].click().catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  if (await exists("Technik-Check")) break;
  if (i === 5) throw new Error("Technik-Check nicht erreicht");
}
await new Promise((r) => setTimeout(r, 1500));
await clickText("Aufnahme-Ansicht");
await new Promise((r) => setTimeout(r, 1500));
if (await exists("Kurz bevor es losgeht")) {
  await clickText("Alles klar");
  await new Promise((r) => setTimeout(r, 500));
}

const readToggle = () =>
  page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Mauszeiger"),
    );
    if (!btn) return null;
    return {
      active: btn.className.includes("bg-brand-soft"),
      title: btn.getAttribute("title"),
      stored: localStorage.getItem("vc-studio-cursor"),
    };
  });

let state = await readToggle();
console.log("initial:", JSON.stringify(state));
if (!state) throw new Error("Mauszeiger-Toggle fehlt!");
if (!state.active) throw new Error("Toggle sollte standardmäßig aktiv sein");

await clickText("Mauszeiger");
await new Promise((r) => setTimeout(r, 400));
state = await readToggle();
console.log("nach 1. Klick:", JSON.stringify(state));
if (state.active || state.stored !== "0") throw new Error("Abschalten wird nicht gespeichert");

await clickText("Mauszeiger");
await new Promise((r) => setTimeout(r, 400));
state = await readToggle();
console.log("nach 2. Klick:", JSON.stringify(state));
if (!state.active || state.stored !== "1") throw new Error("Einschalten wird nicht gespeichert");

await page.screenshot({ path: "/tmp/cursor-toggle.png" });
console.log("OK — SCREENSHOT /tmp/cursor-toggle.png");
await browser.close();
