import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  defaultViewport: { width: 390, height: 844, isMobile: true },
});
const page = await browser.newPage();
page.setDefaultTimeout(60000);
page.on("console", (m) => console.log("CONSOLE:", m.type(), m.text()));
page.on("requestfailed", (r) =>
  console.log("REQFAIL:", r.url(), r.failure()?.errorText),
);
page.on("response", (r) => {
  if (r.url().includes("/api/lp/form"))
    console.log("FORM_RESPONSE:", r.status());
});

await page.goto("http://localhost:3000/v/juergen-weber-6e58?preview=1", {
  waitUntil: "networkidle2",
});
await new Promise((r) => setTimeout(r, 1500));

const nameInput = await page.$('form input[name="name"], form input');
if (!nameInput) {
  console.log("NO FORM INPUT");
  process.exit(1);
}
await page.evaluate(() =>
  document.querySelector("form")?.scrollIntoView({ block: "center" }),
);
await new Promise((r) => setTimeout(r, 800));
const info = await page.evaluate(() => {
  const form = document.querySelector("form");
  const btn = form?.querySelector('button[type="submit"], button');
  const inputs = [...(form?.querySelectorAll("input,textarea") ?? [])].map(
    (i) => ({ name: i.getAttribute("name"), type: i.getAttribute("type") }),
  );
  return { hasForm: !!form, btnText: btn?.innerText, inputs };
});
console.log("FORM_INFO:", JSON.stringify(info));

await page.evaluate(() => {
  const form = document.querySelector("form");
  const set = (sel, val) => {
    const el = form.querySelector(sel);
    if (!el) return;
    const proto = el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  set('input[name="name"]', "Jürgen Weber");
  set('input[type="email"], input[name="email"]', "juergen@test.de");
  set("textarea", "Bitte um Rückruf.");
});
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const form = document.querySelector("form");
  const btn = form.querySelector('button[type="submit"]') ??
    form.querySelector("button");
  btn.click();
});
await new Promise((r) => setTimeout(r, 3000));
const text = await page.evaluate(() => document.body.innerText);
console.log("THANKS:", /[Dd]anke/.test(text));
await page.screenshot({ path: "/tmp/lp3-shots/s2-09-form-debug.png" });
await browser.close();
console.log("DONE");
