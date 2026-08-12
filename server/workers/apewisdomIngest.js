import { WATCHLIST } from '../config.js';
import { pool } from '../db/pool.js';

const PAGE_URL = 'https://apewisdom.io/api/v1.0/filter/all-stocks/page/';
const USER_AGENT = 'pulse/1.0 (paper-trading research agent; +https://github.com/HenriqueGomesHub/Pulse)';
const MAX_PAGES = 20;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 2000;
const RETRY_BUDGET_MS = 60000;
const HEARTBEAT_MINUTES = 30;

const LAST_PAYLOAD_SQL = `
  SELECT DISTINCT ON (symbol) symbol, raw
  FROM social_snapshots
  WHERE source = 'apewisdom' AND symbol = ANY($1)
    AND ts > now() - interval '${HEARTBEAT_MINUTES} minutes'
  ORDER BY symbol, ts DESC
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonical(payload) {
  if (payload === null || typeof payload !== 'object') return null;
  return JSON.stringify(Object.keys(payload).sort().map((key) => [key, payload[key]]));
}

async function fetchPage(page, deadline) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${PAGE_URL}${page}`, { headers: { 'User-Agent': USER_AGENT } });
    if (response.ok) return response.json();

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`apewisdom page ${page} returned ${response.status}`);
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : BACKOFF_MS * attempt;
    if (Date.now() + wait > deadline) {
      throw new Error(
        `apewisdom page ${page} returned ${response.status} and the next attempt would wait ${wait}ms, more than the ${RETRY_BUDGET_MS}ms retry budget for this tick has left, so it was not attempted`
      );
    }
    await sleep(wait);
  }
}

function pageResults(body, page) {
  const results = body?.results;
  if (!Array.isArray(results)) {
    throw new Error(`apewisdom page ${page} returned no results array — refusing to read a malformed page as the end of the ranking`);
  }
  return results;
}

async function fetchRanking() {
  const deadline = Date.now() + RETRY_BUDGET_MS;
  const first = await fetchPage(1, deadline);
  const pages = Number(first.pages);
  const count = Number(first.count);
  if (!Number.isInteger(pages) || pages < 1) {
    throw new Error(`apewisdom returned an unusable page count: ${JSON.stringify(first.pages)}`);
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`apewisdom returned an unusable ranking size: ${JSON.stringify(first.count)}`);
  }
  if (pages > MAX_PAGES) {
    throw new Error(`apewisdom reports ${pages} pages, above the ${MAX_PAGES} bound — refusing to read a partial ranking as complete`);
  }

  const results = [...pageResults(first, 1)];
  const pageSize = results.length;
  if (pageSize === 0) {
    throw new Error(
      `apewisdom page 1 of ${pages} came back empty while reporting ${count} ranked tickers — refusing to read an unreadable ranking as absence`
    );
  }
  for (let page = 2; page <= pages; page += 1) {
    results.push(...pageResults(await fetchPage(page, deadline), page));
  }
  const missing = count - results.length;
  if (missing >= pageSize) {
    throw new Error(
      `apewisdom collected ${results.length} of the ${count} ranked tickers it reports over ${pages} pages, short by ${missing}, a whole page of ${pageSize} or more — refusing to read an incomplete ranking as absence`
    );
  }
  return results;
}

export async function apewisdomIngest() {
  const ts = new Date();

  let ranked;
  try {
    ranked = await fetchRanking();
  } catch (error) {
    console.warn(`[apewisdomIngest] source fetch failed, skipping tick: ${error.message}`);
    return;
  }

  const byTicker = new Map(ranked.map((entry) => [entry.ticker, entry]));
  const stored = await pool.query(LAST_PAYLOAD_SQL, [WATCHLIST]);
  const storedPayload = new Map(stored.rows.map((row) => [row.symbol, canonical(row.raw)]));

  const values = [];
  const params = [];
  let unchanged = 0;

  for (const symbol of WATCHLIST) {
    const entry = byTicker.get(symbol);
    const raw = entry ?? { absent_from_ranking: true };
    if (storedPayload.get(symbol) === canonical(raw)) {
      unchanged += 1;
      continue;
    }

    const row = [symbol, 'apewisdom', ts, entry ? entry.mentions : 0, entry ? entry.upvotes : 0, raw];
    values.push(`($${params.length + 1}, $${params.length + 2}, $${params.length + 3}, $${params.length + 4}, $${params.length + 5}, $${params.length + 6})`);
    params.push(...row);
  }

  if (values.length === 0) {
    console.log(
      `[apewisdomIngest] ${ranked.length} ranked tickers, all ${unchanged} watchlist payloads unchanged since a row written inside the last ${HEARTBEAT_MINUTES} minutes, inserted 0 rows`
    );
    return;
  }

  await pool.query(
    `INSERT INTO social_snapshots (symbol, source, ts, mentions_24h, upvotes_24h, raw)
     VALUES ${values.join(', ')}`,
    params
  );
  console.log(
    `[apewisdomIngest] ${ranked.length} ranked tickers, inserted ${values.length} rows, ${unchanged} unchanged inside the ${HEARTBEAT_MINUTES}-minute heartbeat`
  );
}
