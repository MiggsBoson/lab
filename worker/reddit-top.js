// Cloudflare Worker: the top Reddit post of the day for any subreddit.
//
// The lab's pages are public, so they can't hold the Reddit app's secret.
// This Worker holds it instead.  A page asks   ?sub=ireland
// and gets back a few fields of that subreddit's top post today.
//
// Set these in the Cloudflare dashboard (Settings → Variables and Secrets),
// never in this file:
//   REDDIT_CLIENT_ID       secret: the code under "personal use script"
//   REDDIT_CLIENT_SECRET   secret: the app's secret
//   REDDIT_USERNAME        optional secret: sent to Reddit as contact info

const ALLOWED_ORIGINS = ["https://miggsboson.github.io", "http://localhost:8000"];
const CACHE_SECONDS = 600;                    // answer each subreddit from memory for 10 minutes
const MAX_CACHED = 500;
const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;     // Reddit's rule for subreddit names
const IMAGE_HOST = /(^|\.)(redd\.it|redditmedia\.com)$/;
const TEXT_LIMIT = 400;

let token = null;          // { value, expires }: reused until it runs out
const cache = new Map();   // subreddit → { body, status, expires }

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const headers = { "Content-Type": "application/json; charset=utf-8", "Vary": "Origin" };
    const allowed = ALLOWED_ORIGINS.includes(origin);
    if (allowed) headers["Access-Control-Allow-Origin"] = origin;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET" } });
    }
    if (request.method !== "GET") return reply({ error: "Only GET is supported." }, 405, headers);
    if (!allowed) return reply({ error: "This service only answers the lab's pages." }, 403, headers);
    if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
      return reply({ error: "The Worker isn't set up yet: add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET." }, 500, headers);
    }

    const name = (new URL(request.url).searchParams.get("sub") || "").trim().replace(/^\/?r\//i, "");
    if (!SUBREDDIT.test(name)) return reply({ error: "That isn't a valid subreddit name." }, 400, headers);

    const key = name.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return reply(hit.body, hit.status, headers);

    let body, status;
    try {
      [body, status] = await topPost(name, env);
    } catch (e) {
      console.log("Reddit problem:", e.message);   // shows in the Worker's logs in Cloudflare
      const why = e.message.startsWith("credentials")
        ? `Reddit didn't accept the app's ID or secret (${e.message.slice(13)}).`
        : "Couldn't reach Reddit.  Try again in a minute.";
      return reply({ error: why }, 502, headers);
    }

    // Remember real answers (a post, or "no such subreddit"), not outages.
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
    cache.set(key, { body, status, expires: Date.now() + CACHE_SECONDS * 1000 });
    return reply(body, status, headers);
  },
};

function reply(body, status, headers) {
  const h = { ...headers };
  if (status === 200) h["Cache-Control"] = `public, max-age=${CACHE_SECONDS}`;
  return new Response(JSON.stringify(body), { status, headers: h });
}

// Reddit asks every app to send a descriptive User-Agent.
function userAgent(env) {
  return "web:lab-top-post:1.0" + (env.REDDIT_USERNAME ? ` (by /u/${env.REDDIT_USERNAME})` : "");
}

// App-only login: the app's ID and secret are enough to read public posts.
async function getToken(env, fresh) {
  if (!fresh && token && token.expires > Date.now()) return token.value;
  // trim() drops stray spaces or line breaks picked up when pasting the secrets.
  const id = env.REDDIT_CLIENT_ID.trim();
  const secret = env.REDDIT_CLIENT_SECRET.trim();
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${id}:${secret}`),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent(env),
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || (res.ok && !data.access_token)) {
    // Say what Reddit answered (never the secret itself), to help find the problem.
    throw new Error(`credentials: Reddit said ${res.status} ${data.message || data.error || ""}`.trim());
  }
  if (!res.ok) throw new Error(`token ${res.status}`);
  token = { value: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
  return token.value;
}

async function topPost(name, env) {
  let res;
  for (const fresh of [false, true]) {   // if Reddit says the token expired, get a new one and retry once
    res = await fetch(`https://oauth.reddit.com/r/${name}/top?t=day&limit=1&raw_json=1`, {
      headers: { "Authorization": `Bearer ${await getToken(env, fresh)}`, "User-Agent": userAgent(env) },
      redirect: "manual",                 // Reddit sends unknown names to a search page
    });
    if (res.status !== 401) break;
  }

  if (res.status >= 300 && res.status < 400) return [{ error: `r/${name} doesn't exist.` }, 404];
  if (res.status === 403 || res.status === 404) {
    const reason = (await res.json().catch(() => ({}))).reason;
    const words = { private: "is private", banned: "is banned", quarantined: "is quarantined", gold_only: "is members-only" };
    if (reason) return [{ error: `r/${name} ${words[reason] || "can't be shown"}.` }, 404];
    if (res.status === 404) return [{ error: `r/${name} doesn't exist.` }, 404];
    throw new Error("listing 403");
  }
  if (!res.ok) throw new Error(`listing ${res.status}`);

  const post = (await res.json())?.data?.children?.[0]?.data;
  if (!post) return [{ subreddit: name, post: null }, 200];
  return [{ subreddit: post.subreddit || name, post: simplify(post) }, 200];
}

// Send back only what the page shows.
function simplify(p) {
  const text = p.is_self ? p.selftext || "" : "";
  return {
    title: p.title,
    link: `https://www.reddit.com${p.permalink}`,
    author: p.author,
    score: p.score,
    comments: p.num_comments,
    created: p.created_utc,
    nsfw: Boolean(p.over_18),
    spoiler: Boolean(p.spoiler),
    image: pickImage(p),
    text: text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT).trimEnd() + "…" : text,
    domain: p.is_self ? "" : p.domain,
  };
}

// A medium-sized preview picture if there is one, else the thumbnail.
function pickImage(p) {
  const img = p.preview?.images?.[0];
  const sizes = img ? [...(img.resolutions || []), img.source] : [];
  let url = (sizes.find((s) => s && s.width >= 640) || sizes[sizes.length - 1])?.url;
  if (!url && p.is_gallery) {
    const first = p.gallery_data?.items?.[0]?.media_id;
    url = p.media_metadata?.[first]?.s?.u;
  }
  return safeImage(url || p.thumbnail);
}

// Only pass on pictures hosted by Reddit itself.
function safeImage(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && IMAGE_HOST.test(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}
