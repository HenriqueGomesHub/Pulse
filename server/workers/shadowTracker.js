import { pool } from '../db/pool.js';
import { VOCABULARY, evaluate } from '../strategies/engine.js';

const HOUR_MS = 60 * 60 * 1000;
const PRICE_FRESHNESS_MINUTES = 15;
const POSITION_ONLY_FEATURES = new Set(['pnl_pct', 'hold_hours']);
const FEATURE_COLUMNS = VOCABULARY.features.filter((feature) => !POSITION_ONLY_FEATURES.has(feature));

const OPEN_SHADOW_SQL = `
  SELECT t.id, t.strategy_id, t.symbol, t.qty, t.entry_price, t.entry_ts,
         t.slippage_pct_per_side, s.params
  FROM shadow_trades t
  JOIN strategies s ON s.id = t.strategy_id
  WHERE t.status = 'open'
  ORDER BY t.id
`;

const FRESH_PRICE_SQL = `
  SELECT DISTINCT ON (symbol) symbol, price
  FROM market_snapshots
  WHERE ts > now() - make_interval(mins => $1::int)
  ORDER BY symbol, ts DESC
`;

function num(value) {
  return value === null || value === undefined ? null : Number(value);
}

function featureBag(row, pnlPct, holdHours) {
  const bag = { in_position: true, pnl_pct: pnlPct, hold_hours: holdHours };
  for (const feature of FEATURE_COLUMNS) bag[feature] = num(row?.[feature]);
  return bag;
}

export async function shadowTracker() {
  const ts = new Date();
  const shadows = await pool.query(OPEN_SHADOW_SQL);
  if (shadows.rows.length === 0) {
    console.log('[shadowTracker] no open shadow positions');
    return;
  }

  const [latest, features] = await Promise.all([
    pool.query(FRESH_PRICE_SQL, [PRICE_FRESHNESS_MINUTES]),
    pool.query('SELECT DISTINCT ON (symbol) * FROM features ORDER BY symbol, ts DESC'),
  ]);

  const priceBySymbol = new Map(latest.rows.map((row) => [row.symbol, Number(row.price)]));
  const featuresBySymbol = new Map(features.rows.map((row) => [row.symbol, row]));

  let closed = 0;
  const stale = [];
  for (const shadow of shadows.rows) {
    const markPrice = priceBySymbol.get(shadow.symbol);
    if (markPrice === undefined || !Number.isFinite(markPrice)) {
      stale.push(`${shadow.id} ${shadow.symbol}`);
      continue;
    }

    const isShort = shadow.params.side === 'short';
    const entryPrice = Number(shadow.entry_price);
    const holdHours = (ts.getTime() - new Date(shadow.entry_ts).getTime()) / HOUR_MS;
    const markPnlPct = isShort
      ? ((entryPrice - markPrice) / entryPrice) * 100
      : ((markPrice - entryPrice) / entryPrice) * 100;

    const bag = featureBag(featuresBySymbol.get(shadow.symbol), markPnlPct, holdHours);
    const signal = evaluate(shadow.params, bag);

    if (!signal) {
      await pool.query(
        `UPDATE shadow_trades
         SET pnl_pct = $1, hold_hours = $2, last_price = $3, last_price_ts = $4
         WHERE id = $5`,
        [markPnlPct, holdHours, markPrice, ts, shadow.id]
      );
      console.log(
        `[shadowTracker] shadow ${shadow.id} ${shadow.symbol} open: pnl ${markPnlPct.toFixed(2)}%, held ${holdHours.toFixed(2)}h`
      );
      continue;
    }

    // The row's own constant, not the current one. A shadow trade is a single counterfactual and
    // must be priced under a single assumption on both legs, or shadow_trades.slippage_pct_per_side
    // stops being true of the row and nothing can restate it exactly afterwards. A position open
    // across a change to the constant is the only case where these differ, and it is the case that
    // matters: the entry is already spent at the old number.
    const slippage = Number(shadow.slippage_pct_per_side);
    const exitPrice = markPrice * (1 + (isShort ? slippage : -slippage) / 100);
    const exitPnlPct = isShort
      ? ((entryPrice - exitPrice) / entryPrice) * 100
      : ((exitPrice - entryPrice) / entryPrice) * 100;
    const reason = signal.conditions_met
      .map((condition) => `${condition.feature} ${condition.op} ${condition.value}`)
      .join(' OR ');

    await pool.query(
      `UPDATE shadow_trades
       SET exit_price = $1, exit_ts = $2, pnl_pct = $3, hold_hours = $4, exit_reason = $5, status = 'closed'
       WHERE id = $6`,
      [exitPrice, ts, exitPnlPct, holdHours, reason, shadow.id]
    );

    closed += 1;
    console.log(
      `[shadowTracker] shadow ${shadow.id} ${shadow.symbol} closed @ ${exitPrice.toFixed(4)} (mark ${markPrice}, ${slippage}% adverse): pnl ${exitPnlPct.toFixed(2)}% after ${holdHours.toFixed(2)}h (${reason})`
    );
  }

  console.log(
    `[shadowTracker] ${shadows.rows.length} open shadow positions, ${shadows.rows.length - stale.length} marked, ${closed} closed${
      stale.length === 0
        ? ''
        : `, not marked with no market_snapshots price inside ${PRICE_FRESHNESS_MINUTES} minutes: ${stale.join(', ')}`
    }`
  );
}
