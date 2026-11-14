// menu.js: getting around and making the lab yours.  together.js starts it.
//
//   🧭 Rooms         every page, with how many people are in it right now
//   command palette  press / or Ctrl+K anywhere, type, press Enter
//   while you were away   what changed since your last visit
//   your name, your settings, and a share button for Messenger

import { getSetting, setSetting, getName, setName } from "./settings.js";

export const ROOMS = [
  { page: "home", title: "Home", emoji: "🏠" },
  { page: "jam", title: "Jam", emoji: "🎛️" },
  { page: "magnets", title: "Fridge magnets", emoji: "🧲" },
  { page: "note", title: "Pass it on", emoji: "✉️" },
  { page: "tug", title: "Tug of war", emoji: "🪢" },
  { page: "plant", title: "The plant", emoji: "🪴" },
  { page: "chess", title: "Chess", emoji: "♟️" },
  { page: "live", title: "Live data", emoji: "📡" },
  { page: "playground", title: "Playground", emoji: "🎲" },
  { page: "hello", title: "Hello", emoji: "👋" },
];

const SWITCHES = [
  { name: "noSurprises", label: "Turn off surprises for me" },
  { name: "noGhosts", label: "Hide other people's cursors and echoes" },
  { name: "hideMyCursor", label: "Don't show my cursor to anyone" },
  { name: "nameOnCursor", label: "Show my name on my cursor" },
  { name: "calm", label: "Calm mode (less motion)" },
  { name: "hideMess", label: "Hide the mess (stickers, paint, wear)" },
];

