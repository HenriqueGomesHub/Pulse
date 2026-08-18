import { WATCHLIST } from '../config.js';
import { pool } from '../db/pool.js';
import { getAsset, getBars } from '../services/alpaca.js';
import { getLatestShortInterest } from '../services/finra.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const AVG_VOLUME_BARS = 30;
const BARS_LOOKBACK_DAYS = 60;

const UPDATE_SQL = `
  UPDATE tickers t
  SET name = v.name,
      exchange = v.exchange,
      avg_volume_30d = v.avg_volume_30d,
      shares_short = v.shares_short,
      short_interest_settlement_date = v.settlement_date,
      days_to_cover = v.days_to_cover,
      last_meta_refresh = $8
  FROM (
    SELECT unnest($1::text[]) AS symbol,
           unnest($2::text[]) AS name,
           unnest($3::text[]) AS exchange,
           unnest($4::bigint[]) AS avg_volume_30d,
           unnest($5::bigint[]) AS shares_short,
           unnest($6::date[]) AS settlement_date,
           unnest($7::numeric[]) AS days_to_cover
  ) v
  WHERE t.symbol = v.symbol
`;

function easternDate(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(value);
}

export async function tickerMetaRefresh() {
  const ts = new Date();
  const today = easternDate(ts);

  const [assets, daily, shortInterest] = await Promise.all([
    Promise.all(WATCHLIST.map((symbol) => getAsset(symbol))),
    getBars(WATCHLIST, '1Day', new Date(ts.getTime() - BARS_LOOKBACK_DAYS * DAY_MS)),
    getLatestShortInterest(WATCHLIST),
  ]);

  const symbols = [];
  const names = [];
  const exchanges = [];
  const avgVolumes = [];
  const sharesShorts = [];
  const settlementDates = [];
  const daysToCovers = [];

  for (const asset of assets) {
    const completed = (daily[asset.symbol] ?? []).filter(
      (bar) => easternDate(new Date(bar.t)) < today
    );
    const recent = completed.slice(-AVG_VOLUME_BARS);
    const avgVolume =
      recent.length < AVG_VOLUME_BARS
        ? null
        : Math.round(recent.reduce((sum, bar) => sum + bar.v, 0) / recent.length);

    const short = shortInterest.get(asset.symbol) ?? null;
    const sharesShort = short === null ? null : short.sharesShort;
    const daysToCover =
      sharesShort === null || avgVolume === null || avgVolume <= 0 ? null : sharesShort / avgVolume;

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
    if (daysToCover === null) {
      console.warn(
        `[tickerMetaRefresh] ${asset.symbol}: days_to_cover left NULL (shares_short ${sharesShort}, avg_volume_30d ${avgVolume})`
      );
    }

    symbols.push(asset.symbol);
    names.push(asset.name);
    exchanges.push(asset.exchange);
    avgVolumes.push(avgVolume);
    sharesShorts.push(sharesShort);
    settlementDates.push(short === null ? null : short.settlementDate);
    daysToCovers.push(daysToCover);
  }

  const updated = await pool.query(UPDATE_SQL, [
    symbols,
    names,
    exchanges,
    avgVolumes,
    sharesShorts,
    settlementDates,
    daysToCovers,
    ts,
  ]);
  const summary = `refreshed ${updated.rowCount} of ${symbols.length} tickers`;
  console.log(`[tickerMetaRefresh] ${summary}`);
  return summary;
}
