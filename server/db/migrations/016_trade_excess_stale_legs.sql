-- 012 resolved each basket leg to the last snapshot at or before the trade's timestamp with no
-- lower bound. A watchlist symbol whose price feed stopped before a trade's window would therefore
-- resolve BOTH legs to the same stale row, contribute an exact 0.00% return, and still be counted
-- in basket_members — pulling the basket toward zero and the excess toward raw P&L on the metric
-- that is now primary. No leg is currently stale (checked: 0 of 500 legs over the 25 closed
-- trades), so this corrects a latent fault rather than a wrong number, which is the only time it
-- is cheap to correct. The 24-hour bound is the one evolution.js's replay already uses for the
-- same decision, REPLAY_MAX_PRICE_AGE_MS.
CREATE OR REPLACE VIEW trade_excess AS
WITH closed AS (
  SELECT t.id, t.strategy_id, t.entry_ts, t.exit_ts, t.pnl_pct, s.params->>'side' AS side
  FROM trades t
  JOIN strategies s ON s.id = t.strategy_id
  WHERE t.status = 'closed' AND t.pnl_pct IS NOT NULL
    AND t.entry_ts IS NOT NULL AND t.exit_ts IS NOT NULL
),
legs AS (
  SELECT c.id AS trade_id,
         (SELECT m.price FROM market_snapshots m
           WHERE m.symbol = u.symbol AND m.price > 0
             AND m.ts <= c.entry_ts AND m.ts > c.entry_ts - interval '24 hours'
           ORDER BY m.ts DESC LIMIT 1) AS entry_price,
         (SELECT m.price FROM market_snapshots m
           WHERE m.symbol = u.symbol AND m.price > 0
             AND m.ts <= c.exit_ts AND m.ts > c.exit_ts - interval '24 hours'
           ORDER BY m.ts DESC LIMIT 1) AS exit_price
  FROM closed c CROSS JOIN tickers u
),
basket AS (
  SELECT trade_id,
         (count(*) FILTER (WHERE entry_price IS NOT NULL AND exit_price IS NOT NULL))::int AS members,
         avg((exit_price - entry_price) / entry_price * 100) AS pnl_pct
  FROM legs
  GROUP BY trade_id
)
SELECT c.id AS trade_id,
       c.strategy_id,
       b.members AS basket_members,
       b.pnl_pct AS basket_pnl_pct,
       c.pnl_pct - CASE WHEN c.side = 'short' THEN -b.pnl_pct ELSE b.pnl_pct END AS excess_pnl_pct
FROM closed c
JOIN basket b ON b.trade_id = c.id;

COMMENT ON VIEW trade_excess IS 'Per closed trade: what an equal-weight basket of the whole watchlist did over that trade''s own hold window, and how much the trade beat or missed it by. A view rather than columns on trades because it is wholly derived from rows already stored — that makes it correct for the 23 trades that closed before it existed, with no backfill, and it cannot drift from the prices it is computed against. Two limits are deliberate and neither is free. It costs one index lookup per watchlist member per leg per trade, recomputed on every read: at 25 trades and 20 tickers that is 1,000 lookups, small enough that the dashboard recomputes it on a 30-second poll, and it grows linearly with the trade count, so it is the first thing to materialise if that stops being true. And it benchmarks every trade against the watchlist as it stands today, which is right only while WATCHLIST is a fixed constant — the day a symbol is added or dropped, historical baskets become anachronistic and this needs a membership history rather than a CROSS JOIN.';
COMMENT ON COLUMN trade_excess.basket_members IS 'Watchlist symbols that had a price within 24 hours before each side of the window and therefore contributed. Travels with the number so a basket measured over 19 of 20 names cannot be read as one measured over all 20. A symbol whose feed has stopped drops out here rather than contributing a silent 0.00%.';
COMMENT ON COLUMN trade_excess.basket_pnl_pct IS 'Equal-weight mean of each contributing member''s return from the last snapshot at or before entry_ts to the last at or before exit_ts, each no more than 24 hours stale. Always the long-side basket return, whatever the trade''s side.';
COMMENT ON COLUMN trade_excess.excess_pnl_pct IS 'The trade''s return minus the return of the comparable basket exposure: the long basket for a long, its negative for a short, since the benchmark for a short is shorting the same basket rather than holding it. This is the primary metric — absolute pnl_pct is context, because a book that loses less than the tape it is drawn from has an edge and one that loses more does not.';

-- Two comments written in 008 became false on 2026-09-17 and are corrected rather than left to
-- mislead whoever reads the schema next.
COMMENT ON TABLE shadow_trades IS 'Counterfactual book: entries a strategy signalled, refused by a budget-class guard (PDT budget or max-concurrent). Never reaches a broker, never counts toward the PDT counter, the reservation or max-concurrent. Deliberately a separate table rather than a trades.status value: trades is read at 26 sites including statsRollup, the evolution holdout replay and the PDT counters, and isolation must be structural rather than dependent on 26 predicates staying right forever. Until 2026-09-17 an entry also had to clear a 0.4 conviction gate to be recorded here; that gate was dropped as uninformative and a conviction is now scored and logged on every entry without gating it, so rows written after that date are not filtered on conviction and rows written before it are.';
COMMENT ON COLUMN shadow_trades.slippage_pct_per_side IS 'Per-side slippage assumption this row was priced under, on BOTH legs — shadowTracker reads it back rather than using the current constant, so a position open across a change to that constant stays internally consistent and can be restated exactly. Stored per row because the constant moves: 0.05 from 2026-08-12 on an evidence base of three real fills, raised to 0.15 on 2026-09-17 against the median of 24 entry and 20 exit fills measured versus the nearest 5-minute snapshot. /api/shadow reports expectancy as priced and restated at the current constant so the two eras are comparable.';
