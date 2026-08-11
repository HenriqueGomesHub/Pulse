import { SUBREDDITS, WATCHLIST } from '../config.js';
import { pool } from '../db/pool.js';
import { fetchNewComments, fetchNewPosts } from '../services/reddit.js';
import { extractTickers } from '../services/tickerExtractor.js';

const HOUR_MS = 60 * 60 * 1000;

export async function redditIngest() {
  const ts = new Date();
  const cutoff = ts.getTime() - HOUR_MS;

  const batches = await Promise.all(
    SUBREDDITS.flatMap((subreddit) => [fetchNewPosts(subreddit), fetchNewComments(subreddit)])
  );
  const recent = batches.flat().filter((item) => item.createdAt.getTime() >= cutoff);

  const totals = new Map(
    WATCHLIST.map((symbol) => [symbol, { mentions: 0, authors: new Set(), score: 0, topScore: 0 }])
  );

  for (const item of recent) {
    for (const symbol of extractTickers(item.text)) {
      const total = totals.get(symbol);
      if (!total) continue;
      total.mentions += 1;
      total.authors.add(item.author);
      total.score += item.score;
      total.topScore = Math.max(total.topScore, item.score);
    }
  }

  const values = [];
  const params = [];
  for (const symbol of WATCHLIST) {
    const total = totals.get(symbol);
    const row = [
      symbol,
      'reddit',
      ts,
      total.mentions,
      total.authors.size,
      total.score,
      null,
      total.topScore,
      { items_scanned: recent.length, subreddits: SUBREDDITS, window_minutes: 60 },
    ];
    values.push(`($${params.length + 1}, $${params.length + 2}, $${params.length + 3}, $${params.length + 4}, $${params.length + 5}, $${params.length + 6}, $${params.length + 7}, $${params.length + 8}, $${params.length + 9})`);
    params.push(...row);
  }

  await pool.query(
    `INSERT INTO social_snapshots (symbol, source, ts, mentions_1h, unique_authors_1h, upvote_velocity, bull_ratio, top_post_score, raw)
     VALUES ${values.join(', ')}`,
    params
  );
  console.log(`[redditIngest] scanned ${recent.length} items in the last hour, inserted ${values.length} rows`);
}
