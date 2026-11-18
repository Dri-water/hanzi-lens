// End-to-end check of the real extension in Chrome, including the update path:
//   1. install the extension, open a page, hover a word -> popup
//   2. replace the extension files and reload it (what an update does)
//   3. hover again in the SAME tab, without refreshing -> popup from the new copy
//
//   npm run build && node tools/e2e-update.mjs [--from <old unpacked build>]
//
// --from installs an older build first (e.g. an unzipped previous release), so
// step 2 is a real old -> new upgrade. Without it, the current build is
// "updated" to itself, which still exercises the reload/takeover path.
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { chromePath } from "./chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const fromArg = process.argv.indexOf("--from");
const from = fromArg > 0 ? process.argv[fromArg + 1] : dist;

const PAGE = `<!doctype html><meta charset="utf-8"><title>e2e</title>
<body style="font:24px sans-serif;margin:40px">
<h1 id="h">美国务卿鲁比奥访华</h1>
<p>Text inside a link: <a href="#"><b>特朗普</b>宣布对华加征关税</a></p></body>`;
const server = createServer((_, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE));
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;

const extDir = mkdtempSync(join(tmpdir(), "hanzi-lens-e2e-"));
const copyBuild = (src) =>
  cpSync(src, extDir, { recursive: true, filter: (p) => !/[\\/](demo\.(html|js)|showcase\.html)$/.test(p) });
copyBuild(from);

const launch = () =>
  puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    pipe: true,
    protocolTimeout: 20000,
    ignoreDefaultArgs: ["--disable-extensions"],
    // GitHub's Ubuntu runners block the Chrome sandbox (AppArmor userns rules).
    args: ["--enable-unsafe-extension-debugging", ...(process.env.CI ? ["--no-sandbox"] : [])],
  });
// Chrome occasionally hangs at startup on CI runners; one retry covers it.
const browser = await launch().catch((e) => {
  console.log(`Chrome didn't start (${e.message}); retrying once`);
  return launch();
});
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failed = true;
};

try {
  const cdp = await browser.target().createCDPSession();
  const { id } = await cdp.send("Extensions.loadUnpacked", { path: extDir });
  const worker = async () => {
    const t = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(id), { timeout: 10000 });
    return t.worker();
  };
  const version = async () => (await worker()).evaluate(() => chrome.runtime.getManifest().version);
  console.log(`installed ${await version()} from ${from}`);

  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 500 });
  await page.goto(url, { waitUntil: "load" });

  /** Hovers the n-th character of #h, returns the popup's headword (or null). */
  const hover = async (n) => {
    await page.mouse.move(5, 480); // off any text: lets the previous popup go
    await new Promise((r) => setTimeout(r, 400));
    const p = await page.evaluate((n) => {
      const t = document.getElementById("h").firstChild;
      const r = document.createRange();
      r.setStart(t, n);
      r.setEnd(t, n + 1);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, n);
    await page.mouse.move(p.x, p.y);
    return page
      .waitForFunction(
        () => {
          const hosts = [...document.querySelectorAll("[data-hanzi-lens]")];
          const card = hosts.map((h) => h.shadowRoot?.querySelector(".card")).find((c) => c && c.style.display !== "none");
          return card?.querySelector(".hanzi")?.textContent || false;
        },
        { timeout: 8000 },
      )
      .then((h) => h.jsonValue(), () => null);
  };

  check((await hover(4)) === "鲁比奥", "hover works after install (鲁比奥)");

  // --- update: swap in the current build and reload the extension ---
  copyBuild(dist);
  // A freshly injected copy announces itself with this event (see content.ts).
  await page.evaluate(() => {
    window.__takeovers = 0;
    document.addEventListener("hanzi-lens:takeover", () => window.__takeovers++);
  });
  // Loading the same folder again is a reload, like the ↻ button in chrome://extensions.
  const again = await cdp.send("Extensions.loadUnpacked", { path: extDir });
  if (again.id !== id) throw new Error(`reload gave a new extension id ${again.id}`);
  const injected = await page
    .waitForFunction(() => window.__takeovers > 0, { timeout: 10000 })
    .then(() => true, () => false);
  console.log(`reloaded (now ${JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8")).version}); same tab, not refreshed`);
  check(injected, "new copy was injected into the open tab");

  const t0 = Date.now();
  const responsive = await Promise.race([page.evaluate(() => 1), new Promise((r) => setTimeout(() => r(0), 5000))]);
  check(responsive === 1, `page still responsive after update (${Date.now() - t0} ms)`);
  check((await hover(1)) === "国务卿", "hover works in the already-open tab after update (国务卿)");
  const hosts = await page.evaluate(() => document.querySelectorAll("[data-hanzi-lens]").length);
  check(hosts === 1, `exactly one popup in the page (found ${hosts})`);

  // --- leaving the word: the card goes away at once, and never blocks text ---
  const cardBox = () =>
    page.evaluate(() => {
      const c = document.querySelector("[data-hanzi-lens]")?.shadowRoot?.querySelector(".card");
      if (!c || c.style.display === "none") return null;
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  const goneWithin = (ms) =>
    page
      .waitForFunction(
        () => document.querySelector("[data-hanzi-lens]")?.shadowRoot?.querySelector(".card")?.style.display === "none",
        { timeout: ms, polling: "raf" },
      )
      .then(() => true, () => false);

  await hover(4);
  let box = await cardBox();
  await page.mouse.move(5, 480);
  check(await goneWithin(100), "card disappears as soon as the pointer leaves the word");

  await hover(4);
  box = await cardBox();
  await page.mouse.move(box.x, box.y); // onto the card (default: passes through it)
  check(await goneWithin(100), "default: moving onto the card hides it");
  const under = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-hanzi-lens]") == null,
    box,
  );
  check(under, "default: the card doesn't block the page under it");

  // --- "keep open while the mouse is on it" setting ---
  // Tick it on the real options page (right-click the icon -> Options).
  const opts = await browser.newPage();
  await opts.goto(`chrome-extension://${id}/options.html`);
  await opts.click("#keepOpen");
  await opts.waitForFunction(() => document.getElementById("saved").textContent !== "");
  await opts.close();
  await page.bringToFront();
  await hover(4);
  box = await cardBox();
  await page.mouse.move(box.x, box.y);
  check(!(await goneWithin(700)), "keep-open setting: card stays while the pointer is on it");
  await page.mouse.move(5, 480);
  check(await goneWithin(1000), "keep-open setting: card goes once the pointer leaves it");
} finally {
  await browser.close();
  server.close();
  rmSync(extDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
