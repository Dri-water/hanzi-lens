import { hmmCut } from "./hmm.js";
import type { Lexicon } from "./lexicon.js";

export type TokenKind =
  | "word" // Chinese word (may or may not have a dictionary entry)
  | "name" // dot-joined foreign name, e.g. 唐纳德·特朗普
  | "latin" // run of Latin letters / mixed alphanumerics, e.g. SpaceX
  | "number" // 25, 1.2%, ２０２４
  | "punct"
  | "space";

export interface Token {
  text: string;
  /** Offsets into the input string, in UTF-16 code units (DOM-compatible). */
  start: number;
  end: number;
  kind: TokenKind;
  /** For "name": the dot-separated pieces. */
  parts?: Token[];
}

const HAN = /\p{Script=Han}/u;
const ALNUM = /[A-Za-z0-9０-９Ａ-Ｚａ-ｚ]/;
// One alphanumeric run: letters/digits, decimals like 1.2 or 3,000, optional %.
const ALNUM_RUN = /[A-Za-z0-9０-９Ａ-Ｚａ-ｚ]+(?:[.,:．][0-9０-９]+)*[%％]?/y;
const NUMBER = /^[0-9０-９.,:．%％]+$/;
const NAME_DOTS = new Set(["·", "・", "‧", "•", "･"]);
// Characters used in the standard transliteration of foreign names (Xinhua tables).
const TRANSLIT = new Set(
  Array.from(
    "阿埃艾安奥巴拜班邦鲍贝本比彼宾波伯博布查达戴丹道德迪蒂丁杜多厄恩尔法菲费芬丰弗福盖冈戈格贡古瓜圭哈海汉豪赫亨胡霍" +
      "基吉加贾杰金卡凯坎康柯科克肯库夸奎拉莱赖兰朗劳勒雷蕾里利莉连列林琳隆卢鲁伦罗洛马玛迈麦曼芒梅门蒙米敏莫姆穆" +
      "纳娜奈内尼妮涅纽努诺欧帕潘佩彭皮珀普齐奇乔切琼丘萨塞桑瑟森沙莎舍什舒斯松苏索塔泰坦汤唐特滕提图托瓦旺威韦维" +
      "温沃乌伍西希锡谢辛休雅亚扬耶伊因尤约泽扎詹兹佐澤連蘭羅爾維諾薩亞達貝倫",
  ),
);

export const isHan = (ch: string) => HAN.test(ch);

export class Segmenter {
  constructor(private readonly lexicon: Lexicon) {}

  segment(text: string): Token[] {
    const tokens: Token[] = [];
    // Split into blocks of Han + alphanumerics; everything else is emitted directly.
    let i = 0;
    while (i < text.length) {
      const ch = charAt(text, i);
      if (isHan(ch) || ALNUM.test(ch)) {
        let j = i;
        while (j < text.length) {
          const c = charAt(text, j);
          if (!(isHan(c) || ALNUM.test(c) || (j > i && /[.,:．%％]/.test(c) && ALNUM.test(text[j - 1] ?? "")))) break;
          j += c.length;
        }
        this.cutBlock(text.slice(i, j), i, tokens);
        i = j;
      } else if (/\s/.test(ch)) {
        let j = i;
        while (j < text.length && /\s/.test(text[j])) j++;
        tokens.push({ text: text.slice(i, j), start: i, end: j, kind: "space" });
        i = j;
      } else {
        tokens.push({ text: ch, start: i, end: i + ch.length, kind: "punct" });
        i += ch.length;
      }
    }
    return mergeDottedNames(this.mergeTransliterations(tokens));
  }

  /**
   * 鲁 / 比奥 -> 鲁比奥: adjacent pieces made only of transliteration characters,
   * none of them a real dictionary word (beyond single characters), are joined.
   */
  private mergeTransliterations(tokens: Token[]): Token[] {
    const fits = (t: Token) =>
      t.kind === "word" &&
      Array.from(t.text).every((c) => TRANSLIT.has(c)) &&
      (Array.from(t.text).length === 1 || !this.lexicon.hasEntry(t.text));
    const out: Token[] = [];
    for (let i = 0; i < tokens.length; i++) {
      let j = i;
      while (j < tokens.length && fits(tokens[j])) j++;
      const run = tokens.slice(i, j);
      const len = run.reduce((n, t) => n + Array.from(t.text).length, 0);
      if (run.length >= 2 && len >= 3 && run.some((t) => Array.from(t.text).length > 1)) {
        out.push({ text: run.map((t) => t.text).join(""), start: run[0].start, end: run[run.length - 1].end, kind: "word" });
        i = j - 1;
      } else {
        out.push(tokens[i]);
      }
    }
    return out;
  }

