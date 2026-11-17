# Hanzi Lens

Hover over Chinese text to see **where each word begins and ends**, with **pinyin** and **English definitions**.

Chinese is written without spaces, so the hardest part of reading it is often working out which characters belong together. Some lookup extensions only match the longest word starting at the cursor. Hanzi Lens segments the **whole sentence** and tints each word so you can see the boundaries at a glance. That matters most for proper nouns such as 唐纳德·特朗普, 古特雷斯 and 泽连斯基.

> 外交部 · 发言人 · 毛宁 · 就 · 中美 · 关系 · 答记者问
>
> 沪指 · 收涨 · 1.2% · 创业板指 · 涨超 · 2%

Status: early. The browser extension (Chrome / Edge / Firefox) works. A system-wide desktop app is planned (see [Roadmap](#roadmap)).

## Features

- Word segmentation of the whole sentence (jieba-style dictionary DAG + HMM for unknown words), with alternating tints so you can see the boundaries
- Pinyin with tone marks and tone colours, chosen per word, so polyphones like 银行 *yínháng* / 行走 *xíngzǒu* come out right
- CC-CEDICT definitions, with the traditional/simplified alternate form
- Names: dot-joined names (唐纳德·特朗普) become one unit with per-part lookups; unseen transliterations (鲁比奥) are kept together
- Words with no dictionary entry are broken into the dictionary words / characters inside them
- Long words list what they contain (中华人民共和国 → 中华, 人民, 共和国 …)
- Works across inline markup (`<a>`, `<b>`, `<em>`), and on simplified and traditional text
- Runs fully offline. No accounts, no API calls, no tracking.

## Install (from source)

```bash
git clone https://github.com/Dri-water/hanzi-lens.git
cd hanzi-lens
npm install
npm run data     # downloads CC-CEDICT + jieba, builds packages/core/data/lexicon.json
npm run build    # builds packages/extension/dist
```

**Chrome / Edge:** open `chrome://extensions`, enable *Developer mode*, choose *Load unpacked*, and select `packages/extension/dist`.
**Firefox:** open `about:debugging#/runtime/this-firefox`, choose *Load Temporary Add-on*, and select `packages/extension/dist/manifest.json`.

Click the toolbar icon (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>) to turn it on or off. <kbd>Esc</kbd> hides the popup.

## Project layout

```
packages/
  core/        UI-agnostic engine: segmentation, pinyin, dictionary lookup
    src/         segmenter.ts · hmm.ts · lexicon.ts · lookup.ts · pinyin.ts
    scripts/     build-data.mjs (dictionary pipeline) · seg.ts (CLI)
    data/        supplement.u8 (our own additions, CEDICT format)
    test/        headlines.ts (news-headline test cases) · core.test.ts
  extension/   Manifest V3 browser extension (thin front end over core)
    src/         background.ts (owns the dictionary) · content.ts (hover) · popup.ts
    dev/         demo.html: try the content script without installing
```

The core has no DOM or browser dependencies, so a future desktop app (or anything else) can reuse it as is.

## Development

```bash
npm test                                   # headline + unit tests
npm run seg -- "特朗普宣布对华加征关税"         # print a segmentation
npm run seg -- --lookup "美国务卿鲁比奥访华"     # ... with pinyin and definitions
npm run typecheck
```

To try the extension UI without installing it, run `npm run build` and serve `packages/extension/dist` (for example `npx http-server packages/extension/dist`), then open `/demo.html`.

### Testing with headlines

News headlines make a good stress test. They're short, packed with abbreviations (国台办, 沪指, 防长) and full of names that are hard to split. When you find one that segments badly:

1. Add it to [`packages/core/test/headlines.ts`](packages/core/test/headlines.ts) with the segmentation you expect.
2. Fix it, usually by adding a term to [`packages/core/data/supplement.u8`](packages/core/data/supplement.u8) (CC-CEDICT format), then run `npm run data`.
3. Run `npm test`.

## How it works

1. **Lexicon.** About 427k words with frequencies (jieba) plus about 125k CC-CEDICT entries. jieba-only phrase compounds that split cleanly into dictionary words (中美关系 → 中美 + 关系) are pruned, so that boundaries stay useful for learners.
2. **Segmentation.** Build a DAG of every dictionary word in the sentence, then pick the maximum-probability path. Leftover runs of single characters go to an HMM (Viterbi, jieba's model), which recovers unseen words and names. Runs of transliteration characters (斯, 基, 克, 尔 …) are kept together as probable foreign names. Dot-joined names are merged.
3. **Lookup.** Entries are ranked so that common readings come first: 宁 *níng* before the rare 㝉 *zhù*, and "see X" cross-references are resolved.

## Roadmap

- [ ] Publish to the Chrome Web Store / Firefox Add-ons
- [ ] Settings: tint style, popup trigger key, traditional/simplified preference
- [ ] Better polyphone choice for single characters in context (了, 着, 长)
- [ ] More headline test cases (Taiwan / HK / Singapore usage)
- [ ] **Desktop app** (Windows first): hotkey lookup on selected text, then hover via UI Automation, with OCR fallback for images and video subtitles

## License

Code: [MIT](LICENSE).
Dictionary data: [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) (CC BY-SA 4.0) and [jieba](https://github.com/fxsjy/jieba) (MIT). They're downloaded at build time and bundled into built extensions, and the bundled `lexicon.json` is CC BY-SA 4.0.
