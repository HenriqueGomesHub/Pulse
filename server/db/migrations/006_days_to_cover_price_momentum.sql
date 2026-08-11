ALTER TABLE tickers ADD COLUMN shares_short BIGINT;
ALTER TABLE tickers ADD COLUMN short_interest_settlement_date DATE;
ALTER TABLE tickers ADD COLUMN days_to_cover NUMERIC;

ALTER TABLE market_snapshots ADD COLUMN pct_change_2d NUMERIC;

ALTER TABLE features ADD COLUMN days_to_cover NUMERIC;
ALTER TABLE features ADD COLUMN price_momentum_1d NUMERIC;
ALTER TABLE features ADD COLUMN price_momentum_2d NUMERIC;
