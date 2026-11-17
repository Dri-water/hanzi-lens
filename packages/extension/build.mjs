// Builds the extension into dist/ (load it as an unpacked extension).
//   node build.mjs          one-off build
//   node build.mjs --watch  rebuild on change
import * as esbuild from "esbuild";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const lexicon = join(here, "..", "core", "data", "lexicon.json");
const watch = process.argv.includes("--watch");

if (!existsSync(lexicon)) {
  console.error("Missing core/data/lexicon.json — run `npm run data` first.");
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "icons"), { recursive: true });
cpSync(join(here, "static"), dist, { recursive: true });
copyFileSync(lexicon, join(dist, "lexicon.json"));
for (const size of [16, 48, 128]) writeFileSync(join(dist, "icons", `${size}.png`), icon(size));

// Dev-only demo page (not referenced by the manifest; stripped from release zips).
copyFileSync(join(here, "dev", "demo.html"), join(dist, "demo.html"));

const options = {
  entryPoints: {
    background: join(here, "src/background.ts"),
    content: join(here, "src/content.ts"),
    demo: join(here, "dev/demo.ts"),
  },
  outdir: dist,
  bundle: true,
  format: "iife",
  target: ["chrome110", "firefox121"],
  logLevel: "info",
};
if (watch) await (await esbuild.context(options)).watch();
else await esbuild.build(options);

// --- tiny PNG icon generator (magnifying lens over a warm square) -----------
function icon(size) {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 128;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const fx = (x + 0.5) / s;
      const fy = (y + 0.5) / s;
      // rounded square background
      const r = 26;
      const dx = Math.max(r - fx, fx - (128 - r), 0);
      const dy = Math.max(r - fy, fy - (128 - r), 0);
      if (dx * dx + dy * dy > r * r) continue;
      let [R, G, B] = [200, 48, 40];
      // lens ring + handle
      const d = Math.hypot(fx - 54, fy - 54);
      const onRing = d > 26 && d < 36;
      const t = ((fx - 54) + (fy - 54)) / 2;
      const off = Math.abs((fx - 54) - (fy - 54)) / Math.SQRT2;
      const onHandle = t > 30 && t < 58 && off < 7;
      if (onRing || onHandle) [R, G, B] = [255, 244, 222];
      else if (d <= 26) [R, G, B] = [235, 120, 90];
      px.set([R, G, B, 255], i);
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
