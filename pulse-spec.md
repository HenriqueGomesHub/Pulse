# PULSE — Social-Momentum Paper-Trading Agent

Small-cap US stock agent: ingests social attention (Reddit, Stocktwits) + market data (Alpaca),
generates entry/exit signals from competing strategies, paper-trades every signal via Alpaca,
tracks per-strategy PnL, and evolves its strategy set weekly.

**Stack:** React + Vite (Vercel) · Express + node-cron (Railway) · Postgres (Railway) · Alpaca Paper API · Claude API (analysis + evolution).

**Prime directive for the agent's objective function:** optimize *expectancy* — `(win% × avgWin) − (loss% × avgLoss)` — and max drawdown. Never optimize win rate.

---

## 1. External APIs & env

| Service | Use | Env vars |
|---|---|---|
| Alpaca Paper | orders, positions, fills, market data (bars/quotes) | `ALPACA_KEY_ID`, `ALPACA_SECRET`, `ALPACA_BASE_URL=https://paper-api.alpaca.markets` |
| Reddit (OAuth, script app) | r/wallstreetbets, r/pennystocks, r/Shortsqueeze — new posts + comments | `REDDIT_CLIENT_ID`, `REDDIT_SECRET`, `REDDIT_USER`, `REDDIT_PASS` |
| Stocktwits public API | per-ticker message volume + bull/bear sentiment | none (public, rate-limited — respect 200 req/hr) |
| Anthropic | signal reasoning, weekly evolution | `ANTHROPIC_API_KEY` |

All secrets in Railway env. Never in source.

## 2. Postgres schema

```sql
tickers        (symbol PK, name, float_shares, short_interest_pct, avg_volume_30d, exchange, last_meta_refresh)
social_snapshots (id, symbol FK, source, ts, mentions_1h, unique_authors_1h, upvote_velocity,
                  bull_ratio, top_post_score, raw JSONB)          -- one row per ticker per source per cron tick
market_snapshots (id, symbol FK, ts, price, volume_1h, rel_volume, pct_change_1h, pct_change_1d)
features       (id, symbol FK, ts, social_velocity, social_accel, author_quality, mention_zscore,
                rel_volume_zscore, price_momentum, exhaustion_score)  -- computed, one row per tick per active ticker
strategies     (id, name, generation INT, params JSONB, status ENUM(active|retired|candidate),
                parent_id FK nullable, created_at)
signals        (id, strategy_id FK, symbol FK, ts, direction ENUM(entry|exit), conviction NUMERIC,
                reasoning TEXT, feature_snapshot JSONB)
trades         (id, strategy_id FK, symbol FK, entry_signal_id FK, exit_signal_id FK nullable,
                alpaca_order_id, exit_order_id, exit_attempt, qty, entry_price, exit_price,
                peak_price, entry_ts, exit_ts,
                pnl_pct, trade_max_adverse_pct, hold_hours, status ENUM(open|closed|expired))
strategy_stats (strategy_id FK, window ENUM(7d|30d|all), trades_n, win_rate, avg_win_pct, avg_loss_pct,
                expectancy, max_drawdown, sharpe_naive, updated_at, PK(strategy_id, window))
evolution_log  (id, ts, action ENUM(retire|mutate|promote), strategy_id, parent_id, rationale TEXT,
                holdout_expectancy NUMERIC)
```

**Two different drawdowns — do not conflate them** *(owner decision, 2026-08-11)*.

- `strategy_stats.max_drawdown` — **peak-to-trough decline of that strategy's cumulative PnL curve** over the stat window. This is the drawdown in the prime directive, and the one §6's evolution loop uses for retirement decisions. Computed by `statsRollup`.
- `trades.trade_max_adverse_pct` — **maximum adverse excursion of a single trade from its own high-water mark**, stored as a positive magnitude. For a long the high-water mark is the highest price reached since entry; for a short it is the lowest. A trade that runs 10.00 → 15.00 → 12.00 records 20%, not 0. `trades.peak_price` persists that high-water mark across ticks.

The per-trade column was originally named `max_drawdown_pct` and measured from entry rather than from peak, which made both its name and its value wrong. Renamed and corrected in migration `004`; `max(trade_max_adverse_pct)` is the worst single trade and is **not** a substitute for strategy drawdown.

`trades.exit_order_id` and `trades.exit_attempt` (migration `002`) exist so an exit is reconcilable: the order id is recorded before submission and the attempt counter gives each retry a fresh deterministic `client_order_id`.

## 3. Backend structure (Express, Railway)

