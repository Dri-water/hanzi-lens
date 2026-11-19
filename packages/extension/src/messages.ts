import type { Token, WordInfo } from "@hanzi-lens/core";

export type Request =
  | { type: "segment"; text: string }
  | { type: "lookup"; token: Token }
  /** Several at once: the words around the hovered one, fetched ahead of time. */
  | { type: "lookupMany"; tokens: Token[] }
  /** Wakes the background and loads the dictionary ahead of the first hover. */
  | { type: "ping" };

export type SegmentResponse = { tokens: Token[] } | { error: string };
export type LookupResponse = { info: WordInfo } | { error: string };
export type LookupManyResponse = { infos: WordInfo[] } | { error: string };

export const ENABLED_KEY = "enabled";
/** Setting: keep the definition open while the pointer is on it (default off). */
export const KEEP_OPEN_KEY = "keepOpenOnPopup";
