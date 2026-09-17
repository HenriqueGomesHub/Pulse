CREATE VIEW trade_excess AS
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
           WHERE m.symbol = u.symbol AND m.ts <= c.entry_ts AND m.price > 0
           ORDER BY m.ts DESC LIMIT 1) AS entry_price,
         (SELECT m.price FROM market_snapshots m
           WHERE m.symbol = u.symbol AND m.ts <= c.exit_ts AND m.price > 0
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

COMMENT ON VIEW trade_excess IS 'Per closed trade: what an equal-weight basket of the whole watchlist did over that trade''s own hold window, and how much the trade beat or missed it by. A view rather than columns on trades because it is wholly derived from rows already stored — that makes it correct for the 23 trades that closed before it existed, with no backfill, and it cannot drift from the prices it is computed against. The cost is a per-trade scan of one index lookup per watchlist member per leg, which is why it is read by the hourly rollup and the dashboard rather than inside the 5-minute tick.';
COMMENT ON COLUMN trade_excess.basket_members IS 'Watchlist symbols that had a price on both sides of the window and therefore contributed to the basket. Travels with the number so a basket measured over 19 of 20 names cannot be read as one measured over all 20.';
COMMENT ON COLUMN trade_excess.basket_pnl_pct IS 'Equal-weight mean of each member''s return from the last snapshot at or before entry_ts to the last at or before exit_ts. Always the long-side basket return, whatever the trade''s side.';
COMMENT ON COLUMN trade_excess.excess_pnl_pct IS 'The trade''s return minus the return of the comparable basket exposure: the long basket for a long, its negative for a short, since the benchmark for a short is shorting the same basket rather than holding it. This is the primary metric — absolute pnl_pct is context, because a book that loses less than the tape it is drawn from has an edge and one that loses more does not.';

ALTER TABLE strategy_stats ADD COLUMN excess_expectancy NUMERIC;
ALTER TABLE strategy_stats ADD COLUMN excess_trades_n INTEGER;

COMMENT ON COLUMN strategy_stats.excess_expectancy IS 'Mean excess-over-basket return per closed trade in the window. The primary measure of whether entries select anything: expectancy can be negative purely because the universe fell, and this cannot.';
COMMENT ON COLUMN strategy_stats.excess_trades_n IS 'Closed trades the excess was measured over. Never assume it equals trades_n: a trade whose window has no basket price on one side is absent from trade_excess and counted here but not there.';
