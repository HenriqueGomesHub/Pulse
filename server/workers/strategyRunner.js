import {
  MAX_CONVICTION_CALLS_PER_DAY,
  MAX_DAY_TRADES_PER_5_SESSIONS,
  SHADOW_SLIPPAGE_PCT_PER_SIDE,
} from '../config.js';
import { pool } from '../db/pool.js';
import { getClock, getLatestTradePrice, submitOrder } from '../services/alpaca.js';
import { callClaude } from '../services/claude.js';
import { evaluate } from '../strategies/engine.js';

const NOTIONAL_USD = 1000;
const CONVICTION_MODEL = 'claude-haiku-4-5';
const CONVICTION_MAX_TOKENS = 300;
const MIN_CONVICTION = 0.4;
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

const CONVICTION_SCHEMA = {
  type: 'object',
  properties: {
    conviction: {
      type: 'number',
      description:
        'Confidence from 0 to 1 that this entry signal will be a profitable trade for this strategy. 0 is no confidence, 1 is full confidence.',
    },
    reasoning: {
      type: 'string',
      description: '2-3 sentences explaining the conviction score, citing the feature values that drove it.',
    },
  },
  required: ['conviction', 'reasoning'],
  additionalProperties: false,
};

const RESERVE_CONVICTION_CALL_SQL = `
  INSERT INTO claude_call_budget (day, calls)
  VALUES ((now() AT TIME ZONE 'America/New_York')::date, 1)
  ON CONFLICT (day) DO UPDATE SET calls = claude_call_budget.calls + 1
    WHERE claude_call_budget.calls < $1
  RETURNING calls
`;

const OPEN_SHADOW_KEYS_SQL = "SELECT strategy_id, symbol FROM shadow_trades WHERE status = 'open'";

const INSERT_SHADOW_SQL = `
  INSERT INTO shadow_trades (strategy_id, symbol, entry_signal_id, blocked_by, qty, entry_price, entry_ts,
                             slippage_pct_per_side, status)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open') RETURNING id
`;

