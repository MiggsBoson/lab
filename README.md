# The lab

Small web experiments, hosted free on GitHub Pages.  Plain HTML, CSS and JavaScript.

Live at **https://miggsboson.github.io/lab/**.  Every push to `main` updates it (about a minute).

## Preview locally

```bash
cd ~/lab && python3 -m http.server 8000
```

Then open http://localhost:8000.  On localhost the live features (chess, shout box,
"here now", reactions) talk to a local copy of the server, so also run:

```bash
cd ~/lab/server && npx wrangler dev
```

## The live server

`server/` is a Cloudflare Worker with one Durable Object (`server/src/index.js`).  Every page
loads `together.js`, which keeps one WebSocket open to it.  It holds the chess game and the
shout box, counts who's here and passes on reactions.  It only accepts the lab's own pages.

Deploy a change to it (needs `npx wrangler login` once):

```bash
cd ~/lab/server && npx wrangler deploy
```

`chaos.js` (loaded by `together.js`) is the shared mess: stickers, spray paint, wear and
the site's shared colour.  `admin/` resets it and moderates shouts and suggestions; it needs
the admin key, set once with `npx wrangler secret put ADMIN_KEY` (for `wrangler dev`, put
`ADMIN_KEY=...` in `server/.dev.vars`, which git ignores).

`chess/chess.js` is a copy of `server/node_modules/chess.js/dist/esm/chess.js`; if you upgrade
chess.js, copy it again so the page and the server use the same rules.

## Publish a change

```bash
cd ~/lab && git add -A && git commit -m "Describe the change" && git push
```

Repo: https://github.com/MiggsBoson/lab (Pages: Settings → Pages, deploying `main`, `/ (root)`).

## Add an experiment

1. Copy `hello/` to a new folder, e.g. `predictions/`.
2. Edit its `index.html`.
3. Add a link to it in the home page `index.html`.
4. Commit and push.

## Friends

- Builders: Settings → Collaborators → add their GitHub username.
- Requests and bugs: the repo's Issues tab, or message Martin.
