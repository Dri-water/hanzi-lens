import type { Token, WordInfo } from "@hanzi-lens/core";

export type Request =
  | { type: "segment"; text: string }
  | { type: "lookup"; token: Token };

export type SegmentResponse = { tokens: Token[] } | { error: string };
export type LookupResponse = { info: WordInfo } | { error: string };

export const ENABLED_KEY = "enabled";
