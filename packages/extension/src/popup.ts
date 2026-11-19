import type { Definition, Syllable, WordInfo } from "@hanzi-lens/core";

const CSS_TEXT = `
:host { all: initial; }
.card {
  position: fixed; z-index: 2147483647; max-width: 380px; min-width: 180px;
  max-height: 60vh; overflow: auto; box-sizing: border-box;
  padding: 10px 12px; border-radius: 10px;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #1d1d1f; background: #fffefa; border: 1px solid #d9d4c7;
  box-shadow: 0 6px 24px rgba(0,0,0,.18);
  /* By default the card is see-through to the mouse: it never blocks hovering
     the text under it, and it goes away as soon as the pointer leaves the word. */
  pointer-events: none;
}
.card.interactive { pointer-events: auto; }
.head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.hanzi { font: 26px/1.2 "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif; }
.alt { color: #8a8578; font-size: 15px; }
.py { font-size: 16px; }
.approx { color: #8a8578; font-size: 11px; margin-left: 2px; }
.t1 { color: #d0342c; } .t2 { color: #d98b00; } .t3 { color: #2e8b57; } .t4 { color: #2f6fd6; } .t5, .t0 { color: #777; }
ol { margin: 6px 0 0; padding-left: 20px; }
li { margin: 1px 0; }
.entry + .entry { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #e4dfd2; }
.entry-py { font-size: 13px; }
.section { margin-top: 8px; padding-top: 6px; border-top: 1px solid #ebe6da; }
.label { color: #8a8578; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.row { display: flex; gap: 8px; align-items: baseline; margin-top: 2px; }
.row .w { font: 16px/1.3 "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif; white-space: nowrap; }
.row .g { color: #444; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.none { color: #8a8578; font-style: italic; margin-top: 4px; }
.loading { display: inline-flex; gap: 4px; align-items: center; margin-left: 4px; }
.loading i { width: 6px; height: 6px; border-radius: 50%; background: #b9b3a4; animation: hl-dot 0.9s infinite ease-in-out; }
.loading i:nth-child(2) { animation-delay: .15s; } .loading i:nth-child(3) { animation-delay: .3s; }
@keyframes hl-dot { 0%, 80%, 100% { opacity: .25; transform: scale(.8); } 40% { opacity: 1; transform: scale(1); } }
@media (prefers-color-scheme: dark) {
  .card { color: #ece9e1; background: #24231f; border-color: #45423a; }
  .alt, .approx, .label, .none { color: #a19c8f; }
  .row .g { color: #cfcabd; }
  .entry + .entry { border-top-color: #3a3832; } .section { border-top-color: #3a3832; }
  .t1 { color: #ff6b61; } .t2 { color: #f0b23e; } .t3 { color: #5fc48a; } .t4 { color: #6ea2ff; }
}
`;

const MAX_ENTRIES = 4;
const MAX_DEFS = 6;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function pinyinEl(syllables: Syllable[], cls = "py") {
  const span = el("span", cls);
  syllables.forEach((s, i) => {
    const prev = syllables[i - 1];
    if (s.tone === 0) {
      span.append(s.text === "·" ? " · " : s.text);
      return;
    }
    if (prev && prev.tone !== 0 && /^[aeoāáǎàēéěèōóǒò]/i.test(s.text)) span.append("'");
    span.append(el("span", `t${s.tone}`, s.text));
  });
  return span;
}

function entryEl(d: Definition, showPinyin: boolean) {
  const box = el("div", "entry");
  if (showPinyin || d.altForm) {
    const head = el("div");
    if (showPinyin) head.append(pinyinEl(d.syllables, "entry-py"));
    if (d.altForm) head.append(el("span", "alt", `  ${d.altForm}`));
    box.append(head);
  }
  const ol = el("ol");
  for (const text of d.definitions.slice(0, MAX_DEFS)) ol.append(el("li", undefined, text));
  box.append(ol);
  if (d.definitions.length > MAX_DEFS) box.append(el("div", "alt", `+${d.definitions.length - MAX_DEFS} more`));
  return box;
}

