// Background: owns the dictionary (≈18 MB) so pages don't each load it.
import { Engine, type LexiconData } from "@hanzi-lens/core";
import { ENABLED_KEY, type Request } from "./messages.js";

let engine: Promise<Engine> | null = null;

function getEngine(): Promise<Engine> {
  engine ??= fetch(chrome.runtime.getURL("lexicon.json"))
    .then((r) => r.json() as Promise<LexiconData>)
    .then((data) => new Engine(data))
    .catch((e) => {
      engine = null;
      throw e;
    });
  return engine;
}

chrome.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
  getEngine()
    .then((e) => {
      if (msg.type === "segment") sendResponse({ tokens: e.segment(msg.text) });
      else if (msg.type === "lookup") sendResponse({ info: e.lookup(msg.token) });
    })
    .catch((err) => sendResponse({ error: String(err) }));
  return true; // async response
});

async function setEnabled(enabled: boolean) {
  await chrome.storage.local.set({ [ENABLED_KEY]: enabled });
  await chrome.action.setBadgeText({ text: enabled ? "" : "off" });
  await chrome.action.setBadgeBackgroundColor({ color: "#888" });
  await chrome.action.setTitle({ title: `Hanzi Lens: ${enabled ? "on (click to turn off)" : "off (click to turn on)"}` });
}

async function toggle() {
  const { [ENABLED_KEY]: enabled = true } = await chrome.storage.local.get(ENABLED_KEY);
  await setEnabled(!enabled);
}

chrome.action.onClicked.addListener(toggle);
chrome.commands?.onCommand.addListener((cmd) => {
  if (cmd === "toggle") toggle();
});
chrome.runtime.onStartup?.addListener(async () => {
  const { [ENABLED_KEY]: enabled = true } = await chrome.storage.local.get(ENABLED_KEY);
  await setEnabled(enabled);
});

// Chrome only runs content scripts in pages loaded after install, and an
// update cuts off the copies already running. Without this, every tab that
// was open at install/update time (often a long-lived YouTube or news tab)
// silently does nothing until it's reloaded. The fresh copy tells any stale
// one to step aside (see TAKEOVER in content.ts).
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*", "file:///*"] });
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null || tab.discarded) return;
      const target = { tabId: tab.id, allFrames: true };
      try {
        await chrome.scripting.insertCSS({ target, files: ["content.css"] });
        await chrome.scripting.executeScript({ target, files: ["content.js"] });
      } catch {
        // Pages extensions can't touch (Web Store, other extensions, PDFs).
      }
    }),
  );
});
