import type { HmmModel, HmmState } from "./lexicon.js";

// Port of jieba's finalseg Viterbi decoder (MIT). Splits a run of characters
// that the dictionary could not explain into likely words, which is how
// unseen names like 毛宁 or 古特雷斯 get kept together.

const MIN = -3.14e100;
const STATES: HmmState[] = ["B", "M", "E", "S"];
const PREV: Record<HmmState, HmmState[]> = { B: ["E", "S"], M: ["M", "B"], S: ["S", "E"], E: ["B", "M"] };

export function hmmCut(chars: string[], model: HmmModel): string[] {
  if (chars.length === 0) return [];
  let V: Record<string, number> = {};
  let path: Record<string, HmmState[]> = {};
  for (const y of STATES) {
    V[y] = model.start[y] + (model.emit[y][chars[0]] ?? MIN);
    path[y] = [y];
  }
  for (let t = 1; t < chars.length; t++) {
    const nextV: Record<string, number> = {};
    const nextPath: Record<string, HmmState[]> = {};
    for (const y of STATES) {
      const em = model.emit[y][chars[t]] ?? MIN;
      let best = -Infinity;
      let bestPrev: HmmState = PREV[y][0];
      for (const y0 of PREV[y]) {
        const p = V[y0] + (model.trans[y0][y] ?? MIN) + em;
        if (p > best) {
          best = p;
          bestPrev = y0;
        }
      }
      nextV[y] = best;
      nextPath[y] = [...path[bestPrev], y];
    }
    V = nextV;
    path = nextPath;
  }
  const last: HmmState = V.E >= V.S ? "E" : "S";
  const states = path[last];

  const words: string[] = [];
  let begin = 0;
  for (let i = 0; i < chars.length; i++) {
    const s = states[i];
    if (s === "B") begin = i;
    else if (s === "E") {
      words.push(chars.slice(begin, i + 1).join(""));
      begin = i + 1;
    } else if (s === "S") {
      words.push(chars[i]);
      begin = i + 1;
    }
  }
  if (begin < chars.length) words.push(chars.slice(begin).join(""));
  return words;
}
