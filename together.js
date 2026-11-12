// together.js: the lab's live connection, shared by every page.
//
// Add it to a page with:   <script type="module" src="../together.js"></script>
// It puts a small bar in the corner ("● 3 here now" plus emoji reactions) and keeps one
// WebSocket open to the lab's live server (server/ in this repo).  Pages can also use
// it for their own messages:
//
//   import { on, send } from "../together.js";
//   on("chess", (msg) => ...);          // run when the server sends a "chess" message
//   send({ type: "move", from: "e2", to: "e4" });

// On this computer, talk to `npx wrangler dev`; online, to the deployed server.
const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const SERVER = LOCAL ? "ws://localhost:8787/ws" : "wss://lab-live.dmwyap.workers.dev/ws";
const EMOJIS = ["👋", "😂", "❤️", "🔥", "🎉", "😮"];

// ---- Messages to and from the server -------------------------------------------

const handlers = {};
let socket = null;
let retries = 0;

export function on(type, fn) {
  (handlers[type] ||= []).push(fn);
}

export function send(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

function emit(type, msg) {
  for (const fn of handlers[type] || []) {
    try { fn(msg); } catch (e) { console.error(e); }
  }
}

// A random id that stays in this browser, so the server can tell visitors apart
// (and knows who is playing white).  It is never shown to anyone.
function visitorId() {
  try {
    let id = localStorage.getItem("lab-visitor");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("lab-visitor", id);
    }
    return id;
  } catch {
    return (visitorId.fallback ||= crypto.randomUUID());   // storage blocked: this visit only
  }
}

function connect() {
  socket = new WebSocket(SERVER);
  socket.addEventListener("open", () => {
    retries = 0;
    socket.send(JSON.stringify({ type: "hello", id: visitorId() }));
    emit("open");
  });
  socket.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    emit(msg.type, msg);
  });
  socket.addEventListener("close", () => {
    emit("closed");
    // Try again, waiting longer each time (1 s, 2 s, 4 s ... up to 30 s).
    setTimeout(connect, Math.min(30_000, 1000 * 2 ** retries++));
  });
}

// ---- The corner bar: who's here, and reactions ------------------------------------

const bar = document.createElement("aside");
bar.className = "together";
bar.setAttribute("aria-label", "People on the lab right now");
bar.innerHTML = `<span class="together-count" aria-live="polite">Connecting…</span>
  <span class="together-emojis"></span>`;
for (const emoji of EMOJIS) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = emoji;
  b.setAttribute("aria-label", `Send ${emoji} to everyone`);
  b.addEventListener("click", () => send({ type: "react", emoji }));
  bar.querySelector(".together-emojis").append(b);
}
document.body.append(bar);
document.body.classList.add("has-together");

const count = bar.querySelector(".together-count");
on("presence", (msg) => {
  count.textContent = msg.count === 1 ? "Just you here" : `${msg.count} here now`;
  count.classList.add("live");
});
on("closed", () => {
  count.textContent = "Reconnecting…";
  count.classList.remove("live");
});

// Someone tapped an emoji: float it up the screen, then remove it.
on("react", (msg) => {
  const span = document.createElement("span");
  span.className = "together-float";
  span.textContent = msg.emoji;
  span.style.left = `${10 + Math.random() * 80}%`;
  span.setAttribute("aria-hidden", "true");
  document.body.append(span);
  span.addEventListener("animationend", () => span.remove());
});

connect();