export class Popup {
  private host: HTMLElement | null = null;
  private card!: HTMLDivElement;
  private interactive = false;

  /** Interactive: the pointer can move onto the card (to scroll or select). */
  setInteractive(on: boolean) {
    this.interactive = on;
    this.card?.classList.toggle("interactive", on);
  }

  private ensure() {
    if (this.host?.isConnected) return;
    this.host = document.createElement("div");
    this.host.setAttribute("data-hanzi-lens", "");
    const root = this.host.attachShadow({ mode: "open" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS_TEXT);
      root.adoptedStyleSheets = [sheet];
    } catch {
      root.append(el("style", undefined, CSS_TEXT));
    }
    this.card = el("div", "card");
    this.card.classList.toggle("interactive", this.interactive);
    this.card.style.display = "none";
    root.append(this.card);
    document.documentElement.append(this.host);
  }

  show(info: WordInfo, anchor: DOMRect) {
    this.ensure();
    const c = this.card;
    c.replaceChildren();

    const head = el("div", "head");
    head.append(el("span", "hanzi", info.word));
    if (info.syllables.length) head.append(pinyinEl(info.syllables));
    if (info.syllables.length && !info.pinyinExact) {
      const a = el("span", "approx", "(per character)");
      a.title = "No dictionary entry for the whole word; pinyin is stitched from its characters.";
      head.append(a);
    }
    const alt = info.definitions[0]?.altForm;
    if (alt) head.append(el("span", "alt", alt));
    c.append(head);

    // Entries: the first one's pinyin is already in the header.
    info.definitions.slice(0, MAX_ENTRIES).forEach((d, i) => {
      c.append(entryEl(i === 0 ? { ...d, altForm: undefined } : d, i > 0 && d.pinyin !== info.pinyin));
    });
    if (info.definitions.length === 0 && info.parts.length === 0) c.append(el("div", "none", "No dictionary entry."));

    if (info.parts.length) {
      const sec = el("div", "section");
      const isName = /[·・‧•･]/.test(info.word);
      sec.append(el("div", "label", isName ? "Name parts" : info.definitions.length ? "Parts" : "Not in dictionary — parts"));
      for (const p of info.parts) {
        const row = el("div", "row");
        row.append(el("span", "w", p.word), pinyinEl(p.syllables));
        row.append(el("span", "g", p.definitions[0]?.definitions.slice(0, 2).join("; ") ?? ""));
        sec.append(row);
      }
      c.append(sec);
    }

    if (info.contains.length) {
      const sec = el("div", "section");
      sec.append(el("div", "label", "Contains"));
      for (const w of info.contains) {
        const row = el("div", "row");
        row.append(el("span", "w", w.word), el("span", "alt", w.pinyin), el("span", "g", w.gloss));
        sec.append(row);
      }
      c.append(sec);
    }

    c.style.display = "block";
    c.scrollTop = 0;
    this.position(anchor);
  }

  /** The word right away, with a loader while its entry is on the way. */
  showLoading(word: string, anchor: DOMRect) {
    this.ensure();
    const c = this.card;
    const head = el("div", "head");
    const dots = el("span", "loading");
    dots.append(el("i"), el("i"), el("i"));
    dots.setAttribute("aria-label", "Loading");
    head.append(el("span", "hanzi", word), dots);
    c.replaceChildren(head);
    c.style.display = "block";
    this.position(anchor);
  }

  private position(a: DOMRect) {
    const c = this.card;
    const gap = 6;
    const w = c.offsetWidth;
    const h = c.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const left = Math.max(4, Math.min(a.left, vw - w - 4));
    const below = a.bottom + gap;
    const top = below + h <= vh || a.top - gap - h < 0 ? below : a.top - gap - h;
    c.style.left = `${left}px`;
    c.style.top = `${Math.max(4, top)}px`;
  }

  hide() {
    if (this.card) this.card.style.display = "none";
  }

  destroy() {
    this.host?.remove();
    this.host = null;
  }
}
