// events.js: surprises the live server sets off every so often, for everyone at once.
// together.js starts it on every page.  The server decides which event and when; this
// file just shows it.  Each effect returns a function that undoes it.
//
// To add a new surprise: give it a length in EVENTS in server/src/index.js, then add a
// line to TEXT and a function to EFFECTS below.

const TEXT = {
  snow: "❄️ It's snowing on the lab",
  gravity: "🍎 Gravity's gone funny",
  flip: "🙃 The lab is upside down",
  disco: "🪩 Disco time",
  dark: "🔦 Lights out: you've got a torch",
  ghost: "👻 A ghost is wandering about.  Catch it!",
  treasure: "🗝️ A golden key is hidden somewhere on the lab",
  paintparty: "🎨 Paint party: unlimited ink (🎨 at the bottom)",
};

export function startEvents({ on, send, page }) {
  const main = document.querySelector("main");
  if (!main) return;

  let current = null;     // the event now running, as the server sent it
  let skew = 0;           // server clock minus ours, so everyone's timing matches
  let undo = null;

  const banner = make("div", "event-banner");
  banner.hidden = true;
  banner.setAttribute("role", "status");
  document.body.append(banner);

  const now = () => Date.now() + skew;

  on("event", (msg) => {
    skew = msg.now - Date.now();
    const same = current && current.kind === msg.kind && current.start === msg.start;
    const nowFound = same && !current.foundBy && msg.foundBy;
    current = msg;
    if (!same || nowFound) {
      undo?.();
      undo = EFFECTS[msg.kind]?.(msg) || null;
    }
    showBanner();
  });
  on("event-end", stop);
  on("closed", stop);
  setInterval(showBanner, 1000);

  function stop() {
    undo?.();
    undo = null;
    current = null;
    banner.hidden = true;
  }

  function showBanner() {
    if (!current) return;
    const left = current.end - now();
    if (left <= 0) return stop();
    const clock = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}`;
    banner.replaceChildren();
    if (current.kind === "treasure" && current.foundBy) {
      banner.textContent = `🏆 ${current.foundBy} found the golden key!`;
    } else if (current.kind === "treasure") {
      banner.append(current.page === page
        ? "🗝️ The golden key is hidden on this page!  First to click it wins a 🏆."
        : TEXT.treasure);
      if (current.page !== page && now() - current.start > 4 * 60_000) {   // a hint after a while
        const a = document.createElement("a");
        a.href = pageLink(current.page);
        a.textContent = `try the ${current.page} page`;
        banner.append(".  Hint: ", a);
      }
    } else {
      banner.textContent = TEXT[current.kind] || "Something's happening";
    }
    const time = make("span", "event-clock");
    time.textContent = clock;
    banner.append(time);
    banner.hidden = false;
  }

  // From this page to another, on localhost and online (/lab/...).
  function pageLink(target) {
    const up = page === "home" ? "./" : "../";
    return target === "home" ? up : `${up}${target}/`;
  }

  // ---- The effects -------------------------------------------------------------------

  const EFFECTS = {
    // Flakes fall and pile up along the bottom of the screen.
    snow() {
      const canvas = make("canvas", "event-canvas");
      canvas.setAttribute("aria-hidden", "true");
      document.body.append(canvas);
      const g = canvas.getContext("2d");
      const still = reducedMotion();
      let w, h, pile;
      const size = () => {
        w = canvas.width = innerWidth;
        h = canvas.height = innerHeight;
        pile = new Float32Array(Math.ceil(w / 4) + 1).fill(still ? 18 : 0);
      };
      size();
      addEventListener("resize", size);
      const flake = (anywhere) => ({
        x: Math.random() * w, y: anywhere ? Math.random() * h : -8,
        r: 1 + Math.random() * 2.5, v: 0.5 + Math.random() * 1.2, sway: Math.random() * 6,
      });
      const flakes = still ? [] : Array.from({ length: 150 }, () => flake(true));
      let raf = 0;
      let frames = 0;
      const frame = () => {
        g.clearRect(0, 0, w, h);
        g.fillStyle = "rgba(255,255,255,0.95)";
        g.shadowColor = "rgba(0,0,0,0.35)";
        g.shadowBlur = 2;
        for (const f of flakes) {
          f.y += f.v;
          f.sway += 0.02;
          f.x += Math.sin(f.sway) * 0.4;
          const col = clamp(Math.floor(f.x / 4), 0, pile.length - 1);
          if (f.y >= h - pile[col]) {
            pile[col] = Math.min(h * 0.22, pile[col] + f.r * 0.7);
            Object.assign(f, flake(false));
          }
          g.beginPath();
          g.arc(f.x, f.y, f.r, 0, 7);
          g.fill();
        }
        if (++frames % 8 === 0) {   // let the pile settle into drifts
          for (let i = 1; i < pile.length - 1; i++) pile[i] = (pile[i - 1] + 2 * pile[i] + pile[i + 1]) / 4;
        }
        g.beginPath();
        g.moveTo(0, h);
        for (let i = 0; i < pile.length; i++) g.lineTo(i * 4, h - pile[i]);
        g.lineTo(w, h);
        g.fill();
        if (!still) raf = requestAnimationFrame(frame);
      };
      frame();
      return () => { cancelAnimationFrame(raf); removeEventListener("resize", size); canvas.remove(); };
    },

    // Everything sags and swings, the same way for everyone.
    gravity(e) {
      const rand = seeded(e.seed);
      const things = [...main.querySelectorAll(".card, .experiments a, h1, .lede, .board, #status, footer")];
      for (const el of things) {
        el.style.setProperty("--fall", `${20 + rand() * 150}px`);
        el.style.setProperty("--swing", `${(rand() - 0.5) * 26}deg`);
      }
      document.documentElement.classList.add("ev-gravity");
      return () => {
        document.documentElement.classList.remove("ev-gravity");
        for (const el of things) { el.style.removeProperty("--fall"); el.style.removeProperty("--swing"); }
      };
    },

    flip() {
      document.documentElement.classList.add("ev-flip");
      return () => document.documentElement.classList.remove("ev-flip");
    },

    disco() {
      document.documentElement.classList.add("ev-disco");
      return () => document.documentElement.classList.remove("ev-disco");
    },

    // Darkness, except a circle of light that follows your pointer or finger.
    dark() {
      const torch = make("div", "event-torch");
      torch.setAttribute("aria-hidden", "true");
      document.body.append(torch);
      const follow = (e) => {
        const p = e.touches ? e.touches[0] : e;
        torch.style.setProperty("--mx", `${p.clientX}px`);
        torch.style.setProperty("--my", `${p.clientY}px`);
      };
      addEventListener("pointermove", follow, { passive: true });
      addEventListener("touchmove", follow, { passive: true });
      return () => {
        removeEventListener("pointermove", follow);
        removeEventListener("touchmove", follow);
        torch.remove();
      };
    },

    // A ghost drifts about.  Its path comes from the event's seed and the time since it
    // started, so it's in the same place on everyone's screen at the same moment.
    ghost(e) {
      const ghost = make("button", "event-ghost");
      ghost.type = "button";
      ghost.textContent = "👻";
      ghost.setAttribute("aria-label", "A ghost.  Click to scare it");
      document.body.append(ghost);
      const rand = seeded(e.seed);
      const [a, b, phase] = [0.09 + rand() * 0.08, 0.13 + rand() * 0.08, rand() * 6];
      let raf = 0;
      const drift = () => {
        const t = (now() - e.start) / 1000;
        const x = 0.5 + 0.42 * Math.sin(t * a + phase);
        const y = 0.45 + 0.36 * Math.sin(t * b + phase * 1.7);
        ghost.style.transform = `translate(${x * innerWidth}px, ${y * innerHeight}px) rotate(${Math.sin(t) * 10}deg)`;
        raf = requestAnimationFrame(drift);
      };
      drift();
      ghost.addEventListener("click", () => {
        ghost.textContent = "💨";
        setTimeout(() => { ghost.textContent = "👻"; }, 1200);
        send({ type: "react", emoji: "😮" });   // everyone sees someone jump
      });
      return () => { cancelAnimationFrame(raf); ghost.remove(); };
    },

    // The golden key, only on the page the server picked, until someone finds it.
    treasure(e) {
      if (e.foundBy || e.page !== page) return null;
      const key = make("button", "event-key");
      key.type = "button";
      key.textContent = "🗝️";
      key.setAttribute("aria-label", "The golden key!  Click to claim it");
      document.body.append(key);
      let y = e.y;
      const place = () => {
        const m = main.getBoundingClientRect();
        const b = document.body.getBoundingClientRect();
        const tallest = ((b.bottom - m.top) / m.width) * 1000 - 80;   // keep it on the page
        y = Math.round(Math.max(100, Math.min(e.y, tallest)));
        key.style.left = `${m.left - b.left + (e.x * m.width) / 1000}px`;
        key.style.top = `${m.top - b.top + (y * m.width) / 1000}px`;
      };
      place();
      const watch = new ResizeObserver(place);
      watch.observe(document.body);
      key.addEventListener("click", () => {
        let name = "";
        try { name = localStorage.getItem("lab-shout-name") || ""; } catch {}
        send({ type: "found", name, x: e.x, y });
        key.disabled = true;
      });
      return () => { watch.disconnect(); key.remove(); };
    },

    paintparty() {
      return null;   // chaos.js lifts the ink limit; the banner says so
    },
  };
}

// ---- Small helpers -------------------------------------------------------------------------

function make(tag, className) {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
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
