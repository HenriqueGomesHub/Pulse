import { MAX_DAY_TRADES_PER_5_SESSIONS } from '../config.js';
import { pool } from '../db/pool.js';
import { findOrderByClientOrderId, getClock, getOrder, getPositions, submitOrder } from '../services/alpaca.js';
import { evaluate } from '../strategies/engine.js';

const HOUR_MS = 60 * 60 * 1000;
const TERMINAL_UNFILLED = new Set(['canceled', 'expired', 'rejected', 'done_for_day', 'replaced', 'suspended']);

const OPEN_TRADES_SQL = `
  SELECT t.id, t.strategy_id, t.symbol, t.alpaca_order_id, t.exit_order_id, t.exit_attempt,
         t.qty, t.entry_price, t.entry_ts, t.trade_max_adverse_pct, t.peak_price, s.params
  FROM trades t
  JOIN strategies s ON s.id = t.strategy_id
  WHERE t.status = 'open'
  ORDER BY t.id
`;

const LATEST_PRICE_SQL = `
  SELECT DISTINCT ON (symbol) symbol, price
  FROM market_snapshots
  WHERE ts > now() - interval '1 day'
  ORDER BY symbol, ts DESC
`;

const DAY_TRADES_SQL = `
  SELECT (
    (SELECT count(*) FROM trades
      WHERE status = 'closed'
        AND entry_ts IS NOT NULL
        AND exit_ts IS NOT NULL
        AND (entry_ts AT TIME ZONE 'America/New_York')::date = (exit_ts AT TIME ZONE 'America/New_York')::date
        AND exit_ts > now() - interval '7 days')
    +
    (SELECT count(*) FROM trades
      WHERE status = 'open'
        AND exit_order_id IS NOT NULL
        AND entry_ts IS NOT NULL
        AND (entry_ts AT TIME ZONE 'America/New_York')::date = (now() AT TIME ZONE 'America/New_York')::date)
  )::int AS n
`;

function num(value) {
  return value === null || value === undefined ? null : Number(value);
}

function markAdverse(isShort, priorPeak, price) {
  const peak = isShort ? Math.min(priorPeak, price) : Math.max(priorPeak, price);
  return { peak, adversePct: ((isShort ? price - peak : peak - price) / peak) * 100 };
}

function easternDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function featureBag(row, pnlPct, holdHours) {
  return {
    in_position: true,
    social_velocity: num(row?.social_velocity),
    social_accel: num(row?.social_accel),
    author_quality: num(row?.author_quality),
    mention_zscore: num(row?.mention_zscore),
    mentions_1h: num(row?.mentions_1h),
    unique_authors_1h: num(row?.unique_authors_1h),
    rel_volume_zscore: num(row?.rel_volume_zscore),
    price_momentum: num(row?.price_momentum),
    price_momentum_1d: num(row?.price_momentum_1d),
    price_momentum_2d: num(row?.price_momentum_2d),
    days_to_cover: num(row?.days_to_cover),
    exhaustion_score: num(row?.exhaustion_score),
    pnl_pct: pnlPct,
    hold_hours: holdHours,
  };
}

