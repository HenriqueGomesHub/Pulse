CREATE TABLE shadow_trades (
  id                    BIGSERIAL PRIMARY KEY,
  strategy_id           BIGINT NOT NULL REFERENCES strategies(id),
  symbol                TEXT NOT NULL REFERENCES tickers(symbol),
  entry_signal_id       BIGINT NOT NULL REFERENCES signals(id),
  blocked_by            TEXT NOT NULL,
  qty                   NUMERIC,
  entry_price           NUMERIC,
  exit_price            NUMERIC,
  entry_ts              TIMESTAMPTZ NOT NULL,
  exit_ts               TIMESTAMPTZ,
  pnl_pct               NUMERIC,
  hold_hours            NUMERIC,
  exit_reason           TEXT,
  slippage_pct_per_side NUMERIC NOT NULL,
  status                trade_status NOT NULL
);

CREATE INDEX shadow_trades_open_idx ON shadow_trades (strategy_id, symbol) WHERE status = 'open';

ALTER TABLE claude_call_budget ADD COLUMN shadow_drops INTEGER NOT NULL DEFAULT 0;

COMMENT ON TABLE shadow_trades IS 'Counterfactual book: entries a strategy signalled and conviction passed, refused by a budget-class guard (PDT budget or max-concurrent). Never reaches a broker, never counts toward the PDT counter, the reservation or max-concurrent. Deliberately a separate table rather than a trades.status value: trades is read at 26 sites including statsRollup, the evolution holdout replay and the PDT counters, and isolation must be structural rather than dependent on 26 predicates staying right forever.';
COMMENT ON COLUMN shadow_trades.blocked_by IS 'Which budget-class guard refused the real entry: pdt_budget or max_concurrent.';
COMMENT ON COLUMN shadow_trades.entry_price IS 'Signal price from market_snapshots with slippage_pct_per_side applied adversely. No Alpaca call is made anywhere on the shadow path.';
COMMENT ON COLUMN shadow_trades.slippage_pct_per_side IS 'Per-side slippage assumption in force when this row was written, stored per row because the constant is provisional (0.05, evidence base three real fills at ~0.067% round trip, reviewed ~2026-08-26).';
COMMENT ON COLUMN claude_call_budget.shadow_drops IS 'Shadow entries dropped that session because the shared conviction cap was already spent. Shadow entries make the same real conviction call and are never recorded with conviction NULL, so cap pressure shows up here as a smaller sample rather than as a contaminated book.';
