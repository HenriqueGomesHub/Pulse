CREATE TABLE attention_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  symbol      TEXT NOT NULL REFERENCES tickers(symbol),
  instrument  TEXT NOT NULL,
  period_date DATE NOT NULL,
  granularity TEXT NOT NULL,
  value       NUMERIC NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL,
  raw         JSONB,
  UNIQUE (symbol, instrument, period_date)
);

CREATE INDEX attention_snapshots_instrument_symbol_date_idx
  ON attention_snapshots (instrument, symbol, period_date DESC);

ALTER TABLE features ADD COLUMN wiki_views NUMERIC;
ALTER TABLE features ADD COLUMN wiki_views_date DATE;
ALTER TABLE features ADD COLUMN wiki_views_zscore NUMERIC;
ALTER TABLE features ADD COLUMN attention_breadth INTEGER;
ALTER TABLE features ADD COLUMN attention_breadth_of INTEGER;
