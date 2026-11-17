import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LexiconData } from "../src/index.js";

export const LEXICON_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "lexicon.json");

export function loadLexiconData(): LexiconData {
  if (!existsSync(LEXICON_PATH)) {
    throw new Error(`Missing ${LEXICON_PATH}. Run \`npm run data\` first.`);
  }
  return JSON.parse(readFileSync(LEXICON_PATH, "utf8"));
}
