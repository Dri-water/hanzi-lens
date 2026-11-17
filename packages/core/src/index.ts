import { Lexicon, type LexiconData } from "./lexicon.js";
import { Dictionary } from "./lookup.js";
import { Segmenter, type Token } from "./segmenter.js";

export * from "./lexicon.js";
export * from "./lookup.js";
export * from "./pinyin.js";
export * from "./segmenter.js";
export { hmmCut } from "./hmm.js";

/** Convenience bundle: one lexicon shared by the segmenter and dictionary. */
export class Engine {
  readonly lexicon: Lexicon;
  readonly segmenter: Segmenter;
  readonly dictionary: Dictionary;

  constructor(data: LexiconData) {
    this.lexicon = new Lexicon(data);
    this.segmenter = new Segmenter(this.lexicon);
    this.dictionary = new Dictionary(this.lexicon);
  }

  segment(text: string): Token[] {
    return this.segmenter.segment(text);
  }

  lookup(token: Token) {
    return this.dictionary.lookupToken(token);
  }
}