const RECORD_SHADOW_DROPS_SQL = `
  UPDATE claude_call_budget SET shadow_drops = shadow_drops + $1
  WHERE day = (now() AT TIME ZONE 'America/New_York')::date
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
    mentions_1h: row.mentions_1h === null ? null : Number(row.mentions_1h),
    unique_authors_1h: row.unique_authors_1h === null ? null : Number(row.unique_authors_1h),
    mentions_24h: row.mentions_24h === null ? null : Number(row.mentions_24h),
    mention_growth_24h: row.mention_growth_24h === null ? null : Number(row.mention_growth_24h),
    rel_volume_zscore: row.rel_volume_zscore === null ? null : Number(row.rel_volume_zscore),
    price_momentum: row.price_momentum === null ? null : Number(row.price_momentum),
    price_momentum_1d: row.price_momentum_1d === null ? null : Number(row.price_momentum_1d),
    price_momentum_2d: row.price_momentum_2d === null ? null : Number(row.price_momentum_2d),
    days_to_cover: row.days_to_cover === null ? null : Number(row.days_to_cover),
    exhaustion_score: row.exhaustion_score === null ? null : Number(row.exhaustion_score),
  };
}

async function convictionFor(strategyName, bag) {
  const reserved = await pool.query(RESERVE_CONVICTION_CALL_SQL, [MAX_CONVICTION_CALLS_PER_DAY]);
  if (reserved.rowCount === 0) {
    console.warn(
      `[strategyRunner] daily budget of ${MAX_CONVICTION_CALLS_PER_DAY} conviction calls is spent, no conviction and no trade`
    );
    return { conviction: null, reasoning: null, budgetExceeded: true };
  }

  const verdict = await callClaude(
    `Strategy: ${strategyName}\nfeature_snapshot: ${JSON.stringify(bag)}`,
    CONVICTION_SCHEMA,
    { model: CONVICTION_MODEL, maxTokens: CONVICTION_MAX_TOKENS }
  );

  const conviction = Number(verdict?.conviction);
  if (!Number.isFinite(conviction) || conviction < 0 || conviction > 1) {
    console.warn(
      `[strategyRunner] ${strategyName}: Claude returned no usable conviction (call ${reserved.rows[0].calls} of ${MAX_CONVICTION_CALLS_PER_DAY} today), the trade is not gated on it`
    );
    return { conviction: null, reasoning: null, budgetExceeded: false };
  }
  return { conviction, reasoning: verdict.reasoning, budgetExceeded: false };
}

async function recordShadowEntries(refused, ts, prices, shadowKeys) {
  let recorded = 0;
  let capDropped = 0;
  let unusable = 0;
  let duplicate = 0;
  let belowConviction = 0;

  for (const { strategy, symbol, bag, conditions, blockedBy, refusal } of refused) {
    const key = `${strategy.id}:${symbol}`;
    if (shadowKeys.has(key)) {
      duplicate += 1;
      continue;
    }

    const verdict = await convictionFor(strategy.name, bag);

    if (verdict.budgetExceeded) {
      capDropped += 1;
      console.warn(
        `[strategyRunner] shadow DROPPED ${strategy.name} ${symbol}: the shared daily cap of ${MAX_CONVICTION_CALLS_PER_DAY} conviction calls is spent, and a shadow entry is never recorded with conviction NULL (${refusal})`
      );
      continue;
    }

    if (verdict.conviction === null) {
      unusable += 1;
      console.warn(
        `[strategyRunner] shadow DROPPED ${strategy.name} ${symbol}: Claude returned no usable conviction, and a shadow entry is never recorded with conviction NULL (${refusal})`
      );
      continue;
    }

    const inserted = await pool.query(
      `INSERT INTO signals (strategy_id, symbol, ts, direction, conviction, reasoning, feature_snapshot)
       VALUES ($1, $2, $3, 'entry', $4, $5, $6) RETURNING id`,
      [strategy.id, symbol, ts, verdict.conviction, verdict.reasoning ?? conditions, bag]
    );

    if (verdict.conviction < MIN_CONVICTION) {
      belowConviction += 1;
      console.log(
        `[strategyRunner] shadow ${strategy.name} ${symbol}: signal ${inserted.rows[0].id} logged, conviction ${verdict.conviction} below ${MIN_CONVICTION}, no shadow entry (${refusal})`
      );
      continue;
    }

    const isShort = strategy.params.side === 'short';
    const signalPrice = prices.get(symbol);
    const qty = Math.floor(NOTIONAL_USD / signalPrice);
    const entryPrice = signalPrice * (1 + (isShort ? -SHADOW_SLIPPAGE_PCT_PER_SIDE : SHADOW_SLIPPAGE_PCT_PER_SIDE) / 100);

    const shadow = await pool.query(INSERT_SHADOW_SQL, [
      strategy.id,
      symbol,
      inserted.rows[0].id,
      blockedBy,
      qty,
      entryPrice,
      ts,
      SHADOW_SLIPPAGE_PCT_PER_SIDE,
    ]);

    shadowKeys.add(key);
    recorded += 1;
    console.log(
      `[strategyRunner] shadow entry ${shadow.rows[0].id}: ${strategy.name} ${isShort ? 'sell' : 'buy'} ${qty} ${symbol} @ ${entryPrice.toFixed(4)} (signal ${signalPrice}, ${SHADOW_SLIPPAGE_PCT_PER_SIDE}% adverse), no order placed — ${refusal} (${conditions}, conviction ${verdict.conviction})`
    );
  }

  if (capDropped > 0) await pool.query(RECORD_SHADOW_DROPS_SQL, [capDropped]);

  return { recorded, capDropped, unusable, duplicate, belowConviction };
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
  const openingBudget = MAX_DAY_TRADES_PER_5_SESSIONS - used - reserved;
  let dayTradeBudget = openingBudget;

  const [eligible, features, open, shadowOpen] = await Promise.all([
    pool.query(ELIGIBLE_SQL, [MIN_PRICE, MAX_PRICE, MIN_AVG_VOLUME_30D, ALLOWED_EXCHANGES]),
    pool.query('SELECT DISTINCT ON (symbol) * FROM features ORDER BY symbol, ts DESC'),
    pool.query("SELECT strategy_id, symbol FROM trades WHERE status = 'open'"),
    pool.query(OPEN_SHADOW_KEYS_SQL),
  ]);

  const prices = new Map(eligible.rows.map((row) => [row.symbol, Number(row.price)]));
  const featuresBySymbol = new Map(features.rows.map((row) => [row.symbol, row]));
  const openCounts = new Map();
  const openKeys = new Set();
  for (const row of open.rows) {
    openCounts.set(row.strategy_id, (openCounts.get(row.strategy_id) ?? 0) + 1);
    openKeys.add(`${row.strategy_id}:${row.symbol}`);
  }
  const shadowKeys = new Set(shadowOpen.rows.map((row) => `${row.strategy_id}:${row.symbol}`));

  console.log(
    `[strategyRunner] ${strategies.rows.length} active strategies, ${prices.size} eligible tickers, ${open.rows.length} open trades, day-trade budget ${dayTradeBudget} (${used} used, ${reserved} reserved)`
  );

  const candidates = [];
  for (const strategy of strategies.rows) {
    for (const symbol of prices.keys()) {
      if (openKeys.has(`${strategy.id}:${symbol}`)) continue;

      const featureRow = featuresBySymbol.get(symbol);
      if (!featureRow) continue;

      const bag = featureBag(featureRow);
      const signal = evaluate(strategy.params, bag);
      if (!signal) continue;

      candidates.push({
        strategy,
        symbol,
        bag,
        conditions: signal.conditions_met
          .map((condition) => `${condition.feature} ${condition.op} ${condition.value}`)
          .join(' AND '),
      });
    }
  }

  const refused = [];
  let placed = 0;
  for (const candidate of candidates) {
    const { strategy, symbol, bag, conditions } = candidate;
    const openForStrategy = openCounts.get(strategy.id) ?? 0;

    if (dayTradeBudget <= 0) {
      refused.push({
        ...candidate,
        blockedBy: 'pdt_budget',
        refusal: `PDT guard: ${MAX_DAY_TRADES_PER_5_SESSIONS} - ${used} used - ${reserved} reserved = ${openingBudget}, ${placed} placed this tick, no day-trade budget left`,
      });
      continue;
    }

    if (openForStrategy >= MAX_OPEN_TRADES_PER_STRATEGY) {
      refused.push({
        ...candidate,
        blockedBy: 'max_concurrent',
        refusal: `max-concurrent guard: ${strategy.name} holds ${openForStrategy} of ${MAX_OPEN_TRADES_PER_STRATEGY} open trades`,
      });
      continue;
    }

    const lastPrice = await getLatestTradePrice(symbol);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
      console.warn(`[strategyRunner] ${symbol}: no last trade price from Alpaca, cannot size the order, skipping`);
      continue;
    }

    const qty = Math.floor(NOTIONAL_USD / lastPrice);
    if (qty < 1) continue;

    const verdict = await convictionFor(strategy.name, bag);

    const inserted = await pool.query(
      `INSERT INTO signals (strategy_id, symbol, ts, direction, conviction, reasoning, feature_snapshot)
       VALUES ($1, $2, $3, 'entry', $4, $5, $6) RETURNING id`,
      [strategy.id, symbol, ts, verdict.conviction, verdict.reasoning ?? conditions, bag]
    );

    if (verdict.budgetExceeded) {
      console.warn(
        `[strategyRunner] ${strategy.name} ${symbol}: signal ${inserted.rows[0].id} logged with conviction NULL, trade skipped (${conditions})`
      );
      continue;
    }

    if (verdict.conviction !== null && verdict.conviction < MIN_CONVICTION) {
      console.log(
        `[strategyRunner] ${strategy.name} ${symbol}: signal ${inserted.rows[0].id} logged, conviction ${verdict.conviction} below ${MIN_CONVICTION}, trade skipped (${conditions})`
      );
      continue;
    }

    const trade = await pool.query(
      `INSERT INTO trades (strategy_id, symbol, entry_signal_id, qty, entry_ts, status)
       VALUES ($1, $2, $3, $4, $5, 'open') RETURNING id`,
      [strategy.id, symbol, inserted.rows[0].id, qty, ts]
    );
    const tradeId = trade.rows[0].id;

    const side = strategy.params.side === 'short' ? 'sell' : 'buy';
    const order = await submitOrder({ symbol, qty, side, clientOrderId: `pulse-entry-${tradeId}` });
    await pool.query('UPDATE trades SET alpaca_order_id = $1 WHERE id = $2', [order.id, tradeId]);

    openCounts.set(strategy.id, openForStrategy + 1);
    dayTradeBudget -= 1;
    placed += 1;
    console.log(
      `[strategyRunner] ${strategy.name} entry ${side} ${qty} ${symbol} @ ~${lastPrice} = $${(qty * lastPrice).toFixed(2)} (${conditions}, conviction ${verdict.conviction})`
    );
  }

  const shadow = await recordShadowEntries(refused, ts, prices, shadowKeys);

  console.log(
    `[strategyRunner] ${candidates.length} entry signals fired, ${placed} placed, ${refused.length} refused by a budget guard → ${shadow.recorded} shadow entries recorded (${shadow.duplicate} already shadowed, ${shadow.belowConviction} below conviction, ${shadow.capDropped} dropped on the conviction cap, ${shadow.unusable} dropped with no usable conviction)`
  );
}
