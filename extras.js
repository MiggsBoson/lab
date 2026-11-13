// extras.js: small things that make every page feel inhabited.  together.js starts it.
//
//   ghost cursors   other visitors' pointers drift about on the same page, live
//   echoes          now and then an old shout floats across the screen
//   real weather    Dublin's actual weather and daylight leak into the site
//   tab tricks      the tab's title pleads with you while you're away
//   secrets         type certain words anywhere on the site...

import { getSetting, onSetting, getName, calm } from "./settings.js";

const ANIMALS = ["🦊", "🐸", "🐙", "🦉", "🐝", "🐢", "🦄", "🐧", "🦔", "🐌", "🦀", "🐞"];
const DUBLIN = { lat: 53.3498, lon: -6.2603 };

export function startExtras({ on, send, page }) {
  const main = document.querySelector("main");
  if (!main) return;
  const still = calm();

  // Where <main> is on the page: positions are shared in "units" (1000 = its width).
  function toUnits(clientX, clientY) {
    const m = main.getBoundingClientRect();
    return [Math.round(((clientX - m.left) / m.width) * 1000), Math.round(((clientY - m.top) / m.width) * 1000)];
  }
  function toPage([x, y]) {
    const m = main.getBoundingClientRect();
    return [m.left + scrollX + (x * m.width) / 1000, m.top + scrollY + (y * m.width) / 1000];
  }

  // ---- Ghost cursors ------------------------------------------------------------------

  const cursors = new Map();   // who -> { el, at }

  let lastSent = 0;
  addEventListener("pointermove", (e) => {
    const now = Date.now();
    if (now - lastSent < 100) return;
    lastSent = now;
    const [x, y] = toUnits(e.clientX, e.clientY);
    if (x < -600 || x > 1600 || y < -300 || y > 30000) return;
    if (getSetting("hideMyCursor")) return;
    send({ type: "cursor", x, y, name: getSetting("nameOnCursor") ? getName() : undefined });
  }, { passive: true });

  on("cursor", (msg) => {
    if (getSetting("noGhosts")) return;
    let c = cursors.get(msg.who);
    if (!c) {
      const el = make("div", "ghost-cursor");
      el.setAttribute("aria-hidden", "true");
      el.append(make("span", "ghost-animal"), make("span", "ghost-name"));
      el.firstChild.textContent = ANIMALS[parseInt(msg.who, 36) % ANIMALS.length];
      document.body.append(el);
      c = { el };
      cursors.set(msg.who, c);
    }
    c.el.lastChild.textContent = msg.name || "";
    const [px, py] = toPage([msg.x, msg.y]);
    c.el.style.transform = `translate(${px}px, ${py}px)`;
    c.el.classList.remove("faded");
    c.at = Date.now();
  });
  onSetting("noGhosts", (off) => {
    if (!off) return;
    for (const c of cursors.values()) c.el.remove();
    cursors.clear();
  });
  on("cursor-gone", (msg) => {
    cursors.get(msg.who)?.el.remove();
    cursors.delete(msg.who);
  });
  setInterval(() => {   // fade out pointers that have stopped moving, drop long-gone ones
    for (const [who, c] of cursors) {
      const idle = Date.now() - c.at;
      if (idle > 60_000) { c.el.remove(); cursors.delete(who); }
      else if (idle > 6000) c.el.classList.add("faded");
    }
  }, 2000);

  // ---- Echoes: old shouts drift across the screen now and then ---------------------------

  let shouts = [];
  on("shouts", (msg) => { shouts = msg.shouts; });
  function echo() {
    setTimeout(echo, 70_000 + Math.random() * 90_000);
    if (document.hidden || !shouts.length || getSetting("noGhosts")) return;
    const s = shouts[Math.floor(Math.random() * shouts.length)];
    const el = make("div", "echo");
    el.setAttribute("aria-hidden", "true");
    el.textContent = `“${s.text}” — ${s.name}`;
    el.style.top = `${15 + Math.random() * 60}vh`;
    if (still) el.classList.add("still");
    document.body.append(el);
    el.addEventListener("animationend", () => el.remove());
  }
  setTimeout(echo, 20_000 + Math.random() * 40_000);

  // ---- Real weather: what Dublin is doing outside comes in through the window ------------

  const sky = make("div", "real-sky");
  sky.setAttribute("aria-hidden", "true");
  document.body.append(sky);
  fetch(`https://api.open-meteo.com/v1/forecast?latitude=${DUBLIN.lat}&longitude=${DUBLIN.lon}` +
        "&current=weather_code,is_day,wind_speed_10m&timezone=Europe%2FDublin")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const now = data?.current;
      if (!now) return;
      const code = now.weather_code;
      const kinds = [];
      if (!now.is_day) kinds.push("night");
      if ([45, 48].includes(code)) kinds.push("fog");
      if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) kinds.push("rain");
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) kinds.push("flurries");
      if (code >= 95) kinds.push("rain", "storm");
      if (now.wind_speed_10m > 35) kinds.push("windy");
      for (const k of kinds) sky.classList.add(k);
      if (kinds.includes("rain") || kinds.includes("flurries")) makeDrops(kinds.includes("flurries"));
      if (kinds.includes("storm") && !still) lightning();
      if (kinds.includes("night")) makeStars();
      const words = { night: "it's night", fog: "it's foggy", rain: "it's raining", flurries: "it's snowing", storm: "there's a storm", windy: "it's windy" };
      if (kinds.length) sky.title = `In Dublin right now ${kinds.map((k) => words[k]).join(" and ")}, so it is here too.`;
    })
    .catch(() => {});

  function makeDrops(snowy) {
    for (let i = 0; i < (still ? 0 : 60); i++) {
      const d = make("span", snowy ? "flurry" : "drop");
      d.style.left = `${Math.random() * 100}%`;
      d.style.animationDelay = `${-Math.random() * 3}s`;
      d.style.animationDuration = `${(snowy ? 6 : 0.7) + Math.random() * (snowy ? 4 : 0.5)}s`;
      sky.append(d);
    }
  }
  function makeStars() {
    for (let i = 0; i < 40; i++) {
      const st = make("span", "star");
      st.style.left = `${Math.random() * 100}%`;
      st.style.top = `${Math.random() * 35}%`;
      st.style.animationDelay = `${-Math.random() * 4}s`;
      sky.append(st);
    }
  }
  function lightning() {
    setTimeout(() => {
      sky.classList.add("flash");
      setTimeout(() => sky.classList.remove("flash"), 120);
      lightning();
    }, 8000 + Math.random() * 20000);
  }

  // ---- Tab tricks: the title pleads while you're in another tab ---------------------------

  const title = document.title;
  let here = 1;
  on("presence", (msg) => { here = msg.count; });
  const pleas = [
    () => "👀 come back",
    () => (here > 1 ? `🫥 ${here - 1} still here without you` : "🫥 it's lonely in here"),
    () => "🦇 the bats are restless",
    () => "🕯️ someone moved your sticker",
    () => "☕ we'll wait",
    () => "🧽 the paint is drying",
  ];
  document.addEventListener("visibilitychange", () => {
    document.title = document.hidden ? pleas[Math.floor(Math.random() * pleas.length)]() : title;
  });

  // ---- Secrets: type these words anywhere (not in a text box) -------------------------------

  const SECRETS = {
    chaos: () => { spin(); send({ type: "react", emoji: "🎉" }); },
    boo: () => send({ type: "react", emoji: "😮" }),
    gravity: () => document.documentElement.classList.add("secret-sink"),
    stop: () => document.documentElement.classList.remove("secret-sink"),
  };
  let typed = "";
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]") || e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-12);
    for (const [word, fn] of Object.entries(SECRETS)) {
      if (typed.endsWith(word)) { typed = ""; fn(); }
    }
  });
  function spin() {
    if (still) return;
    main.classList.remove("secret-spin");
    void main.offsetWidth;   // restart the animation
    main.classList.add("secret-spin");
    main.addEventListener("animationend", () => main.classList.remove("secret-spin"), { once: true });
  }
}

function make(tag, className) {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}
