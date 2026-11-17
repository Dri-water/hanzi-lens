import type { DictEntry, Lexicon } from "./lexicon.js";
import { joinSyllables, parsePinyin, type Syllable } from "./pinyin.js";
import type { Token } from "./segmenter.js";

export interface Definition {
  /** The headword in the script that matched the text. */
  headword: string;
  /** The other script's form, when it differs (traditional <-> simplified). */
  altForm?: string;
  pinyin: string;
  syllables: Syllable[];
  definitions: string[];
}

export interface WordInfo {
  word: string;
  /** Best-guess pronunciation for this word. */
  pinyin: string;
  syllables: Syllable[];
  /** False when the pinyin was stitched together character by character. */
  pinyinExact: boolean;
  definitions: Definition[];
  /**
   * Breakdown into smaller pieces: name parts, or for words without an
   * entry, the longest dictionary words / characters inside it.
   */
  parts: WordInfo[];
  /** Shorter dictionary words contained in a known multi-character word (中华人民共和国 -> 人民, 共和国). */
  contains: { word: string; pinyin: string; gloss: string }[];
}

const LOW_VALUE = /^(old |archaic |ancient |Japanese |Korean )?variant of|^see |^used in |^\(Tw\)|^surname /i;

function rank(e: DictEntry, word: string): number {
  let score = 0;
  // 宁 is also the traditional form of rare 㝉 (zhù); prefer readings where the
  // text matches the simplified side. Uniform for all-traditional words.
  if (word === e.traditional && word !== e.simplified) score += 3;
  if (e.definitions.every((d) => LOW_VALUE.test(d))) score += 4;
  else if (e.definitions.some((d) => /variant of/i.test(d))) score += 2; // 宁 zhù "variant of 貯"
  if (/^[A-Z]/.test(e.pinyin)) score += 1; // proper-noun readings after common ones
  return score;
}

// "see 海南省[Hai3 nan2 Sheng3]" -> 海南省 (simplified side when given as trad|simp)
const SEE_REF = /^see (?:also )?([^\[|\s]+)(?:\|([^\[\s]+))?\[/;

function toDefinition(word: string, e: DictEntry): Definition {
  const isTrad = word === e.traditional && word !== e.simplified;
  const syllables = parsePinyin(e.pinyin);
  return {
    headword: isTrad ? e.traditional : e.simplified,
    altForm: e.traditional !== e.simplified ? (isTrad ? e.simplified : e.traditional) : undefined,
    pinyin: joinSyllables(syllables),
    syllables,
    definitions: e.definitions,
  };
}

export class Dictionary {
  constructor(private readonly lexicon: Lexicon) {}

  definitions(word: string): Definition[] {
    return this.lexicon
      .entries(word)
      .map((e, i) => ({ e, i }))
      .sort((a, b) => rank(a.e, word) - rank(b.e, word) || a.i - b.i)
      .map(({ e }) => toDefinition(word, this.resolveSee(e)));
  }

  /** Entries that only say "see X" borrow X's first definitions. */
  private resolveSee(e: DictEntry): DictEntry {
    if (!e.definitions.every((d) => d.startsWith("see "))) return e;
    const m = SEE_REF.exec(e.definitions[0]);
    if (!m) return e;
    const target = this.lexicon.entries(m[2] ?? m[1])[0];
    if (!target) return e;
    return { ...e, definitions: [...target.definitions.slice(0, 3), ...e.definitions] };
  }

  lookupToken(token: Token): WordInfo {
    if (token.kind === "name" && token.parts) {
      const parts = token.parts.map((p) => this.lookup(p.text));
      const own = this.definitions(token.text);
      const syllables = parts.flatMap((p, i) => (i ? [{ text: "·", tone: 0 }, ...p.syllables] : p.syllables));
      return {
        word: token.text,
        pinyin: own[0]?.pinyin ?? joinSyllables(syllables),
        syllables: own[0]?.syllables ?? syllables,
        pinyinExact: own.length > 0 || parts.every((p) => p.pinyinExact),
        definitions: own,
        parts,
        contains: [],
      };
    }
    return this.lookup(token.text);
  }

  lookup(word: string, depth = 0): WordInfo {
    const defs = this.definitions(word);
    const chars = Array.from(word);
    if (defs.length > 0) {
      return {
        word,
        pinyin: defs[0].pinyin,
        syllables: defs[0].syllables,
        pinyinExact: true,
        definitions: defs,
        parts: [],
        contains: chars.length > 2 && depth === 0 ? this.containedWords(word) : [],
      };
    }
    if (chars.length <= 1 || depth > 1) {
      return { word, pinyin: "", syllables: [], pinyinExact: false, definitions: [], parts: [], contains: [] };
    }
    // No entry: break into the longest known pieces, left to right.
    const parts = this.greedyPieces(chars).map((p) => this.lookup(p, depth + 1));
    const syllables = parts.flatMap((p) => p.syllables);
    return {
      word,
      pinyin: joinSyllables(syllables),
      syllables,
      pinyinExact: false,
      definitions: [],
      parts,
      contains: [],
    };
  }

  /** Longest-match split using only words that have dictionary entries. */
  private greedyPieces(chars: string[]): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < chars.length) {
      let e = Math.min(chars.length, i + 12);
      // never return the whole input as one piece
      if (i === 0 && e === chars.length) e--;
      for (; e > i + 1; e--) if (this.lexicon.hasEntry(chars.slice(i, e).join(""))) break;
      out.push(chars.slice(i, e).join(""));
      i = e;
    }
    return out;
  }

  private containedWords(word: string) {
    const chars = Array.from(word);
    const seen = new Set<string>();
    const out: WordInfo["contains"] = [];
    for (let s = 0; s < chars.length; s++) {
      for (let e = chars.length; e >= s + 2; e--) {
        if (s === 0 && e === chars.length) continue;
        const w = chars.slice(s, e).join("");
        if (seen.has(w) || !this.lexicon.hasEntry(w)) continue;
        seen.add(w);
        const d = this.definitions(w)[0];
        out.push({ word: w, pinyin: d.pinyin, gloss: d.definitions[0] ?? "" });
      }
    }
    return out.slice(0, 8);
  }
}
