// Content script: finds the character under the mouse, asks the background to
// segment the surrounding text, highlights word boundaries and shows a popup.
import type { Token, WordInfo } from "@hanzi-lens/core";
import { ENABLED_KEY, KEEP_OPEN_KEY, type LookupResponse, type Request, type SegmentResponse } from "./messages.js";
import { Popup } from "./popup.js";

const HAN = /\p{Script=Han}/u;
const SENTENCE_END = /[。！？!?；;\n]/;
const MAX_BLOCK_CHARS = 4000;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE"]);
/** With "keep open" on: time to cross the gap between the word and the card. */
const KEEP_OPEN_GRACE_MS = 300;
/** Below Chrome's 30 s idle limit for extension workers (see keepAlive below). */
const KEEPALIVE_MS = 20_000;

interface TextContext {
  text: string;
  nodes: { node: Text; start: number }[];
  tokens: Token[];
}

let enabled = true;
let keepOpen = false;
const popup = new Popup();
const contexts = new WeakMap<Element, { text: string; ctx: Promise<TextContext> }>();
const lookups = new Map<string, Promise<WordInfo | null>>();
let current: { block: Element; token: Token } | null = null;
let pending = false;
let lastEvent: MouseEvent | null = null;
let hideTimer = 0;
/** Text node the pointer is on right now. Cleared when it leaves, so a slow
 *  reply that arrives afterwards doesn't pop up a card for where it used to be. */
let latestNode: Text | null = null;

// --- highlight (CSS Custom Highlight API, with a no-op fallback) -------------
const supportsHighlights = typeof CSS !== "undefined" && "highlights" in CSS;
const hl = supportsHighlights
  ? {
      a: new Highlight(),
      b: new Highlight(),
      active: new Highlight(),
    }
  : null;
if (hl) {
  CSS.highlights.set("hanzi-lens-a", hl.a);
  CSS.highlights.set("hanzi-lens-b", hl.b);
  CSS.highlights.set("hanzi-lens-active", hl.active);
}
function clearHighlights() {
  hl?.a.clear();
  hl?.b.clear();
  hl?.active.clear();
}

// --- messaging ---------------------------------------------------------------
function send<T>(msg: Request): Promise<T> {
  return new Promise((resolve, reject) => {
    // After the extension is updated or reloaded, this copy is cut off from the
    // background for good. Step aside; the background injects a fresh copy.
    if (!chrome.runtime?.id) {
      teardown();
      reject(new Error("extension context invalidated"));
      return;
    }
    try {
      chrome.runtime.sendMessage(msg, (res: T) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(res);
      });
    } catch (e) {
      reject(e); // extension reloaded: context invalidated
    }
  });
}

function lookup(token: Token): Promise<WordInfo | null> {
  const key = `${token.kind}:${token.text}`;
  let p = lookups.get(key);
  if (!p) {
    p = send<LookupResponse>({ type: "lookup", token }).then(
      (r) => ("info" in r ? r.info : null),
      () => {
        lookups.delete(key); // e.g. the worker was restarting: try again next hover
        return null;
      },
    );
    lookups.set(key, p);
    if (lookups.size > 2000) lookups.delete(lookups.keys().next().value!);
  }
  return p;
}

// --- DOM text helpers ----------------------------------------------------------
function caretAt(x: number, y: number): { node: Text; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p && p.offsetNode.nodeType === Node.TEXT_NODE) return { node: p.offsetNode as Text, offset: p.offset };
    return null;
  }
  const r = document.caretRangeFromPoint?.(x, y);
  if (r && r.startContainer.nodeType === Node.TEXT_NODE) return { node: r.startContainer as Text, offset: r.startOffset };
  return null;
}

function rectContains(r: DOMRect, x: number, y: number) {
  return x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1;
}

/** The caret is a boundary; find the character actually under the pointer. */
function charUnderPointer(node: Text, offset: number, x: number, y: number): number | null {
  const range = document.createRange();
  for (const i of [offset, offset - 1]) {
    if (i < 0 || i >= node.length) continue;
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    for (const r of range.getClientRects()) if (rectContains(r, x, y)) return i;
  }
  return null;
}

function isInline(el: Element) {
  const d = getComputedStyle(el).display;
  return d.startsWith("inline") || d === "contents" || d === "ruby" || d === "ruby-text";
}

/** Nearest block-level ancestor, so a headline split across <a>/<em> segments as one. */
function blockFor(node: Text): Element {
  let el = node.parentElement!;
  while (el.parentElement && el !== document.body && isInline(el)) el = el.parentElement;
  return el;
}

