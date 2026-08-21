ALTER TABLE trades ADD COLUMN last_price NUMERIC;
ALTER TABLE trades ADD COLUMN last_price_ts TIMESTAMPTZ;

ALTER TABLE shadow_trades ADD COLUMN last_price NUMERIC;
ALTER TABLE shadow_trades ADD COLUMN last_price_ts TIMESTAMPTZ;

COMMENT ON COLUMN trades.last_price IS 'The mark positionTracker last valued this trade at, written in the same UPDATE as pnl_pct so the price and the percentage can never come from different moments. NULL between the fill and the first tracker tick, and never NULL again after it. Stops advancing once an exit order is pending, since the tracker no longer marks a trade it is already closing — last_price_ts is what makes that visible rather than silent.';
COMMENT ON COLUMN trades.last_price_ts IS 'When last_price was taken. Written in the same statement as last_price and pnl_pct, never separately.';
COMMENT ON COLUMN shadow_trades.last_price IS 'The market_snapshots mark shadowTracker last valued this counterfactual at, written in the same UPDATE as pnl_pct. Not slippage-adjusted: slippage is applied only to the modelled exit price, so this is the raw mark standing behind pnl_pct and nothing else.';
COMMENT ON COLUMN shadow_trades.last_price_ts IS 'When last_price was taken. Written in the same statement as last_price and pnl_pct, never separately.';
