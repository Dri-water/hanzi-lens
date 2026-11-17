// Quick CLI for eyeballing segmentation:
//   npm run seg -- "特朗普宣布对华加征关税"
//   npm run seg -- --lookup "中华人民共和国"
import { readFileSync } from "node:fs";
import { Engine } from "../src/index.js";
import { loadLexiconData } from "../test/load.js";

const args = process.argv.slice(2);
const lookup = args[0] === "--lookup";
const inputs = lookup ? args.slice(1) : args;
const engine = new Engine(loadLexiconData());

const lines = inputs.length ? inputs : readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
for (const line of lines) {
  const tokens = engine.segment(line);
  console.log(tokens.filter((t) => t.kind !== "space").map((t) => t.text).join(" / "));
  if (lookup) {
    for (const t of tokens) {
      if (t.kind !== "word" && t.kind !== "name") continue;
      const info = engine.lookup(t);
      const def = info.definitions[0]?.definitions.slice(0, 3).join("; ") ?? "(no entry)";
      console.log(`  ${t.text}  ${info.pinyin}${info.pinyinExact ? "" : " (~)"}  ${def}`);
      for (const p of info.parts) console.log(`    · ${p.word} ${p.pinyin} ${p.definitions[0]?.definitions[0] ?? ""}`);
      for (const c of info.contains) console.log(`    ⊃ ${c.word} ${c.pinyin} ${c.gloss}`);
    }
  }
}
