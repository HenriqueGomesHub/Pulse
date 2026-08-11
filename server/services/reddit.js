const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_URL = 'https://oauth.reddit.com';
const PUBLIC_URL = 'https://www.reddit.com';
const PUBLIC_USER_AGENT = 'nodejs:pulse:v1.0 (by /u/MY_REDDIT_USERNAME)';

let token = null;
let tokenExpiresAt = 0;
let warnedPublic = false;

function hasCredentials() {
  return Boolean(
    process.env.REDDIT_CLIENT_ID &&
      process.env.REDDIT_SECRET &&
      process.env.REDDIT_USER &&
      process.env.REDDIT_PASS
  );
}

function userAgent() {
  return `pulse/0.1 (by /u/${process.env.REDDIT_USER})`;
}

async function getToken() {
  if (token && Date.now() < tokenExpiresAt) return token;

  const basic = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent(),
    },
    body: new URLSearchParams({
      grant_type: 'password',
      username: process.env.REDDIT_USER,
      password: process.env.REDDIT_PASS,
    }),
  });
  if (!res.ok) {
    throw new Error(`Reddit token request failed: ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  token = body.access_token;
  tokenExpiresAt = Date.now() + (body.expires_in - 60) * 1000;
  return token;
}

async function request(path) {
  // TODO(#1): drop this public fallback and always use the OAuth branch once REDDIT_* credentials exist.
  if (!hasCredentials()) {
    if (!warnedPublic) {
      warnedPublic = true;
      console.warn('[reddit] REDDIT_* not set — using public JSON endpoints (unauthenticated rate limits)');
    }
    return fetch(`${PUBLIC_URL}${path}.json?limit=100`, {
      headers: { 'User-Agent': PUBLIC_USER_AGENT },
    });
  }
  return fetch(`${API_URL}${path}?limit=100`, {
    headers: { Authorization: `Bearer ${await getToken()}`, 'User-Agent': userAgent() },
  });
}

async function listing(path) {
  const res = await request(path);
  if (!res.ok) {
    throw new Error(`Reddit ${path} failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.data.children.map((child) => child.data);
}

export async function fetchNewPosts(subreddit) {
  const posts = await listing(`/r/${subreddit}/new`);
  return posts.map((post) => ({
    id: post.id,
    subreddit,
    author: post.author,
    text: `${post.title}\n${post.selftext ?? ''}`,
    score: post.score,
    createdAt: new Date(post.created_utc * 1000),
  }));
}

export async function fetchNewComments(subreddit) {
  const comments = await listing(`/r/${subreddit}/comments`);
  return comments.map((comment) => ({
    id: comment.id,
    subreddit,
    author: comment.author,
    text: comment.body ?? '',
    score: comment.score,
    createdAt: new Date(comment.created_utc * 1000),
  }));
}
