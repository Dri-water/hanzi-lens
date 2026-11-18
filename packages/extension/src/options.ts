// Options page (right-click the toolbar icon → Options).
import { KEEP_OPEN_KEY } from "./messages.js";

const box = document.getElementById("keepOpen") as HTMLInputElement;
const saved = document.getElementById("saved")!;

chrome.storage.local.get(KEEP_OPEN_KEY, (r) => {
  box.checked = r[KEEP_OPEN_KEY] === true;
});
box.addEventListener("change", () => {
  chrome.storage.local.set({ [KEEP_OPEN_KEY]: box.checked }, () => {
    saved.textContent = "Saved. Applies to open tabs right away.";
  });
});
