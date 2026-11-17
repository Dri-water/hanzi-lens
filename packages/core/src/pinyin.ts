export interface Syllable {
  /** Syllable with tone mark, e.g. "lǎng". Non-pinyin pieces (",", "·", "C") pass through. */
  text: string;
  /** 1-4, 5 = neutral, 0 = not a pinyin syllable. */
  tone: number;
}

const MARKS: Record<string, string> = {
  a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", ü: "ǖǘǚǜ",
  A: "ĀÁǍÀ", E: "ĒÉĚÈ", I: "ĪÍǏÌ", O: "ŌÓǑÒ", U: "ŪÚǓÙ", Ü: "ǕǗǙǛ",
};

function vowelToMark(base: string): number {
  const lower = base.toLowerCase();
  const ae = lower.search(/[ae]/);
  if (ae >= 0) return ae;
  const ou = lower.indexOf("ou");
  if (ou >= 0) return ou;
  for (let i = lower.length - 1; i >= 0; i--) if ("iouü".includes(lower[i])) return i;
  return -1;
}

/** "lang3" -> { text: "lǎng", tone: 3 } */
export function markSyllable(numbered: string): Syllable {
  const m = /^([A-Za-zÜü:]+)([1-5])$/.exec(numbered);
  if (!m) return { text: numbered.replace(/u:/g, "ü").replace(/U:/g, "Ü"), tone: 0 };
  const base = m[1].replace(/u:/g, "ü").replace(/U:/g, "Ü").replace(/v/g, "ü");
  const tone = Number(m[2]);
  if (tone === 5) return { text: base === "r" ? "r" : base, tone: 5 };
  const at = vowelToMark(base);
  if (at < 0) return { text: base, tone };
  const marked = MARKS[base[at]]?.[tone - 1] ?? base[at];
  return { text: base.slice(0, at) + marked + base.slice(at + 1), tone };
}

/** "Te4 lang3 pu3" -> syllables with tone marks. */
export function parsePinyin(numbered: string): Syllable[] {
  return numbered.split(/\s+/).filter(Boolean).map(markSyllable);
}

/**
 * Joins syllables into standard Hanyu Pinyin orthography for one word:
 * "Tèlǎngpǔ", "Xī'ān". Separators such as "·" keep spaces around them.
 */
export function joinSyllables(syllables: Syllable[]): string {
  let out = "";
  syllables.forEach((s, i) => {
    if (s.tone === 0) {
      out += s.text === "·" || s.text === "," ? ` ${s.text} ` : s.text;
      return;
    }
    const prev = syllables[i - 1];
    if (i > 0 && prev && prev.tone !== 0 && /^[aeoāáǎàēéěèōóǒò]/i.test(s.text)) out += "'";
    out += s.text;
  });
  return out.replace(/\s+/g, " ").trim();
}

/** "Te4 lang3 pu3" -> "Tèlǎngpǔ" */
export function toMarked(numbered: string): string {
  return joinSyllables(parsePinyin(numbered));
}
