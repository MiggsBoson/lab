# Reddit Worker

A tiny Cloudflare Worker that fetches the top Reddit post of the day for a subreddit.
It exists because the Reddit app's secret can't go in the public pages.

- Code: `reddit-top.js` (the copy in this repo is the master; paste it into Cloudflare).
- Used by: `live/index.html` (`REDDIT_WORKER` near the bottom).
- Only answers requests from `https://miggsboson.github.io` and `http://localhost:8000`.
- Remembers each subreddit's answer for 10 minutes, so Reddit gets few requests.
- Free plan: 100,000 requests a day.

## Set up (once, in the Cloudflare website)

1. Sign up at https://dash.cloudflare.com (free plan).
2. Check your `workers.dev` name: **Workers & Pages** → the account's **workers.dev subdomain**
   (in the right-hand panel or under Settings).  It can default to part of your email; change it
   to something neutral, because it appears in the site's public code.
3. **Workers & Pages** → **Create** → **Create Worker** (start from "Hello World").
   Name it `lab-reddit` → **Deploy**.
4. **Edit code** → delete everything → paste all of `reddit-top.js` → **Deploy**.
5. The Worker → **Settings** → **Variables and Secrets** → **Add**, type **Secret**, for each:
   - `REDDIT_CLIENT_ID`: the code under "personal use script" on reddit.com/prefs/apps
   - `REDDIT_CLIENT_SECRET`: the app's secret (click **edit** on the Reddit app to see it)
   - `REDDIT_USERNAME` (optional): your Reddit username, sent only to Reddit as contact info

   Then **Deploy**.
6. Copy the Worker's address, e.g. `https://lab-reddit.<your-subdomain>.workers.dev`,
   and put it in `REDDIT_WORKER` in `live/index.html`.

## Update the code later

Edit `reddit-top.js` here, then repeat step 4.
