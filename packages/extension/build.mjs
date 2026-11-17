// Builds the extension into dist/ (load it as an unpacked extension).
//   node build.mjs          one-off build
//   node build.mjs --watch  rebuild on change
import * as esbuild from "esbuild";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const lexicon = join(here, "..", "core", "data", "lexicon.json");
const watch = process.argv.includes("--watch");

if (!existsSync(lexicon)) {
  console.error("Missing core/data/lexicon.json — run `npm run data` first.");
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(here, "static"), dist, { recursive: true });
copyFileSync(lexicon, join(dist, "lexicon.json"));

// Dev-only demo page (not referenced by the manifest; stripped from release zips).
for (const f of ["demo.html", "showcase.html"]) copyFileSync(join(here, "dev", f), join(dist, f));

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
else {
  await esbuild.build(options);
  buildFirefox();
}

// Firefox doesn't support background service workers yet, and Chrome warns
// about `background.scripts` in MV3, so each browser gets its own manifest.
// dist/ (Chrome / Edge) is the dev build; dist-firefox/ is release-only.
function buildFirefox() {
  const out = join(here, "dist-firefox");
  rmSync(out, { recursive: true, force: true });
  cpSync(dist, out, {
    recursive: true,
    filter: (src) => !/[\\/](demo\.(html|js)|showcase\.html)$/.test(src),
  });
  const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
  manifest.background = { scripts: ["background.js"] };
  manifest.browser_specific_settings = {
    gecko: { id: "hanzi-lens@dri-water.github.io", strict_min_version: "121.0" },
  };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("  dist-firefox/ written");
}