export async function positionTracker() {
  const ts = new Date();
  const trades = await pool.query(OPEN_TRADES_SQL);
  if (trades.rows.length === 0) {
    console.log('[positionTracker] no open trades');
    return;
  }

  const [clock, positions, latest, features, dayTrades] = await Promise.all([
    getClock(),
    getPositions(),
    pool.query(LATEST_PRICE_SQL),
    pool.query('SELECT DISTINCT ON (symbol) * FROM features ORDER BY symbol, ts DESC'),
    pool.query(DAY_TRADES_SQL),
  ]);

  const positionBySymbol = new Map(positions.map((position) => [position.symbol, position]));
  const priceBySymbol = new Map(latest.rows.map((row) => [row.symbol, Number(row.price)]));
  const featuresBySymbol = new Map(features.rows.map((row) => [row.symbol, row]));
  let dayTradesUsed = dayTrades.rows[0].n;

  let closed = 0;
  let submitted = 0;
  let expired = 0;
  for (const trade of trades.rows) {
    let entryPrice = num(trade.entry_price);
    let qty = num(trade.qty);
    let entryTs = trade.entry_ts;
    const isShort = trade.params.side === 'short';

    if (entryPrice === null) {
      let entryOrderId = trade.alpaca_order_id;

      if (entryOrderId === null) {
        const recovered = await findOrderByClientOrderId(`pulse-entry-${trade.id}`);
        if (recovered === null) {
          await pool.query("UPDATE trades SET status = 'expired' WHERE id = $1", [trade.id]);
          expired += 1;
          console.warn(
            `[positionTracker] trade ${trade.id} ${trade.symbol}: entry order never reached Alpaca, marked expired`
          );
          continue;
        }
        entryOrderId = recovered.id;
        await pool.query('UPDATE trades SET alpaca_order_id = $1 WHERE id = $2', [entryOrderId, trade.id]);
        console.warn(
          `[positionTracker] trade ${trade.id} ${trade.symbol}: recovered unrecorded entry order ${entryOrderId}`
        );
      }

      const order = await getOrder(entryOrderId);
      const entryFilledQty = Number(order.filled_qty ?? 0);
      const entryUsable = order.status === 'filled' || (TERMINAL_UNFILLED.has(order.status) && entryFilledQty > 0);

      if (!entryUsable) {
        if (TERMINAL_UNFILLED.has(order.status)) {
          await pool.query("UPDATE trades SET status = 'expired' WHERE id = $1", [trade.id]);
          expired += 1;
          console.warn(
            `[positionTracker] trade ${trade.id} ${trade.symbol}: entry order ${order.status} with no fill, marked expired`
          );
        } else {
          console.log(`[positionTracker] trade ${trade.id} ${trade.symbol}: entry order ${order.status}, waiting`);
        }
        continue;
      }

      entryPrice = Number(order.filled_avg_price);
      qty = entryFilledQty;
      entryTs = new Date(order.filled_at ?? order.updated_at);
      await pool.query('UPDATE trades SET entry_price = $1, qty = $2, entry_ts = $3 WHERE id = $4', [
        entryPrice,
        qty,
        entryTs,
        trade.id,
      ]);
    }

    if (trade.exit_order_id !== null) {
      const exitOrder = await getOrder(trade.exit_order_id);
      const exitFilledQty = Number(exitOrder.filled_qty ?? 0);

      if (exitOrder.status === 'filled') {
        const exitPrice = Number(exitOrder.filled_avg_price);
        const exitTs = new Date(exitOrder.filled_at);
        const holdHours = (exitTs.getTime() - new Date(entryTs).getTime()) / HOUR_MS;
        const finalPnlPct = isShort
          ? ((entryPrice - exitPrice) / entryPrice) * 100
          : ((exitPrice - entryPrice) / entryPrice) * 100;
        const excursion = markAdverse(isShort, num(trade.peak_price) ?? entryPrice, exitPrice);

        await pool.query(
          `UPDATE trades
           SET exit_price = $1, exit_ts = $2, pnl_pct = $3, trade_max_adverse_pct = $4, peak_price = $5,
               hold_hours = $6, status = 'closed'
           WHERE id = $7`,
          [
            exitPrice,
            exitTs,
            finalPnlPct,
            Math.max(num(trade.trade_max_adverse_pct) ?? 0, excursion.adversePct),
            excursion.peak,
            holdHours,
            trade.id,
          ]
        );

        closed += 1;
        console.log(
          `[positionTracker] trade ${trade.id} ${trade.symbol} closed: filled ${exitFilledQty} @ ${exitPrice}, pnl ${finalPnlPct.toFixed(2)}% after ${holdHours.toFixed(2)}h`
        );
        continue;
      }

      if (TERMINAL_UNFILLED.has(exitOrder.status)) {
        if (exitFilledQty > 0) {
          console.error(
            `[positionTracker] trade ${trade.id} ${trade.symbol}: exit order ${exitOrder.id} ended ${exitOrder.status} after filling ${exitFilledQty} of ${qty}; left open, needs manual reconciliation`
          );
          continue;
        }
        await pool.query('UPDATE trades SET exit_order_id = NULL, exit_attempt = exit_attempt + 1 WHERE id = $1', [
          trade.id,
        ]);
        console.warn(
          `[positionTracker] trade ${trade.id} ${trade.symbol}: exit order ${exitOrder.status} unfilled, retrying next tick`
        );
        continue;
      }

      console.log(`[positionTracker] trade ${trade.id} ${trade.symbol}: exit order ${exitOrder.status}, waiting`);
      continue;
    }

    const pendingExit = trade.exit_attempt > 0;
    const sameSession = easternDate(new Date(entryTs)) === easternDate(ts);
    let reasoning = null;
    let bag = null;
    let attempt = trade.exit_attempt;

    if (!pendingExit) {
      const position = positionBySymbol.get(trade.symbol);
      const currentPrice = position ? Number(position.current_price) : priceBySymbol.get(trade.symbol);
      if (currentPrice === undefined || !Number.isFinite(currentPrice)) {
        console.warn(`[positionTracker] trade ${trade.id} ${trade.symbol}: no current price available, skipping`);
        continue;
      }

      const pnlPct = isShort
        ? ((entryPrice - currentPrice) / entryPrice) * 100
        : ((currentPrice - entryPrice) / entryPrice) * 100;
      const holdHours = (ts.getTime() - new Date(entryTs).getTime()) / HOUR_MS;
      const excursion = markAdverse(isShort, num(trade.peak_price) ?? entryPrice, currentPrice);
      const maxAdversePct = Math.max(num(trade.trade_max_adverse_pct) ?? 0, excursion.adversePct);
      bag = featureBag(featuresBySymbol.get(trade.symbol), pnlPct, holdHours);
      const signal = evaluate(trade.params, bag);

      await pool.query(
        'UPDATE trades SET pnl_pct = $1, trade_max_adverse_pct = $2, peak_price = $3, hold_hours = $4 WHERE id = $5',
        [pnlPct, maxAdversePct, excursion.peak, holdHours, trade.id]
      );

      if (!signal) {
        console.log(
          `[positionTracker] trade ${trade.id} ${trade.symbol} open: pnl ${pnlPct.toFixed(2)}%, mae ${maxAdversePct.toFixed(2)}%, held ${holdHours.toFixed(2)}h`
        );
        continue;
      }

      reasoning = signal.conditions_met
        .map((condition) => `${condition.feature} ${condition.op} ${condition.value}`)
        .join(' OR ');
    }

    if (!clock.is_open) {
      console.log(
        `[positionTracker] trade ${trade.id} ${trade.symbol}: exit held, market is closed until ${clock.next_open}`
      );
      continue;
    }

    if (sameSession && dayTradesUsed >= MAX_DAY_TRADES_PER_5_SESSIONS) {
      console.warn(
        `[positionTracker] trade ${trade.id} ${trade.symbol}: exit would be day-trade ${dayTradesUsed + 1} of ${MAX_DAY_TRADES_PER_5_SESSIONS}, deferred to the next session`
      );
      continue;
    }

    if (!pendingExit) {
      const inserted = await pool.query(
        `INSERT INTO signals (strategy_id, symbol, ts, direction, reasoning, feature_snapshot)
         VALUES ($1, $2, $3, 'exit', $4, $5) RETURNING id`,
        [trade.strategy_id, trade.symbol, ts, reasoning, bag]
      );
      attempt = trade.exit_attempt + 1;
      await pool.query('UPDATE trades SET exit_signal_id = $1, exit_attempt = $2 WHERE id = $3', [
        inserted.rows[0].id,
        attempt,
        trade.id,
      ]);
    }

    const clientOrderId = `pulse-exit-${trade.id}-${attempt}`;
    let closeOrder = pendingExit ? await findOrderByClientOrderId(clientOrderId) : null;
    if (closeOrder === null) {
      closeOrder = await submitOrder({
        symbol: trade.symbol,
        qty,
        side: isShort ? 'buy' : 'sell',
        clientOrderId,
      });
    }

    await pool.query('UPDATE trades SET exit_order_id = $1 WHERE id = $2', [closeOrder.id, trade.id]);
    if (sameSession) dayTradesUsed += 1;
    submitted += 1;
    console.log(
      `[positionTracker] trade ${trade.id} ${trade.symbol}: exit order ${closeOrder.id} ${closeOrder.status} (attempt ${attempt}${reasoning === null ? '' : `, ${reasoning}`})`
    );
  }

  console.log(
    `[positionTracker] ${trades.rows.length} open trades synced, ${submitted} exits submitted, ${closed} closed, ${expired} expired`
  );
}
