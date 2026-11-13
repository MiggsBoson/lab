// chaos.js: the lab's shared mess, on every page.  together.js starts it.
//
// Everything here is kept by the server and drawn for everyone:
//   stickers  tap to stick a stamp; the oldest peel off, and they fade in the sun
//   paint     spray with limited ink; paint fades over three days; anyone can scrub
//   wear      clicks leave grime, paths leave dust, used buttons go grubby and crooked
//   colours   anyone can repaint the whole site; every visit nudges it a little
//   age       the more the site is used, the older and rougher it looks
//
// Positions are in "units": 1000 units = the width of the page's <main>, measured
// from its top-left corner, so marks stay near the same things on any screen.

const STICKERS = [
  ["star", "⭐"], ["heart", "❤️"], ["skull", "💀"], ["cat", "🐱"], ["bat", "🦇"],
  ["ghost", "👻"], ["eye", "👁️"], ["moon", "🌙"], ["mushroom", "🍄"], ["spider", "🕷️"],
  ["frog", "🐸"], ["fire", "🔥"], ["rose", "🌹"], ["crown", "👑"], ["bolt", "⚡"],
  ["gem", "💎"], ["planet", "🪐"], ["flower", "🌼"], ["alien", "👽"], ["rocket", "🚀"],
  ["circle", ""], ["square", ""], ["rect", ""], ["triangle", ""], ["tape", ""],
];
const EMOJI = { ...Object.fromEntries(STICKERS), trophy: "🏆" };   // trophies come from the golden key
const PAINT = ["#e63946", "#f4a261", "#2a9d8f", "#3a86ff", "#8338ec", "#111111", "#ffffff"];
const BRUSH = 14;                      // units
const INK_MAX = 6000;                  // units of line; matches the server
const INK_PER_SEC = 60;
const STROKE_POINTS = 80;
const PAINT_LIFE = 3 * 864e5;          // three days
const STICKER_FADE = 14 * 864e5;       // two weeks in the sun
const WEAR_CELL = 25;

