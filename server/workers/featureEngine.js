import { pool } from '../db/pool.js';
import {
  MENTION_BASELINE_INTERVAL,
  MENTION_BASELINE_MIN_OBS,
  primaryMentionSource,
} from '../services/mentionSource.js';

const MIN_OBS_REL_VOLUME_30D = 20;
const MIN_OBS_MENTIONS_24H = 12;
const MENTION_SD_FLOOR = 1;
const HOUR_MS = 60 * 60 * 1000;

const MARKET_SQL = `
  WITH recent AS (
    SELECT symbol, ts, price, rel_volume, pct_change_1h, pct_change_1d, pct_change_2d
    FROM market_snapshots
    WHERE ts > now() - interval '30 days'
  ),
  ranked AS (
    SELECT symbol, rel_volume, pct_change_1h, pct_change_1d, pct_change_2d,
           lag(rel_volume) OVER (PARTITION BY symbol ORDER BY ts) AS prev_rel_volume,
           row_number() OVER (PARTITION BY symbol ORDER BY ts DESC) AS rn
    FROM recent
  ),
  stats AS (
    SELECT symbol,
           count(rel_volume) AS n,
           avg(rel_volume) AS mean,
           stddev_samp(rel_volume) AS sd
    FROM recent
    GROUP BY symbol
  )
  SELECT r.symbol, r.rel_volume, r.prev_rel_volume, r.pct_change_1h, r.pct_change_1d, r.pct_change_2d,
         s.n, s.mean, s.sd
  FROM ranked r
  JOIN stats s USING (symbol)
  WHERE r.rn = 1
`;

const MENTION_SQL = `
  WITH baseline AS (
    SELECT symbol, ts,
           (CASE WHEN $1 = 'apewisdom' THEN mentions_24h ELSE mentions_1h END)::numeric AS mentions,
           mentions_1h, unique_authors_1h, mentions_24h, upvotes_24h,
           CASE WHEN jsonb_typeof(raw->'mentions_24h_ago') = 'number'
                THEN (raw->>'mentions_24h_ago')::numeric END AS mentions_24h_ago
    FROM social_snapshots
    WHERE source = $1 AND ts > now() - interval '${MENTION_BASELINE_INTERVAL}'
  ),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY symbol ORDER BY ts DESC) AS rn
    FROM baseline
  ),
  week AS (
    SELECT symbol, count(mentions) AS n, avg(mentions) AS mean, stddev_samp(mentions) AS sd
    FROM baseline
    GROUP BY symbol
  ),
  day AS (
    SELECT symbol, count(mentions) AS n, avg(mentions) AS mean, stddev_samp(mentions) AS sd
    FROM baseline
    WHERE ts > now() - interval '24 hours'
    GROUP BY symbol
  )
  SELECT r.symbol, r.ts, r.mentions, r.mentions_1h, r.unique_authors_1h,
         r.mentions_24h, r.upvotes_24h, r.mentions_24h_ago,
         p.ts AS prev_ts, p.mentions AS prev_mentions,
         w.n AS week_n, w.mean AS week_mean, w.sd AS week_sd,
         d.n AS day_n, d.mean AS day_mean, d.sd AS day_sd
  FROM ranked r
  JOIN week w USING (symbol)
  LEFT JOIN day d USING (symbol)
  LEFT JOIN ranked p ON p.symbol = r.symbol AND p.rn = 2
  WHERE r.rn = 1
`;

const BULL_RATIO_SQL = `
  WITH ranked AS (
    SELECT symbol, bull_ratio,
           lag(bull_ratio) OVER (PARTITION BY symbol ORDER BY ts) AS prev_bull_ratio,
           row_number() OVER (PARTITION BY symbol ORDER BY ts DESC) AS rn
    FROM social_snapshots
    WHERE source = 'stocktwits' AND ts > now() - interval '${MENTION_BASELINE_INTERVAL}'
  )
  SELECT symbol, bull_ratio, prev_bull_ratio FROM ranked WHERE rn = 1
`;

function num(value) {
  return value === null || value === undefined ? null : Number(value);
}

function zscore(value, mean, sd, n, minObs, sdFloor = 0) {
  if (value === null || mean === null || sd === null) return null;
  if (n === null || n < minObs) return null;
  const denominator = Math.max(sd, sdFloor);
  if (denominator === 0) return null;
  return (value - mean) / denominator;
}

function exhaustionScore(inputs) {
  if (Object.values(inputs).some((value) => value === null)) return null;
  const parts = [
    inputs.socialAccel < 0 ? 1 : 0,
    inputs.priceMomentum > 0 ? 1 : 0,
    inputs.bullRatio < inputs.prevBullRatio ? 1 : 0,
    inputs.relVolume < inputs.prevRelVolume ? 1 : 0,
  ];
  return parts.reduce((sum, part) => sum + part, 0) / parts.length;
}

