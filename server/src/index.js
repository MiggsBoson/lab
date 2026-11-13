// lab-live: the lab's shared, live server (a Cloudflare Worker plus one Durable Object).
//
// Every page opens one WebSocket to  /ws .  Over it, visitors see each other:
//   presence     how many people are on the site right now
//   reactions    tap an emoji and it floats up on everyone's screen
//   shout box    short public messages (authors can delete; 2 reports hide one)
//   chess        one shared board: the first mover plays white, the next mover black
//   chaos        stickers, spray paint, wear and tear, and the site's shared colours
//   suggestions  ideas for the lab, with one vote per visitor
//   events       surprises the server sets off every so often, for everyone at once
//   usage        daily counts of what people use, for Martin's admin page
//   admin        Martin's reset and delete controls, locked by the ADMIN_KEY secret
//
// Everything lives in one Durable Object, "the lobby".  It handles one message at
// a time, so two people can never grab the same chess side at the same moment.
//
// Each browser makes up a random visitor id and keeps it (localStorage).  The id is
// how the server knows "this is the person playing white".  Ids are never sent to
// other visitors.
//
// Positions on a page are in "units": 1000 units = the width of the page's main
// column, measured from its top-left corner.  So a sticker stays next to the same
// thing whether the page is open on a phone or a wide screen.

import { DurableObject } from "cloudflare:workers";
import { Chess } from "chess.js";

const ALLOWED_ORIGINS = ["https://miggsboson.github.io", "http://localhost:8000", "http://127.0.0.1:8000"];
const MESSAGE_MAX = 4000;               // characters per incoming message
const EMOJIS = ["👋", "😂", "❤️", "🔥", "🎉", "😮"];
const SHOUTS_KEPT = 50;
const SHOUT_MAX = 200;                  // characters
const NAME_MAX = 20;
const SHOUT_GAP_MS = 10_000;            // one shout per 10 seconds per visitor
const REACT_GAP_MS = 250;               // a few reactions a second per visitor
const REPORTS_TO_HIDE = 2;              // reports from different visitors
const ABANDONED_MS = 24 * 3600 * 1000;  // anyone may restart a game with no move for a day

// Chaos
const PAGES = ["home", "chess", "live", "playground", "hello", "magnets", "note", "jam", "tug"];
const STICKERS = [
  "star", "heart", "skull", "cat", "bat", "ghost", "eye", "moon", "mushroom", "spider",
  "frog", "fire", "rose", "crown", "bolt", "gem", "planet", "flower", "alien", "rocket",
  "circle", "square", "rect", "triangle", "tape",
];
const PAINT = ["#e63946", "#f4a261", "#2a9d8f", "#3a86ff", "#8338ec", "#111111", "#ffffff"];
const STICKERS_PER_PAGE = 150;          // past this, the oldest peel off
const STICKER_GAP_MS = 1500;
const STROKES_PER_PAGE = 150;
const STROKE_POINTS = 80;
const PAINT_LIFE_MS = 3 * 24 * 3600 * 1000;   // paint fades away over three days
const INK_MAX = 6000;                   // in units of line length; refills over time
const INK_PER_SEC = 60;
const SCRUB_GAP_MS = 200;
const WEAR_CELL = 25;                   // wear is counted on a grid of 25-unit squares
const WEAR_CELLS_MAX = 3000;
const WEAR_KEYS_MAX = 300;
const WEAR_GAP_MS = 4000;
const REPAINT_GAP_MS = 4000;

// Suggestions
const SUGGESTIONS_KEPT = 100;
const SUGGESTION_MAX = 140;
const SUGGEST_GAP_MS = 60_000;

// Surprise events: how long each lasts.  A new one is due 15 to 45 minutes after the
// last one ends; it starts then if someone is on the site, or when the next person arrives.
const EVENTS = {
  snow: 6, gravity: 4, flip: 2, disco: 3, dark: 4, ghost: 8, treasure: 15, paintparty: 10,
  earthquake: 1, mirror: 2, balloons: 3, tiny: 2, comic: 5, fireflies: 6,
};
const EVENT_GAP_MINUTES = [15, 45];

// Usage counts are kept per day, for this many days.
const STATS_DAYS = 60;

// Ghost cursors: how often each visitor's pointer position is passed on.
const CURSOR_GAP_MS = 90;

// The hold-together button: this many people holding at once sets off a surprise.
const HOLD_NEEDED = 3;
const HOLD_COOLDOWN_MS = 3 * 60_000;

// Pass-it-on notes: each visitor reads the last note and leaves one for the next.
const NOTE_MAX = 280;
const NOTES_KEPT = 100;
const NOTE_GAP_MS = 60_000;

// Fridge magnets: a fixed set of words anyone can drag around a shared board.
const MAGNET_WORDS = [
  "the", "a", "I", "you", "we", "they", "is", "was", "will", "not", "and", "but", "or", "if", "when",
  "my", "your", "our", "all", "no", "lab", "ghost", "cat", "bat", "moon", "dream", "chess", "night",
  "rain", "Dublin", "sky", "heart", "skull", "friend", "stranger", "secret", "key", "door", "window",
  "fire", "sea", "star", "coffee", "pizza", "song", "story", "word", "time", "tomorrow", "yesterday",
  "now", "never", "always", "maybe", "here", "there", "inside", "under", "over", "away", "home",
  "love", "hate", "want", "need", "find", "lose", "see", "hear", "dance", "run", "sleep", "wake",
  "break", "build", "paint", "forget", "remember", "whisper", "scream", "wait", "play", "win",
  "strange", "quiet", "loud", "tiny", "huge", "old", "new", "golden", "broken", "wild", "soft",
  "dark", "bright", "sticky", "lost", "lucky", "weird", "sad", "happy", "-s", "-ing", "-ed", "-ly", "?", "!",
];
const MAGNET_GAP_MS = 40;

// Jam: one shared 16-step loop.  Each of the 12 rows is a bitmask of the steps it plays on.
// Everyone's page works out "which step is it now?" from the same start time (epoch) and
// tempo, using the server's clock, so they all hear the same beat at the same moment.
const JAM_ROWS = 12;
const JAM_STEPS = 16;
const JAM_BPM = [70, 160];
const JAM_TOGGLE_GAP_MS = 60;
const JAM_TEMPO_GAP_MS = 1500;
// A starting groove, so the first visitor hears something: kick, snare, hat, clap, six notes, two bass.
// Live polls: anyone can ask; everyone votes once (and can change their vote).
const POLL_Q_MAX = 120;
const POLL_OPTION_MAX = 40;
const POLLS_OPEN = 3;                   // at most this many running at once
const POLLS_KEPT = 12;                  // open and finished together
const POLL_LIFE_MS = 30 * 60_000;
const POLL_GAP_MS = 2 * 60_000;

// Tug of war: red pulls left, blue pulls right; first to the end of the rope wins.
const TUG_END = 40;
const TUG_PULL_GAP_MS = 70;
const TUG_SEND_GAP_MS = 80;