export function startMenu({ on, send, page, bar }) {
  let perPage = {};
  let everyone = 1;

  // From this page to another, on localhost and online (/lab/...).
  const link = (target) => {
    const up = page === "home" ? "./" : "../";
    return target === "home" ? up : `${up}${target}/`;
  };

  // ---- Small toasts in the corner ------------------------------------------------------

  const toasts = make("div", "toasts");
  toasts.setAttribute("aria-live", "polite");
  document.body.append(toasts);
  function toast(content, ms = 5000) {
    const t = make("div", "toast");
    t.append(...(Array.isArray(content) ? content : [content]));
    const close = make("button", "toast-close");
    close.type = "button";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Dismiss");
    close.addEventListener("click", () => t.remove());
    t.append(close);
    toasts.append(t);
    if (ms) setTimeout(() => t.remove(), ms);
    return t;
  }

  // ---- The 🧭 panel -------------------------------------------------------------------

  const button = make("button", "together-menu");
  button.type = "button";
  button.textContent = "🧭";
  button.setAttribute("aria-label", "Rooms, settings and sharing");
  button.setAttribute("aria-expanded", "false");
  bar.insertBefore(button, bar.querySelector(".together-mess"));

  const panel = make("div", "menu-panel");
  panel.hidden = true;
  panel.setAttribute("aria-label", "Rooms, settings and sharing");
  document.body.append(panel);

  const roomList = make("ul", "rooms");
  const nameBox = document.createElement("input");
  nameBox.type = "text";
  nameBox.maxLength = 20;
  nameBox.placeholder = "Your name (optional)";
  nameBox.setAttribute("aria-label", "Your name, used across the lab");
  nameBox.value = getName();
  nameBox.addEventListener("change", () => { setName(nameBox.value.trim()); toast("Name saved."); });

  const switches = SWITCHES.map(({ name, label }) => {
    const row = make("label", "menu-switch");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = getSetting(name);
    box.addEventListener("change", () => {
      setSetting(name, box.checked);
      if (name === "calm") document.documentElement.classList.toggle("calm", box.checked);
    });
    row.append(box, ` ${label}`);
    return { name, box, row };
  });
  addEventListener("lab-setting", (e) => {   // keep the boxes in step if something else flips a setting
    const s = switches.find((s) => s.name === e.detail.name);
    if (s) s.box.checked = e.detail.value;
  });

  const shareButton = make("button", "secondary");
  shareButton.type = "button";
  shareButton.textContent = "📤 Share this page";
  shareButton.addEventListener("click", share);

  const tip = make("p", "muted menu-tip");
  tip.textContent = "Tip: press / or Ctrl+K anywhere to jump around.";

  const heading = (text) => { const h = make("h3", "menu-heading"); h.textContent = text; return h; };
  panel.append(heading("Rooms"), roomList, heading("You"), nameBox, ...switches.map((s) => s.row),
               make("div", "menu-actions"), tip);
  panel.querySelector(".menu-actions").append(shareButton);

  function showRooms() {
    roomList.replaceChildren(...ROOMS.map((r) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = link(r.page);
      a.textContent = `${r.emoji} ${r.title}`;
      if (r.page === page) a.setAttribute("aria-current", "page");
      const n = perPage[r.page] || 0;
      const badge = make("span", n ? "room-count live" : "room-count");
      badge.textContent = r.page === page ? (n > 1 ? `you + ${n - 1}` : "you're here") : n ? `${n} here` : "";
      li.append(a, badge);
      return li;
    }));
  }

  function openPanel(open) {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", open);
    if (open) { showRooms(); nameBox.value = getName(); }
  }
  button.addEventListener("click", () => openPanel(panel.hidden));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") openPanel(false); });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== button) openPanel(false);
  });

  on("presence", (msg) => {
    everyone = msg.count;
    perPage = msg.pages || {};
    if (!panel.hidden) showRooms();
  });

  async function share() {
    const url = location.href.split(/[?#]/)[0];
    if (navigator.share) {
      try { await navigator.share({ title: document.title, url }); } catch {}
      return;
    }
    try { await navigator.clipboard.writeText(url); toast("Link copied.  Paste it into Messenger."); }
    catch { toast(url, 12000); }
  }

  // ---- While you were away -----------------------------------------------------------------

  let previous = 0;
  try { previous = Number(localStorage.getItem("lab-last-seen")) || 0; } catch {}
  const markSeen = () => { try { localStorage.setItem("lab-last-seen", String(Date.now())); } catch {} };
  document.addEventListener("visibilitychange", () => { if (document.hidden) markSeen(); });
  addEventListener("pagehide", markSeen);
  setInterval(() => { if (!document.hidden) markSeen(); }, 30_000);

  let askedSince = false;
  on("open", () => {
    if (askedSince || !previous || Date.now() - previous < 15 * 60_000) return;
    askedSince = true;
    send({ type: "since", t: previous });
  });

  let lastDigest = null;
  on("since", (msg) => {
    const c = msg.counts || {};
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const lines = [
      c.stickers && `🖼️ ${plural(c.stickers, "new sticker", "new stickers")}`,
      c.paint && `🎨 ${plural(c.paint, "new paint mark", "new paint marks")}`,
      c.shouts && `📣 ${plural(c.shouts, "shout", "shouts")}`,
      c.notes && `✉️ ${plural(c.notes, "note passed on", "notes passed on")}`,
      c.ideas && `💡 ${plural(c.ideas, "new idea", "new ideas")}`,
      c.polls && `📊 ${plural(c.polls, "new poll", "new polls")}`,
      c.chess && "♟️ the chess game moved on",
    ].filter(Boolean);
    if (!lines.length) return;
    lastDigest = lines;
    showDigest(lines);
  });
  function showDigest(lines) {
    const head = make("strong", "");
    head.textContent = `While you were away (${ago(previous)}):`;
    const list = make("ul", "digest");
    for (const line of lines) { const li = document.createElement("li"); li.textContent = line; list.append(li); }
    toast([head, list], 15000);
  }

  // ---- Command palette -------------------------------------------------------------------

  const overlay = make("div", "palette-overlay");
  overlay.hidden = true;
  const box = make("div", "palette");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Command palette");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Go to, react, toggle…";
  input.setAttribute("aria-label", "Type a command");
  input.setAttribute("aria-controls", "palette-list");
  const list = make("ul", "palette-list");
  list.id = "palette-list";
  list.setAttribute("role", "listbox");
  box.append(input, list);
  overlay.append(box);
  document.body.append(overlay);

  const commands = () => [
    ...ROOMS.filter((r) => r.page !== page).map((r) => ({
      label: `${r.emoji} Go to ${r.title}`, hint: perPage[r.page] ? `${perPage[r.page]} here` : "",
      run: () => { location.href = link(r.page); },
    })),
    ...["👋", "😂", "❤️", "🔥", "🎉", "😮"].map((e) => ({ label: `${e} Send ${e} to everyone`, run: () => send({ type: "react", emoji: e }) })),
    { label: "🎨 Stickers and paint", run: () => document.querySelector(".together-mess")?.click() },
    { label: "📤 Share this page", run: share },
    { label: "✏️ Set your name", run: () => { openPanel(true); nameBox.focus(); } },
    { label: "🕰️ What changed while I was away", run: () => (lastDigest ? showDigest(lastDigest) : toast("Nothing new since your last visit.")) },
    ...SWITCHES.map((s) => ({
      label: `${getSetting(s.name) ? "☑" : "☐"} ${s.label}`,
      run: () => {
        setSetting(s.name, !getSetting(s.name));
        if (s.name === "calm") document.documentElement.classList.toggle("calm", getSetting("calm"));
        toast(`${s.label}: ${getSetting(s.name) ? "on" : "off"}.`);
      },
    })),
    { label: "⬆️ Back to the top", run: () => scrollTo({ top: 0, behavior: "smooth" }) },
    { label: `👥 ${everyone === 1 ? "Just you here" : `${everyone} people on the lab`}`, run: () => openPanel(true) },
  ];

  let shown = [];
  let pick = 0;
  // Fuzzy match: the letters you type must appear in order ("gtj" finds "Go to Jam").
  const matches = (text, q) => {
    let i = 0;
    for (const ch of text.toLowerCase()) if (ch === q[i]) i++;
    return i === q.length;
  };
  function filter() {
    const q = input.value.trim().toLowerCase().replace(/\s+/g, "");
    shown = commands().filter((c) => matches(c.label.replace(/\s+/g, ""), q)).slice(0, 12);
    pick = Math.min(pick, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((c, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === pick);
      li.textContent = c.label;
      if (c.hint) { const h = make("span", "palette-hint"); h.textContent = c.hint; li.append(h); }
      li.addEventListener("click", () => run(i));
      return li;
    }));
    if (!shown.length) { const li = document.createElement("li"); li.className = "muted"; li.textContent = "Nothing matches."; list.append(li); }
  }
  function run(i) {
    const c = shown[i];
    closePalette();
    c?.run();
  }
  function openPalette() {
    overlay.hidden = false;
    input.value = "";
    pick = 0;
    filter();
    input.focus();
  }
  function closePalette() { overlay.hidden = true; }

  input.addEventListener("input", () => { pick = 0; filter(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); pick = (pick + 1) % Math.max(1, shown.length); filter(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); pick = (pick - 1 + shown.length) % Math.max(1, shown.length); filter(); }
    else if (e.key === "Enter") { e.preventDefault(); run(pick); }
    else if (e.key === "Escape") closePalette();
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closePalette(); });
  document.addEventListener("keydown", (e) => {
    const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]");
    if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
      e.preventDefault();
      overlay.hidden ? openPalette() : closePalette();
    }
  });
}

function make(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function ago(ms) {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 60) return `${mins} min`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)} hours`;
  return `${Math.floor(mins / 1440)} days`;
}
