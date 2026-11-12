# The lab

Small web experiments, hosted free on GitHub Pages.  Plain HTML, CSS and JavaScript.

## Preview locally

```bash
cd ~/lab && python3 -m http.server 8000
```

Then open http://localhost:8000.

## Put it online (once)

1. On github.com, create an empty public repo called `lab` (no README, no licence).
2. Push this folder to it (replace `USERNAME`):

```bash
cd ~/lab && git add -A && git commit -m "Start the lab" && git remote add origin https://github.com/USERNAME/lab.git && git push -u origin main
```

3. In the repo: Settings → Pages → "Deploy from a branch" → `main`, `/ (root)` → Save.
4. About a minute later it is live at `https://USERNAME.github.io/lab/`.  Every push updates it.

## Add an experiment

1. Copy `hello/` to a new folder, e.g. `predictions/`.
2. Edit its `index.html`.
3. Add a link to it in the home page `index.html`.
4. Commit and push.

## Friends

- Builders: Settings → Collaborators → add their GitHub username.
- Requests and bugs: the repo's Issues tab, or message Martin.
