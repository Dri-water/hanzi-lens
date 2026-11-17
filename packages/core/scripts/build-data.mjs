// Downloads the source dictionaries and compiles them into data/lexicon.json.
//
// Sources (all free / open):
//   - CC-CEDICT (CC BY-SA 4.0)  https://www.mdbg.net/chinese/dictionary?page=cc-cedict
//   - jieba dict.txt + HMM model (MIT)  https://github.com/fxsjy/jieba  (pinned to v0.42.1)
//
// Usage: node scripts/build-data.mjs [--force]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
const rawDir = join(dataDir, "raw");
const force = process.argv.includes("--force");

const JIEBA = "https://raw.githubusercontent.com/fxsjy/jieba/v0.42.1/jieba";
const SOURCES = {
  "cedict_ts.u8.gz": "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz",
  "jieba_dict.txt": `${JIEBA}/dict.txt`,
  "prob_start.py": `${JIEBA}/finalseg/prob_start.py`,
  "prob_trans.py": `${JIEBA}/finalseg/prob_trans.py`,
  "prob_emit.py": `${JIEBA}/finalseg/prob_emit.py`,
};

async function download() {
  mkdirSync(rawDir, { recursive: true });
  for (const [name, url] of Object.entries(SOURCES)) {
    const dest = join(rawDir, name);
    if (existsSync(dest) && !force) continue;
    process.stdout.write(`downloading ${url} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log("ok");
  }
}

/** Parses jieba's python dict literals (`P={'B': {'\u4e00': -3.6, ...}, ...}`). */
function parsePyDict(src) {
  const body = src.slice(src.indexOf("P=") + 2);
  const json = body
    .replace(/-3\.14e\+100/g, "-3.14e100")
    .replace(/'((?:\\u[0-9a-fA-F]{4}|[^'\\])*)'/g, (_, s) => JSON.stringify(JSON.parse(`"${s}"`)))
    .replace(/,\s*}/g, "}");
  return JSON.parse(json);
}

function build() {
  // --- jieba frequencies --------------------------------------------------
  const freq = new Map();
  for (const line of readFileSync(join(rawDir, "jieba_dict.txt"), "utf8").split("\n")) {
    const [word, f] = line.trim().split(" ");
    if (!word || !f) continue;
    freq.set(word, (freq.get(word) ?? 0) + Number(f));
  }

  // --- CC-CEDICT -----------------------------------------------------------
  const cedict = gunzipSync(readFileSync(join(rawDir, "cedict_ts.u8.gz"))).toString("utf8");
  const lineRe = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/;
  const parseCedict = (text) => {
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("#")) continue;
      const m = lineRe.exec(line);
      if (m) rows.push([m[1], m[2], m[3], m[4]]);
    }
    return rows;
  };
  const supplement = parseCedict(readFileSync(join(dataDir, "supplement.u8"), "utf8"));
  const entries = [...supplement, ...parseCedict(cedict)];

  const headwords = new Set();
  for (const [trad, simp] of entries) {
    headwords.add(trad);
    headwords.add(simp);
  }

  // jieba contains many phrase-like compounds (中美关系, 举行会谈) that hide
  // useful word boundaries. Drop jieba-only words that split cleanly into
  // multi-character dictionary words; keep atomic ones (names, slang).
  const splitsIntoWords = (w) => {
    const n = w.length;
    const ok = new Array(n + 1).fill(false);
    ok[0] = true;
    for (let e = 2; e <= n; e++) {
      for (let s = Math.max(0, e - 12); s <= e - 2; s++) {
        if (ok[s] && headwords.has(w.slice(s, e)) && !(s === 0 && e === n)) {
          ok[e] = true;
          break;
        }
      }
    }
    return ok[n];
  };
  let pruned = 0;
  for (const w of [...freq.keys()]) {
    if (w.length >= 4 && !headwords.has(w) && splitsIntoWords(w)) {
      freq.delete(w);
      pruned++;
    }
  }

  // Every CEDICT headword must be segmentable. Words jieba doesn't know get a
  // small default frequency; traditional forms inherit the simplified frequency.
  const DEFAULT_FREQ = 3;
  const SUPPLEMENT_FREQ = 2000;
  entries.forEach(([trad, simp], i) => {
    let f = freq.get(simp) ?? DEFAULT_FREQ;
    if (i < supplement.length) f = Math.max(f, SUPPLEMENT_FREQ);
    freq.set(simp, Math.max(freq.get(simp) ?? 0, f));
    if (trad !== simp) freq.set(trad, Math.max(freq.get(trad) ?? 0, f));
  });

  let total = 0;
  for (const f of freq.values()) total += f;

  // --- HMM model for unknown words (names etc.) ---------------------------
  const hmm = {
    start: parsePyDict(readFileSync(join(rawDir, "prob_start.py"), "utf8")),
    trans: parsePyDict(readFileSync(join(rawDir, "prob_trans.py"), "utf8")),
    emit: parsePyDict(readFileSync(join(rawDir, "prob_emit.py"), "utf8")),
  };

  const lexicon = {
    version: 1,
    total,
    freq: Object.fromEntries(freq),
    entries,
    hmm,
  };
  const out = join(dataDir, "lexicon.json");
  writeFileSync(out, JSON.stringify(lexicon));
  console.log(
    `wrote ${out}: ${freq.size} words (${pruned} compounds pruned), ${entries.length} entries (${supplement.length} supplement)`,
  );
}

await download();
build();
