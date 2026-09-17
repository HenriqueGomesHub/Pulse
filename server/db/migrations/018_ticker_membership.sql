-- The precondition for the primary metric surviving universe rotation, landed before any name
-- moves. trade_excess CROSS JOINed `tickers`, which benchmarks every historical trade against the
-- watchlist as it stands today; its own comment named this as the thing that breaks the day the
-- list changes. BITF's removal did not break it — BITF never had a price, so the 24-hour staleness
-- bound already excluded it and every basket already read 19 members. The next removal will not be
-- so harmless: a name with real price history leaving the list would silently vanish from the
-- baskets of trades that closed while it was a member, changing an excess figure already reported.

CREATE TABLE ticker_membership (
  id      BIGSERIAL PRIMARY KEY,
  symbol  TEXT NOT NULL REFERENCES tickers(symbol),
  from_ts TIMESTAMPTZ NOT NULL,
  to_ts   TIMESTAMPTZ,
  reason  TEXT NOT NULL,
  CONSTRAINT ticker_membership_interval_ck CHECK (to_ts IS NULL OR to_ts > from_ts)
);

-- At most one open interval per symbol: a name cannot be admitted twice without leaving first,
-- enforced by the database rather than by whatever writes the rotation.
CREATE UNIQUE INDEX ticker_membership_open_idx ON ticker_membership (symbol) WHERE to_ts IS NULL;
CREATE INDEX ticker_membership_symbol_from_idx ON ticker_membership (symbol, from_ts);

COMMENT ON TABLE ticker_membership IS 'When each symbol was part of the tradable universe. Intervals are half-open [from_ts, to_ts), to_ts NULL meaning still a member. Exists so that a basket can be reconstructed as the universe stood at a given moment rather than as it stands now — without it, excess return silently changes for already-closed trades every time the watchlist is edited, and excess is the primary metric.';
COMMENT ON COLUMN ticker_membership.from_ts IS 'When the symbol became a universe member. Seeded from the first feature row Pulse ever wrote for it, which is the first moment it could have been evaluated at all.';
COMMENT ON COLUMN ticker_membership.to_ts IS 'When it stopped being one, or NULL while it still is. A rotated-out name keeps its closed interval forever: that is what makes an old basket reconstructible.';
COMMENT ON COLUMN ticker_membership.reason IS 'Why the interval opened or closed, recorded at the time. Never composed after the fact.';

-- Seed the 19 current members from the first feature row each one carries, rather than from a
-- single hard-coded date: the symbols were inserted together but began producing features at
-- slightly different moments, and the first evaluable moment is the honest start.
INSERT INTO ticker_membership (symbol, from_ts, to_ts, reason)
SELECT f.symbol, min(f.ts), NULL,
       'Founding member of the day-one watchlist, backfilled 2026-09-18 when membership began being recorded. from_ts is the first feature row Pulse wrote for this symbol.'
FROM features f
WHERE f.symbol <> 'BITF'
GROUP BY f.symbol;

-- BITF is the first closed interval, and the reason it exists. to_ts is the moment the deploy
-- carrying its removal from WATCHLIST first ran a tick (confirmed by the system_warnings row it
-- wrote at that instant), not the moment the decision was made.
INSERT INTO ticker_membership (symbol, from_ts, to_ts, reason)
SELECT 'BITF', min(ts), TIMESTAMPTZ '2026-09-17 22:05:00+00',
       'Removed by owner decision: delisted since week one, 0 market_snapshots rows in 37 days while still accumulating 2,289 social and 10,647 feature rows. Its tickers row and history are kept; only its universe membership ended.'
FROM features WHERE symbol = 'BITF';

-- The basket is now the universe as it stood when the trade was ENTERED, not as it stands now and
-- not as it stood at exit. The benchmark answers "instead of this trade, what could I have held
-- across this window?", and the opportunity set is fixed at the moment of the decision. A name that
-- left mid-trade stays in that trade's basket because it was available when the trade was opened.
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
           WHERE m.symbol = mem.symbol AND m.price > 0
             AND m.ts <= c.entry_ts AND m.ts > c.entry_ts - interval '24 hours'
           ORDER BY m.ts DESC LIMIT 1) AS entry_price,
         (SELECT m.price FROM market_snapshots m
           WHERE m.symbol = mem.symbol AND m.price > 0
             AND m.ts <= c.exit_ts AND m.ts > c.exit_ts - interval '24 hours'
           ORDER BY m.ts DESC LIMIT 1) AS exit_price
  FROM closed c
  JOIN ticker_membership mem
    ON mem.from_ts <= c.entry_ts
   AND (mem.to_ts IS NULL OR mem.to_ts > c.entry_ts)
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

COMMENT ON VIEW trade_excess IS 'Per closed trade: what an equal-weight basket of the universe did over that trade''s own hold window, and how much the trade beat or missed it by. The universe is resolved through ticker_membership as it stood at entry_ts, so editing the watchlist can no longer change the excess of a trade that has already closed. A view rather than columns on trades because it is wholly derived from rows already stored — correct for every trade that closed before it existed, with no backfill, and unable to drift from the prices it is computed against. It costs one index lookup per member per leg per trade, recomputed on every read: at 25 trades and 19 members that is 950 lookups, small enough for a 30-second dashboard poll, growing linearly with the trade count, and the first thing to materialise if that stops being true.';
COMMENT ON COLUMN trade_excess.basket_members IS 'Universe members at entry that had a price within 24 hours before each side of the window and therefore contributed. Travels with the number so a basket measured over 19 of 20 cannot be read as one measured over all 20. A symbol whose feed has stopped drops out rather than contributing a silent 0.00%.';
