import { MAX_DAY_TRADES_PER_5_SESSIONS } from '../config.js';
import { pool } from '../db/pool.js';
import { getClock, getLatestTradePrice, submitOrder } from '../services/alpaca.js';
import { evaluate } from '../strategies/engine.js';

const NOTIONAL_USD = 1000;
const MAX_OPEN_TRADES_PER_STRATEGY = 5;
const ENTRY_WINDOW_OPEN_MINUTES = 9 * 60 + 45;
const ENTRY_WINDOW_CLOSE_BUFFER_MS = 15 * 60 * 1000;
const MIN_PRICE = 1;
const MAX_PRICE = 50;
const MIN_AVG_VOLUME_30D = 500000;
const ALLOWED_EXCHANGES = ['NYSE', 'NASDAQ', 'AMEX'];

const ELIGIBLE_SQL = `
  WITH latest AS (
    SELECT DISTINCT ON (symbol) symbol, price
    FROM market_snapshots
    WHERE ts > now() - interval '1 day'
    ORDER BY symbol, ts DESC
  )
  SELECT t.symbol, l.price
  FROM tickers t
  JOIN latest l USING (symbol)
  WHERE l.price >= $1 AND l.price <= $2
    AND t.avg_volume_30d > $3
    AND t.exchange = ANY($4::text[])
`;

const DAY_TRADES_SQL = `
  SELECT
    (SELECT count(*) FROM trades
      WHERE status = 'closed'
        AND entry_ts IS NOT NULL
        AND exit_ts IS NOT NULL
        AND (entry_ts AT TIME ZONE 'America/New_York')::date = (exit_ts AT TIME ZONE 'America/New_York')::date
        AND exit_ts > now() - interval '7 days')::int AS used,
    (SELECT count(*) FROM trades
      WHERE status = 'open'
        AND entry_ts IS NOT NULL
        AND (entry_ts AT TIME ZONE 'America/New_York')::date = (now() AT TIME ZONE 'America/New_York')::date)::int
      AS reserved
`;

function easternMinutes(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return Number(value('hour')) * 60 + Number(value('minute'));
}

async function entryWindow(now) {
  const clock = await getClock();
  if (!clock.is_open) return { allowed: false, reason: `market closed, next open ${clock.next_open}` };
  if (easternMinutes(now) < ENTRY_WINDOW_OPEN_MINUTES) {
    return { allowed: false, reason: 'within 15 min of the open' };
  }
  if (now.getTime() >= new Date(clock.next_close).getTime() - ENTRY_WINDOW_CLOSE_BUFFER_MS) {
    return { allowed: false, reason: `within 15 min of the close (${clock.next_close})` };
  }
  return { allowed: true, reason: null };
}

function featureBag(row) {
  return {
    in_position: false,
    social_velocity: row.social_velocity === null ? null : Number(row.social_velocity),
    social_accel: row.social_accel === null ? null : Number(row.social_accel),
    author_quality: row.author_quality === null ? null : Number(row.author_quality),
    mention_zscore: row.mention_zscore === null ? null : Number(row.mention_zscore),
    rel_volume_zscore: row.rel_volume_zscore === null ? null : Number(row.rel_volume_zscore),
    price_momentum: row.price_momentum === null ? null : Number(row.price_momentum),
    exhaustion_score: row.exhaustion_score === null ? null : Number(row.exhaustion_score),
  };
}

