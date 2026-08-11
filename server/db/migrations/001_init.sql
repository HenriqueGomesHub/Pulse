CREATE TYPE strategy_status AS ENUM ('active', 'retired', 'candidate');
CREATE TYPE signal_direction AS ENUM ('entry', 'exit');
CREATE TYPE trade_status AS ENUM ('open', 'closed', 'expired');
CREATE TYPE stats_window AS ENUM ('7d', '30d', 'all');
CREATE TYPE evolution_action AS ENUM ('retire', 'mutate', 'promote');

CREATE TABLE tickers (
  symbol             TEXT PRIMARY KEY,
  name               TEXT,
  float_shares       BIGINT,
  short_interest_pct NUMERIC,
  avg_volume_30d     BIGINT,
  exchange           TEXT,
  last_meta_refresh  TIMESTAMPTZ
);

CREATE TABLE social_snapshots (
  id                BIGSERIAL PRIMARY KEY,
  symbol            TEXT NOT NULL REFERENCES tickers(symbol),
  source            TEXT NOT NULL,
  ts                TIMESTAMPTZ NOT NULL,
  mentions_1h       INTEGER,
  unique_authors_1h INTEGER,
  upvote_velocity   NUMERIC,
  bull_ratio        NUMERIC,
  top_post_score    INTEGER,
  raw               JSONB
);

CREATE INDEX social_snapshots_symbol_ts_idx ON social_snapshots (symbol, ts DESC);

CREATE TABLE market_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  symbol        TEXT NOT NULL REFERENCES tickers(symbol),
  ts            TIMESTAMPTZ NOT NULL,
  price         NUMERIC,
  volume_1h     BIGINT,
  rel_volume    NUMERIC,
  pct_change_1h NUMERIC,
  pct_change_1d NUMERIC
);

CREATE INDEX market_snapshots_symbol_ts_idx ON market_snapshots (symbol, ts DESC);

CREATE TABLE features (
  id                BIGSERIAL PRIMARY KEY,
  symbol            TEXT NOT NULL REFERENCES tickers(symbol),
  ts                TIMESTAMPTZ NOT NULL,
  social_velocity   NUMERIC,
  social_accel      NUMERIC,
  author_quality    NUMERIC,
  mention_zscore    NUMERIC,
  rel_volume_zscore NUMERIC,
  price_momentum    NUMERIC,
  exhaustion_score  NUMERIC
);

CREATE INDEX features_symbol_ts_idx ON features (symbol, ts DESC);

CREATE TABLE strategies (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  generation INTEGER NOT NULL,
  params     JSONB NOT NULL,
  status     strategy_status NOT NULL,
  parent_id  BIGINT REFERENCES strategies(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE signals (
  id               BIGSERIAL PRIMARY KEY,
  strategy_id      BIGINT NOT NULL REFERENCES strategies(id),
  symbol           TEXT NOT NULL REFERENCES tickers(symbol),
  ts               TIMESTAMPTZ NOT NULL,
  direction        signal_direction NOT NULL,
  conviction       NUMERIC,
  reasoning        TEXT,
  feature_snapshot JSONB
);

CREATE TABLE trades (
  id               BIGSERIAL PRIMARY KEY,
  strategy_id      BIGINT NOT NULL REFERENCES strategies(id),
  symbol           TEXT NOT NULL REFERENCES tickers(symbol),
  entry_signal_id  BIGINT NOT NULL REFERENCES signals(id),
  exit_signal_id   BIGINT REFERENCES signals(id),
  alpaca_order_id  TEXT,
  qty              NUMERIC,
  entry_price      NUMERIC,
  exit_price       NUMERIC,
  entry_ts         TIMESTAMPTZ,
  exit_ts          TIMESTAMPTZ,
  pnl_pct          NUMERIC,
  max_drawdown_pct NUMERIC,
  hold_hours       NUMERIC,
  status           trade_status NOT NULL
);

CREATE TABLE strategy_stats (
  strategy_id  BIGINT NOT NULL REFERENCES strategies(id),
  "window"     stats_window NOT NULL,
  trades_n     INTEGER,
  win_rate     NUMERIC,
  avg_win_pct  NUMERIC,
  avg_loss_pct NUMERIC,
  expectancy   NUMERIC,
  max_drawdown NUMERIC,
  sharpe_naive NUMERIC,
  updated_at   TIMESTAMPTZ,
  PRIMARY KEY (strategy_id, "window")
);

CREATE TABLE evolution_log (
  id                   BIGSERIAL PRIMARY KEY,
  ts                   TIMESTAMPTZ NOT NULL,
  action               evolution_action NOT NULL,
  strategy_id          BIGINT REFERENCES strategies(id),
  parent_id            BIGINT REFERENCES strategies(id),
  rationale            TEXT,
  holdout_expectancy   NUMERIC
);
