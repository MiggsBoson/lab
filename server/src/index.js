// lab-live: the lab's shared, live server (a Cloudflare Worker plus one Durable Object).
//
// Every page opens one WebSocket to  /ws .  Over it, visitors see each other:
//   presence    how many people are on the site right now
//   reactions   tap an emoji and it floats up on everyone's screen
//   shout box   short public messages (authors can delete; 2 reports hide one)
//   chess       one shared board: the first mover plays white, the next mover black
//
// Everything lives in one Durable Object, "the lobby".  It handles one message at
// a time, so two people can never grab the same chess side at the same moment.
//
// Each browser makes up a random visitor id and keeps it (localStorage).  The id is
// how the server knows "this is the person playing white".  Ids are never sent to
// other visitors.

import { DurableObject } from "cloudflare:workers";
import { Chess } from "chess.js";

const ALLOWED_ORIGINS = ["https://miggsboson.github.io", "http://localhost:8000", "http://127.0.0.1:8000"];
const EMOJIS = ["👋", "😂", "❤️", "🔥", "🎉", "😮"];
const SHOUTS_KEPT = 50;
const SHOUT_MAX = 200;                  // characters
const NAME_MAX = 20;
const SHOUT_GAP_MS = 10_000;            // one shout per 10 seconds per visitor
const REACT_GAP_MS = 250;               // a few reactions a second per visitor
const REPORTS_TO_HIDE = 2;              // reports from different visitors
const ABANDONED_MS = 24 * 3600 * 1000;  // anyone may restart a game with no move for a day

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
      this.shouts = (await ctx.storage.get("shouts")) || [];
      this.nextShoutId = (await ctx.storage.get("nextShoutId")) || 1;
      this.game = (await ctx.storage.get("game")) || freshGame();
      this.chess = replay(this.game.moves);
    });
  }

  // A page connects.  acceptWebSocket lets the object sleep between messages
  // while keeping the connection open, which keeps it within the free plan.
  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: null, lastShout: 0, lastReact: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > 2000) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment();

    if (msg.type === "hello") {
      if (me.id || !/^[0-9a-f-]{36}$/.test(msg.id)) return;
      me.id = msg.id;
      ws.serializeAttachment(me);
      this.send(ws, { type: "shouts", shouts: this.publicShouts(me.id) });
      this.send(ws, this.chessState(me.id));
      this.broadcastPresence();
      return;
    }
    if (!me.id) return;   // say hello first

    switch (msg.type) {
      case "react": return this.react(ws, me, msg);
      case "shout": return this.shout(ws, me, msg);
      case "unshout": return this.unshout(me, msg);
      case "report": return this.report(me, msg);
      case "move": return this.move(ws, me, msg);
      case "resign": return this.resign(ws, me);
      case "newgame": return this.restart(ws);
    }
  }

  webSocketClose(ws) {
    try { ws.close(1000, "bye"); } catch {}
    this.broadcastPresence(ws);
  }

  webSocketError(ws) {
    this.broadcastPresence(ws);
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

  // Send everyone their own version of a message (e.g. "you play white").
  broadcastEach(makeMessage) {
    for (const ws of this.ctx.getWebSockets()) {
      const id = ws.deserializeAttachment()?.id;
      if (id) this.send(ws, makeMessage(id));
    }
  }

  // ---- Presence ---------------------------------------------------------------

  // Count people, not tabs: three tabs from one browser count once.
  broadcastPresence(leaving) {
    const ids = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      const id = ws.deserializeAttachment()?.id;
      if (ws !== leaving && id) ids.add(id);
    }
    this.broadcast({ type: "presence", count: ids.size }, leaving);
  }

  // ---- Reactions --------------------------------------------------------------

  react(ws, me, msg) {
    if (!EMOJIS.includes(msg.emoji)) return;
    const now = Date.now();
    if (now - me.lastReact < REACT_GAP_MS) return;
    me.lastReact = now;
    ws.serializeAttachment(me);
    this.broadcast({ type: "react", emoji: msg.emoji });
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
    this.game = freshGame();
    this.chess = new Chess();
    await this.saveGame();
  }
}

// ---- Helpers ------------------------------------------------------------------

function freshGame() {
  return { moves: [], white: null, black: null, result: null, reason: null, updatedAt: Date.now() };
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
