// Captures the README screenshots and demo GIF from the showcase page.
//   npm run build && node tools/screenshots.mjs
// Needs a local Chrome/Edge (CHROME_PATH) and ffmpeg on PATH for the GIF.
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { chromePath } from "./chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const out = join(root, "assets", "screenshots");
mkdirSync(out, { recursive: true });

// --- static server for dist/ -------------------------------------------------------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer((req, res) => {
  const file = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(dist) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/showcase.html`;

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });

async function openPage(scheme, width = 980, height = 620) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/** Center of the n-th character inside the element with this id. */
async function charPoint(page, id, n) {
  return page.evaluate(
    (id, n) => {
      const walker = document.createTreeWalker(document.getElementById(id), NodeFilter.SHOW_TEXT);
      let left = n;
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (left < t.length) {
          const r = document.createRange();
          r.setStart(t, left);
          r.setEnd(t, left + 1);
          const b = r.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }
        left -= t.length;
      }
      throw new Error(`char ${n} not in #${id}`);
    },
    id,
    n,
  );
}

async function hover(page, id, n) {
  const p = await charPoint(page, id, n);
  await page.mouse.move(p.x - 3, p.y);
  await page.mouse.move(p.x, p.y);
  await page.waitForFunction(() => {
    const c = document.querySelector("[data-hanzi-lens]")?.shadowRoot?.querySelector(".card");
    return c && c.style.display === "block";
  });
  await new Promise((r) => setTimeout(r, 150));
}

async function shot(name, scheme, id, n, clip) {
  const page = await openPage(scheme);
  await hover(page, id, n);
  await page.screenshot({ path: join(out, name), clip });
  console.log("wrote", name);
  await page.close();
}

const full = { x: 0, y: 0, width: 980, height: 620 };
await shot("names.png", "light", "h-trump", 1, full); // 唐纳德·特朗普
await shot("contains.png", "light", "lede", 9, full); // 存款准备金率
await shot("unknown-dark.png", "dark", "h-rubio", 5, full); // 鲁比奥
await shot("traditional-dark.png", "dark", "h-trad", 9, full); // 關稅

// --- GIF: sweep across a headline word by word ---------------------------------
const frames = join(out, "_frames");
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames);
{
  const page = await browser.newPage();
  await page.setViewport({ width: 820, height: 440, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.goto(url, { waitUntil: "networkidle0" });
  let i = 0;
  const still = async (count) => {
    for (let k = 0; k < count; k++) await page.screenshot({ path: join(frames, `${String(i++).padStart(3, "0")}.png`) });
  };
  await still(4);
  // 唐纳德·特朗普 / 宣布 / 对华 / 加征 / 关税
  for (const n of [1, 7, 9, 11, 13]) {
    await hover(page, "h-trump", n);
    await still(9);
  }
  // move off the popup (it covers the next line) and let it close
  await page.mouse.move(800, 430);
  await new Promise((r) => setTimeout(r, 450));
  await still(3);
  // 古特雷斯, 停火
  for (const n of [7, 13]) {
    await hover(page, "h-guterres", n);
    await still(9);
  }
  await page.close();
}
await browser.close();
server.close();

execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-framerate", "6", "-i", join(frames, "%03d.png"),
  "-vf", "split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none",
  join(out, "demo.gif"),
]);
rmSync(frames, { recursive: true, force: true });
console.log("wrote demo.gif");