function collectText(block: Element, hovered: Text): { text: string; nodes: TextContext["nodes"] } {
  const nodes: TextContext["nodes"] = [];
  let text = "";
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || SKIP_TAGS.has(p.tagName) || p.closest("[data-hanzi-lens]")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    nodes.push({ node: n, start: text.length });
    text += n.data;
    if (text.length > MAX_BLOCK_CHARS) {
      // Huge container: fall back to just the hovered text node.
      return { text: hovered.data, nodes: [{ node: hovered, start: 0 }] };
    }
  }
  return { text, nodes };
}

function getContext(block: Element, hovered: Text): Promise<TextContext> {
  const { text, nodes } = collectText(block, hovered);
  const cached = contexts.get(block);
  if (cached && cached.text === text) {
    // nodes may have been replaced with identical text; refresh positions
    return cached.ctx.then((c) => ({ ...c, nodes }));
  }
  const entry = {
    text,
    ctx: send<SegmentResponse>({ type: "segment", text }).then((r) => {
      if ("error" in r) throw new Error(r.error);
      return { text, nodes, tokens: r.tokens };
    }),
  };
  // Don't remember a failure, or this block would stay dead until a page reload.
  entry.ctx.catch(() => contexts.get(block) === entry && contexts.delete(block));
  const ctx = entry.ctx;
  contexts.set(block, entry);
  return ctx;
}

function rangeFor(ctx: TextContext, start: number, end: number): Range | null {
  const range = document.createRange();
  const locate = (g: number, isEnd: boolean) => {
    for (let i = 0; i < ctx.nodes.length; i++) {
      const { node, start: s } = ctx.nodes[i];
      const e = s + node.length;
      if (isEnd ? g > s && g <= e : g >= s && g < e) return { node, offset: g - s };
    }
    return null;
  };
  const a = locate(start, false);
  const b = locate(end, true);
  if (!a || !b) return null;
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

const isChinese = (t: Token) => t.kind === "word" || t.kind === "name";

// --- hover handling ------------------------------------------------------------
async function handleHover(e: MouseEvent) {
  if (!enabled) return;
  const target = e.target as Element | null;
  if (target?.closest?.("[data-hanzi-lens]")) {
    // Only reachable with "keep open" on (otherwise the card ignores the mouse).
    return cancelHide();
  }
  const caret = caretAt(e.clientX, e.clientY);
  const idx = caret && charUnderPointer(caret.node, caret.offset, e.clientX, e.clientY);
  if (!caret || idx == null || !HAN.test(caret.node.data[idx] ?? "")) return leave();
  sawChinese();

  const block = blockFor(caret.node);
  // Pointer moved to a paragraph we haven't segmented yet: the old card is
  // no longer about what's under the pointer, so drop it now.
  if (current && current.block !== block) hide();
  latestNode = caret.node;
  const ctx = await getContext(block, caret.node).catch(() => null);
  if (latestNode !== caret.node) return; // pointer has moved on
  if (!ctx) return leave();
  const nodeStart = ctx.nodes.find((n) => n.node === caret.node)?.start;
  if (nodeStart == null) return leave();
  const g = nodeStart + idx;
  const ti = ctx.tokens.findIndex((t) => t.start <= g && g < t.end);
  const token = ctx.tokens[ti];
  if (!token || !isChinese(token)) return leave();
  cancelHide();

  if (current && current.block === block && current.token.start === token.start && current.token.end === token.end) return;
  current = { block, token };

  const tokenRange = rangeFor(ctx, token.start, token.end);
  if (!tokenRange) return;
  highlightSentence(ctx, ti, tokenRange);

  const info = await lookup(token);
  if (current?.token !== token || !info) return;
  popup.show(info, tokenRange.getBoundingClientRect());
}

/** The pointer is no longer on a Chinese word. */
function leave() {
  latestNode = null;
  if (!current) return;
  if (!keepOpen) return hide();
  if (hideTimer) return; // already counting down
  hideTimer = window.setTimeout(hide, KEEP_OPEN_GRACE_MS);
}
function cancelHide() {
  clearTimeout(hideTimer);
  hideTimer = 0;
}

// --- keeping the background warm ------------------------------------------------
// Chrome stops an idle extension worker after 30 s; restarting it means
// reloading the whole dictionary (~0.5-1.5 s), which is exactly the lag of the
// first hover after reading for a while. While a tab with Chinese on it is
// visible, a tiny ping every 20 s keeps the dictionary loaded. Hidden tabs and
// non-Chinese pages don't ping, so Chrome can still unload it when unused.
let chinesePage = false;
let keepAliveTimer = 0;
function ping() {
  if (enabled && chinesePage && document.visibilityState === "visible") send({ type: "ping" }).catch(() => {});
}
function sawChinese() {
  if (chinesePage) return;
  chinesePage = true;
  ping(); // load now, while the mouse is still on its way to the word
  keepAliveTimer = window.setInterval(ping, KEEPALIVE_MS);
}
const onVisibility = () => ping();
/** Cheap look at the page's first text, to warm up before the first hover. */
function pageLooksChinese() {
  if (/^zh/i.test(document.documentElement.lang) || HAN.test(document.title)) return true;
  if (!document.body) return false;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let n = walker.nextNode(); n && seen < 50_000; n = walker.nextNode()) {
    const t = (n as Text).data;
    if (HAN.test(t) && !SKIP_TAGS.has(n.parentElement?.tagName ?? "")) return true;
    seen += t.length;
  }
  return false;
}

