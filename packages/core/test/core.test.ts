import { beforeAll, describe, expect, it } from "vitest";
import { Engine, markSyllable, toMarked } from "../src/index.js";
import { HEADLINES } from "./headlines.js";
import { loadLexiconData } from "./load.js";

let engine: Engine;
beforeAll(() => {
  engine = new Engine(loadLexiconData());
});

const seg = (text: string) =>
  engine
    .segment(text)
    .filter((t) => t.kind !== "space")
    .map((t) => t.text)
    .join(" / ");

describe("headline segmentation", () => {
  for (const h of HEADLINES) {
    it(h.text, () => expect(seg(h.text)).toBe(h.expect));
  }
});

describe("segmenter", () => {
  it("offsets map back to the input", () => {
    const text = "  唐纳德·特朗普说：“Hello”，涨1.2%。";
    for (const t of engine.segment(text)) expect(text.slice(t.start, t.end)).toBe(t.text);
  });

  it("covers the input with no gaps", () => {
    const text = "新華社北京11月17日電 abc ＡＢＣ １２３ 𠮷野家";
    const tokens = engine.segment(text);
    expect(tokens.map((t) => t.text).join("")).toBe(text);
  });

  it("marks dot-joined names with parts", () => {
    const name = engine.segment("唐纳德·特朗普").find((t) => t.kind === "name")!;
    expect(name.parts!.map((p) => p.text)).toEqual(["唐纳德", "特朗普"]);
  });

  it("classifies numbers and latin", () => {
    const kinds = engine.segment("涨1.2% SpaceX").filter((t) => t.kind !== "space").map((t) => t.kind);
    expect(kinds).toEqual(["word", "number", "latin"]);
  });
});

describe("lookup", () => {
  const info = (w: string) => engine.lookup(engine.segment(w)[0]);

  it("gives pinyin and English", () => {
    const i = info("特朗普");
    expect(i.pinyin).toBe("Tèlǎngpǔ");
    expect(i.definitions[0].definitions[0]).toMatch(/Trump/);
  });

  it("uses word-level pinyin for polyphones", () => {
    expect(info("银行").pinyin).toBe("yínháng");
    expect(info("行走").pinyin).toBe("xíngzǒu");
    expect(info("长大").pinyin).toBe("zhǎngdà");
  });

  it("prefers the common reading of a character", () => {
    expect(info("宁").pinyin).toBe("níng");
  });

  it("breaks unknown words into parts", () => {
    const i = info("毛宁");
    expect(i.definitions).toHaveLength(0);
    expect(i.parts.map((p) => p.word)).toEqual(["毛", "宁"]);
    expect(i.pinyin).toBe("máoníng");
    expect(i.pinyinExact).toBe(false);
  });

  it("lists words contained in long words", () => {
    const words = info("中华人民共和国").contains.map((c) => c.word);
    expect(words).toContain("人民");
    expect(words).toContain("共和国");
  });

  it("looks up name parts", () => {
    const t = engine.segment("唐纳德·特朗普")[0];
    const i = engine.lookup(t);
    expect(i.parts.map((p) => p.pinyin)).toEqual(["Tángnàdé", "Tèlǎngpǔ"]);
  });

  it("handles traditional text", () => {
    const d = info("關稅").definitions[0];
    expect(d.headword).toBe("關稅");
    expect(d.altForm).toBe("关税");
  });
});

describe("pinyin", () => {
  it("places tone marks", () => {
    expect(markSyllable("lu:e4").text).toBe("lüè");
    expect(markSyllable("gou3").text).toBe("gǒu");
    expect(markSyllable("hui4").text).toBe("huì");
    expect(markSyllable("liu2").text).toBe("liú");
    expect(markSyllable("de5")).toEqual({ text: "de", tone: 5 });
  });

  it("joins with apostrophes", () => {
    expect(toMarked("Xi1 an1")).toBe("Xī'ān");
    expect(toMarked("Tian1 an1 men2")).toBe("Tiān'ānmén");
  });
});