  /** jieba-style: DAG of dictionary words -> max-probability route -> HMM for leftovers. */
  private cutBlock(block: string, offset: number, out: Token[]) {
    const lex = this.lexicon;
    const chars = Array.from(block);
    const pos: number[] = []; // code-unit offset of each char
    let acc = 0;
    for (const c of chars) {
      pos.push(acc);
      acc += c.length;
    }
    pos.push(acc);
    const N = chars.length;

    // DAG: for each start index, candidate end indices (exclusive).
    const dag: number[][] = [];
    const latinEnd = new Map<number, number>();
    for (let s = 0; s < N; s++) {
      const ends: number[] = [s + 1];
      let w = chars[s];
      for (let e = s + 2; e <= Math.min(N, s + lex.maxWordLength); e++) {
        w += chars[e - 1];
        if (lex.frequency(w) > 0) ends.push(e);
      }
      // A run of alphanumerics is one unit (SpaceX, 1.2%) unless the dictionary says otherwise.
      if (ALNUM.test(chars[s]) && (s === 0 || !ALNUM.test(chars[s - 1]))) {
        ALNUM_RUN.lastIndex = pos[s];
        const m = ALNUM_RUN.exec(block);
        if (m) {
          const endUnit = pos[s] + m[0].length;
          const e = pos.indexOf(endUnit);
          if (e > s + 1) {
            ends.push(e);
            latinEnd.set(s, e);
          }
        }
      }
      dag.push(ends);
    }

    // Route: best[i] = max log-prob of segmenting chars[i..N).
    const best = new Float64Array(N + 1);
    const next = new Int32Array(N + 1);
    for (let s = N - 1; s >= 0; s--) {
      let bp = -Infinity;
      let bn = s + 1;
      for (const e of dag[s]) {
        const w = chars.slice(s, e).join("");
        let f = lex.frequency(w);
        if (latinEnd.get(s) === e) f = Math.max(f, 1e4); // keep alnum runs whole
        const p = Math.log(f || 1) - lex.logTotal + best[e];
        if (p > bp || (p === bp && e > bn)) {
          bp = p;
          bn = e;
        }
      }
      best[s] = bp;
      next[s] = bn;
    }

    const emit = (s: number, e: number) => {
      const t = chars.slice(s, e).join("");
      out.push({ text: t, start: offset + pos[s], end: offset + pos[e], kind: kindOf(t) });
    };

    // Leftover single characters [from, to): HMM unless the dictionary knows the whole run.
    const cutUnknown = (from: number, to: number) => {
      const buf = chars.slice(from, to);
      if (buf.length === 1 || lex.frequency(buf.join("")) > 0) {
        for (let k = from; k < to; k++) emit(k, k + 1);
        return;
      }
      let k = from;
      for (const w of hmmCut(buf, lex.hmm)) {
        const n = Array.from(w).length;
        emit(k, k + n);
        k += n;
      }
    };

    // Walk the route, buffering runs of single Han characters.
    let bufStart = -1;
    const flush = (upTo: number) => {
      if (bufStart < 0) return;
      // Runs of 3+ characters typical of foreign-name transliteration
      // (泽连斯基, 哈梅内伊) are kept together as one probable name.
      let cursor = bufStart;
      let k = bufStart;
      while (k < upTo) {
        if (!TRANSLIT.has(chars[k])) {
          k++;
          continue;
        }
        let r = k;
        while (r < upTo && TRANSLIT.has(chars[r])) r++;
        if (r - k >= 3) {
          if (k > cursor) cutUnknown(cursor, k);
          emit(k, r);
          cursor = r;
        }
        k = r;
      }
      if (upTo > cursor) cutUnknown(cursor, upTo);
      bufStart = -1;
    };

    let s = 0;
    while (s < N) {
      const e = next[s];
      if (e - s === 1 && isHan(chars[s])) {
        if (bufStart < 0) bufStart = s;
      } else {
        flush(s);
        emit(s, e);
      }
      s = e;
    }
    flush(N);
  }
}

function charAt(text: string, i: number): string {
  const cp = text.codePointAt(i)!;
  return String.fromCodePoint(cp);
}

function kindOf(t: string): TokenKind {
  if (NUMBER.test(t)) return "number";
  if (!Array.from(t).some(isHan)) return "latin";
  return "word";
}

/** 唐纳德 · 特朗普 -> one "name" token with parts. */
function mergeDottedNames(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "word" || !NAME_DOTS.has(tokens[i + 1]?.text) || tokens[i + 2]?.kind !== "word") {
      out.push(t);
      continue;
    }
    const parts: Token[] = [t];
    let j = i;
    while (NAME_DOTS.has(tokens[j + 1]?.text) && tokens[j + 2]?.kind === "word") {
      parts.push(tokens[j + 2]);
      j += 2;
    }
    const start = t.start;
    const end = tokens[j].end;
    const text = tokens.slice(i, j + 1).map((x) => x.text).join("");
    out.push({ text, start, end, kind: "name", parts });
    i = j;
  }
  return out;
}