export function startChaos({ on, send, page, bar }) {
  const main = document.querySelector("main");
  if (!main) return;

  // ---- What everyone has left here (filled in by the server) -------------------

  let stickers = [];
  let strokes = new Map();
  let wear = { clicks: {}, trail: {}, keys: {} };
  let total = 0;
  let palette = { hue: 218, at: 0 };

  // ---- This visitor's tools ----------------------------------------------------------

  let mode = "look";                   // look | sticker | spray | scrub
  let stickerKind = "star";
  let colour = PAINT[0];
  let ink = INK_MAX;
  let inkAt = Date.now();
  let drawing = null;                  // the stroke being sprayed right now
  let drawLength = 0;
  const pending = [];                  // sent strokes, shown until the server echoes them
  let hidden = false;
  try { hidden = localStorage.getItem("lab-hide-mess") === "1"; } catch {}

  // ---- The layer everything is drawn on ------------------------------------------------

  document.body.classList.add("chaos-on");
  const layer = make("div", "chaos-layer");
  layer.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  const stickerBox = make("div", "chaos-stickers");
  layer.append(canvas, stickerBox);
  document.body.append(layer);
  const g = canvas.getContext("2d");

  // While a tool is picked, this catches taps and drags instead of the page.
  const capture = make("div", "chaos-capture");
  capture.hidden = true;
  document.body.append(capture);

  // Where <main> is, relative to the layer, in pixels.
  function frame() {
    const m = main.getBoundingClientRect();
    const l = layer.getBoundingClientRect();
    return { x: m.left - l.left, y: m.top - l.top, w: m.width };
  }
  const toPx = (f, ux, uy) => [f.x + (ux * f.w) / 1000, f.y + (uy * f.w) / 1000];
  function toUnits(clientX, clientY) {
    const m = main.getBoundingClientRect();
    const x = Math.round(((clientX - m.left) / m.width) * 1000);
    const y = Math.round(((clientY - m.top) / m.width) * 1000);
    return [clamp(x, -600, 1600), clamp(y, -300, 30000)];
  }

  let frameRequest = 0;
  function redraw() {
    if (!frameRequest) frameRequest = requestAnimationFrame(() => { frameRequest = 0; draw(); });
  }

  function draw() {
    const w = layer.clientWidth;
    const h = layer.clientHeight;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    g.clearRect(0, 0, w, h);
    if (hidden) { stickerBox.replaceChildren(); return; }
    const f = frame();
    drawWear(f);
    drawPaint(f);
    drawStickers(f);
  }

  // Grime where people click, fainter dust where they wander.
  function drawWear(f) {
    const dark = isDark();
    const cell = (WEAR_CELL * f.w) / 1000;
    const smudge = (map, rgb, base, step, grow, cap) => {
      for (const [key, n] of Object.entries(map)) {
        const [cx, cy] = key.split(",").map(Number);
        const [px, py] = toPx(f, (cx + 0.5) * WEAR_CELL, (cy + 0.5) * WEAR_CELL);
        const r = cell * (0.9 + grow * Math.log2(1 + n));
        const a = Math.min(cap, base + step * Math.log2(1 + n));
        const grad = g.createRadialGradient(px, py, 0, px, py, r);
        grad.addColorStop(0, `rgba(${rgb},${a})`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = grad;
        g.fillRect(px - r, py - r, 2 * r, 2 * r);
      }
    };
    drawCracks(f);
    smudge(wear.trail, dark ? "200,185,150" : "150,125,85", 0.03, 0.035, 0.22, 0.42);
    smudge(wear.clicks, dark ? "175,155,115" : "80,60,35", 0.07, 0.09, 0.38, 0.6);
  }

  // Cracks spread as the site ages.  They're seeded by the page name, so everyone
  // sees the same cracks in the same places, and old ones stay as new ones appear.
  function drawCracks(f) {
    const count = Math.floor(ageOf(total) * 16);
    if (!count) return;
    const rand = seeded(hash(page) || 1);
    const tall = ((layer.clientHeight - f.y) / f.w) * 1000;
    const dark = isDark();
    const line = (pts, width) => {
      g.beginPath();
      pts.forEach(([x, y], i) => { const [px, py] = toPx(f, x, y); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
      g.lineWidth = width;
      g.strokeStyle = dark ? "rgba(0,0,0,0.75)" : "rgba(60,45,25,0.55)";
      g.stroke();
      g.save();
      g.translate(1, 1);
      g.strokeStyle = dark ? "rgba(255,240,210,0.16)" : "rgba(255,255,255,0.6)";
      g.lineWidth = Math.max(0.6, width * 0.6);
      g.stroke();
      g.restore();
    };
    const crack = (x, y, angle, steps, width) => {
      const pts = [[x, y]];
      for (let i = 0; i < steps; i++) {
        angle += (rand() - 0.5) * 1.1;
        const len = 18 + rand() * 45;
        x += Math.cos(angle) * len;
        y += Math.sin(angle) * len;
        pts.push([x, y]);
        if (rand() < 0.22 && width > 0.8) crack(x, y, angle + (rand() < 0.5 ? 0.9 : -0.9), Math.ceil(steps / 2), width * 0.6);
      }
      line(pts, width);
    };
    for (let i = 0; i < count; i++) {
      crack(-80 + rand() * 1160, rand() * Math.max(400, tall), rand() * Math.PI * 2, 6 + Math.floor(rand() * 9), 1.4);
    }
  }

  function drawPaint(f) {
    const now = Date.now();
    const all = [...strokes.values(), ...pending, ...(drawing ? [drawing] : [])];
    for (const s of all) {
      const age = (now - s.at) / PAINT_LIFE;
      if (age >= 1) continue;
      const alpha = 0.85 * (1 - age) + 0.05;
      g.globalAlpha = alpha;
      g.strokeStyle = s.colour;
      g.lineWidth = (s.size * f.w) / 1000;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      s.points.forEach(([x, y], i) => {
        const [px, py] = toPx(f, x, y);
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      });
      g.stroke();
      // Spray speckles around the line; the same pattern every time for a stroke.
      const rand = seeded(s.id || 7);
      g.fillStyle = s.colour;
      g.globalAlpha = alpha * 0.6;
      for (const [x, y] of s.points) {
        for (let k = 0; k < 3; k++) {
          const [px, py] = toPx(f, x + (rand() - 0.5) * s.size * 2.6, y + (rand() - 0.5) * s.size * 2.6);
          g.fillRect(px, py, 1.6, 1.6);
        }
      }
    }
    g.globalAlpha = 1;
  }

  function drawStickers(f) {
    const now = Date.now();
    const size = Math.max(26, (70 * f.w) / 1000);
    stickerBox.replaceChildren(...stickers.map((s) => {
      const node = make("span", "chaos-sticker");
      const [px, py] = toPx(f, s.x, s.y);
      node.style.left = `${px}px`;
      node.style.top = `${py}px`;
      node.style.setProperty("--size", `${size}px`);
      node.style.setProperty("--rot", `${s.rot}deg`);
      node.style.opacity = (1 - 0.55 * Math.min(1, (now - s.at) / STICKER_FADE)).toFixed(2);
      if (EMOJI[s.kind]) node.textContent = EMOJI[s.kind];
      else {
        node.classList.add("chaos-shape", s.kind);
        if (s.kind !== "tape") node.style.background = s.colour;   // tape is always tape-coloured
      }
      return node;
    }));
  }

  // ---- Worn buttons and links, and the site's age ------------------------------------

  function wearKey(el) {
    return el.dataset.wear || `${el.tagName.toLowerCase()}:${el.textContent.trim().replace(/\s+/g, " ").slice(0, 30)}`;
  }

  function applyWear() {
    for (const el of main.querySelectorAll("a, button")) {
      if (el.closest("#board, .no-wear")) continue;   // grids stay straight
      const n = wear.keys[wearKey(el)] || 0;
      if (!n) { el.classList.remove("worn"); continue; }
      el.classList.add("worn");
      const h = hash(wearKey(el));
      el.style.setProperty("--wear", Math.min(1, Math.log10(1 + n) / 2).toFixed(3));
      el.style.setProperty("--tilt", `${(h % 15) - 7}deg`);
      el.style.setProperty("--nudge", `${((h >> 4) % 9) - 4}px`);
    }
    document.documentElement.style.setProperty("--age", ageOf(total).toFixed(3));
    document.documentElement.classList.toggle("no-mess", hidden);
  }

  // ---- The site's shared colour -----------------------------------------------------------

  function applyPalette() {
    const h = palette.hue;
    const dark = isDark();
    const set = (k, v) => document.documentElement.style.setProperty(k, v);
    set("--accent", accentFor(h, dark));
    set("--accent-fg", dark ? "#0b0b0b" : "#ffffff");
    if (dark) {
      set("--bg", `hsl(${h} 18% 8%)`);
      set("--card", `hsl(${h} 14% 11%)`);
      set("--border", `hsl(${h} 12% 22%)`);
    } else {
      set("--bg", `hsl(${h} 30% 97%)`);
      set("--card", `hsl(${h} 40% 99.5%)`);
      set("--border", `hsl(${h} 18% 86%)`);
    }
    hueInput.value = h;
  }

  // ---- The tray of tools, opened from the bar ---------------------------------------------

  const toggle = make("button", "together-mess");
  toggle.type = "button";
  toggle.textContent = "🎨";
  toggle.setAttribute("aria-label", "Mess with the site");
  toggle.setAttribute("aria-expanded", "false");
  bar.append(toggle);

  const tray = make("div", "chaos-tray");
  tray.hidden = true;
  tray.setAttribute("aria-label", "Mess with the site");
  tray.innerHTML = `
    <div class="chaos-modes" role="group" aria-label="Tool">
      <button type="button" data-mode="look">👀 Look</button>
      <button type="button" data-mode="sticker">⭐ Sticker</button>
      <button type="button" data-mode="spray">🖌️ Spray</button>
      <button type="button" data-mode="scrub">🧽 Scrub</button>
    </div>
    <div class="chaos-row" data-for="sticker" role="group" aria-label="Sticker"></div>
    <div class="chaos-row" data-for="spray">
      <span class="chaos-swatches" role="group" aria-label="Paint colour"></span>
      <span class="chaos-ink" title="Ink refills over time"><span></span></span>
    </div>
    <p class="chaos-hint muted"></p>
    <label class="chaos-row chaos-hue">Site colour, for everyone
      <input type="range" min="0" max="359" step="1">
    </label>
    <label class="chaos-row"><input type="checkbox" class="chaos-hide"> Hide the mess (just for me)</label>
    <p class="chaos-info muted"></p>
    <p class="chaos-notice" aria-live="polite"></p>`;
  document.body.append(tray);

  const hueInput = tray.querySelector(".chaos-hue input");
  const hideBox = tray.querySelector(".chaos-hide");
  hideBox.checked = hidden;

  for (const [kind, emoji] of STICKERS) {
    const b = make("button", "chaos-pick");
    b.type = "button";
    b.dataset.kind = kind;
    b.setAttribute("aria-label", kind);
    if (emoji) b.textContent = emoji;
    else b.append(make("span", `chaos-shape ${kind}`));
    b.addEventListener("click", () => { stickerKind = kind; showTools(); });
    tray.querySelector('[data-for="sticker"]').append(b);
  }
  for (const c of PAINT) {
    const b = make("button", "chaos-swatch");
    b.type = "button";
    b.dataset.colour = c;
    b.style.background = c;
    b.setAttribute("aria-label", `Paint colour ${c}`);
    b.addEventListener("click", () => { colour = c; showTools(); });
    tray.querySelector(".chaos-swatches").append(b);
  }

  const HINTS = {
    look: "Use the page as normal.  Your clicks still leave a little wear.",
    sticker: "Tap anywhere on the page to stick it.  Everyone will see it.",
    spray: "Drag to spray.  Ink runs out and refills; paint fades over three days.",
    scrub: "Drag over paint to scrub it off, for everyone.",
  };

  function showTools() {
    tray.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === mode));
    tray.querySelectorAll("[data-for]").forEach((row) => { row.hidden = row.dataset.for !== mode; });
    tray.querySelectorAll(".chaos-pick").forEach((b) => b.setAttribute("aria-pressed", b.dataset.kind === stickerKind));
    tray.querySelectorAll(".chaos-swatch").forEach((b) => b.setAttribute("aria-pressed", b.dataset.colour === colour));
    tray.querySelector(".chaos-hint").textContent = HINTS[mode];
    capture.hidden = mode === "look";
    capture.className = `chaos-capture ${mode}`;
    showInfo();
  }

  function setMode(m) {
    mode = m;
    if (m !== "look" && hidden) setHidden(false);   // can't mess with what you can't see
    showTools();
  }

  function setHidden(value) {
    hidden = value;
    hideBox.checked = value;
    try { localStorage.setItem("lab-hide-mess", value ? "1" : "0"); } catch {}
    dispatchEvent(new CustomEvent("lab-setting", { detail: { name: "hideMess", value } }));   // tell the 🧭 menu
    applyWear();
    redraw();
  }

  function openTray(open) {
    tray.hidden = !open;
    toggle.setAttribute("aria-expanded", open);
    if (!open) setMode("look");
    else showTools();
  }

  toggle.addEventListener("click", () => openTray(tray.hidden));
  tray.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  hideBox.addEventListener("change", () => setHidden(hideBox.checked));
  // The same switch lives in the 🧭 menu (settings.js); keep the two in step.
  addEventListener("lab-setting", (e) => { if (e.detail.name === "hideMess" && e.detail.value !== hidden) setHidden(e.detail.value); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !tray.hidden) openTray(false); });

  let lastRepaint = 0;
  hueInput.addEventListener("input", () => {   // preview while dragging, just here
    palette = { ...palette, hue: Number(hueInput.value) };
    applyPalette();
  });
  hueInput.addEventListener("change", () => {  // let go: repaint it for everyone
    if (Date.now() - lastRepaint < 4000) return notice("Give it a few seconds between repaints.");
    lastRepaint = Date.now();
    send({ type: "repaint", hue: Number(hueInput.value) });
  });

  let paintParty = false;              // a surprise event: unlimited ink for everyone
  on("event", (msg) => { paintParty = msg.kind === "paintparty"; });
  on("event-end", () => { paintParty = false; });

  function currentInk() {
    if (paintParty) return INK_MAX;
    return Math.min(INK_MAX, ink + ((Date.now() - inkAt) / 1000) * INK_PER_SEC);
  }

  function showInfo() {
    tray.querySelector(".chaos-ink span").style.width = `${(currentInk() / INK_MAX) * 100}%`;
    const age = Math.round(ageOf(total) * 100);
    const parts = [`${stickers.length} stickers`, `${strokes.size} paint marks here`, `site age ${age}%`];
    if (palette.at) parts.push(`colour last changed ${timeAgo(palette.at)}`);
    tray.querySelector(".chaos-info").textContent = parts.join(" · ");
  }
  setInterval(() => { if (!tray.hidden) showInfo(); }, 500);

  let noticeTimer = 0;
  function notice(text) {
    const p = tray.querySelector(".chaos-notice");
    p.textContent = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { p.textContent = ""; }, 4000);
  }

  // ---- Using the tools ------------------------------------------------------------------------

  let lastSticker = 0;
  capture.addEventListener("click", (e) => {
    if (mode !== "sticker") return;
    if (Date.now() - lastSticker < 1500) return notice("One sticker every couple of seconds.");
    lastSticker = Date.now();
    const [x, y] = toUnits(e.clientX, e.clientY);
    send({ type: "sticker", kind: stickerKind, x, y });
  });

  capture.addEventListener("pointerdown", (e) => {
    if (mode === "sticker") return;
    try { capture.setPointerCapture(e.pointerId); } catch {}   // keep the drag even off-screen
    if (mode === "spray") startStroke(e);
    if (mode === "scrub") scrubAt(e);
  });
  capture.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" && !e.buttons) return;
    if (mode === "spray" && drawing) extendStroke(e);
    if (mode === "scrub") scrubAt(e);
  });
  capture.addEventListener("pointerup", () => finishStroke());
  capture.addEventListener("pointercancel", () => finishStroke());

  function startStroke(e) {
    if (currentInk() < 20) return notice("Out of ink.  It refills in a minute or two.");
    drawing = { id: 0, colour, size: BRUSH, points: [toUnits(e.clientX, e.clientY)], at: Date.now() };
    drawLength = 0;
    redraw();
  }

  function extendStroke(e) {
    const p = toUnits(e.clientX, e.clientY);
    const last = drawing.points[drawing.points.length - 1];
    const d = Math.hypot(p[0] - last[0], p[1] - last[1]);
    if (d < 6) return;
    if (drawLength + d > currentInk()) { finishStroke(); return notice("Out of ink.  It refills in a minute or two."); }
    drawing.points.push(p);
    drawLength += d;
    if (drawing.points.length >= STROKE_POINTS) {   // long drag: send this part, keep going
      const keep = drawing.points[drawing.points.length - 1];
      finishStroke();
      drawing = { id: 0, colour, size: BRUSH, points: [keep], at: Date.now() };
    }
    redraw();
  }

  function finishStroke() {
    if (drawing && drawing.points.length >= 2) {
      send({ type: "stroke", colour: drawing.colour, size: drawing.size, points: drawing.points });
      ink = Math.max(0, currentInk() - drawLength);
      inkAt = Date.now();
      const sent = drawing;
      pending.push(sent);
      setTimeout(() => {               // if the server never echoes it (e.g. out of ink), drop it
        const i = pending.indexOf(sent);
        if (i >= 0) { pending.splice(i, 1); redraw(); }
      }, 3000);
    }
    drawing = null;
    drawLength = 0;
    redraw();
  }

  let scrubQueue = [];
  let scrubTimer = 0;
  function scrubAt(e) {
    const [ux, uy] = toUnits(e.clientX, e.clientY);
    for (const s of strokes.values()) {
      if (s.points.some(([x, y]) => Math.hypot(x - ux, y - uy) < 24 + s.size / 2)) {
        strokes.delete(s.id);            // gone here straight away
        scrubQueue.push(s.id);
      }
    }
    redraw();
    if (scrubQueue.length && !scrubTimer) scrubTimer = setTimeout(flushScrub, 220);
  }
  function flushScrub() {
    scrubTimer = 0;
    if (!scrubQueue.length) return;
    send({ type: "scrub", ids: scrubQueue.splice(0, 30) });
    if (scrubQueue.length) scrubTimer = setTimeout(flushScrub, 220);
  }

  // ---- Wear: remember clicks and wanderings, send them every few seconds -----------------------

  const clicks = [];
  const trail = [];
  let lastTrail = null;
  let lastTrailAt = 0;

  document.addEventListener("click", (e) => {
    if (mode !== "look" || !e.isTrusted || e.target.closest(".together, .chaos-tray")) return;
    const [x, y] = toUnits(e.clientX, e.clientY);
    const target = e.target.closest("a, button");
    const key = target && main.contains(target) && !target.closest("#board, .no-wear") ? wearKey(target) : "";
    if (clicks.length < 30) clicks.push([x, y, key]);
  }, true);

  document.addEventListener("pointermove", (e) => {
    if (mode !== "look") return;
    const now = Date.now();
    if (now - lastTrailAt < 500) return;
    const p = toUnits(e.clientX, e.clientY);
    if (lastTrail && Math.hypot(p[0] - lastTrail[0], p[1] - lastTrail[1]) < 40) return;
    lastTrail = p;
    lastTrailAt = now;
    if (trail.length < 60) trail.push(p);
  }, { passive: true });

  setInterval(() => {
    if (!clicks.length && !trail.length) return;
    send({ type: "wear", clicks: clicks.splice(0), trail: trail.splice(0) });
  }, 5000);

  // ---- Messages from the server -----------------------------------------------------------------

  on("chaos", (msg) => {
    if (msg.page !== page) return;
    stickers = msg.stickers;
    strokes = new Map(msg.strokes.map((s) => [s.id, s]));
    wear = msg.wear;
    total = msg.total;
    applyWear();
    redraw();
  });
  on("sticker-add", (msg) => {
    stickers = stickers.filter((s) => !msg.removed.includes(s.id));
    stickers.push(msg.sticker);
    redraw();
  });
  on("stroke-add", (msg) => {
    for (const id of msg.removed) strokes.delete(id);
    strokes.set(msg.stroke.id, msg.stroke);
    pending.shift();
    redraw();
  });
  on("stroke-remove", (msg) => {
    for (const id of msg.ids) strokes.delete(id);
    redraw();
  });
  on("wear-add", (msg) => {
    Object.assign(wear.clicks, msg.clicks);
    Object.assign(wear.trail, msg.trail);
    Object.assign(wear.keys, msg.keys);
    total = msg.total;
    applyWear();
    redraw();
  });
  on("palette", (msg) => {
    palette = { hue: msg.hue, at: msg.at };
    if (typeof msg.total === "number") total = msg.total;
    applyPalette();
    applyWear();
  });
  on("notice", (msg) => { if (msg.about === "chaos") notice(msg.text); });

  // Redraw when the page changes size, and now and then so old paint keeps fading.
  new ResizeObserver(redraw).observe(document.body);
  document.addEventListener("visibilitychange", redraw);   // background tabs skip drawing
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { applyPalette(); redraw(); });
  setInterval(redraw, 60_000);
  setInterval(applyWear, 3000);       // pages that redraw their own buttons (e.g. lists)
  applyWear();
}

// ---- Small helpers ------------------------------------------------------------------------------

function make(tag, className) {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// The site's age from its total clicks: a bit worn from the start, about half-way
// after 200 clicks, fully aged after a few thousand.
function ageOf(total) {
  return Math.min(1, 0.15 + Math.log10(1 + total) / 3.5);
}

function isDark() {
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

function timeAgo(ms) {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)} h ago`;
  return `${Math.floor(mins / 1440)} days ago`;
}

// A repeatable random sequence from a number (mulberry32).
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

// An accent colour of the given hue that stays readable: dark enough on the light
// background (and under white button text), light enough on the dark one.
function accentFor(hue, dark) {
  if (dark) {
    for (let l = 55; l <= 92; l++) if (luminance(hslToRgb(hue, 80, l)) >= 0.42) return `hsl(${hue} 80% ${l}%)`;
    return `hsl(${hue} 80% 92%)`;
  }
  for (let l = 50; l >= 15; l--) if (luminance(hslToRgb(hue, 65, l)) <= 0.15) return `hsl(${hue} 65% ${l}%)`;
  return `hsl(${hue} 65% 15%)`;
}

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

function luminance([r, g, b]) {
  const c = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
