export type HmmState = "B" | "M" | "E" | "S";

export interface HmmModel {
  start: Record<HmmState, number>;
  trans: Record<HmmState, Partial<Record<HmmState, number>>>;
  emit: Record<HmmState, Record<string, number>>;
}

/** The compiled data file produced by `scripts/build-data.mjs`. */
export interface LexiconData {
  version: number;
  /** Sum of all frequencies. */
  total: number;
  /**
   * Corpus frequencies (jieba + all CC-CEDICT headwords) as parallel arrays:
   * `words` is newline-joined, `freqs[i]` belongs to the i-th word. Much faster
   * to load than a 430k-key object, which matters on every worker cold start.
   */
  words: string;
  freqs: number[];
  /** CC-CEDICT rows: [traditional, simplified, numbered pinyin, "/"-joined definitions]. */
  entries: [string, string, string, string][];
  hmm: HmmModel;
}

export interface DictEntry {
  traditional: string;
  simplified: string;
  /** Numbered pinyin as in CC-CEDICT, e.g. "Te4 lang3 pu3". */
  pinyin: string;
  definitions: string[];
}

/** In-memory dictionary: frequencies for segmentation, CC-CEDICT for lookup. */
export class Lexicon {
  readonly total: number;
  readonly logTotal: number;
  readonly maxWordLength: number;
  readonly hmm: HmmModel;
  private readonly freq: Map<string, number>;
  private readonly rows: LexiconData["entries"];
  private readonly index = new Map<string, number[]>();

  constructor(data: LexiconData) {
    this.total = data.total;
    this.logTotal = Math.log(data.total);
    this.hmm = data.hmm;
    this.rows = data.entries;
    const words = data.words.split("\n");
    this.freq = new Map();
    let max = 1;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      this.freq.set(w, data.freqs[i]);
      if (w.length > max) max = w.length;
    }
    this.maxWordLength = Math.min(max, 24);
    this.rows.forEach(([trad, simp], i) => {
      this.addIndex(simp, i);
      if (trad !== simp) this.addIndex(trad, i);
    });
  }

  private addIndex(word: string, i: number) {
    const list = this.index.get(word);
    if (list) list.push(i);
    else this.index.set(word, [i]);
  }

  /** Corpus frequency, 0 if the word is not in the segmentation dictionary. */
  frequency(word: string): number {
    return this.freq.get(word) ?? 0;
  }

  /** True if CC-CEDICT has a definition for this exact headword. */
  hasEntry(word: string): boolean {
    return this.index.has(word);
  }

  entries(word: string): DictEntry[] {
    const ids = this.index.get(word);
    if (!ids) return [];
    return ids.map((i) => {
      const [traditional, simplified, pinyin, defs] = this.rows[i];
      return { traditional, simplified, pinyin, definitions: defs.split("/") };
    });
  }
}