```
/server
  index.js                 -- express app, routes mount, cron registration
  /workers
    redditIngest.js        -- every 5 min, market hours ±2h
    stocktwitsIngest.js    -- every 5 min
    marketIngest.js        -- every 5 min, Alpaca bars for watchlist
    tickerMetaRefresh.js   -- daily: float, short interest, avg volume
    featureEngine.js       -- every 5 min after ingests: compute features rows
    strategyRunner.js      -- every 5 min after features: evaluate all active strategies → signals → orders
    positionTracker.js     -- every 5 min: sync open trades w/ Alpaca, update drawdown, fire exits
    statsRollup.js         -- hourly: recompute strategy_stats
    evolution.js           -- weekly (Sunday): retire/mutate/promote cycle
  /services
    alpaca.js              -- thin client: submitOrder, getPositions, getBars (broker-swappable interface)
    reddit.js, stocktwits.js
    claude.js              -- callClaude(prompt, schema) with JSON parsing + retry
    tickerExtractor.js     -- $TICKER + cashtag + uppercase-word extraction, blocklist (DD, CEO, YOLO, etc.)
  /strategies
    engine.js              -- evaluate(strategyParams, features) → signal | null  (pure function, unit-tested)
    seeds.js               -- the 4 generation-0 strategy param sets
  /routes
    dashboard.js           -- GET /api/watchlist, /api/trades, /api/strategies, /api/signals, /api/pnl
  /db
    pool.js, migrations/
```

### Cron sequencing (single Railway service, node-cron)
`:00 :05 :10...` → ingests run in parallel → featureEngine → strategyRunner → positionTracker. Chain with a simple async pipeline per tick, not independent crons racing each other.

### PDT + risk rules (hard-coded guards in strategyRunner)
- Max 3 day-trades per rolling 5 sessions (respect PDT from day one so results transfer to live)
- Max 5 concurrent open trades per strategy; position size = fixed $1,000 notional per trade (paper acct starts at $100k — do NOT size up; small size keeps stats comparable)
- No entries in first 15 min after open or last 15 min before close
- Only tickers with price $1–$50, avg_volume_30d > 500k, exchange in (NYSE, NASDAQ, AMEX) — no OTC

## 4. Features (computed per ticker per tick)

- `social_velocity` — mentions/hr now vs trailing 24h baseline (z-score)
- `social_accel` — first derivative of velocity (is attention still growing?)
- `unique_authors_1h` + `author_quality` — account age & karma weighted; crude astroturf filter
- `mention_zscore` — vs that ticker's own 7-day history
- `rel_volume_zscore` — market volume vs its 30d baseline
- `price_momentum` — 1h and 1d pct change
- `exhaustion_score` — the sell-signal core: high when social_accel < 0 while price still up, bull_ratio declining, rel_volume fading. This is the "it went up, now signal it's going down" mechanism.

**Insufficient data → NULL** *(owner decision, 2026-08-11)*. Any feature computed from fewer observations than its window requires is written as NULL — never 0, never a partial value. Absent social history is the same case, not a special one: with no `social_snapshots` rows for a ticker, `social_velocity`, `social_accel`, `mention_zscore` and `author_quality` are all NULL. Strategies must treat NULL as "condition not met" rather than as a numeric comparison.

**Floored z-score denominator for `mention_zscore`** *(owner decision, 2026-08-11)*. Mention baselines are zero-inflated: a row is written for every watchlist ticker every tick, so an unmentioned ticker contributes `mentions_1h = 0`. Over 7 days that is ~2016 near-zero observations with mean ≈ 0.0005 and stddev ≈ 0.022, and a *single* mention scores z ≈ 45 — `mention_zscore > 3` degenerates to "mentioned at least once".

Zero rows stay in the baseline — silence is real data. Instead the denominator is floored:

```
mention_zscore = (x − mean) / max(std, 1.0)
```

This restores the meaning of "3-sigma spike": clearing `> 3` now requires genuine mention volume rather than one post.

Applied to `mention_zscore` only. `rel_volume_zscore` was measured against live data and is **not** degenerate — n = 310 over 30 days, mean 0.3308, stddev 0.3068, range 0.0054–1.9732, zero zero-valued rows. A floor of 1.0 there would crush every z-score toward zero and permanently disable `rel_volume_zscore > 2`, so it is deliberately left unfloored.

Z-scores alone remain scale-blind, so strategies gating on attention must also carry absolute-substance conditions — see §5.

## 5. Generation-0 strategies (seeds.js)

Each strategy = JSONB params interpreted by the same pure `engine.js` — evolution mutates params, never code.

1. **social-breakout** — entry: mention_zscore > 3 AND social_accel > 0 AND rel_volume_zscore > 2 AND mentions_1h ≥ 5 AND unique_authors_1h ≥ 3; exit: exhaustion_score > threshold OR stop −8% OR target +15% OR max hold 3 days

   *The two absolute-substance conditions are an owner decision of 2026-08-11.* A z-score is scale-blind — it says a ticker is unusually talked-about relative to its own history, not that anyone is actually talking about it. Paired with the floored denominator in §4, they stop a single post from triggering an entry.
