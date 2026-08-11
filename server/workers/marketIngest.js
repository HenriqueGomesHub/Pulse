import { WATCHLIST } from '../config.js';
import { pool } from '../db/pool.js';
import { getBars } from '../services/alpaca.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SESSION_HOURS = 6.5;

function pctChange(from, to) {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / from) * 100;
}

export async function marketIngest() {
  const ts = new Date();
  const [hourly, daily] = await Promise.all([
    getBars(WATCHLIST, '1Hour', new Date(ts.getTime() - 2 * DAY_MS)),
    getBars(WATCHLIST, '1Day', new Date(ts.getTime() - 45 * DAY_MS)),
  ]);

  const values = [];
  const params = [];
  const missing = [];

  for (const symbol of WATCHLIST) {
    const hourBars = hourly[symbol] ?? [];
    if (hourBars.length === 0) {
      missing.push(symbol);
      continue;
    }

    const dayBars = daily[symbol] ?? [];
    const last = hourBars[hourBars.length - 1];
    const prevHour = hourBars[hourBars.length - 2];
    const lastDay = dayBars[dayBars.length - 1];
    const prevDay = dayBars[dayBars.length - 2];

    const baseline = dayBars.slice(-31, -1);
    const avgHourlyVolume = baseline.length > 0
      ? baseline.reduce((sum, bar) => sum + bar.v, 0) / baseline.length / SESSION_HOURS
      : null;

    const row = [
      symbol,
      ts,
      last.c,
      last.v,
      avgHourlyVolume ? last.v / avgHourlyVolume : null,
      pctChange(prevHour?.c, last.c),
      pctChange(prevDay?.c, lastDay?.c),
    ];
    values.push(`($${params.length + 1}, $${params.length + 2}, $${params.length + 3}, $${params.length + 4}, $${params.length + 5}, $${params.length + 6}, $${params.length + 7})`);
    params.push(...row);
  }

  if (missing.length > 0) {
    console.warn(`[marketIngest] no bars returned for: ${missing.join(', ')}`);
  }
  if (values.length === 0) return;

  await pool.query(
    `INSERT INTO market_snapshots (symbol, ts, price, volume_1h, rel_volume, pct_change_1h, pct_change_1d)
     VALUES ${values.join(', ')}`,
    params
  );
  console.log(`[marketIngest] inserted ${values.length} rows`);
}
