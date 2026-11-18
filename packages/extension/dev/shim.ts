// Fakes the bits of the extension API the content script uses, running the
// engine in-page, so the demo page works in any browser without installing.
import { Engine, type LexiconData } from "@hanzi-lens/core";
import type { Request } from "../src/messages.js";

const engine: Promise<Engine> = fetch("lexicon.json")
  .then((r) => r.json() as Promise<LexiconData>)
  .then((d) => new Engine(d));

(globalThis as any).chrome = {
  runtime: {
    id: "demo",
    lastError: undefined,
    getURL: (p: string) => p,
    sendMessage(msg: Request, cb: (r: unknown) => void) {
      engine.then((e) => cb(msg.type === "segment" ? { tokens: e.segment(msg.text) } : { info: e.lookup(msg.token) }));
    },
  },
  storage: {
    local: { get: (_k: string, cb: (r: object) => void) => cb({}) },
    onChanged: { addListener() {} },
  },
};
