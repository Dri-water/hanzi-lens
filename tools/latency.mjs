// Measures how fast the popup reacts, in a real Chrome with the built extension:
//   coldFirst  same hover: until anything shows (the loader)
//   cold    first hover after the background worker was shut down (idle >30 s)
//   block   first hover in a paragraph not hovered before (worker warm)
//   word    moving to another word in the same paragraph
//   hide    moving off the word until the popup is gone
//   idle    first hover after 35 s without touching the mouse (Chrome's idle
//           limit is 30 s; the page's keep-alive should make this as fast as warm)
//
//   npm run build && node tools/latency.mjs [runs] [--no-idle]
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { chromePath } from "./chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = process.env.HL_DIST ?? join(root, "packages", "extension", "dist");
const runs = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 5);

const LINES = [
  "美国务卿鲁比奥访华，与中方讨论贸易和关税问题",
  "特朗普宣布对华加征关税，市场反应强烈",
  "中国科学家在量子计算领域取得重大突破",
  "北京今天天气晴朗，气温适宜，适合户外活动",
  "这家公司发布了新款智能手机，价格比去年便宜",
  "教育部出台新政策，减轻中小学生课业负担",
];
const PAGE = `<!doctype html><meta charset="utf-8"><title>latency</title>
<body style="font:24px sans-serif;margin:40px">
${Array.from({ length: runs + 1 }, (_, r) => LINES.map((l, i) => `<p id="p${r}_${i}">${l}</p>`).join("")).join("")}
</body>`;
const server = createServer((_, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE));
await new Promise((r) => server.listen(0, r));

const extDir = mkdtempSync(join(tmpdir(), "hanzi-lens-lat-"));
cpSync(dist, extDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  pipe: true,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: ["--enable-unsafe-extension-debugging", ...(process.env.CI ? ["--no-sandbox"] : [])],
});

const stats = { coldFirst: [], cold: [], block: [], word: [], hide: [], idle: [] };
try {
  const cdp = await browser.target().createCDPSession();
  await cdp.send("Extensions.loadUnpacked", { path: extDir });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 900 });
  await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: "load" });

  /** Moves the mouse, returns ms until `done(visibleWord())` holds (polled every frame). */
  const timed = async (x, y, want) => {
    await page.evaluate((fn) => {
      window.__check = new Function("w", fn);
      window.__t0 = performance.now();
      window.__dt = null;
      const tick = () => {
        const card = [...document.querySelectorAll("[data-hanzi-lens]")]
          .map((h) => h.shadowRoot?.querySelector(".card"))
          .find((c) => c && c.style.display !== "none");
        // A card still showing its loader doesn't count as loaded.
        const w = card && !card.querySelector(".loading") ? card.querySelector(".hanzi")?.textContent ?? null : card ? "…" : null;
        if (window.__check(w)) window.__dt = performance.now() - window.__t0;
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, want);
    await page.mouse.move(x, y);
    await page.waitForFunction(() => window.__dt != null, { timeout: 15000 });
    return page.evaluate(() => window.__dt);
  };
  const charPos = (id, n) =>
    page.evaluate(
      (id, n) => {
        const el = document.getElementById(id);
        el.scrollIntoView({ block: "center" });
        const t = el.firstChild;
        const r = document.createRange();
        r.setStart(t, n);
        r.setEnd(t, n + 1);
        const b = r.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      },
      id,
      n,
    );
  const away = async () => {
    await page.mouse.move(1090, 5);

    await page.waitForFunction(() =>
      [...document.querySelectorAll("[data-hanzi-lens]")].every(
        (h) => h.shadowRoot?.querySelector(".card")?.style.display === "none",
      ),
    );
  };

  for (let r = 0; r < runs; r++) {
    await away();
    // What Chrome does to an idle extension worker after ~30 s.
    const sw = browser.targets().find((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"));
    if (sw) await cdp.send("Target.closeTarget", { targetId: sw._targetId }).catch((e) => console.log("close failed", e.message));
    await new Promise((res) => setTimeout(res, 500));
    // char 4 of line 0 is inside 鲁比奥, char 1 of line 1 inside 朗 of 特朗普
    let p = await charPos(`p${r}_0`, 4);
    // Two numbers for the same hover: first feedback (loader), then the full card.
    const t0 = Date.now();
    stats.coldFirst.push(await timed(p.x, p.y, "return w !== null"));
    await page.waitForFunction(() => {
      const c = document.querySelector("[data-hanzi-lens]")?.shadowRoot?.querySelector(".card");
      return c && c.style.display !== "none" && !c.querySelector(".loading");
    });
    stats.cold.push(Date.now() - t0);
    await away();
    p = await charPos(`p${r}_1`, 1);
    stats.block.push(await timed(p.x, p.y, "return w !== null && w !== '…'"));
    p = await charPos(`p${r}_1`, 7); // 加征 / 关税 area
    stats.word.push(await timed(p.x, p.y, "return w !== null && w !== '…' && w !== '特朗普'"));
    stats.hide.push(await timed(1090, 5, "return w === null"));
  }
  if (!process.argv.includes("--no-idle")) {
    await new Promise((res) => setTimeout(res, 35_000));
    const p = await charPos(`p${runs}_2`, 3);
    stats.idle.push(await timed(p.x, p.y, "return w !== null && w !== '…'"));
  }
} finally {
  await browser.close();
  server.close();
  rmSync(extDir, { recursive: true, force: true });
}

const fmt = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return `median ${s[s.length >> 1].toFixed(0).padStart(4)} ms   max ${s[s.length - 1].toFixed(0).padStart(4)} ms`;
};
for (const [k, v] of Object.entries(stats)) if (v.length) console.log(`${k.padEnd(6)} ${fmt(v)}`);