export async function featureEngine() {
  const ts = new Date();
  const primarySource = await primaryMentionSource();
  const [tickers, market, social, bull] = await Promise.all([
    pool.query('SELECT symbol, days_to_cover FROM tickers ORDER BY symbol'),
    pool.query(MARKET_SQL),
    pool.query(MENTION_SQL, [primarySource]),
    pool.query(BULL_RATIO_SQL),
  ]);

  const marketBySymbol = new Map(market.rows.map((row) => [row.symbol, row]));
  const socialBySymbol = new Map(social.rows.map((row) => [row.symbol, row]));
  const bullBySymbol = new Map(bull.rows.map((row) => [row.symbol, row]));

  const values = [];
  const params = [];

  for (const { symbol, days_to_cover: daysToCover } of tickers.rows) {
    const m = marketBySymbol.get(symbol);
    const s = socialBySymbol.get(symbol);
    const b = bullBySymbol.get(symbol);

    const relVolume = m ? num(m.rel_volume) : null;
    const prevRelVolume = m ? num(m.prev_rel_volume) : null;
    const priceMomentum = m ? num(m.pct_change_1h) : null;
    const priceMomentum1d = m ? num(m.pct_change_1d) : null;
    const priceMomentum2d = m ? num(m.pct_change_2d) : null;
    const relVolumeZscore = m
      ? zscore(relVolume, num(m.mean), num(m.sd), num(m.n), MIN_OBS_REL_VOLUME_30D)
      : null;

    const mentions = s ? num(s.mentions) : null;
    const authors = s ? num(s.unique_authors_1h) : null;
    const mentions1h = s ? num(s.mentions_1h) : null;
    const mentions24h = s ? num(s.mentions_24h) : null;
    const upvotes24h = s ? num(s.upvotes_24h) : null;
    const mentions24hAgo = s ? num(s.mentions_24h_ago) : null;
    const mentionGrowth24h =
      mentions24h === null || mentions24hAgo === null ? null : mentions24h - mentions24hAgo;
    const bullRatio = b ? num(b.bull_ratio) : null;
    const prevBullRatio = b ? num(b.prev_bull_ratio) : null;

    const socialVelocity = s
      ? zscore(mentions, num(s.day_mean), num(s.day_sd), num(s.day_n), MIN_OBS_MENTIONS_24H)
      : null;
    const mentionZscore = s
      ? zscore(mentions, num(s.week_mean), num(s.week_sd), num(s.week_n), MENTION_BASELINE_MIN_OBS, MENTION_SD_FLOOR)
      : null;

    const priorVelocity = s
      ? zscore(num(s.prev_mentions), num(s.day_mean), num(s.day_sd), num(s.day_n), MIN_OBS_MENTIONS_24H)
      : null;
    const observationHours = s && s.prev_ts ? (s.ts.getTime() - s.prev_ts.getTime()) / HOUR_MS : null;
    const socialAccel =
      socialVelocity === null || priorVelocity === null || !(observationHours > 0)
        ? null
        : (socialVelocity - priorVelocity) / observationHours;

    const authorQuality =
      mentions === null || authors === null || mentions === 0 ? null : authors / mentions;

    const row = [
      symbol,
      ts,
      socialVelocity,
      socialAccel,
      authorQuality,
      mentionZscore,
      relVolumeZscore,
      priceMomentum,
      exhaustionScore({ socialAccel, priceMomentum, bullRatio, prevBullRatio, relVolume, prevRelVolume }),
      mentions1h,
      authors,
      num(daysToCover),
      priceMomentum1d,
      priceMomentum2d,
      mentions24h,
      upvotes24h,
      mentionGrowth24h,
    ];
    values.push(`(${row.map((_, index) => `$${params.length + index + 1}`).join(', ')})`);
    params.push(...row);
  }

  if (values.length === 0) {
    console.log('[featureEngine] no active tickers, inserted 0 rows');
    return;
  }

  await pool.query(
    `INSERT INTO features (symbol, ts, social_velocity, social_accel, author_quality, mention_zscore, rel_volume_zscore, price_momentum, exhaustion_score, mentions_1h, unique_authors_1h, days_to_cover, price_momentum_1d, price_momentum_2d, mentions_24h, upvotes_24h, mention_growth_24h)
     VALUES ${values.join(', ')}`,
    params
  );
  console.log(`[featureEngine] inserted ${values.length} rows, mentions from source ${primarySource}`);
}