const JAM_START = [0x1111, 0x1010, 0x5555, 0x0000, 0x0000, 0x0000, 0x0204, 0x0000, 0x2040, 0x0000, 0x8101, 0x0000];

// ---- The Worker: checks the request, then hands it to the lobby --------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") return new Response("lab-live: nothing to see here.", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket.", { status: 426 });
    if (!ALLOWED_ORIGINS.includes(request.headers.get("Origin"))) {
      return new Response("Only the lab's pages may connect.", { status: 403 });
    }
    const lobby = env.LOBBY.get(env.LOBBY.idFromName("lobby"));
    return lobby.fetch(request);
  },
};

// ---- The lobby ----------------------------------------------------------------

export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Load saved state before handling any message.  This also runs when the
    // object wakes up after sleeping ("hibernation"), so nothing is lost.
    ctx.blockConcurrencyWhile(async () => {
      const keys = ["shouts", "nextShoutId", "game", "palette", "total", "suggestions", "nextId",
                    "event", "lastEvent", "nextEventAt", "visits", "notes", "magnets", "lastHoldWin", "jam", "polls", "tug"];
      for (const p of PAGES) keys.push(`stickers:${p}`, `wear:${p}`);
      const saved = await ctx.storage.get(keys);

      this.shouts = saved.get("shouts") || [];
      this.nextShoutId = saved.get("nextShoutId") || 1;
      this.game = saved.get("game") || freshGame();
      this.chess = replay(this.game.moves);

      this.palette = saved.get("palette") || { hue: 218, at: 0 };
      this.total = saved.get("total") || 0;        // every click ever: the site's age
      this.suggestions = saved.get("suggestions") || [];
      this.nextId = saved.get("nextId") || 1;
      this.event = saved.get("event") || null;
      this.lastEvent = saved.get("lastEvent") || null;
      this.nextEventAt = saved.get("nextEventAt") || Date.now() + 5 * 60_000;
      this.visits = saved.get("visits") || 0;
      this.notes = saved.get("notes") || [];
      this.lastHoldWin = saved.get("lastHoldWin") || 0;
      this.jam = saved.get("jam") || { bpm: 108, epoch: Date.now(), grid: [...JAM_START] };
      this.polls = saved.get("polls") || [];
      this.tug = saved.get("tug") || { pos: 0, red: 0, blue: 0 };
      // Magnets start scattered at random, then stay wherever people leave them.
      this.magnets = saved.get("magnets") || MAGNET_WORDS.map(() => [randomInt(10, 900), randomInt(10, 700)]);

      this.pages = {};
      for (const p of PAGES) {
        this.pages[p] = {
          stickers: saved.get(`stickers:${p}`) || [],
          strokes: new Map(),                        // each stroke is saved under its own key
          wear: saved.get(`wear:${p}`) || freshWear(),
        };
      }
      for (const [key, stroke] of await ctx.storage.list({ prefix: "stroke:" })) {
        const page = key.split(":")[1];
        if (this.pages[page]) this.pages[page].strokes.set(stroke.id, stroke);
      }
    });
  }

  // A page connects.  acceptWebSocket lets the object sleep between messages
  // while keeping the connection open, which keeps it within the free plan.
  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: null, page: null, lastShout: 0, lastReact: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MESSAGE_MAX) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    const me = ws.deserializeAttachment();

    if (msg.type === "hello") return this.hello(ws, me, msg);
    if (!me.id) return;   // say hello first

    switch (msg.type) {
      case "react": return this.react(ws, me, msg);
      case "shout": return this.shout(ws, me, msg);
      case "unshout": return this.unshout(me, msg);
      case "report": return this.report(me, msg);
      case "move": return this.move(ws, me, msg);
      case "resign": return this.resign(ws, me);
      case "newgame": return this.restart(ws);
      case "sticker": return this.sticker(ws, me, msg);
      case "stroke": return this.stroke(ws, me, msg);
      case "scrub": return this.scrub(ws, me, msg);
      case "wear": return this.addWear(ws, me, msg);
      case "repaint": return this.repaint(ws, me, msg);
      case "suggest": return this.suggest(ws, me, msg);
      case "vote": return this.vote(me, msg);
      case "unsuggest": return this.unsuggest(me, msg);
      case "report-suggestion": return this.reportSuggestion(me, msg);
      case "found": return this.found(ws, me, msg);
      case "cursor": return this.cursor(ws, me, msg);
      case "hold": return this.hold(ws, me, msg);
      case "magnet": return this.magnet(ws, me, msg);
      case "leave-note": return this.leaveNote(ws, me, msg);
      case "time": return this.send(ws, { type: "time", t0: msg.t0, server: Date.now() });
      case "jam-toggle": return this.jamToggle(ws, me, msg);
      case "jam-tempo": return this.jamTempo(ws, me, msg);
      case "since": return this.send(ws, this.sinceMessage(msg.t));
      case "poll-create": return this.pollCreate(ws, me, msg);
      case "poll-vote": return this.pollVote(me, msg);
      case "poll-report": return this.pollReport(me, msg);
      case "tug-join": return this.tugJoin(ws, me, msg);
      case "tug-pull": return this.tugPull(ws, me);
      case "report-note": return this.reportNote(me, msg);
      case "admin": return this.admin(ws, me, msg);
    }
  }

  webSocketClose(ws) {
    try { ws.close(1000, "bye"); } catch {}
    this.leaving(ws);
  }

  webSocketError(ws) {
    this.leaving(ws);
  }

  // Someone closed a page: update the count, remove their cursor, let go of the button.
  leaving(ws) {
    this.broadcastPresence(ws);
    const me = ws.deserializeAttachment();
    if (me?.id && me.page) this.broadcastPage(me.page, { type: "cursor-gone", who: shortHash(me.id) }, ws);
    if (me?.holding) this.broadcastHolders(ws);
    if (me?.page === "tug" && me.team) this.broadcastPage("tug", this.tugMessage(null, ws), ws);   // team sizes changed
  }

  async hello(ws, me, msg) {
    if (me.id || !/^[0-9a-f-]{36}$/.test(msg.id)) return;
    me.id = msg.id;
    me.page = PAGES.includes(msg.page) ? msg.page : null;
    ws.serializeAttachment(me);

    // Every visit nudges the site's colour a little, so it drifts by itself.
    this.palette.hue = (this.palette.hue + randomInt(-2, 2) + 360) % 360;
    if (msg.page !== "bot") this.visits += 1;
    await this.ctx.storage.put({ palette: this.palette, visits: this.visits });
    this.send(ws, { type: "welcome", visitor: this.visits });

    this.send(ws, { type: "shouts", shouts: this.publicShouts(me.id) });
    this.send(ws, this.chessState(me.id));
    this.send(ws, { type: "suggestions", list: this.publicSuggestions(me.id) });
    if (me.page) this.send(ws, this.chaosState(me.page));
    if (me.page === "home") this.send(ws, this.holdersMessage());
    if (me.page === "magnets") this.send(ws, { type: "magnets", words: MAGNET_WORDS, pos: this.magnets });
    if (me.page === "note") this.send(ws, this.noteFor(me.id));
    if (me.page === "jam") this.send(ws, this.jamMessage());
    if (me.page === "home") this.send(ws, { type: "polls", list: this.publicPolls(me.id) });
    if (me.page === "tug") this.send(ws, this.tugMessage());
    this.broadcast(this.paletteMessage());
    this.broadcastPresence();
    await this.count(`visit:${msg.page === "admin" ? "admin" : me.page || "other"}`, me.id);

    if (this.event && Date.now() >= this.event.end) await this.endEvent();
    if (!this.event && Date.now() >= this.nextEventAt) await this.startEvent();
    else if (this.event) this.send(ws, this.eventMessage());
  }

  // ---- Sending ----------------------------------------------------------------

  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  // Send everyone the same message.
  broadcast(msg, except) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) try { ws.send(text); } catch {}
    }
  }

  // Send the same message to everyone looking at one page.
  broadcastPage(page, msg, except) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except && ws.deserializeAttachment()?.page === page) try { ws.send(text); } catch {}
    }
  }

  // Send everyone their own version of a message (e.g. "you play white").
  broadcastEach(makeMessage) {
    for (const ws of this.ctx.getWebSockets()) {
      const id = ws.deserializeAttachment()?.id;
      if (id) this.send(ws, makeMessage(id));
    }
  }

  // ---- Presence ---------------------------------------------------------------

  // Count people, not tabs: three tabs from one browser count once.
  // Also counts people per page, for the Rooms menu ("Jam: 2 here").
  broadcastPresence(leaving) {
    const ids = new Set();
    const perPage = {};
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (ws === leaving || !a?.id) continue;
      ids.add(a.id);
      if (a.page) (perPage[a.page] ||= new Set()).add(a.id);
    }
    const pages = Object.fromEntries(Object.entries(perPage).map(([p, set]) => [p, set.size]));
    this.broadcast({ type: "presence", count: ids.size, pages }, leaving);
  }

  // ---- Reactions --------------------------------------------------------------

  async react(ws, me, msg) {
    if (!EMOJIS.includes(msg.emoji)) return;
    const now = Date.now();
    if (now - me.lastReact < REACT_GAP_MS) return;
    me.lastReact = now;
    ws.serializeAttachment(me);
    this.broadcast({ type: "react", emoji: msg.emoji });
    await this.count("react");
  }

  // ---- Shout box --------------------------------------------------------------

  publicShouts(viewer) {
    return this.shouts
      .filter((s) => s.reports.length < REPORTS_TO_HIDE)
      .map((s) => ({ id: s.id, name: s.name, text: s.text, at: s.at, mine: s.by === viewer }));
  }

  async saveShouts() {
    await this.ctx.storage.put({ shouts: this.shouts, nextShoutId: this.nextShoutId });
    this.broadcastEach((id) => ({ type: "shouts", shouts: this.publicShouts(id) }));
  }

  async shout(ws, me, msg) {
    const text = clean(msg.text, SHOUT_MAX);
    const name = clean(msg.name, NAME_MAX) || "Someone";
    if (!text) return;
    const now = Date.now();
    if (now - me.lastShout < SHOUT_GAP_MS) {
      return this.send(ws, { type: "notice", about: "shout", text: "Slow down: one shout every 10 seconds." });
    }
    me.lastShout = now;
    ws.serializeAttachment(me);
    this.shouts.push({ id: this.nextShoutId++, by: me.id, name, text, at: now, reports: [] });
    await this.count("shout");
    this.shouts = this.shouts.slice(-SHOUTS_KEPT);
    await this.saveShouts();
  }

  async unshout(me, msg) {
    const before = this.shouts.length;
    this.shouts = this.shouts.filter((s) => !(s.id === msg.id && s.by === me.id));
    if (this.shouts.length !== before) await this.saveShouts();
  }

  async report(me, msg) {
    const s = this.shouts.find((s) => s.id === msg.id);
    if (!s || s.by === me.id || s.reports.includes(me.id)) return;
    s.reports.push(me.id);
    await this.saveShouts();
  }

  // ---- Chess ------------------------------------------------------------------

  canRestart() {
    const g = this.game;
    return g.moves.length > 0 && (Boolean(g.result) || Date.now() - g.updatedAt > ABANDONED_MS);
  }

  chessState(viewer) {
    const g = this.game;
    const history = this.chess.history({ verbose: true });
    const last = history[history.length - 1];
    const seat = (owner) => (!owner ? "open" : owner === viewer ? "you" : "taken");
    return {
      type: "chess",
      fen: this.chess.fen(),
      sans: history.map((m) => m.san),
      last: last ? { from: last.from, to: last.to } : null,
      white: seat(g.white),
      black: seat(g.black),
      you: g.white === viewer ? "w" : g.black === viewer ? "b" : null,
      result: g.result,
      reason: g.reason,
      canRestart: this.canRestart(),
    };
  }

  async saveGame() {
    this.game.updatedAt = Date.now();
    await this.ctx.storage.put("game", this.game);
    this.broadcastEach((id) => this.chessState(id));
  }

  // Say no, and resend the real position so the page can't drift out of step.
  refuse(ws, me, text) {
    this.send(ws, { type: "notice", about: "chess", text });
    this.send(ws, this.chessState(me.id));
  }

  async move(ws, me, msg) {
    const g = this.game;
    if (g.result) return this.refuse(ws, me, "This game is over.  Start a new one.");
    if (!/^[a-h][1-8]$/.test(msg.from) || !/^[a-h][1-8]$/.test(msg.to)) return;
    if (msg.promotion !== undefined && !["q", "r", "b", "n"].includes(msg.promotion)) return;

    const side = this.chess.turn();                        // "w" or "b"
    const owner = side === "w" ? g.white : g.black;
    const other = side === "w" ? g.black : g.white;
    const colour = side === "w" ? "White" : "Black";
    if (owner && owner !== me.id) return this.refuse(ws, me, `${colour} is someone else's side.`);
    if (!owner && other === me.id) return this.refuse(ws, me, "You're already playing the other side.");

    let move = null;
    try {
      move = this.chess.move({ from: msg.from, to: msg.to, promotion: msg.promotion || "q" });
    } catch {}                                             // chess.js throws on an illegal move
    if (!move) return this.refuse(ws, me, "That move isn't allowed.");

    if (!owner) g[side === "w" ? "white" : "black"] = me.id;   // first move with a colour claims it
    await this.count("chess-move");
    g.moves.push({ from: move.from, to: move.to, promotion: move.promotion });

    const c = this.chess;
    if (c.isCheckmate()) [g.result, g.reason] = [side === "w" ? "1-0" : "0-1", "checkmate"];
    else if (c.isStalemate()) [g.result, g.reason] = ["1/2-1/2", "stalemate"];
    else if (c.isThreefoldRepetition()) [g.result, g.reason] = ["1/2-1/2", "threefold repetition"];
    else if (c.isInsufficientMaterial()) [g.result, g.reason] = ["1/2-1/2", "insufficient material"];
    else if (c.isDraw()) [g.result, g.reason] = ["1/2-1/2", "the 50-move rule"];
    await this.saveGame();
  }

  async resign(ws, me) {
    const g = this.game;
    const side = g.white === me.id ? "w" : g.black === me.id ? "b" : null;
    if (!side || g.result) return;
    [g.result, g.reason] = [side === "w" ? "0-1" : "1-0", side === "w" ? "white resigned" : "black resigned"];
    await this.saveGame();
  }

  async restart(ws) {
    if (!this.canRestart()) return this.send(ws, { type: "notice", about: "chess", text: "This game is still going." });
    await this.resetChess();
  }

  async resetChess() {
    this.game = freshGame();
    this.chess = new Chess();
    await this.saveGame();
  }

  // ---- Chaos: what everyone has left on a page ---------------------------------

  chaosState(page) {
    const p = this.pages[page];
    this.pruneStrokes(page);
    return {
      type: "chaos",
      page,
      stickers: p.stickers,
      strokes: [...p.strokes.values()],
      wear: p.wear,
      total: this.total,
    };
  }

  paletteMessage() {
    return { type: "palette", hue: this.palette.hue, at: this.palette.at, total: this.total };
  }

  // Spend from a visitor's ink, which refills a little every second.
  spendInk(ws, me, amount) {
    if (this.event?.kind === "paintparty") return true;   // unlimited ink during a paint party
    const now = Date.now();
    const ink = Math.min(INK_MAX, (me.ink ?? INK_MAX) + ((now - (me.inkAt || now)) / 1000) * INK_PER_SEC);
    if (ink < amount * 0.9) return false;          // a little slack for rounding
    me.ink = Math.max(0, ink - amount);
    me.inkAt = now;
    ws.serializeAttachment(me);
    return true;
  }

  async sticker(ws, me, msg) {
    const page = me.page;
    if (!page || !STICKERS.includes(msg.kind) || !inBounds(msg.x, msg.y)) return;
    const now = Date.now();
    if (now - (me.lastSticker || 0) < STICKER_GAP_MS) return;
    me.lastSticker = now;
    ws.serializeAttachment(me);

    const p = this.pages[page];
    const s = {
      id: this.nextId++,
      kind: msg.kind,
      x: msg.x,
      y: msg.y,
      rot: randomInt(-25, 25),
      colour: PAINT[randomInt(0, PAINT.length - 2)],   // for the shapes; not white
      at: now,
    };
    p.stickers.push(s);
    await this.count("sticker");
    const removed = p.stickers.splice(0, Math.max(0, p.stickers.length - STICKERS_PER_PAGE)).map((x) => x.id);
    await this.ctx.storage.put({ [`stickers:${page}`]: p.stickers, nextId: this.nextId });
    this.broadcastPage(page, { type: "sticker-add", sticker: s, removed });
  }

  pruneStrokes(page) {
    const p = this.pages[page];
    const old = [...p.strokes.values()].filter((s) => Date.now() - s.at > PAINT_LIFE_MS).map((s) => s.id);
    for (const id of old) p.strokes.delete(id);
    if (old.length) this.ctx.storage.delete(old.map((id) => `stroke:${page}:${id}`));
    return old;
  }

  async stroke(ws, me, msg) {
    const page = me.page;
    if (!page || !PAINT.includes(msg.colour)) return;
    if (!Number.isInteger(msg.size) || msg.size < 4 || msg.size > 40) return;
    const pts = msg.points;
    if (!Array.isArray(pts) || pts.length < 2 || pts.length > STROKE_POINTS) return;
    if (!pts.every((pt) => Array.isArray(pt) && pt.length === 2 && inBounds(pt[0], pt[1]))) return;

    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (!this.spendInk(ws, me, length)) {
      return this.send(ws, { type: "notice", about: "chaos", text: "Out of ink.  It refills in a minute or two." });
    }

    const p = this.pages[page];
    const removed = this.pruneStrokes(page);
    const s = { id: this.nextId++, colour: msg.colour, size: msg.size, points: pts, at: Date.now() };
    await this.count("paint");
    p.strokes.set(s.id, s);
    while (p.strokes.size > STROKES_PER_PAGE) {
      const oldest = p.strokes.keys().next().value;
      p.strokes.delete(oldest);
      removed.push(oldest);
    }
    await this.ctx.storage.put({ [`stroke:${page}:${s.id}`]: s, nextId: this.nextId });
    if (removed.length) await this.ctx.storage.delete(removed.map((id) => `stroke:${page}:${id}`));
    this.broadcastPage(page, { type: "stroke-add", stroke: s, removed });
  }

  async scrub(ws, me, msg) {
    const page = me.page;
    if (!page || !Array.isArray(msg.ids)) return;
    const now = Date.now();
    if (now - (me.lastScrub || 0) < SCRUB_GAP_MS) return;
    me.lastScrub = now;
    ws.serializeAttachment(me);

    const p = this.pages[page];
    const ids = msg.ids.slice(0, 30).filter((id) => p.strokes.has(id));
    if (!ids.length) return;
    for (const id of ids) p.strokes.delete(id);
    await this.ctx.storage.delete(ids.map((id) => `stroke:${page}:${id}`));
    await this.count("scrub");
    this.broadcastPage(page, { type: "stroke-remove", ids });
  }

  // Clicks leave grime; the paths people take leave dust; used things get worn.
  async addWear(ws, me, msg) {
    const page = me.page;
    if (!page) return;
    const now = Date.now();
    if (now - (me.lastWear || 0) < WEAR_GAP_MS) return;
    me.lastWear = now;
    ws.serializeAttachment(me);

    const w = this.pages[page].wear;
    const changed = { clicks: {}, trail: {}, keys: {} };
    const bump = (map, out, x, y) => {
      if (!inBounds(x, y)) return;
      const cell = `${Math.floor(x / WEAR_CELL)},${Math.floor(y / WEAR_CELL)}`;
      if (!(cell in map) && Object.keys(map).length >= WEAR_CELLS_MAX) return;
      out[cell] = map[cell] = (map[cell] || 0) + 1;
    };

    const clicks = Array.isArray(msg.clicks) ? msg.clicks.slice(0, 30) : [];
    for (const c of clicks) {
      if (!Array.isArray(c)) continue;
      bump(w.clicks, changed.clicks, c[0], c[1]);
      const key = clean(c[2], 40);
      if (key && (key in w.keys || Object.keys(w.keys).length < WEAR_KEYS_MAX)) {
        changed.keys[key] = w.keys[key] = (w.keys[key] || 0) + 1;
      }
    }
    const trail = Array.isArray(msg.trail) ? msg.trail.slice(0, 60) : [];
    for (const t of trail) if (Array.isArray(t)) bump(w.trail, changed.trail, t[0], t[1]);

    this.total += clicks.length;
    await this.ctx.storage.put({ [`wear:${page}`]: w, total: this.total });
    this.broadcastPage(page, { type: "wear-add", ...changed, total: this.total });
  }

  // Anyone can repaint the whole site's colours for everyone.
  async repaint(ws, me, msg) {
    if (!Number.isInteger(msg.hue) || msg.hue < 0 || msg.hue > 359) return;
    const now = Date.now();
    if (now - (me.lastRepaint || 0) < REPAINT_GAP_MS) return;
    me.lastRepaint = now;
    ws.serializeAttachment(me);
    this.palette = { hue: msg.hue, at: now };
    await this.ctx.storage.put("palette", this.palette);
    this.broadcast(this.paletteMessage());
    await this.count("repaint");
  }

  // ---- Suggestions ---------------------------------------------------------------

  publicSuggestions(viewer) {
    return this.suggestions
      .filter((s) => s.reports.length < REPORTS_TO_HIDE)
      .map((s) => ({
        id: s.id, text: s.text, at: s.at, done: s.done,
        votes: s.votes.length, voted: s.votes.includes(viewer), mine: s.by === viewer,
      }));
  }

  async saveSuggestions() {
    await this.ctx.storage.put({ suggestions: this.suggestions, nextId: this.nextId });
    this.broadcastEach((id) => ({ type: "suggestions", list: this.publicSuggestions(id) }));
  }

  async suggest(ws, me, msg) {
    const text = clean(msg.text, SUGGESTION_MAX);
    if (!text) return;
    const now = Date.now();
    if (now - (me.lastSuggest || 0) < SUGGEST_GAP_MS) {
      return this.send(ws, { type: "notice", about: "suggest", text: "One suggestion a minute, please." });
    }
    me.lastSuggest = now;
    ws.serializeAttachment(me);
    this.suggestions.push({ id: this.nextId++, by: me.id, text, at: now, votes: [me.id], reports: [], done: false });
    await this.count("suggest");
    if (this.suggestions.length > SUGGESTIONS_KEPT) {
      // Drop the least-voted (oldest first) to make room.
      const worst = [...this.suggestions].sort((a, b) => a.votes.length - b.votes.length || a.at - b.at)[0];
      this.suggestions = this.suggestions.filter((s) => s !== worst);
    }
    await this.saveSuggestions();
  }

  async vote(me, msg) {
    const s = this.suggestions.find((s) => s.id === msg.id);
    if (!s || s.done) return;
    s.votes = s.votes.includes(me.id) ? s.votes.filter((v) => v !== me.id) : [...s.votes, me.id];
    await this.count("vote");
    await this.saveSuggestions();
  }

  async unsuggest(me, msg) {
    const before = this.suggestions.length;
    this.suggestions = this.suggestions.filter((s) => !(s.id === msg.id && s.by === me.id));
    if (this.suggestions.length !== before) await this.saveSuggestions();
  }

  async reportSuggestion(me, msg) {
    const s = this.suggestions.find((s) => s.id === msg.id);
    if (!s || s.by === me.id || s.reports.includes(me.id)) return;
    s.reports.push(me.id);
    await this.saveSuggestions();
  }

  // ---- Ghost cursors: everyone on a page sees everyone else's pointer --------------------
  // Positions are passed on, never stored.  Visitors are shown by a short scrambled tag.

  cursor(ws, me, msg) {
    if (!me.page || !inBounds(msg.x, msg.y)) return;
    const now = Date.now();
    if (now - (me.lastCursor || 0) < CURSOR_GAP_MS) return;
    me.lastCursor = now;
    ws.serializeAttachment(me);
    const name = clean(msg.name, NAME_MAX) || undefined;   // only sent if they chose to show it
    this.broadcastPage(me.page, { type: "cursor", who: shortHash(me.id), x: msg.x, y: msg.y, name }, ws);
  }

  // ---- Hold together: a button that only works if several people hold it at once ------

  holdersMessage(leaving) {
    const ids = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (ws !== leaving && a?.holding && a.page === "home") ids.add(a.id);
    }
    const rest = Math.max(0, this.lastHoldWin + HOLD_COOLDOWN_MS - Date.now());   // recharging after a win
    return { type: "holders", n: ids.size, need: HOLD_NEEDED, rest };
  }

  broadcastHolders(leaving) {
    const msg = this.holdersMessage(leaving);
    this.broadcastPage("home", msg, leaving);
    return msg.n;
  }

  async hold(ws, me, msg) {
    if (me.page !== "home") return;
    me.holding = Boolean(msg.on);
    ws.serializeAttachment(me);
    const n = this.broadcastHolders();
    if (n >= HOLD_NEEDED && Date.now() - this.lastHoldWin > HOLD_COOLDOWN_MS) {
      this.lastHoldWin = Date.now();
      await this.ctx.storage.put("lastHoldWin", this.lastHoldWin);
      await this.count("hold-win");
      this.broadcastPage("home", { type: "hold-win" });
      if (this.event) await this.endEvent();
      await this.startEvent();
    }
  }

  // ---- Fridge magnets ---------------------------------------------------------------------
  // Moves while dragging are only passed on; where a magnet is dropped is saved.

  async magnet(ws, me, msg) {
    if (me.page !== "magnets" || !Number.isInteger(msg.i) || msg.i < 0 || msg.i >= MAGNET_WORDS.length) return;
    if (!Number.isInteger(msg.x) || !Number.isInteger(msg.y) || msg.x < 0 || msg.x > 960 || msg.y < 0 || msg.y > 720) return;
    const now = Date.now();
    if (!msg.drop && now - (me.lastMagnet || 0) < MAGNET_GAP_MS) return;
    me.lastMagnet = now;
    ws.serializeAttachment(me);
    this.magnets[msg.i] = [msg.x, msg.y];
    this.broadcastPage("magnets", { type: "magnet", i: msg.i, x: msg.x, y: msg.y }, ws);
    if (msg.drop) {
      await this.ctx.storage.put("magnets", this.magnets);
      await this.count("magnet");
    }
  }

  // ---- Pass it on: read the note the last person left, leave one for the next --------------

  noteFor(viewer) {
    const note = [...this.notes].reverse().find((n) => n.by !== viewer && n.reports.length < REPORTS_TO_HIDE);
    return { type: "note-for-you", note: note ? { id: note.id, text: note.text, at: note.at } : null, passed: this.notes.length };
  }

  async leaveNote(ws, me, msg) {
    if (me.page !== "note") return;
    const text = clean(msg.text, NOTE_MAX);
    if (!text) return;
    const now = Date.now();
    if (now - (me.lastNote || 0) < NOTE_GAP_MS) {
      return this.send(ws, { type: "notice", about: "note", text: "One note a minute.  The next visitor will get it." });
    }
    me.lastNote = now;
    ws.serializeAttachment(me);
    this.notes.push({ id: this.nextId++, by: me.id, text, at: now, reports: [] });
    this.notes = this.notes.slice(-NOTES_KEPT);
    await this.ctx.storage.put({ notes: this.notes, nextId: this.nextId });
    await this.count("note");
    this.send(ws, { type: "note-left", passed: this.notes.length });
  }

  async reportNote(me, msg) {
    const n = this.notes.find((n) => n.id === msg.id);
    if (!n || n.by === me.id || n.reports.includes(me.id)) return;
    n.reports.push(me.id);
    await this.ctx.storage.put("notes", this.notes);
  }

  // ---- While you were away: what changed since a given time -------------------------------

  sinceMessage(t) {
    if (!Number.isFinite(t) || t <= 0) return { type: "since", counts: {} };
    const newer = (list) => list.filter((x) => x.at > t).length;
    let stickers = 0;
    let paint = 0;
    for (const p of PAGES) {
      stickers += newer(this.pages[p].stickers);
      paint += newer([...this.pages[p].strokes.values()]);
    }
    const counts = {
      shouts: newer(this.shouts.filter((s) => s.reports.length < REPORTS_TO_HIDE)),
      stickers,
      paint,
      notes: newer(this.notes),
      ideas: newer(this.suggestions),
      polls: newer(this.polls),
      chess: this.game.updatedAt > t && this.game.moves.length ? 1 : 0,
    };
    return { type: "since", counts };
  }

  // ---- Live polls -------------------------------------------------------------------------

  publicPolls(viewer) {
    const now = Date.now();
    return this.polls
      .filter((p) => p.reports.length < REPORTS_TO_HIDE)
      .map((p) => ({
        id: p.id, q: p.q, at: p.at, ends: p.ends, open: p.ends > now, mine: p.by === viewer,
        options: p.options.map((o) => ({ text: o.text, votes: o.votes.length })),
        voted: p.options.findIndex((o) => o.votes.includes(viewer)),
      }));
  }

  async savePolls() {
    await this.ctx.storage.put("polls", this.polls);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a?.id && a.page === "home") this.send(ws, { type: "polls", list: this.publicPolls(a.id) });
    }
  }

  async pollCreate(ws, me, msg) {
    const q = clean(msg.q, POLL_Q_MAX);
    const options = (Array.isArray(msg.options) ? msg.options : []).map((o) => clean(o, POLL_OPTION_MAX)).filter(Boolean).slice(0, 4);
    if (!q || options.length < 2 || new Set(options).size !== options.length) {
      return this.send(ws, { type: "notice", about: "poll", text: "A poll needs a question and 2 to 4 different answers." });
    }
    const now = Date.now();
    if (now - (me.lastPoll || 0) < POLL_GAP_MS) return this.send(ws, { type: "notice", about: "poll", text: "One new poll every two minutes." });
    if (this.polls.filter((p) => p.ends > now).length >= POLLS_OPEN) {
      return this.send(ws, { type: "notice", about: "poll", text: "Three polls are already running.  Wait for one to finish." });
    }
    me.lastPoll = now;
    ws.serializeAttachment(me);
    this.polls.push({ id: this.nextId++, by: me.id, q, at: now, ends: now + POLL_LIFE_MS, reports: [], options: options.map((text) => ({ text, votes: [] })) });
    this.polls = this.polls.slice(-POLLS_KEPT);
    await this.ctx.storage.put("nextId", this.nextId);
    await this.count("poll");
    await this.savePolls();
  }

  async pollVote(me, msg) {
    const p = this.polls.find((p) => p.id === msg.id);
    if (!p || p.ends <= Date.now() || !Number.isInteger(msg.i) || msg.i < 0 || msg.i >= p.options.length) return;
    const had = p.options[msg.i].votes.includes(me.id);
    for (const o of p.options) o.votes = o.votes.filter((v) => v !== me.id);
    if (!had) p.options[msg.i].votes.push(me.id);       // tapping your own choice again takes the vote back
    await this.count("poll-vote");
    await this.savePolls();
  }

  async pollReport(me, msg) {
    const p = this.polls.find((p) => p.id === msg.id);
    if (!p || p.by === me.id || p.reports.includes(me.id)) return;
    p.reports.push(me.id);
    await this.savePolls();
  }

  // ---- Tug of war -------------------------------------------------------------------------

  tugMessage(winner, leaving) {
    const teams = { red: new Set(), blue: new Set() };
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (ws !== leaving && a?.id && a.page === "tug" && teams[a.team]) teams[a.team].add(a.id);
    }
    return { type: "tug", pos: this.tug.pos, end: TUG_END, wins: { red: this.tug.red, blue: this.tug.blue },
             players: { red: teams.red.size, blue: teams.blue.size }, winner };
  }

  // Passes the rope's position on, at most every 80 ms, so a frenzy of pulls stays cheap.
  sendTug(winner) {
    const now = Date.now();
    if (winner || now - (this.tugSentAt || 0) >= TUG_SEND_GAP_MS) {
      this.tugSentAt = now;
      clearTimeout(this.tugTimer);
      this.tugTimer = null;
      this.broadcastPage("tug", this.tugMessage(winner));
    } else if (!this.tugTimer) {
      this.tugTimer = setTimeout(() => { this.tugTimer = null; this.sendTug(); }, TUG_SEND_GAP_MS);
    }
  }

  tugJoin(ws, me, msg) {
    if (me.page !== "tug" || !["red", "blue"].includes(msg.team)) return;
    me.team = msg.team;
    ws.serializeAttachment(me);
    this.sendTug(null);
  }

  async tugPull(ws, me) {
    if (me.page !== "tug" || !me.team) return;
    const now = Date.now();
    if (now - (me.lastPull || 0) < TUG_PULL_GAP_MS) return;
    me.lastPull = now;
    ws.serializeAttachment(me);
    this.tug.pos += me.team === "red" ? -1 : 1;
    if (Math.abs(this.tug.pos) >= TUG_END) {
      const winner = this.tug.pos < 0 ? "red" : "blue";
      this.tug[winner] += 1;
      this.tug.pos = 0;
      await this.ctx.storage.put("tug", this.tug);
      await this.count("tug-win");
      return this.sendTug(winner);
    }
    if (Math.abs(this.tug.pos) % 5 === 0) await this.ctx.storage.put("tug", this.tug);   // save now and then
    this.sendTug();
  }

  // ---- Jam: the shared music machine ------------------------------------------------------

  jamMessage() {
    return { type: "jam", bpm: this.jam.bpm, epoch: this.jam.epoch, grid: this.jam.grid, rows: JAM_ROWS, steps: JAM_STEPS, now: Date.now() };
  }

  async jamToggle(ws, me, msg) {
    const { r, c } = msg;
    if (me.page !== "jam" || !Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= JAM_ROWS || c < 0 || c >= JAM_STEPS) return;
    const now = Date.now();
    if (now - (me.lastJam || 0) < JAM_TOGGLE_GAP_MS) return this.send(ws, this.jamMessage());   // resync them
    me.lastJam = now;
    ws.serializeAttachment(me);
    this.jam.grid[r] ^= 1 << c;
    const on = Boolean(this.jam.grid[r] & (1 << c));
    this.broadcastPage("jam", { type: "jam-cell", r, c, on });
    await this.ctx.storage.put("jam", this.jam);
    await this.count("jam-toggle");
  }

  // Change tempo without a hiccup: keep the current position in the loop where it is.
  async jamTempo(ws, me, msg) {
    const bpm = msg.bpm;
    if (me.page !== "jam" || !Number.isInteger(bpm) || bpm < JAM_BPM[0] || bpm > JAM_BPM[1]) return;
    const now = Date.now();
    if (now - (me.lastTempo || 0) < JAM_TEMPO_GAP_MS) return this.send(ws, this.jamMessage());
    me.lastTempo = now;
    ws.serializeAttachment(me);
    const stepMs = (bpm) => 60_000 / bpm / 4;           // 16th notes
    const position = (now - this.jam.epoch) / stepMs(this.jam.bpm);
    this.jam.bpm = bpm;
    this.jam.epoch = now - position * stepMs(bpm);
    this.broadcastPage("jam", this.jamMessage());
    await this.ctx.storage.put("jam", this.jam);
    await this.count("jam-tempo");
  }

  // ---- Surprise events ---------------------------------------------------------------

  eventMessage() {
    const e = this.event;
    return { type: "event", kind: e.kind, start: e.start, end: e.end, seed: e.seed,
             page: e.page, x: e.x, y: e.y, foundBy: e.foundBy || null, now: Date.now() };
  }

  someoneHere() {
    return this.ctx.getWebSockets().some((ws) => ws.deserializeAttachment()?.id);
  }

  async startEvent(kind) {
    const choices = Object.keys(EVENTS).filter((k) => k !== this.lastEvent);
    if (!EVENTS[kind]) kind = choices[randomInt(0, choices.length - 1)];
    const now = Date.now();
    const e = { kind, start: now, end: now + EVENTS[kind] * 60_000, seed: randomInt(1, 1e9) };
    if (kind === "treasure") Object.assign(e, { page: PAGES[randomInt(0, PAGES.length - 1)], x: randomInt(80, 920), y: randomInt(150, 1300) });
    this.event = e;
    this.lastEvent = kind;
    this.nextEventAt = e.end + randomInt(...EVENT_GAP_MINUTES) * 60_000;
    await this.ctx.storage.put({ event: e, lastEvent: kind, nextEventAt: this.nextEventAt });
    await this.count(`event:${kind}`);
    this.broadcast(this.eventMessage());
    await this.scheduleAlarm();
  }

  async endEvent() {
    this.event = null;
    await this.ctx.storage.put("event", null);
    this.broadcast({ type: "event-end" });
    await this.scheduleAlarm();
  }

  // Wakes the object when an event should end or a new one is due.
  async scheduleAlarm() {
    if (this.event) return this.ctx.storage.setAlarm(this.event.end);
    if (this.nextEventAt > Date.now()) return this.ctx.storage.setAlarm(this.nextEventAt);
    await this.ctx.storage.deleteAlarm();   // due, but nobody's here: the next visitor starts it
  }

  async alarm() {
    if (this.event && Date.now() >= this.event.end) return this.endEvent();
    if (!this.event && Date.now() >= this.nextEventAt && this.someoneHere()) return this.startEvent();
    await this.scheduleAlarm();
  }

  // Someone clicked the golden key: they win, and a trophy is left where it was.
  async found(ws, me, msg) {
    const e = this.event;
    if (!e || e.kind !== "treasure" || e.foundBy || me.page !== e.page || !inBounds(msg.x, msg.y)) return;
    e.foundBy = clean(msg.name, NAME_MAX) || "Someone";
    e.end = Math.min(e.end, Date.now() + 45_000);          // show the winner for a bit, then end
    const p = this.pages[e.page];
    const trophy = { id: this.nextId++, kind: "trophy", x: msg.x, y: msg.y, rot: randomInt(-12, 12), colour: "#f4a261", at: Date.now() };
    p.stickers.push(trophy);
    const removed = p.stickers.splice(0, Math.max(0, p.stickers.length - STICKERS_PER_PAGE)).map((x) => x.id);
    await this.ctx.storage.put({ event: e, [`stickers:${e.page}`]: p.stickers, nextId: this.nextId });
    await this.count("key-found");
    this.broadcastPage(e.page, { type: "sticker-add", sticker: trophy, removed });
    this.broadcast(this.eventMessage());
    await this.scheduleAlarm();
  }

  // ---- Usage counts -----------------------------------------------------------------
  // Counts only.  Visitors are kept as short scrambled tags (not their ids), just to
  // count how many different people came each day and how many came back.

  async count(what, visitorId) {
    const day = new Date().toISOString().slice(0, 10);
    if (this.statsKey !== `stats:${day}`) {
      this.statsKey = `stats:${day}`;
      this.stats = (await this.ctx.storage.get(this.statsKey)) || { visitors: [], counts: {} };
      const old = new Date(Date.now() - STATS_DAYS * 864e5).toISOString().slice(0, 10);
      const expired = [...(await this.ctx.storage.list({ prefix: "stats:", end: `stats:${old}` })).keys()];
      if (expired.length) await this.ctx.storage.delete(expired.slice(0, 128));
    }
    this.stats.counts[what] = (this.stats.counts[what] || 0) + 1;
    if (visitorId) {
      const tag = shortHash(visitorId);
      if (!this.stats.visitors.includes(tag) && this.stats.visitors.length < 5000) this.stats.visitors.push(tag);
    }
    await this.ctx.storage.put(this.statsKey, this.stats);
  }

  async usage() {
    const days = [...(await this.ctx.storage.list({ prefix: "stats:" }))].sort(([a], [b]) => (a < b ? -1 : 1));
    const seen = new Set();
    const out = [];
    for (const [key, day] of days) {
      const returning = day.visitors.filter((v) => seen.has(v)).length;
      day.visitors.forEach((v) => seen.add(v));
      out.push({ day: key.slice(6), visitors: day.visitors.length, returning, counts: day.counts });
    }
    return out.reverse().slice(0, 14);
  }

  // ---- Admin: Martin's controls ------------------------------------------------------

  async admin(ws, me, msg) {
    if ((me.badKeys || 0) >= 5) return;                       // too many wrong keys on this connection
    if (!sameKey(msg.key, this.env.ADMIN_KEY)) {
      me.badKeys = (me.badKeys || 0) + 1;
      ws.serializeAttachment(me);
      return this.send(ws, { type: "admin-reply", ok: false, text: "Wrong key." });
    }

    const pages = msg.page === "all" ? PAGES : PAGES.includes(msg.page) ? [msg.page] : [];
    const del = [];
    let text = "Done.";

    switch (msg.action) {
      case "check":
        break;
      case "reset-stickers":
        for (const p of pages) this.pages[p].stickers = [];
        break;
      case "reset-paint":
        for (const p of pages) {
          del.push(...[...this.pages[p].strokes.keys()].map((id) => `stroke:${p}:${id}`));
          this.pages[p].strokes.clear();
        }
        break;
      case "reset-wear":
        for (const p of pages) this.pages[p].wear = freshWear();
        if (msg.page === "all") this.total = 0;
        break;
      case "reset-chaos":
        for (const p of pages) {
          del.push(...[...this.pages[p].strokes.keys()].map((id) => `stroke:${p}:${id}`));
          this.pages[p] = { stickers: [], strokes: new Map(), wear: freshWear() };
        }
        if (msg.page === "all") this.total = 0;
        break;
      case "reset-colours":
        this.palette = { hue: 218, at: 0 };
        break;
      case "reset-chess":
        await this.resetChess();
        break;
      case "start-event":
        if (this.event) await this.endEvent();
        await this.startEvent(msg.kind);
        text = `Started: ${this.event.kind}.`;
        break;
      case "stop-event":
        if (this.event) await this.endEvent();
        text = "Stopped.";
        break;
      case "usage":
        break;
      case "delete-note":
        this.notes = this.notes.filter((n) => n.id !== msg.id);
        await this.ctx.storage.put("notes", this.notes);
        break;
      case "unhide-note": {
        const n = this.notes.find((n) => n.id === msg.id);
        if (n) n.reports = [];
        await this.ctx.storage.put("notes", this.notes);
        break;
      }
      case "delete-poll":
        this.polls = this.polls.filter((p) => p.id !== msg.id);
        await this.savePolls();
        break;
      case "reset-tug":
        this.tug = { pos: 0, red: 0, blue: 0 };
        await this.ctx.storage.put("tug", this.tug);
        this.sendTug(null);
        break;
      case "reset-jam":
        this.jam = { bpm: 108, epoch: Date.now(), grid: [...JAM_START] };
        await this.ctx.storage.put("jam", this.jam);
        this.broadcastPage("jam", this.jamMessage());
        break;
      case "reset-magnets":
        this.magnets = MAGNET_WORDS.map(() => [randomInt(10, 900), randomInt(10, 700)]);
        await this.ctx.storage.put("magnets", this.magnets);
        this.broadcastPage("magnets", { type: "magnets", words: MAGNET_WORDS, pos: this.magnets });
        break;
      case "delete-shout":
        this.shouts = this.shouts.filter((s) => s.id !== msg.id);
        await this.saveShouts();
        break;
      case "unhide-shout": {
        const s = this.shouts.find((s) => s.id === msg.id);
        if (s) s.reports = [];
        await this.saveShouts();
        break;
      }
      case "delete-suggestion":
        this.suggestions = this.suggestions.filter((s) => s.id !== msg.id);
        await this.saveSuggestions();
        break;
      case "done-suggestion": {
        const s = this.suggestions.find((s) => s.id === msg.id);
        if (s) s.done = !s.done;
        await this.saveSuggestions();
        break;
      }
      case "unhide-suggestion": {
        const s = this.suggestions.find((s) => s.id === msg.id);
        if (s) s.reports = [];
        await this.saveSuggestions();
        break;
      }
      default:
        return this.send(ws, { type: "admin-reply", ok: false, text: "Unknown action." });
    }

    if (["reset-stickers", "reset-paint", "reset-wear", "reset-chaos"].includes(msg.action)) {
      if (!pages.length) return this.send(ws, { type: "admin-reply", ok: false, text: "Pick a page." });
      const save = { total: this.total };
      for (const p of pages) Object.assign(save, { [`stickers:${p}`]: this.pages[p].stickers, [`wear:${p}`]: this.pages[p].wear });
      await this.ctx.storage.put(save);
      if (del.length) for (let i = 0; i < del.length; i += 128) await this.ctx.storage.delete(del.slice(i, i + 128));
      for (const p of pages) this.broadcastPage(p, this.chaosState(p));
      text = `Done: ${msg.action.replace("reset-", "")} cleared on ${msg.page === "all" ? "every page" : msg.page}.`;
    }
    if (msg.action === "reset-colours") {
      await this.ctx.storage.put("palette", this.palette);
      this.broadcast(this.paletteMessage());
    }
    this.send(ws, { type: "admin-reply", ok: true, text, data: { ...this.adminData(), usage: await this.usage() } });
  }

  // Everything the admin page lists, including hidden (reported) items.
  adminData() {
    return {
      shouts: this.shouts.map((s) => ({ id: s.id, name: s.name, text: s.text, at: s.at, reports: s.reports.length })),
      notes: this.notes.map((n) => ({ id: n.id, text: n.text, at: n.at, reports: n.reports.length })),
      polls: this.polls.map((p) => ({ id: p.id, q: p.q, at: p.at, open: p.ends > Date.now(), reports: p.reports.length,
                                      options: p.options.map((o) => `${o.text} (${o.votes.length})`) })),
      tug: this.tug,
      visits: this.visits,
      suggestions: this.suggestions.map((s) => ({
        id: s.id, text: s.text, at: s.at, votes: s.votes.length, reports: s.reports.length, done: s.done,
      })),
      pages: Object.fromEntries(PAGES.map((p) => [p, {
        stickers: this.pages[p].stickers.length,
        strokes: this.pages[p].strokes.size,
        wearCells: Object.keys(this.pages[p].wear.clicks).length + Object.keys(this.pages[p].wear.trail).length,
      }])),
      hue: this.palette.hue,
      event: this.event && { kind: this.event.kind, end: this.event.end, foundBy: this.event.foundBy || null },
      nextEventAt: this.nextEventAt,
      total: this.total,
    };
  }
}

// ---- Helpers ------------------------------------------------------------------

function freshGame() {
  return { moves: [], white: null, black: null, result: null, reason: null, updatedAt: Date.now() };
}

function freshWear() {
  return { clicks: {}, trail: {}, keys: {} };
}

// Rebuild the board from the list of moves (so repetition draws still work).
function replay(moves) {
  const chess = new Chess();
  for (const m of moves) chess.move(m);
  return chess;
}

// Plain one-line text: no control characters, squashed spaces, at most `max` characters.
function clean(value, max) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, max).join("").trim();
}

// A position in units: whole numbers, a bit outside the main column is fine.
function inBounds(x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= -600 && x <= 1600 && y >= -300 && y <= 30000;
}

// A short scrambled tag for a visitor id (FNV-1a), for counting returning visitors.
function shortHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Compare two keys without leaking how much of them matched.
function sameKey(given, real) {
  if (typeof given !== "string" || typeof real !== "string" || !real) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(real);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}