/** Alternate-tint every word in the sentence so boundaries are visible. */
function highlightSentence(ctx: TextContext, ti: number, active: Range) {
  clearHighlights();
  if (!hl) return;
  let s = ti;
  while (s > 0 && !SENTENCE_END.test(ctx.tokens[s - 1].text)) s--;
  let e = ti;
  while (e < ctx.tokens.length - 1 && !SENTENCE_END.test(ctx.tokens[e + 1].text)) e++;
  let alt = false;
  for (let i = s; i <= e; i++) {
    const t = ctx.tokens[i];
    if (!isChinese(t)) continue;
    if (i !== ti) {
      const r = rangeFor(ctx, t.start, t.end);
      if (r) (alt ? hl.b : hl.a).add(r);
    }
    alt = !alt;
  }
  hl.active.add(active);
}

function hide() {
  cancelHide();
  latestNode = null;
  current = null;
  clearHighlights();
  popup.hide();
}

// --- lifecycle -------------------------------------------------------------------
function onMouseMove(e: MouseEvent) {
  lastEvent = e;
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    if (lastEvent) handleHover(lastEvent);
  });
}
const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && hide();
/** Hide only when the hovered text itself moves, not when some unrelated
 *  panel scrolls (live chat, carousels, auto-scrolling feeds). */
function onScroll(e: Event) {
  if (!current) return;
  const t = e.target;
  if (t === document || t === window || (t instanceof Node && t.contains(current.block))) hide();
}
function onStorage(changes: Record<string, chrome.storage.StorageChange>) {
  if (ENABLED_KEY in changes) {
    enabled = changes[ENABLED_KEY].newValue ?? true;
    if (!enabled) hide();
  }
  if (KEEP_OPEN_KEY in changes) setKeepOpen(changes[KEEP_OPEN_KEY].newValue);
}
function setKeepOpen(v: unknown) {
  keepOpen = v === true;
  popup.setInteractive(keepOpen);
  if (!keepOpen) hide();
}

const TAKEOVER = "hanzi-lens:takeover";
let alive = true;

function teardown() {
  if (!alive) return;
  alive = false;
  hide();
  popup.destroy();
  window.removeEventListener("mousemove", onMouseMove, true);
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("blur", hide);
  document.removeEventListener("visibilitychange", onVisibility);
  clearInterval(keepAliveTimer);
  document.removeEventListener(TAKEOVER, teardown);
  try {
    chrome.storage.onChanged.removeListener(onStorage);
  } catch {
    // context already invalidated
  }
}

// A newer copy (after an update, or injected into an already-open tab) tells
// any older copy in this page to step aside. DOM events cross isolated worlds.
document.dispatchEvent(new CustomEvent(TAKEOVER));
document.addEventListener(TAKEOVER, teardown);
// Versions before 0.1.3 don't know TAKEOVER; drop their (now unusable) popup.
for (const stale of document.querySelectorAll("[data-hanzi-lens]")) stale.remove();

// Capture phase on window: pages that stop mousemove propagation (video
// players, canvases, drag handlers) can't hide it from us.
window.addEventListener("mousemove", onMouseMove, { passive: true, capture: true });
window.addEventListener("keydown", onKeyDown, true);
window.addEventListener("scroll", onScroll, { passive: true, capture: true });
window.addEventListener("blur", hide);
document.addEventListener("visibilitychange", onVisibility);

chrome.storage.local.get([ENABLED_KEY, KEEP_OPEN_KEY], (r) => {
  enabled = r[ENABLED_KEY] ?? true;
  keepOpen = r[KEEP_OPEN_KEY] === true;
  popup.setInteractive(keepOpen);
  // Load the dictionary before the first hover. Only the top frame looks;
  // iframes start pinging once Chinese is actually hovered in them.
  if (window === window.top && pageLooksChinese()) sawChinese();
});
chrome.storage.onChanged.addListener(onStorage);
