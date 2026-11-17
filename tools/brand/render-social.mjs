// Renders assets/social-preview.png (1280x640) for the GitHub repo card.
// Upload it under Settings → General → Social preview.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { chromePath } from "../chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const banner = readFileSync(join(root, "assets", "banner-light.svg"), "utf8");
const browser = await puppeteer.launch({ executablePath: chromePath() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 640 });
await page.setContent(`<body style="margin:0;height:640px;display:grid;place-items:center;background:#F3EEE3">
  <div style="width:1180px">${banner.replace("<svg ", '<svg style="width:100%;height:auto;display:block" ')}</div></body>`);
await page.screenshot({ path: join(root, "assets", "social-preview.png") });
await browser.close();
console.log("wrote assets/social-preview.png");
