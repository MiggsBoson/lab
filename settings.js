// settings.js: each visitor's own preferences, kept in this browser only.
//
//   noSurprises    don't show the server's surprise events
//   noGhosts       don't show other people's cursors or the drifting echoes
//   hideMyCursor   don't send my cursor to anyone
//   nameOnCursor   show my name next to my cursor for others
//   calm           as little motion as possible
//   hideMess       hide stickers, paint and wear (chaos.js has the same switch)
//
// Changing one fires a "lab-setting" event, so features can react straight away.

const KEY = "lab-settings";

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function getSetting(name) {
  if (name === "hideMess") {
    try { return localStorage.getItem("lab-hide-mess") === "1"; } catch { return false; }
  }
  return Boolean(read()[name]);
}

export function setSetting(name, value) {
  try {
    if (name === "hideMess") localStorage.setItem("lab-hide-mess", value ? "1" : "0");
    else localStorage.setItem(KEY, JSON.stringify({ ...read(), [name]: Boolean(value) }));
  } catch {}
  dispatchEvent(new CustomEvent("lab-setting", { detail: { name, value: Boolean(value) } }));
}

export function onSetting(name, fn) {
  addEventListener("lab-setting", (e) => { if (e.detail.name === name) fn(e.detail.value); });
}

// One name for the whole site (the shout box, the golden key, your cursor).
export function getName() {
  try { return localStorage.getItem("lab-shout-name") || ""; } catch { return ""; }
}

export function setName(name) {
  try { localStorage.setItem("lab-shout-name", name); } catch {}
  dispatchEvent(new CustomEvent("lab-setting", { detail: { name: "name", value: name } }));
}

// Less motion: if the visitor's system asks for it, or they turned on calm mode.
export function calm() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches || getSetting("calm");
}
