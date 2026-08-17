/* Etappe 2: Varianten-Umschalter im Editor + öffentliche Seite (Sticky-CTA,
 * Formular-CTA). Aufruf: node .lp3s2-e2e.mjs (Dev-Server auf :3000) */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const SHOTS = "/tmp/lp3-shots";
const BASE = "http://localhost:3000";
const TEMPLATE = "90374beb-364d-45e4-b413-2acc684c5622";
const LEAD_SLUG = "juergen-weber-6e58";
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await wait(600);
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
await wait(1500);
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

// ---- Editor: Hero auf "Geteilt" umschalten ----
await page.goto(`${BASE}/landingpages/${TEMPLATE}`, {
  waitUntil: "networkidle2",
});
await wait(1500);
// Hero-Block in der Mittel-Spalte anwählen (Liste links: erster Eintrag)
await clickText("Hero", "*[self::button or self::div][@role or self::button]").catch(
  async () => {
    const [el] = await page.$$("xpath/.//*[contains(text(), 'Hero')]");
    if (el) await el.click();
  },
);
await wait(600);
const layoutLabels = await page.evaluate(() =>
  [...document.querySelectorAll("button")]
    .map((b) => b.innerText.trim())
    .filter((t) =>
      ["Zentriert", "Geteilt", "Geteilt (gespiegelt)"].includes(t),
    ),
);
console.log("HERO_LAYOUT_BUTTONS:", JSON.stringify(layoutLabels));
if (layoutLabels.includes("Geteilt")) {
  const [btn] = await page.$$("xpath/.//button[normalize-space(.)='Geteilt']");
  await btn.click();
  await wait(1200);
  await shot("s2-01-hero-geteilt");
}

// ---- CTA-Banner auf "Formular" umschalten ----
{
  const [item] = await page.$$(
    "xpath/.//*[normalize-space(text())='CTA-Banner']",
  );
  if (!item) throw new Error("CTA-Banner-Listeneintrag fehlt");
  await item.click();
}
await wait(800);
const [formBtn] = await page.$$(
  "xpath/.//button[normalize-space(.)='Formular']",
);
if (!formBtn) throw new Error("Formular-Varianten-Button fehlt");
await formBtn.click();
await wait(1500);
await shot("s2-02-cta-formular");

// ---- Fallstudie hinzufügen ----
await clickText("Block hinzufügen");
await wait(500);
{
  const [item] = await page.$$(
    "xpath/.//*[normalize-space(text())='Fallstudie']",
  );
  if (!item) throw new Error("Fallstudie im Hinzufügen-Menü fehlt");
  await item.click();
}
await wait(1200);
await shot("s2-03-fallstudie");

// Auto-Save abwarten
await wait(2500);

// ---- Öffentliche Seite (Desktop) ----
await page.goto(`${BASE}/v/${LEAD_SLUG}?preview=1`, {
  waitUntil: "networkidle2",
});
await wait(1500);
await shot("s2-04-public-desktop");
const publicText = await page.evaluate(() => document.body.innerText);
console.log("PUBLIC_HAS_FORM:", /Nachricht|E-Mail/.test(publicText));
console.log(
  "PUBLIC_HAS_CASESTUDY:",
  publicText.includes("Ausgangslage") || publicText.includes("Beispiel GmbH"),
);

// ---- Öffentliche Seite (Smartphone hoch): Sticky-CTA ----
await page.setViewport({ width: 390, height: 844, isMobile: true });
await page.goto(`${BASE}/v/${LEAD_SLUG}?preview=1`, {
  waitUntil: "networkidle2",
});
await wait(1500);
await shot("s2-05-public-mobil-oben");
await page.evaluate(() => window.scrollTo({ top: 1400 }));
await wait(1500);
await shot("s2-06-public-mobil-sticky");
const stickyVisible = await page.evaluate(() => {
  const el = document.querySelector("[data-lp-hero]");
  const bars = [...document.querySelectorAll("div,nav")].filter((n) => {
    const s = getComputedStyle(n);
    return s.position === "fixed" && parseInt(s.bottom || "999") === 0;
  });
  return { heroMarker: !!el, fixedBottomBars: bars.length };
});
console.log("STICKY:", JSON.stringify(stickyVisible));

// ---- Formular absenden ----
const nameInput = await page.$('input[name="name"], input[autocomplete="name"]');
if (nameInput) {
  await page.evaluate(() =>
    document
      .querySelector('input[name="name"], input[autocomplete="name"]')
      ?.scrollIntoView({ block: "center" }),
  );
  await wait(800);
  await nameInput.click({ clickCount: 3 });
  await nameInput.type("Jürgen Weber", { delay: 15 });
  const mailInput = await page.$(
    'form input[type="email"], input[name="email"]',
  );
  await mailInput.click({ clickCount: 3 });
  await mailInput.type("juergen@test.de", { delay: 15 });
  const msg = await page.$("form textarea");
  if (msg) await msg.type("Bitte um Rückruf zur Demo.", { delay: 10 });
  await shot("s2-07-formular-gefuellt");
  const [submit] = await page.$$(
    "xpath/.//form//button[@type='submit' or contains(., 'enden')]",
  );
  await submit.click();
  await wait(2500);
  await shot("s2-08-formular-danke");
  const after = await page.evaluate(() => document.body.innerText);
  console.log("FORM_THANKS:", /[Dd]anke/.test(after));
} else {
  console.log("FORM_INPUT: nicht gefunden");
}

await browser.close();
console.log("DONE");
