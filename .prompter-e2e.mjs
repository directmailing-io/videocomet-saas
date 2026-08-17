/* Teleprompter-v4-E2E: angedockt, Overlay-Toggle, Pfeiltasten-Tempo, Wheel-Scroll.
 * Aufruf: node .prompter-e2e.mjs  (Dev-Server auf :3000, System-Chrome) */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const SHOTS = "/tmp/prompter-shots";
const BASE = "http://localhost:3000";
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
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

const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 350));
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log("SHOT", name);
};
const clickText = async (text) => {
  const [el] = await page.$$(`xpath/.//button[contains(., ${JSON.stringify(text)})]`);
  if (!el) throw new Error(`clickText: "${text}" nicht gefunden`);
  await el.click();
  return el;
};
const exists = async (text) =>
  (await page.$$(`xpath/.//*[contains(text(), ${JSON.stringify(text)})]`)).length > 0;

// ---- Login via API (hydration-fest) ----
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
console.log("logged in:", page.url());
await new Promise((r) => setTimeout(r, 1200));
const [noMore] = await page.$$("xpath/.//button[contains(., 'Nicht mehr anzeigen')]");
if (noMore) { await noMore.click(); await new Promise((r) => setTimeout(r, 600)); }

// ---- Studio öffnen ----
await clickText("Studio öffnen");
await page.waitForSelector("xpath/.//*[contains(text(),'Neue Szene')]");

// ---- Eine simple Szene: Eigene Webseite ----
await clickText("Eigene Webseite");
await page.waitForSelector('input[placeholder*="deine-firma"]');
await page.type('input[placeholder*="deine-firma"]', "videocomet.de");
await clickText("Hinzufügen");
console.log("ownsite added");

const waitScenesReady = async (timeoutMs = 120000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await exists("Alle Szenen sind bereit")) return;
    const [retry] = await page.$$("xpath/.//button[contains(., 'Erneut versuchen')]");
    if (retry) { console.log("retry click"); await retry.click(); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Szenen nicht bereit (Timeout)");
};
await waitScenesReady();

// ---- Teleprompter-Text in der Regie eintragen ----
await clickText("Teleprompter");
await page.waitForSelector("textarea");
const SCRIPT_TEXT = Array.from({ length: 12 }, (_, i) =>
  `Absatz ${i + 1}: Hallo! Ich habe mir eure Website angeschaut und dabei ist mir aufgefallen, dass ihr aktuell viel Potenzial verschenkt.`
).join("\n\n");
await page.evaluate((txt) => {
  const ta = document.querySelector("textarea");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, txt);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}, SCRIPT_TEXT);
await new Promise((r) => setTimeout(r, 500));
console.log("script typed");

// ---- Weiter → Technik-Check → Aufnahme-Ansicht ----
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

// ---- Teleprompter einblenden (angedockt) ----
await clickText("Teleprompter");
await new Promise((r) => setTimeout(r, 800));
await shot("p1-angedockt");

// Steuerleiste prüfen: Tempo-Anzeige + Overlay-Button vorhanden?
const readSpeed = () =>
  page.evaluate(() => {
    const el = document.querySelector('span[title^="Tempo"]');
    return el?.textContent?.trim() ?? null;
  });
const overlayBtn = await page.$('[title^="Overlay:"]');
if (!overlayBtn) throw new Error("Overlay-Toggle-Button fehlt!");
const speedBefore = await readSpeed();
console.log("Tempo initial:", speedBefore);

// ---- Pfeiltasten ←/→: Tempo ----
await page.keyboard.press("ArrowRight");
await new Promise((r) => setTimeout(r, 300));
const speedUp = await readSpeed();
console.log("Tempo nach ArrowRight:", speedUp);
if (speedUp === speedBefore) throw new Error("ArrowRight ändert Tempo nicht!");
await page.keyboard.press("ArrowLeft");
await new Promise((r) => setTimeout(r, 300));
const speedDown = await readSpeed();
if (speedDown !== speedBefore) throw new Error("ArrowLeft setzt Tempo nicht zurück!");
console.log("Tempo nach ArrowLeft:", speedDown);

// ---- Pfeiltasten ↑/↓: zeilenweise scrollen ----
const readTransform = () =>
  page.evaluate(() => {
    const el = document.querySelector(".will-change-transform");
    return el ? el.style.transform : null;
  });
