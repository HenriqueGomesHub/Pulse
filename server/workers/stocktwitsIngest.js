import { WATCHLIST } from '../config.js';
import { pool } from '../db/pool.js';
import { fetchSymbolStream } from '../services/stocktwits.js';

const HOUR_MS = 60 * 60 * 1000;
const MAX_PER_TICK = 16;

let cursor = 0;

function nextSlice() {
  const size = Math.min(MAX_PER_TICK, WATCHLIST.length);
  const slice = [];
  for (let i = 0; i < size; i += 1) {
    slice.push(WATCHLIST[(cursor + i) % WATCHLIST.length]);
  }
  cursor = (cursor + size) % WATCHLIST.length;
  return slice;
}

export async function stocktwitsIngest() {
  const ts = new Date();
  const cutoff = ts.getTime() - HOUR_MS;
  const symbols = nextSlice();

  const values = [];
  const params = [];

  for (const symbol of symbols) {
    const messages = await fetchSymbolStream(symbol);
    const recent = messages.filter((message) => message.createdAt.getTime() >= cutoff);
    const bullish = recent.filter((message) => message.sentiment === 'Bullish').length;
    const bearish = recent.filter((message) => message.sentiment === 'Bearish').length;

    const row = [
      symbol,
      'stocktwits',
      ts,
      recent.length,
      new Set(recent.map((message) => message.authorId)).size,
      recent.reduce((sum, message) => sum + message.likes, 0),
      bullish + bearish > 0 ? bullish / (bullish + bearish) : null,
      recent.reduce((max, message) => Math.max(max, message.likes), 0),
      { messages_scanned: messages.length, bullish, bearish, window_minutes: 60 },
    ];
    values.push(`($${params.length + 1}, $${params.length + 2}, $${params.length + 3}, $${params.length + 4}, $${params.length + 5}, $${params.length + 6}, $${params.length + 7}, $${params.length + 8}, $${params.length + 9})`);
    params.push(...row);
  }

  await pool.query(
    `INSERT INTO social_snapshots (symbol, source, ts, mentions_1h, unique_authors_1h, upvote_velocity, bull_ratio, top_post_score, raw)
     VALUES ${values.join(', ')}`,
    params
  );
  console.log(`[stocktwitsIngest] inserted ${values.length} rows for ${symbols.join(', ')}`);
}
