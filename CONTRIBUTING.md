# Contributing to the lab

The lab is a handful of small web experiments: plain HTML, CSS and JavaScript, served by GitHub Pages at https://miggsboson.github.io/lab/. Anything merged into `main` is live about a minute later.

You don't need permission to contribute. You work on your own copy (a *fork*) and send changes as *pull requests*, which the owner reviews and merges.

## Getting started (Windows)

Each step is written so you, or Claude Code on your behalf, can follow it in order. Steps marked **you** need a human: nobody else should type your password or codes.

1. **Tools.** Check with `git --version`, `gh --version` and `python --version` (or `py --version`). Install whatever is missing:

   ```
   winget install --id Git.Git -e
   winget install --id GitHub.cli -e
   winget install --id Python.Python.3.12 -e
   ```

   Close and reopen the terminal afterwards so the new commands are found.

2. **GitHub account (you).** If you don't have one, sign up at https://github.com/signup. Then sign in from the terminal and let git use that login:

   ```
   gh auth login --web --git-protocol https
   gh auth setup-git
   ```

   `gh auth login` shows a one-time code; paste it into the browser page it opens.

3. **Your name on commits.** Use your GitHub username and GitHub's private no-reply address, so your real email stays out of the public history. `gh api user --jq .id` prints your account number:

   ```
   git config --global user.name "YOUR-USERNAME"
   git config --global user.email "ACCOUNT-NUMBER+YOUR-USERNAME@users.noreply.github.com"
   ```

4. **Your copy.** Make a fork, download it, and point `gh` at the main repo for pull requests:

   ```
   gh repo fork MiggsBoson/lab --clone --default-branch-only
   cd lab
   gh repo set-default MiggsBoson/lab
   ```

5. **Preview it.** Start a local web server, then open http://localhost:8000:

   ```
   python -m http.server 8000
   ```

   The shared live features (chess, shout box, other people's cursors) need the live server, so they won't connect on your machine. Everything else works.

## Making a change

1. Start a branch: `git switch -c my-idea`.
2. Make the change. To add an experiment, copy `hello/` to a new folder, edit its `index.html`, and add a link to the list in the home page `index.html`. Keep to plain files: no build step, no frameworks that need installing.
3. Check it in the preview, then commit just your files: `git add my-folder index.html` and `git commit -m "Add my idea"`.
4. Send it: `git push -u origin my-idea`, then `gh pr create --fill`.
5. The owner reviews and merges. To pick up everyone else's changes later, run `gh repo sync` and then `git pull`.

## Ground rules

- No keys, passwords, tokens or personal details in any file. The repo is public.
- `server/` is the live server (a Cloudflare Worker). Changes there deploy as soon as they are merged, so explain in the pull request what they do.
- Nothing that tracks visitors or collects their data.
- Small, odd and fun beats big and polished. Usage decides what grows.

## Want direct access?

You don't need it to contribute: pull requests from your fork always work. With access you can also push to `main` yourself and merge pull requests. Ask from the terminal, or use the *Access request* form under the repo's Issues tab:

```
gh issue create --repo MiggsBoson/lab --title "Access request: YOUR-USERNAME" --body "What I'd like to build: ..."
```

When the owner approves, you get an invitation. Accept it, then point your copy at the main repo:

```
gh api user/repository_invitations --jq '.[] | "\(.id) \(.repository.full_name)"'
gh api -X PATCH user/repository_invitations/INVITATION-ID
git remote set-url origin https://github.com/MiggsBoson/lab.git
```

Pushing to `main` publishes straight away. For anything bigger than a small fix, push a branch and open a pull request so the other person sees it first.
