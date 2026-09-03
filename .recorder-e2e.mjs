// E2E-Check Gast-Recorder: WebKit (Safari-Engine) + Chromium, iPhone-Viewport,
// getUserMedia-Shim mit Canvas-Stream in Hoch- oder Querformat.
// Aufruf: node recorder-e2e.mjs <slug> <engine: webkit|chromium> <w>x<h> <touch:1|0>
import { webkit, chromium, devices } from "playwright";
import fs from "node:fs";

const [slug, engine = "webkit", dims = "720x1280", touchFlag = "1"] = process.argv.slice(2);
const [camW, camH] = dims.split("x").map(Number);
const touch = touchFlag === "1";
const outDir = "/private/tmp/claude-501/-Users-kurzeja-videocomet-saas/fa1f57be-c69b-42b5-875a-19988bea1bf3/scratchpad/shots/";
fs.mkdirSync(outDir, { recursive: true });
const tag = `${engine}-${touch ? "phone" : "desk"}-${dims}`;

const browserType = engine === "chromium" ? chromium : webkit;
const browser = await browserType.launch();
const ctx = await browser.newContext(
  touch
    ? { ...devices["iPhone 14"], locale: "de-DE", permissions: ["camera", "microphone"] }
    : { viewport: { width: 1280, height: 900 }, locale: "de-DE", permissions: ["camera", "microphone"] },
);
// Kamera-Shim: liefert einen Canvas-Stream in gewünschter Größe + stummen Ton.
await ctx.addInitScript(({ w, h }) => {
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    let t = 0;
    const draw = () => {
      g.fillStyle = "#1f7a1f"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#9ef01a"; g.beginPath(); g.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, Math.PI * 2 * ((t % 60) / 60)); g.fill();
      g.fillStyle = "#fff"; g.font = "bold 48px sans-serif"; g.fillText(`${w}x${h}`, 20, 60);
      t += 1; requestAnimationFrame(draw);
    };
    draw();
    const stream = c.captureStream(30);
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ac.createOscillator(); const dst = ac.createMediaStreamDestination();
      const gain = ac.createGain(); gain.gain.value = 0.0001;
      osc.connect(gain).connect(dst); osc.start();
      dst.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    } catch {}
    return stream;
  };
  const shim = async () => { window.__shimCalled = (window.__shimCalled || 0) + 1; return mk(); };
  try { Object.defineProperty(MediaDevices.prototype, "getUserMedia", { value: shim, configurable: true, writable: true }); } catch {}
  try { Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: shim, configurable: true, writable: true }); } catch {}
  try { Object.defineProperty(MediaDevices.prototype, "enumerateDevices", { value: async () => [], configurable: true, writable: true }); } catch {}
}, { w: camW, h: camH });

const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

const measure = async (label) => {
  const r = await page.evaluate(() => {
    const vids = [...document.querySelectorAll("video")];
    const live = vids[0];
    const stage = live.parentElement.getBoundingClientRect();
    const vis = vids.find((v) => getComputedStyle(v).display !== "none") ?? live;
    const vr = vis.getBoundingClientRect();
    const text = document.body.innerText;
    return {
      videos: vids.length,
      shown: `${vis.videoWidth}x${vis.videoHeight}`,
      stage: `${Math.round(stage.width)}x${Math.round(stage.height)}`,
      stageRatio: +(stage.width / stage.height).toFixed(3),
      videoRatio: vis.videoWidth ? +(vis.videoWidth / vis.videoHeight).toFixed(3) : null,
      videoBox: `${Math.round(vr.width)}x${Math.round(vr.height)}`,
      hintOpen: text.includes("So passt es"),
      hintBar: text.includes("Start mit „Hi!“"),
      mismatch: (text.match(/Dein Bild ist gerade[^\n]*|Diese Kamera nimmt[^\n]*/) || [null])[0],
      cue: (text.match(/Sag jetzt[^\n]*|Kurz Luft holen|Und jetzt einfach weitersprechen/) || [null])[0],
      buttons: [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean),
      vh: window.innerHeight,
      shimCalled: window.__shimCalled || 0,
    };
  });
  console.log(`\n== ${tag} :: ${label}`);
  console.log(JSON.stringify(r));
  return r;
};

await page.goto(`https://app.videocomet.de/r/${slug}`, { waitUntil: "networkidle" });
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("Nur notwendige")); b?.click(); });
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}${tag}-1-initial.png`, fullPage: true });
await measure("initial");

await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Kamera und Mikrofon")).click());
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector("video").parentElement.scrollIntoView({ block: "center" }));
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}${tag}-2-camera.png` });
const cam = await measure("camera on");

// Format wechseln, falls Umschalter da ist
const hasToggle = cam.buttons.includes("Hochformat") && cam.buttons.includes("Querformat");
if (hasToggle) {
  const target = camH > camW ? "Querformat" : "Hochformat"; // absichtlich das "falsche" waehlen → Mismatch-Hinweis
  await page.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === t).click(), target);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}${tag}-3-toggle-mismatch.png` });
  await measure(`toggle to ${target} (expect mismatch hint on phone)`);
  const back = camH > camW ? "Hochformat" : "Querformat";
  await page.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === t).click(), back);
  await page.waitForTimeout(2500);
  await measure(`toggle back to ${back}`);
}

await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Aufnahme starten")).click());
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}${tag}-4-countdown.png` });
await measure("countdown");
await page.waitForTimeout(3300);
await page.screenshot({ path: `${outDir}${tag}-5-recording.png` });
await measure("recording (cue)");
await page.waitForTimeout(2500);
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Aufnahme beenden")).click());
await page.waitForTimeout(3000);
await page.screenshot({ path: `${outDir}${tag}-6-review.png` });
const rev = await measure("review");
console.log("review video ratio vs stage ratio:", rev.videoRatio, rev.stageRatio);
if (logs.length) console.log("console:", logs.slice(0, 8).join("\n"));
await browser.close();
