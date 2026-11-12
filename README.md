# The lab

Small web experiments, hosted free on GitHub Pages.  Plain HTML, CSS and JavaScript.

Live at **https://miggsboson.github.io/lab/**.  Every push to `main` updates it (about a minute).

## Preview locally

```bash
cd ~/lab && python3 -m http.server 8000
```

Then open http://localhost:8000.

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
