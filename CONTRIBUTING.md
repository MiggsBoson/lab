# Building in the lab

The lab is a sandbox for small, novel web experiences and tools: plain HTML, CSS and JavaScript, served by GitHub Pages at https://miggsboson.github.io/lab/. Anything merged into `main` is live about a minute later.

You don't need permission to build here. You work on your own copy (a *fork*) and send changes as *pull requests*, which get reviewed and merged.

## Quick start with Claude Code

Paste this into [Claude Code](https://claude.com/claude-code) on your computer. It follows the rest of this guide with you. The same prompt is on https://miggsboson.github.io/lab/build/ (keep the two in sync).

```text
Set me up to build in The lab, a sandbox website for small web experiments and tools: https://github.com/MiggsBoson/lab (live at https://miggsboson.github.io/lab/).

Read https://raw.githubusercontent.com/MiggsBoson/lab/main/CONTRIBUTING.md and follow its "Getting started" steps for my computer: install anything missing, help me make a GitHub account if I need one, sign me in, fork and clone the repo, and open the local preview. Explain each step in a sentence, wait for me whenever I need to click, sign in or choose something, and ask before posting anything on GitHub.

Then ask what I'd like to make, build a first version with me as a new experiment following "Your first experiment", and send it as a pull request. Finally, ask whether I want direct access, and if I do, open an access request.
```

## Getting started

Each step can be followed by you or by Claude Code on your behalf. Steps marked **you** need a human: nobody else should type your password or codes.

### 1. Tools: git, the GitHub CLI (`gh`) and Python

Check what you have with `git --version`, `gh --version` and `python3 --version` (on Windows, `python --version` or `py --version`). Install whatever is missing:

- **Windows:**

  ```
  winget install --id Git.Git -e
  winget install --id GitHub.cli -e
  winget install --id Python.Python.3.12 -e
  ```

  Close and reopen the terminal afterwards so the new commands are found.
- **macOS:** `xcode-select --install` gives you git. Then, with [Homebrew](https://brew.sh): `brew install gh python`.
- **Linux (Debian or Ubuntu):** `sudo apt install git gh python3`. On other systems, see https://cli.github.com for `gh`.

### 2. GitHub account (you)

If you don't have one, sign up at https://github.com/signup. Then sign in from the terminal and let git use that login:

```
gh auth login --web --git-protocol https
gh auth setup-git
```

`gh auth login` shows a one-time code; paste it into the browser page it opens.

### 3. Your name on commits

Use your GitHub username and GitHub's private no-reply address, so your real email stays out of the public history. `gh api user --jq .id` prints your account number:

```
git config --global user.name "YOUR-USERNAME"
git config --global user.email "ACCOUNT-NUMBER+YOUR-USERNAME@users.noreply.github.com"
```

### 4. Your copy

Make a fork, download it, and point `gh` at the main repo for pull requests:

```
gh repo fork MiggsBoson/lab --clone --default-branch-only
cd lab
gh repo set-default MiggsBoson/lab
```

### 5. Preview

From the `lab` folder run `python3 -m http.server 8000` (Windows: `python -m http.server 8000`), then open http://localhost:8000.

The shared live features (chess, shout box, other people's cursors) need the live server, so they won't connect on your machine. Everything else works.

## Your first experiment

1. **Pick something small and a bit odd.** A toy, a tool, a game, a shared thing strangers do together. The home page's suggestion board shows what people are asking for. One idea per folder.
2. **Start a branch and a folder:** run `git switch -c my-idea`, then copy `hello/` to `my-idea/`.
3. **Build it** in `my-idea/index.html`:
   - Plain HTML, CSS and JavaScript only: no build step and no packages to install.
   - Link `../style.css` for the shared look.
   - Keep the `<script type="module" src="../together.js"></script>` line, so your page gets the lab's live layer (who's here, reactions, the 🧭 menu).
   - Make it work on a phone.
   - Libraries can load from a CDN if you really need one.
4. **Add it to the home page:** a new `<li>` in the `experiments` list in `index.html`.
5. **Optional: make it a room.** To get a headcount and stickers, add your folder name to `ROOMS` in `menu.js` and to `PAGES` in `server/src/index.js`.
6. **Optional: make it shared and live.** Pages can talk to each other through the live server. `tug/index.html` shows the pattern: `import { on, send } from "../together.js"`, `send({ type: "tug-pull" })`, `on("tug", ...)`. Each new message type needs a handler in `server/src/index.js`; say what it does in your pull request.
7. **Check it** in the preview, then commit just your files: `git add my-idea index.html` and `git commit -m "Add my idea"`.
8. **Send it:** `git push -u origin my-idea`, then `gh pr create --fill`. Once merged, it's live. To pick up everyone else's changes later, run `gh repo sync` and then `git pull`.

## Ground rules

- No keys, passwords, tokens or personal details in any file. The repo is public.
- `server/` is the live server (a Cloudflare Worker). Changes there deploy as soon as they are merged.
- Nothing that tracks visitors or collects their data.
- Small, odd and fun beats big and polished. Usage decides what grows.

## Want direct access?

You don't need it to contribute: pull requests from your fork always work. With access you can also push to `main` yourself and merge pull requests. Ask from the terminal, or use the *Access request* form under the repo's Issues tab:

```
gh issue create --repo MiggsBoson/lab --title "Access request: YOUR-USERNAME" --body "What I'd like to build: ..."
```

When it's approved you get an invitation. Accept it, then point your copy at the main repo:

```
gh api user/repository_invitations --jq '.[] | "\(.id) \(.repository.full_name)"'
gh api -X PATCH user/repository_invitations/INVITATION-ID
git remote set-url origin https://github.com/MiggsBoson/lab.git
```

Pushing to `main` publishes straight away. For anything bigger than a small fix, push a branch and open a pull request so others see it first.