const tBefore = await readTransform();
await page.keyboard.press("ArrowDown");
await new Promise((r) => setTimeout(r, 300));
const tDown = await readTransform();
console.log("transform nach ArrowDown:", tBefore, "→", tDown);
if (tDown === tBefore) throw new Error("ArrowDown scrollt nicht zeilenweise!");
await page.keyboard.press("ArrowUp");
await new Promise((r) => setTimeout(r, 300));
const tUp = await readTransform();
if (tUp !== "translateY(0px)" && tUp === tDown)
  throw new Error("ArrowUp scrollt nicht zurück!");
console.log("transform nach ArrowUp:", tUp);

// ---- Zeilenanzahl einstellbar ----
const readViewportHeight = () =>
  page.evaluate(() => {
    const el = document.querySelector(".will-change-transform")?.parentElement;
    return el ? el.getBoundingClientRect().height : null;
  });
const hBefore = await readViewportHeight();
const [moreLines] = await page.$$('[aria-label="Mehr Zeilen anzeigen"]');
if (!moreLines) throw new Error("Zeilen-Button fehlt!");
await moreLines.click();
await new Promise((r) => setTimeout(r, 400));
const hAfter = await readViewportHeight();
console.log("Prompter-Höhe:", hBefore, "→", hAfter);
if (!(hAfter > hBefore)) throw new Error("Mehr Zeilen erhöht Fenster nicht!");
const linesPersisted = await page.evaluate(() =>
  localStorage.getItem("vc-prompter-lines"));
console.log("vc-prompter-lines:", linesPersisted);
if (linesPersisted !== "5") throw new Error("Zeilen-Persistenz fehlt!");
const [fewerLines] = await page.$$('[aria-label="Weniger Zeilen anzeigen"]');
await fewerLines.click();
await new Promise((r) => setTimeout(r, 300));
await shot("p1b-zeilen");

// ---- Wheel-Scroll auf dem Prompter (manuell scrollen) ----
const contentEl = await page.$(".will-change-transform");
if (!contentEl) throw new Error("Prompter-Content nicht gefunden!");
const box = await contentEl.boundingBox();
const cx = box.x + box.width / 2;
const cy = Math.min(box.y + 60, 890);
const offsetBefore = await page.evaluate(() => {
  const el = document.querySelector(".will-change-transform");
  return el ? el.style.transform : null;
});
await page.mouse.move(cx, cy);
await page.mouse.wheel({ deltaY: 240 });
await new Promise((r) => setTimeout(r, 400));
const offsetAfter = await page.evaluate(() => {
  const el = document.querySelector(".will-change-transform");
  return el ? el.style.transform : null;
});
console.log("transform vor/nach Wheel:", offsetBefore, "→", offsetAfter);
if (offsetBefore === offsetAfter) throw new Error("Wheel-Scroll bewegt Prompter nicht!");
await shot("p2-nach-wheel");

// ---- Overlay-Modus aktivieren ----
await overlayBtn.click();
await new Promise((r) => setTimeout(r, 800));
await shot("p3-overlay");
const overlayActive = await page.evaluate(() =>
  localStorage.getItem("vc-prompter-overlay"));
console.log("localStorage vc-prompter-overlay:", overlayActive);
if (overlayActive !== "1") throw new Error("Overlay-Persistenz fehlt!");
// Im Overlay muss der Wrapper klick-durchlässig sein
const overlayPointer = await page.evaluate(() => {
  const el = document.querySelector(".will-change-transform")?.closest(".pointer-events-none");
  return Boolean(el);
});
if (!overlayPointer) throw new Error("Overlay-Wrapper nicht pointer-events-none!");

// Overlay wieder aus
const dockBtn = await page.$('[title^="Andocken:"]');
if (!dockBtn) throw new Error("Andocken-Button fehlt im Overlay!");
await dockBtn.click();
await new Promise((r) => setTimeout(r, 500));
await shot("p4-wieder-angedockt");

// ---- Persistenz Tempo/Schriftgröße ----
const persisted = await page.evaluate(() => ({
  speed: localStorage.getItem("vc-prompter-speed"),
  font: localStorage.getItem("vc-prompter-font"),
  overlay: localStorage.getItem("vc-prompter-overlay"),
}));
console.log("persistiert:", JSON.stringify(persisted));

console.log("PROMPTER-E2E OK");
await browser.close();
