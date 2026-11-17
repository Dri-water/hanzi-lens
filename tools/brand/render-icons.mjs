// Rasterizes assets/logo.svg into PNG icons using a local Chrome/Edge.
//   node tools/brand/render-icons.mjs
// Set CHROME_PATH if Chrome isn't in the default location.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { chromePath } from "../chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const svg = readFileSync(join(root, "assets", "logo.svg"), "utf8");

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage();

async function render(size, out) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg style="display:block;width:${size}px;height:${size}px" `)}</body></html>`,
  );
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log("wrote", out);
}

const iconDir = join(root, "packages", "extension", "static", "icons");
mkdirSync(iconDir, { recursive: true });
for (const s of [16, 32, 48, 128]) await render(s, join(iconDir, `${s}.png`));
await render(512, join(root, "assets", "logo-512.png"));
await browser.close();