export async function strategyRunner() {
  const ts = new Date();

  const gate = await entryWindow(ts);
  if (!gate.allowed) {
    console.log(`[strategyRunner] outside the entry window (${gate.reason}), no entries evaluated`);
    return;
  }

  const [strategies, dayTrades] = await Promise.all([
    pool.query("SELECT id, name, params FROM strategies WHERE status = 'active' ORDER BY id"),
    pool.query(DAY_TRADES_SQL),
  ]);

  if (strategies.rows.length === 0) {
    console.log('[strategyRunner] no active strategies');
    return;
  }

  const { used, reserved } = dayTrades.rows[0];
  let dayTradeBudget = MAX_DAY_TRADES_PER_5_SESSIONS - used - reserved;
  if (dayTradeBudget <= 0) {
    console.log(
      `[strategyRunner] PDT guard: ${used} day-trades used and ${reserved} reserved by positions opened this session, no entries`
    );
    return;
  }

  const [eligible, features, open] = await Promise.all([
    pool.query(ELIGIBLE_SQL, [MIN_PRICE, MAX_PRICE, MIN_AVG_VOLUME_30D, ALLOWED_EXCHANGES]),
    pool.query('SELECT DISTINCT ON (symbol) * FROM features ORDER BY symbol, ts DESC'),
    pool.query("SELECT strategy_id, symbol FROM trades WHERE status = 'open'"),
  ]);

  const prices = new Map(eligible.rows.map((row) => [row.symbol, Number(row.price)]));
  const featuresBySymbol = new Map(features.rows.map((row) => [row.symbol, row]));
  const openCounts = new Map();
  const openKeys = new Set();
  for (const row of open.rows) {
    openCounts.set(row.strategy_id, (openCounts.get(row.strategy_id) ?? 0) + 1);
    openKeys.add(`${row.strategy_id}:${row.symbol}`);
  }

  console.log(
    `[strategyRunner] ${strategies.rows.length} active strategies, ${prices.size} eligible tickers, ${open.rows.length} open trades, day-trade budget ${dayTradeBudget} (${used} used, ${reserved} reserved)`
  );

  let placed = 0;
  for (const strategy of strategies.rows) {
    let openForStrategy = openCounts.get(strategy.id) ?? 0;

    for (const symbol of prices.keys()) {
      if (dayTradeBudget <= 0) break;
      if (openForStrategy >= MAX_OPEN_TRADES_PER_STRATEGY) break;
      if (openKeys.has(`${strategy.id}:${symbol}`)) continue;

      const featureRow = featuresBySymbol.get(symbol);
      if (!featureRow) continue;

      const bag = featureBag(featureRow);
      const signal = evaluate(strategy.params, bag);
      if (!signal) continue;

      const lastPrice = await getLatestTradePrice(symbol);
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
        console.warn(`[strategyRunner] ${symbol}: no last trade price from Alpaca, cannot size the order, skipping`);
        continue;
      }

      const qty = Math.floor(NOTIONAL_USD / lastPrice);
      if (qty < 1) continue;

      const reasoning = signal.conditions_met
        .map((condition) => `${condition.feature} ${condition.op} ${condition.value}`)
        .join(' AND ');

      const inserted = await pool.query(
        `INSERT INTO signals (strategy_id, symbol, ts, direction, reasoning, feature_snapshot)
         VALUES ($1, $2, $3, 'entry', $4, $5) RETURNING id`,
        [strategy.id, symbol, ts, reasoning, bag]
      );

      const trade = await pool.query(
        `INSERT INTO trades (strategy_id, symbol, entry_signal_id, qty, entry_ts, status)
         VALUES ($1, $2, $3, $4, $5, 'open') RETURNING id`,
        [strategy.id, symbol, inserted.rows[0].id, qty, ts]
      );
      const tradeId = trade.rows[0].id;

      const side = strategy.params.side === 'short' ? 'sell' : 'buy';
      const order = await submitOrder({ symbol, qty, side, clientOrderId: `pulse-entry-${tradeId}` });
      await pool.query('UPDATE trades SET alpaca_order_id = $1 WHERE id = $2', [order.id, tradeId]);

      openForStrategy += 1;
      dayTradeBudget -= 1;
      placed += 1;
      console.log(
        `[strategyRunner] ${strategy.name} entry ${side} ${qty} ${symbol} @ ~${lastPrice} = $${(qty * lastPrice).toFixed(2)} (${reasoning})`
      );
    }

    if (dayTradeBudget <= 0) break;
  }

  console.log(`[strategyRunner] ${placed} entry signals placed`);
}
