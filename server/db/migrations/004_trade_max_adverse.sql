ALTER TABLE trades RENAME COLUMN max_drawdown_pct TO trade_max_adverse_pct;
ALTER TABLE trades ADD COLUMN peak_price NUMERIC;

COMMENT ON COLUMN trades.trade_max_adverse_pct IS 'Maximum adverse excursion of this trade alone: worst decline from its own high-water mark (peak_price), as a positive percentage. NOT strategy drawdown, which is peak-to-trough on the strategy equity curve.';
COMMENT ON COLUMN trades.peak_price IS 'High-water mark reached while the trade was live: highest price for a long, lowest price for a short. Seeded from entry_price.';
