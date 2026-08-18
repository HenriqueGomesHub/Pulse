import { WATCHLIST, WIKI_ARTICLES } from '../config.js';
import { pool } from '../db/pool.js';

const API_BASE =
  'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/';
const USER_AGENT = 'pulse/1.0 (paper-trading research agent; +https://github.com/HenriqueGomesHub/Pulse)';
const INSTRUMENT = 'wikipedia';
const GRANULARITY = 'daily';
const WINDOW_DAYS = 35;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 2000;
const RETRY_BUDGET_MS = 60000;
const DAY_MS = 24 * 60 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dateStamp(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

// Returns null when Wikimedia has no data for the range — see fetchDaily for why that is a
// boundary condition rather than an error.
async function fetchWindow(article, start, end, deadline) {
  const url = `${API_BASE}${encodeURIComponent(article.replace(/ /g, '_'))}/daily/${dateStamp(start)}/${dateStamp(end)}`;

  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (response.ok) {
      const body = await response.json();
      if (!Array.isArray(body?.items)) {
        throw new Error(`"${article}" returned no items array`);
      }
      return body.items;
    }
    if (response.status === 404) return null;

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`"${article}" returned ${response.status}`);
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : BACKOFF_MS * attempt;
    if (Date.now() + wait > deadline) {
      throw new Error(
        `"${article}" returned ${response.status} and the next attempt would wait ${wait}ms, more than the ${RETRY_BUDGET_MS}ms retry budget for this run has left, so it was not attempted`
      );
    }
    await sleep(wait);
  }
}

// Wikimedia 404s the WHOLE range when its end boundary has no data loaded yet, and does so
// inconsistently between articles: measured 2026-08-15, "MARA Holdings" 404'd on a range ending
// D-1 while eleven other articles returned that same range with D-1 merely absent. Left
// unhandled, one unlucky article loses its entire window behind a per-ticker skip. Stepping the
// boundary back a day costs one day of freshness and recovers the other 34.
async function fetchDaily(article, deadline) {
  const yesterday = new Date(Date.now() - DAY_MS);
  for (const daysBack of [0, 1]) {
    const end = new Date(yesterday.getTime() - daysBack * DAY_MS);
    const start = new Date(end.getTime() - (WINDOW_DAYS - 1) * DAY_MS);
    const items = await fetchWindow(article, start, end, deadline);
    if (items !== null) return items;
  }
  throw new Error(`"${article}" returned 404 for windows ending on each of the last two days`);
}

// Wikimedia omits days it has no data for rather than reporting zero, so an absent day stays
// absent here — it is unknown, not silence, and the z-score's observation minimum handles it.
function rowsFor(symbol, items, fetchedAt) {
  const values = [];
  const params = [];
  for (const item of items) {
    if (typeof item.timestamp !== 'string' || !Number.isFinite(item.views)) continue;
    const periodDate = `${item.timestamp.slice(0, 4)}-${item.timestamp.slice(4, 6)}-${item.timestamp.slice(6, 8)}`;
    const row = [symbol, INSTRUMENT, periodDate, GRANULARITY, item.views, fetchedAt, item];
    values.push(`(${row.map((_, index) => `$${params.length + index + 1}`).join(', ')})`);
    params.push(...row);
  }
  return { values, params };
}

export async function wikiIngest() {
  const fetchedAt = new Date();
  const deadline = Date.now() + RETRY_BUDGET_MS;
  const mapped = WATCHLIST.filter((symbol) => WIKI_ARTICLES[symbol]);

  let inserted = 0;
  let skipped = 0;

  for (const symbol of mapped) {
    const article = WIKI_ARTICLES[symbol];
    try {
      const items = await fetchDaily(article, deadline);
      const { values, params } = rowsFor(symbol, items, fetchedAt);
      if (values.length === 0) {
        console.warn(`[wikiIngest] ${symbol} ("${article}") returned no usable daily counts, skipping`);
        skipped += 1;
        continue;
      }
      await pool.query(
        `INSERT INTO attention_snapshots (symbol, instrument, period_date, granularity, value, fetched_at, raw)
         VALUES ${values.join(', ')}
         ON CONFLICT (symbol, instrument, period_date)
         DO UPDATE SET value = EXCLUDED.value, fetched_at = EXCLUDED.fetched_at, raw = EXCLUDED.raw`,
        params
      );
      inserted += values.length;
    } catch (error) {
      console.warn(`[wikiIngest] ${symbol} ("${article}") failed, skipping: ${error.message}`);
      skipped += 1;
    }
  }

  const summary = `${mapped.length} mapped tickers of ${WATCHLIST.length}, ${inserted} daily rows upserted over a ${WINDOW_DAYS}-day window, ${skipped} skipped`;
  console.log(`[wikiIngest] ${summary}`);
  return summary;
}