2. **squeeze-setup** — entry: short_interest_pct > 15 AND mention_zscore > 2 AND price_momentum_1d > 3%; exit: exhaustion OR stop −10% OR target +25% OR 5 days

   *Short-interest source (owner decision, 2026-08-11).* Alpaca does not expose short interest, so `tickers.short_interest_pct` is NULL and this strategy cannot fire. It comes from FINRA's free API (bi-monthly publication — adequate for a slow-moving level gate), via `FINRA_API_CLIENT` / `FINRA_API_SECRET`. When those exist in env, `tickerMetaRefresh` fetches `short_interest_pct` on its daily run using plain HTTPS `fetch` and no new dependency; if FINRA genuinely requires an SDK, halt rather than adding one. When the credentials are absent, seed #2 is inserted with `status = 'candidate'` rather than `'active'`, and a warning is logged at boot for as long as it stays NULL-blocked. **A strategy must never sit `active` while structurally unable to fire** — that would silently distort the active-strategy count and the evolution cap in §6.
3. **quiet-accumulation** — entry: rel_volume_zscore > 2 AND price_momentum_1h > 1% AND mention_zscore < 1 (volume before crowd), exit on social spike arrival (sell into attention) OR stop −6%
4. **fade-the-peak** — entry (short via Alpaca paper): exhaustion_score > high threshold AND price up > 30% in 2 days; exit: −10% from entry (profit) OR +8% (stop) OR 2 days

Every signal also gets a Claude call: given feature_snapshot, write 2–3 sentence reasoning + conviction 0–1. Conviction < 0.4 → log signal, skip trade (creates a counterfactual dataset for free).

## 6. Evolution loop (weekly)

1. Rank active strategies by 30d expectancy (min 10 closed trades to qualify; unqualified strategies get another week)
2. Retire the worst qualifier → status=retired
3. Claude call with the trade log of the best 2: propose 3 param mutations + 1 novel param combo. Constraint: params must stay within engine.js's supported condition vocabulary.
4. **Holdout validation:** replay each candidate against the last 30 days of stored features (backtest against features table — this is why we persist every feature row). Promote only candidates whose holdout expectancy beats the retired strategy. Log everything to evolution_log.
5. Cap: max 6 active strategies. Recency-weight stats (7d counts 2× vs 30d) because small-cap metas rotate.

## 7. Frontend (React + Vite, Vercel)

Pages (react-router):
- **Watchlist** — live table: ticker, price, mention_zscore sparkline, social_velocity, exhaustion_score, active signals. Ranked by max strategy conviction.
- **Positions** — open paper trades: entry, current PnL%, max drawdown so far, which strategy, live exit conditions status
- **Strategies** — card per strategy: generation, params (readable), equity curve (recharts), expectancy/win-rate/drawdown, lineage tree link to parent
- **Trade log** — closed trades, filterable by strategy/outcome, each row expandable to show the Claude reasoning at entry and exit
- **Evolution** — timeline of retire/mutate/promote events with rationale

Polling: `GET /api/*` every 30s (no websockets in v1 — YAGNI).
Design: Quiet Precision v2.1 system doc applies.

## 8. Build order (one Claude Code session per phase, /clear between)

1. **Phase 1 — skeleton + data in:** repo, migrations, alpaca.js + marketIngest, reddit/stocktwits ingest, tickerExtractor. Verify: rows landing in social_snapshots + market_snapshots for a hardcoded 20-ticker watchlist.
2. **Phase 2 — features + one dumb strategy:** featureEngine, engine.js, seed strategy #1 only, strategyRunner + positionTracker placing Alpaca paper orders. Verify: a full signal→order→tracked-trade→closed-trade lifecycle in the DB.

   *Temporary-threshold method (owner decision, 2026-08-11).* When the lifecycle cannot be triggered by real conditions — e.g. social data is unavailable, so strategy #1 never fires — temporarily lower strategy #1's entry thresholds so a signal fires on market data alone, run the full signal → order → tracked → forced-exit → closed lifecycle against Alpaca during market hours, then restore the real thresholds and record the restoration in `BUILD_LOG.md`. The restoration is part of the phase gate, not an afterthought.
3. **Phase 3 — dashboard:** all 5 pages against real DB data.
4. **Phase 4 — full strategy set + stats:** seeds 2–4, statsRollup, Claude reasoning per signal.
5. **Phase 5 — evolution:** weekly worker + holdout replay + evolution_log + Evolution page.
6. **Phase 6 — run it for 2–3 weeks.** No code. Watch, note bugs, judge if the data has signal before trusting the evolution loop.

Rules for every phase: minimal diff, no speculative abstractions, no new deps without approval, engine.js gets unit tests (it's the only pure-logic module that must be correct), everything else verified manually against the DB.
