import { WATCHLIST } from '../config.js';
import { pool } from '../db/pool.js';
import { getAsset, getBars } from '../services/alpaca.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const AVG_VOLUME_BARS = 30;
const BARS_LOOKBACK_DAYS = 60;

const UPDATE_SQL = `
  UPDATE tickers t
  SET name = v.name,
      exchange = v.exchange,
      avg_volume_30d = v.avg_volume_30d,
      last_meta_refresh = $5
  FROM (
    SELECT unnest($1::text[]) AS symbol,
           unnest($2::text[]) AS name,
           unnest($3::text[]) AS exchange,
           unnest($4::bigint[]) AS avg_volume_30d
  ) v
  WHERE t.symbol = v.symbol
`;

function easternDate(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(value);
}

export async function tickerMetaRefresh() {
  const ts = new Date();
  const today = easternDate(ts);

  const [assets, daily] = await Promise.all([
    Promise.all(WATCHLIST.map((symbol) => getAsset(symbol))),
    getBars(WATCHLIST, '1Day', new Date(ts.getTime() - BARS_LOOKBACK_DAYS * DAY_MS)),
  ]);

  const symbols = [];
  const names = [];
  const exchanges = [];
  const avgVolumes = [];

  for (const asset of assets) {
    const completed = (daily[asset.symbol] ?? []).filter(
      (bar) => easternDate(new Date(bar.t)) < today
    );
    const recent = completed.slice(-AVG_VOLUME_BARS);
    const avgVolume =
      recent.length < AVG_VOLUME_BARS
        ? null
        : Math.round(recent.reduce((sum, bar) => sum + bar.v, 0) / recent.length);

    if (asset.status !== 'active' || !asset.tradable) {
      console.warn(
        `[tickerMetaRefresh] ${asset.symbol}: status=${asset.status}, tradable=${asset.tradable}`
      );
    }
    if (avgVolume === null) {
      console.warn(
        `[tickerMetaRefresh] ${asset.symbol}: only ${completed.length} completed daily bars, avg_volume_30d left NULL`
      );
    }

    symbols.push(asset.symbol);
    names.push(asset.name);
    exchanges.push(asset.exchange);
    avgVolumes.push(avgVolume);
  }

  const updated = await pool.query(UPDATE_SQL, [symbols, names, exchanges, avgVolumes, ts]);
  console.log(`[tickerMetaRefresh] refreshed ${updated.rowCount} of ${symbols.length} tickers`);
}
