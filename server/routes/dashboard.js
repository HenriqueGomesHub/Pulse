import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { SHADOW_SLIPPAGE_PCT_PER_SIDE, WATCHLIST, WIKI_ARTICLES } from '../config.js';
import { pool } from '../db/pool.js';
import { describeBlock } from '../strategies/engine.js';

const SPARKLINE_HOURS = 24;
const ACTIVE_SIGNAL_HOURS = 24;
const SIGNAL_FEED_LIMIT = 200;
const SHADOW_CLOSED_LIMIT = 25;
const TICKER_SERIES_HOURS = 168;
const TICKER_WIKI_SERIES_DAYS = 30;
const NEAR_SIGNAL_LIMIT = 12;
const SUMMARY_SIGNAL_LIMIT = 20;

const isoUtc = (column) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const WATCHLIST_SQL = `
  WITH universe AS (
    SELECT symbol, name FROM tickers WHERE symbol = ANY($3::text[])
  ),
  bounds AS (
    SELECT (date_trunc('hour', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS last_hour,
           ((date_trunc('hour', now() AT TIME ZONE 'UTC') - make_interval(hours => $1::int - 1)) AT TIME ZONE 'UTC')
             AS first_hour
  ),
  hour_slot AS (
    SELECT generate_series(b.first_hour, b.last_hour, interval '1 hour') AS ts
    FROM bounds b
  ),
  hourly AS (
    SELECT t.symbol, f.ts, avg(f.mention_zscore)::float8 AS mention_zscore
    FROM universe t
    CROSS JOIN LATERAL (
      SELECT (date_trunc('hour', fx.ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS ts, fx.mention_zscore
      FROM features fx
      WHERE fx.symbol = t.symbol AND fx.ts >= (SELECT first_hour FROM bounds)
    ) f
    GROUP BY t.symbol, f.ts
  ),
  sparkline AS (
    SELECT t.symbol,
           json_agg(json_build_object('ts', ${isoUtc('s.ts')}, 'mention_zscore', h.mention_zscore)
                    ORDER BY s.ts) AS points
    FROM universe t
    CROSS JOIN hour_slot s
    LEFT JOIN hourly h ON h.symbol = t.symbol AND h.ts = s.ts
    GROUP BY t.symbol
  ),
  latest AS (
    SELECT t.symbol, f.ts, f.mention_zscore, f.social_velocity, f.exhaustion_score,
           f.attention_breadth, f.attention_breadth_of
    FROM universe t
    CROSS JOIN LATERAL (
      SELECT ts, mention_zscore, social_velocity, exhaustion_score,
             attention_breadth, attention_breadth_of
      FROM features fx
      WHERE fx.symbol = t.symbol
      ORDER BY fx.ts DESC
      LIMIT 1
    ) f
  ),
  price AS (
    SELECT DISTINCT ON (symbol) symbol, price
    FROM market_snapshots
    WHERE ts > now() - interval '1 day'
    ORDER BY symbol, ts DESC
  ),
  active AS (
    SELECT s.symbol,
           max(s.conviction)::float8 AS max_conviction,
           json_agg(json_build_object(
             'id', s.id::int,
             'strategy_id', s.strategy_id::int,
             'strategy_name', st.name,
             'direction', s.direction,
             'conviction', s.conviction::float8,
             'ts', ${isoUtc('s.ts')}
           ) ORDER BY s.ts DESC) AS signals
    FROM signals s
    JOIN strategies st ON st.id = s.strategy_id
    WHERE s.ts > now() - make_interval(hours => $2::int)
    GROUP BY s.symbol
  )
  SELECT t.symbol,
         t.name,
         p.price::float8 AS price,
         f.ts AS features_ts,
         f.mention_zscore::float8 AS mention_zscore,
         f.social_velocity::float8 AS social_velocity,
         f.exhaustion_score::float8 AS exhaustion_score,
         f.attention_breadth::int AS attention_breadth,
         f.attention_breadth_of::int AS attention_breadth_of,
         COALESCE(sp.points, '[]'::json) AS mention_zscore_sparkline,
         a.max_conviction,
         COALESCE(a.signals, '[]'::json) AS active_signals
  FROM universe t
  LEFT JOIN price p ON p.symbol = t.symbol
  LEFT JOIN latest f ON f.symbol = t.symbol
  LEFT JOIN sparkline sp ON sp.symbol = t.symbol
  LEFT JOIN active a ON a.symbol = t.symbol
  ORDER BY a.max_conviction DESC NULLS LAST, f.mention_zscore DESC NULLS LAST, t.symbol
`;

const OPEN_TRADES_SQL = `
  SELECT t.id::int AS id,
         t.symbol,
         t.strategy_id::int AS strategy_id,
         st.name AS strategy_name,
         st.params AS params,
         t.qty::float8 AS qty,
         t.entry_price::float8 AS entry_price,
         t.entry_ts,
         t.pnl_pct::float8 AS pnl_pct,
         t.trade_max_adverse_pct::float8 AS trade_max_adverse_pct,
         t.hold_hours::float8 AS hold_hours,
         json_build_object(
           'social_velocity', f.social_velocity::float8,
           'social_accel', f.social_accel::float8,
           'author_quality', f.author_quality::float8,
           'mention_zscore', f.mention_zscore::float8,
           'mentions_1h', f.mentions_1h::float8,
           'unique_authors_1h', f.unique_authors_1h::float8,
           'rel_volume_zscore', f.rel_volume_zscore::float8,
           'rel_volume_zscore_v2', f.rel_volume_zscore_v2::float8,
           'price_momentum', f.price_momentum::float8,
           'exhaustion_score', f.exhaustion_score::float8
         ) AS features
  FROM trades t
  JOIN strategies st ON st.id = t.strategy_id
  LEFT JOIN LATERAL (
    SELECT * FROM features fx WHERE fx.symbol = t.symbol ORDER BY fx.ts DESC LIMIT 1
  ) f ON true
  WHERE t.status = 'open'
  ORDER BY t.entry_ts, t.id
`;

const CLOSED_TRADES_SQL = `
  SELECT t.id::int AS id,
         t.symbol,
         t.strategy_id::int AS strategy_id,
         st.name AS strategy_name,
         t.qty::float8 AS qty,
         t.entry_price::float8 AS entry_price,
         t.exit_price::float8 AS exit_price,
         t.entry_ts,
         t.exit_ts,
         t.pnl_pct::float8 AS pnl_pct,
         x.basket_pnl_pct::float8 AS basket_pnl_pct,
         x.excess_pnl_pct::float8 AS excess_pnl_pct,
         x.basket_members::int AS basket_members,
         t.trade_max_adverse_pct::float8 AS trade_max_adverse_pct,
         t.hold_hours::float8 AS hold_hours,
         CASE
           WHEN t.pnl_pct IS NULL THEN NULL
           WHEN t.pnl_pct > 0 THEN 'win'
           ELSE 'loss'
         END AS outcome,
         es.reasoning AS entry_reasoning,
         es.conviction::float8 AS entry_conviction,
         xs.reasoning AS exit_reasoning,
         xs.conviction::float8 AS exit_conviction
  FROM trades t
  JOIN strategies st ON st.id = t.strategy_id
  JOIN signals es ON es.id = t.entry_signal_id
  LEFT JOIN signals xs ON xs.id = t.exit_signal_id
  LEFT JOIN trade_excess x ON x.trade_id = t.id
  WHERE t.status = 'closed'
  ORDER BY t.exit_ts DESC NULLS LAST, t.id DESC
`;

const STRATEGIES_SQL = `
  WITH closed AS (
    SELECT t.id, t.strategy_id, t.pnl_pct, t.exit_ts, x.excess_pnl_pct
    FROM trades t
    LEFT JOIN trade_excess x ON x.trade_id = t.id
    WHERE t.status = 'closed' AND t.pnl_pct IS NOT NULL
  ),
  stats AS (
    SELECT strategy_id,
           count(*)::int AS trades_n,
           (count(*) FILTER (WHERE pnl_pct > 0))::float8 / count(*) AS win_rate,
           (avg(pnl_pct) FILTER (WHERE pnl_pct > 0))::float8 AS avg_win_pct,
           (avg(pnl_pct) FILTER (WHERE pnl_pct <= 0))::float8 AS avg_loss_pct,
           avg(pnl_pct)::float8 AS expectancy,
           avg(excess_pnl_pct)::float8 AS excess_expectancy,
           count(excess_pnl_pct)::int AS excess_trades_n,
           (count(*) FILTER (WHERE excess_pnl_pct > 0))::int AS beat_basket_n
    FROM closed
    GROUP BY strategy_id
  ),
  cumulative AS (
    SELECT strategy_id, id, exit_ts, pnl_pct,
           row_number() OVER (PARTITION BY strategy_id ORDER BY exit_ts, id) AS ord,
           sum(pnl_pct) OVER (PARTITION BY strategy_id ORDER BY exit_ts, id) AS cum_pnl_pct
    FROM closed
  ),
  drawdown AS (
    SELECT strategy_id, max(GREATEST(peak, 0) - cum_pnl_pct)::float8 AS max_drawdown
    FROM (
      SELECT strategy_id, cum_pnl_pct,
             max(cum_pnl_pct) OVER (PARTITION BY strategy_id ORDER BY ord) AS peak
      FROM cumulative
    ) d
    GROUP BY strategy_id
  ),
  curve AS (
    SELECT strategy_id,
           json_agg(json_build_object(
             'ts', ${isoUtc('exit_ts')},
             'trade_id', id::int,
             'pnl_pct', pnl_pct::float8,
             'cum_pnl_pct', cum_pnl_pct::float8
           ) ORDER BY ord) AS points
    FROM cumulative
    GROUP BY strategy_id
  )
  SELECT s.id::int AS id,
         s.name,
         s.generation,
         s.status,
         s.params,
         s.created_at,
         p.id::int AS parent_id,
         p.name AS parent_name,
         p.generation AS parent_generation,
         COALESCE(st.trades_n, 0) AS trades_n,
         st.win_rate,
         st.avg_win_pct,
         st.avg_loss_pct,
         st.expectancy,
         st.excess_expectancy,
         COALESCE(st.excess_trades_n, 0) AS excess_trades_n,
         COALESCE(st.beat_basket_n, 0) AS beat_basket_n,
         d.max_drawdown,
         COALESCE(c.points, '[]'::json) AS equity_curve
  FROM strategies s
  LEFT JOIN strategies p ON p.id = s.parent_id
  LEFT JOIN stats st ON st.strategy_id = s.id
  LEFT JOIN drawdown d ON d.strategy_id = s.id
  LEFT JOIN curve c ON c.strategy_id = s.id
  ORDER BY s.generation, s.id
`;

const SIGNALS_SQL = `
  WITH feed AS (
    SELECT id, ts, symbol, strategy_id, direction, conviction, reasoning, feature_snapshot
    FROM signals
    ORDER BY ts DESC, id DESC
    LIMIT $1::int
  )
  SELECT s.id::int AS id,
         s.ts,
         s.symbol,
         s.strategy_id::int AS strategy_id,
         st.name AS strategy_name,
         s.direction,
         s.conviction::float8 AS conviction,
         s.reasoning,
         s.feature_snapshot,
         t.trade_id
  FROM feed s
  JOIN strategies st ON st.id = s.strategy_id
  LEFT JOIN LATERAL (
    SELECT id::int AS trade_id
    FROM trades tr
    WHERE tr.entry_signal_id = s.id OR tr.exit_signal_id = s.id
    LIMIT 1
  ) t ON true
  ORDER BY s.ts DESC, s.id DESC
`;

const PNL_TOTALS_SQL = `
  WITH closed AS (
    SELECT t.id, t.exit_ts, t.pnl_pct, x.excess_pnl_pct
    FROM trades t
    LEFT JOIN trade_excess x ON x.trade_id = t.id
    WHERE t.status = 'closed' AND t.pnl_pct IS NOT NULL
  ),
  cumulative AS (
    SELECT row_number() OVER (ORDER BY exit_ts, id) AS ord,
           sum(pnl_pct) OVER (ORDER BY exit_ts, id) AS cum_pnl_pct
    FROM closed
  ),
  drawdown AS (
    SELECT max(GREATEST(peak, 0) - cum_pnl_pct)::float8 AS max_drawdown
    FROM (
      SELECT cum_pnl_pct, max(cum_pnl_pct) OVER (ORDER BY ord) AS peak
      FROM cumulative
    ) d
  )
  SELECT (SELECT count(*) FROM trades WHERE status = 'open')::int AS open_n,
         count(*)::int AS closed_n,
         (count(*) FILTER (WHERE pnl_pct > 0))::int AS wins,
         (count(*) FILTER (WHERE pnl_pct <= 0))::int AS losses,
         ((count(*) FILTER (WHERE pnl_pct > 0))::float8 / NULLIF(count(*), 0)) AS win_rate,
         (avg(pnl_pct) FILTER (WHERE pnl_pct > 0))::float8 AS avg_win_pct,
         (avg(pnl_pct) FILTER (WHERE pnl_pct <= 0))::float8 AS avg_loss_pct,
         avg(pnl_pct)::float8 AS expectancy,
         avg(excess_pnl_pct)::float8 AS excess_expectancy,
         count(excess_pnl_pct)::int AS excess_trades_n,
         (count(*) FILTER (WHERE excess_pnl_pct > 0))::int AS beat_basket_n,
         sum(pnl_pct)::float8 AS total_pnl_pct,
         (SELECT max_drawdown FROM drawdown) AS max_drawdown
  FROM closed
`;

const PNL_CURVE_SQL = `
  SELECT ${isoUtc('exit_ts')} AS ts,
         id::int AS trade_id,
         symbol,
         pnl_pct::float8 AS pnl_pct,
         (sum(pnl_pct) OVER (ORDER BY exit_ts, id))::float8 AS cum_pnl_pct
  FROM trades
  WHERE status = 'closed' AND pnl_pct IS NOT NULL
  ORDER BY exit_ts, id
`;

const SHADOW_OPEN_SQL = `
  SELECT t.id::int AS id,
         t.symbol,
         t.strategy_id::int AS strategy_id,
         st.name AS strategy_name,
         st.params AS params,
         t.blocked_by,
         t.qty::float8 AS qty,
         t.entry_price::float8 AS entry_price,
         t.entry_ts,
         t.pnl_pct::float8 AS pnl_pct,
         t.hold_hours::float8 AS hold_hours,
         json_build_object(
           'social_velocity', f.social_velocity::float8,
           'social_accel', f.social_accel::float8,
           'author_quality', f.author_quality::float8,
           'mention_zscore', f.mention_zscore::float8,
           'mentions_1h', f.mentions_1h::float8,
           'unique_authors_1h', f.unique_authors_1h::float8,
           'rel_volume_zscore', f.rel_volume_zscore::float8,
           'rel_volume_zscore_v2', f.rel_volume_zscore_v2::float8,
           'price_momentum', f.price_momentum::float8,
           'exhaustion_score', f.exhaustion_score::float8
         ) AS features
  FROM shadow_trades t
  JOIN strategies st ON st.id = t.strategy_id
  LEFT JOIN LATERAL (
    SELECT * FROM features fx WHERE fx.symbol = t.symbol ORDER BY fx.ts DESC LIMIT 1
  ) f ON true
  WHERE t.status = 'open'
  ORDER BY t.entry_ts, t.id
`;

const SHADOW_CLOSED_SQL = `
  SELECT t.id::int AS id,
         t.symbol,
         t.strategy_id::int AS strategy_id,
         st.name AS strategy_name,
         t.blocked_by,
         t.entry_price::float8 AS entry_price,
         t.exit_price::float8 AS exit_price,
         t.exit_ts,
         t.pnl_pct::float8 AS pnl_pct,
         t.hold_hours::float8 AS hold_hours,
         t.exit_reason
  FROM shadow_trades t
  JOIN strategies st ON st.id = t.strategy_id
  WHERE t.status = 'closed'
  ORDER BY t.exit_ts DESC NULLS LAST, t.id DESC
  LIMIT $1::int
`;

/* Every closed shadow row keeps the per-side slippage it was priced under, on both legs, so a book
   that spans a change to the constant is a book measured on two different rulers. `priced` does the
   conversion in one expression: it backs the stored constant out to recover the raw marks —
   entry_price = mark * (1 + d*s/100) and exit_price = mark * (1 - d*s/100), where d is +1 long and
   -1 short — and re-applies the constant in force now. shadow_expectancy is what the book recorded
   at the time; shadow_expectancy_restated is that same history under today's assumption, and the
   two are equal for any row already priced under it. They are measured over different samples when
   a row is missing a fill price, which is why restated carries its own n. */
const SHADOW_STATS_SQL = `
  WITH restated AS (
    SELECT t.strategy_id,
           t.pnl_pct,
           CASE WHEN s.params->>'side' = 'short' THEN -1 ELSE 1 END AS direction,
           t.entry_price, t.exit_price, t.slippage_pct_per_side
    FROM shadow_trades t
    JOIN strategies s ON s.id = t.strategy_id
    WHERE t.status = 'closed' AND t.pnl_pct IS NOT NULL AND t.exit_ts IS NOT NULL
  ),
  priced AS (
    SELECT strategy_id,
           pnl_pct,
           direction
             * (exit_price / (1 - direction * slippage_pct_per_side / 100) * (1 - direction * $1::numeric / 100)
                - entry_price / (1 + direction * slippage_pct_per_side / 100) * (1 + direction * $1::numeric / 100))
             / (entry_price / (1 + direction * slippage_pct_per_side / 100) * (1 + direction * $1::numeric / 100))
             * 100 AS restated_pnl_pct
    FROM restated
  ),
  agg AS (
    SELECT strategy_id,
           (count(pnl_pct))::int AS trades_n,
           (count(pnl_pct) FILTER (WHERE pnl_pct > 0))::int AS wins,
           avg(pnl_pct) FILTER (WHERE pnl_pct > 0) AS avg_win_pct,
           avg(pnl_pct) FILTER (WHERE pnl_pct <= 0) AS avg_loss_pct,
           avg(restated_pnl_pct) AS restated_expectancy,
           (count(restated_pnl_pct))::int AS restated_trades_n
    FROM priced
    GROUP BY strategy_id
  )
  SELECT s.id::int AS strategy_id,
         s.name AS strategy_name,
         COALESCE(a.trades_n, 0) AS shadow_trades_n,
         (a.wins::numeric / NULLIF(a.trades_n, 0))::float8 AS shadow_win_rate,
         a.avg_win_pct::float8 AS shadow_avg_win_pct,
         a.avg_loss_pct::float8 AS shadow_avg_loss_pct,
         (CASE
            WHEN a.trades_n = 0 OR a.trades_n IS NULL THEN NULL
            ELSE a.wins::numeric / a.trades_n * COALESCE(a.avg_win_pct, 0)
               + (a.trades_n - a.wins)::numeric / a.trades_n * COALESCE(a.avg_loss_pct, 0)
          END)::float8 AS shadow_expectancy,
         a.restated_expectancy::float8 AS shadow_expectancy_restated,
         COALESCE(a.restated_trades_n, 0) AS shadow_restated_trades_n,
         COALESCE(r.trades_n, 0) AS real_trades_n,
         r.expectancy::float8 AS real_expectancy,
         r.excess_expectancy::float8 AS real_excess_expectancy
  FROM strategies s
  LEFT JOIN agg a ON a.strategy_id = s.id
  LEFT JOIN strategy_stats r ON r.strategy_id = s.id AND r."window" = 'all'
  WHERE EXISTS (SELECT 1 FROM shadow_trades x WHERE x.strategy_id = s.id)
  ORDER BY s.id
`;

const SHADOW_DROPS_SQL = `
  SELECT COALESCE(sum(shadow_drops) FILTER (WHERE day = (now() AT TIME ZONE 'America/New_York')::date), 0)::int
           AS today,
         COALESCE(sum(shadow_drops), 0)::int AS total
  FROM claude_call_budget
`;

const TICKER_META_SQL = `
  SELECT t.symbol,
         t.name,
         t.days_to_cover::float8 AS days_to_cover,
         t.shares_short::float8 AS shares_short,
         t.short_interest_settlement_date,
         p.price::float8 AS price,
         f.ts AS features_ts,
         f.mention_zscore::float8 AS mention_zscore,
         f.social_velocity::float8 AS social_velocity,
         f.social_accel::float8 AS social_accel,
         f.exhaustion_score::float8 AS exhaustion_score,
         f.rel_volume_zscore::float8 AS rel_volume_zscore,
         f.rel_volume_zscore_v2::float8 AS rel_volume_zscore_v2,
         f.price_momentum::float8 AS price_momentum,
         f.mentions_1h::float8 AS mentions_1h,
         f.unique_authors_1h::float8 AS unique_authors_1h,
         f.mentions_24h::float8 AS mentions_24h,
         f.mention_growth_24h::float8 AS mention_growth_24h,
         f.wiki_views::float8 AS wiki_views,
         to_char(f.wiki_views_date, 'YYYY-MM-DD') AS wiki_views_date,
         f.wiki_views_zscore::float8 AS wiki_views_zscore,
         f.attention_breadth::int AS attention_breadth,
         f.attention_breadth_of::int AS attention_breadth_of
  FROM tickers t
  LEFT JOIN LATERAL (
    SELECT price FROM market_snapshots m
    WHERE m.symbol = t.symbol ORDER BY m.ts DESC LIMIT 1
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT * FROM features fx WHERE fx.symbol = t.symbol ORDER BY fx.ts DESC LIMIT 1
  ) f ON true
  WHERE t.symbol = $1
`;

const TICKER_SERIES_SQL = `
  WITH bounds AS (
    SELECT (date_trunc('hour', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS last_hour,
           ((date_trunc('hour', now() AT TIME ZONE 'UTC') - make_interval(hours => $2::int - 1)) AT TIME ZONE 'UTC')
             AS first_hour
  ),
  hour_slot AS (
    SELECT generate_series(b.first_hour, b.last_hour, interval '1 hour') AS ts
    FROM bounds b
  ),
  hourly_price AS (
    SELECT DISTINCT ON (date_trunc('hour', m.ts AT TIME ZONE 'UTC'))
           (date_trunc('hour', m.ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS ts,
           m.price::float8 AS price
    FROM market_snapshots m
    WHERE m.symbol = $1 AND m.ts >= (SELECT first_hour FROM bounds)
    ORDER BY date_trunc('hour', m.ts AT TIME ZONE 'UTC'), m.ts DESC
  ),
  hourly_feature AS (
    SELECT (date_trunc('hour', f.ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS ts,
           avg(f.mention_zscore)::float8 AS mention_zscore,
           avg(f.mentions_1h)::float8 AS mentions_1h
    FROM features f
    WHERE f.symbol = $1 AND f.ts >= (SELECT first_hour FROM bounds)
    GROUP BY 1
  )
  SELECT ${isoUtc('s.ts')} AS ts,
         p.price,
         f.mention_zscore,
         f.mentions_1h
  FROM hour_slot s
  LEFT JOIN hourly_price p ON p.ts = s.ts
  LEFT JOIN hourly_feature f ON f.ts = s.ts
  ORDER BY s.ts
`;

// Daily granularity, kept in its own query and its own chart. `price` is the last price observed
// on that UTC day, not a close — a UTC day is not an ET session.
const TICKER_WIKI_SERIES_SQL = `
  WITH wiki AS (
    SELECT period_date, value::float8 AS wiki_views
    FROM attention_snapshots
    WHERE symbol = $1 AND instrument = 'wikipedia' AND granularity = 'daily'
    ORDER BY period_date DESC
    LIMIT $2::int
  ),
  daily_price AS (
    SELECT DISTINCT ON ((m.ts AT TIME ZONE 'UTC')::date)
           (m.ts AT TIME ZONE 'UTC')::date AS period_date,
           m.price::float8 AS price
    FROM market_snapshots m
    WHERE m.symbol = $1
    ORDER BY (m.ts AT TIME ZONE 'UTC')::date, m.ts DESC
  )
  SELECT to_char(w.period_date, 'YYYY-MM-DD') AS period_date, w.wiki_views, p.price
  FROM wiki w
  LEFT JOIN daily_price p USING (period_date)
  ORDER BY w.period_date
`;

const NEAR_SIGNAL_FEATURES_SQL = `
  SELECT t.symbol,
         t.name,
         p.price::float8 AS price,
         f.ts AS features_ts,
         f.attention_breadth::int AS attention_breadth,
         f.attention_breadth_of::int AS attention_breadth_of,
         json_build_object(
           'social_velocity', f.social_velocity::float8,
           'social_accel', f.social_accel::float8,
           'author_quality', f.author_quality::float8,
           'mention_zscore', f.mention_zscore::float8,
           'mentions_1h', f.mentions_1h::float8,
           'unique_authors_1h', f.unique_authors_1h::float8,
           'mentions_24h', f.mentions_24h::float8,
           'mention_growth_24h', f.mention_growth_24h::float8,
           'rel_volume_zscore', f.rel_volume_zscore::float8,
           'rel_volume_zscore_v2', f.rel_volume_zscore_v2::float8,
           'price_momentum', f.price_momentum::float8,
           'price_momentum_1d', f.price_momentum_1d::float8,
           'price_momentum_2d', f.price_momentum_2d::float8,
           'days_to_cover', f.days_to_cover::float8,
           'exhaustion_score', f.exhaustion_score::float8
         ) AS features
  FROM tickers t
  LEFT JOIN LATERAL (
    SELECT price FROM market_snapshots m
    WHERE m.symbol = t.symbol AND m.ts > now() - interval '1 day'
    ORDER BY m.ts DESC LIMIT 1
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT * FROM features fx WHERE fx.symbol = t.symbol ORDER BY fx.ts DESC LIMIT 1
  ) f ON true
`;

const ACTIVE_STRATEGIES_SQL = `
  SELECT id::int AS id, name, params FROM strategies WHERE status = 'active' ORDER BY id
`;

const OPEN_TRADE_KEYS_SQL = `
  SELECT strategy_id::int AS strategy_id, symbol FROM trades WHERE status = 'open'
`;

const WARNINGS_SQL = `
  SELECT kind, subject, detail, first_seen, last_seen
  FROM system_warnings
  WHERE cleared_at IS NULL
  ORDER BY first_seen, kind, subject
`;

const EVOLUTION_SQL = `
  SELECT e.id::int AS id,
         e.ts,
         e.action,
         e.rationale,
         e.holdout_expectancy::float8 AS holdout_expectancy,
         e.strategy_id::int AS strategy_id,
         s.name AS strategy_name,
         s.generation AS strategy_generation,
         s.status AS strategy_status,
         e.parent_id::int AS parent_id,
         p.name AS parent_name,
         p.generation AS parent_generation
  FROM evolution_log e
  LEFT JOIN strategies s ON s.id = e.strategy_id
  LEFT JOIN strategies p ON p.id = e.parent_id
  ORDER BY e.ts DESC, e.id DESC
`;

function exitStatus(params, features, pnlPct, holdHours) {
  const bag = { ...features, pnl_pct: pnlPct, hold_hours: holdHours };
  try {
    const { logic, conditions } = describeBlock(params.exit, bag);
    return {
      exit_logic: logic,
      exit_conditions: conditions.map((condition) => ({
        ...condition,
        current: bag[condition.feature] ?? null,
      })),
      exit_error: null,
    };
  } catch (error) {
    return { exit_logic: null, exit_conditions: [], exit_error: error.message };
  }
}

// How far a ticker sits from an entry gate it has not cleared, in units of the
// gate's own threshold. max(|value|, 1) keeps thresholds of 0 — `social_accel gt 0`,
// `mention_growth_24h gt 0` — from dividing by zero. A feature that was never
// computed has no distance at all: null, never 0.
function gateGap(condition, current) {
  if (typeof current !== 'number' || !Number.isFinite(current)) return null;
  return Math.abs(current - condition.value) / Math.max(Math.abs(condition.value), 1);
}

function entryProximity(params, features) {
  const { logic, conditions } = describeBlock(params.entry, features);
  const gates = conditions.map((condition) => {
    const current = features[condition.feature] ?? null;
    return { ...condition, current, gap: condition.met ? 0 : gateGap(condition, current) };
  });
  const unmet = gates.filter((gate) => !gate.met);
  const unknown = unmet.some((gate) => gate.gap === null);

  return {
    entry_logic: logic,
    gates,
    gates_met: gates.length - unmet.length,
    gates_total: gates.length,
    // The worst unmet gate is the one that has to travel furthest. Unknown beats
    // nothing: if any unmet gate has no computed feature, the distance is unknown.
    worst_gap: unknown ? null : unmet.reduce((worst, gate) => Math.max(worst, gate.gap), 0),
  };
}

// Gates cleared first, then the smallest worst-gap. Unknown distance sorts last
// within its tier — never ahead of a candidate we can actually measure.
function compareCandidates(a, b) {
  if (a.gates_met !== b.gates_met) return b.gates_met - a.gates_met;
  if (a.worst_gap !== b.worst_gap) {
    if (a.worst_gap === null) return 1;
    if (b.worst_gap === null) return -1;
    return a.worst_gap - b.worst_gap;
  }
  return a.symbol.localeCompare(b.symbol) || a.strategy_id - b.strategy_id;
}

// "day" is the current America/New_York date, the same session clock every other rule in this
// system uses. pnl_usd comes from the fills themselves; `trades` carries no side column, so the
// sign is taken from strategies.params, exactly as positionTracker derives it. With no closed
// trades the sums are 0 rather than NULL: zero realized P&L is a fact we know, and closed_n
// carries the emptiness. shadow_trades is a separate table, so counterfactuals cannot reach the
// sums: the shadow count below is a count of the counterfactual book and nothing else, and open_n
// keeps its meaning of real open trades only.
const SUMMARY_DAY_SQL = `
  WITH closed_today AS (
    SELECT t.qty, t.entry_price, t.exit_price, t.pnl_pct,
           COALESCE(st.params->>'side', 'long') AS side
    FROM trades t
    JOIN strategies st ON st.id = t.strategy_id
    WHERE t.status = 'closed'
      AND t.exit_ts IS NOT NULL
      AND (t.exit_ts AT TIME ZONE 'America/New_York')::date
          = (now() AT TIME ZONE 'America/New_York')::date
  )
  SELECT count(*)::int AS closed_n,
         COALESCE(sum(pnl_pct), 0)::float8 AS pnl_pct,
         COALESCE(sum(qty * CASE WHEN side = 'short'
                                 THEN entry_price - exit_price
                                 ELSE exit_price - entry_price END), 0)::float8 AS pnl_usd,
         (SELECT count(*) FROM trades WHERE status = 'open')::int AS open_n,
         (SELECT count(*) FROM shadow_trades WHERE status = 'open')::int AS shadow_n
  FROM closed_today
`;

// The open book, real and counterfactual in one list, told apart by is_shadow. The flag is a
// literal boolean per branch rather than anything derived: the consumer treats "not explicitly
// false" as simulated, so a real position depends on this column actually saying false.
//
// Rows missing qty or entry_price are left out. A real entry sits with both NULL for the minutes
// between the order going to Alpaca and the fill coming back, and there is no honest way to state
// a position's size or cost during that window. They stay counted in open_n, which is a count and
// needs no price; this list only carries what it can describe.
//
// current_price, unrealized_pnl_pct and unrealized_pnl_usd all come out of a single tracker write:
// the trackers persist the mark in the same UPDATE as the percentage, so the price shown here is
// the price that percentage was computed from, and as_of is the one moment both were taken. No
// second price lookup happens on this path, so there is nothing for them to disagree about.
//
// pnl_pct is already sign-corrected for side, so +2.00 on a short means profit, and
// qty * entry * pct/100 is correct for shorts too -- identical to the qty * (exit - entry) form
// the day sums use.
//
// All four keys are always present. They are NULL from the fill until a tracker first marks the
// position, and do not return to NULL afterwards. The one crossing case is a position already open
// when last_price shipped: it holds a percentage with no stored price behind it until its next
// tick, and reports current_price and as_of NULL rather than inventing either.
//
// Real first, then largest: the consumer caps the list before it sorts, so ordering here is what
// keeps a real position from being cut by a crowd of shadows. The union is wrapped in a subquery
// only so that ordering can use an expression -- a set operation may be ordered by output column
// name alone, and notional is a sort key rather than part of the contract.
const SUMMARY_POSITIONS_SQL = `
  SELECT symbol, qty, entry_price, is_shadow, current_price, unrealized_pnl_pct, unrealized_pnl_usd, as_of
  FROM (
    SELECT symbol,
           qty::float8 AS qty,
           entry_price::float8 AS entry_price,
           false AS is_shadow,
           last_price::float8 AS current_price,
           pnl_pct::float8 AS unrealized_pnl_pct,
           (qty * entry_price * pnl_pct / 100)::float8 AS unrealized_pnl_usd,
           ${isoUtc('last_price_ts')} AS as_of
    FROM trades
    WHERE status = 'open' AND qty IS NOT NULL AND entry_price IS NOT NULL
    UNION ALL
    SELECT symbol,
           qty::float8 AS qty,
           entry_price::float8 AS entry_price,
           true AS is_shadow,
           last_price::float8 AS current_price,
           pnl_pct::float8 AS unrealized_pnl_pct,
           (qty * entry_price * pnl_pct / 100)::float8 AS unrealized_pnl_usd,
           ${isoUtc('last_price_ts')} AS as_of
    FROM shadow_trades
    WHERE status = 'open' AND qty IS NOT NULL AND entry_price IS NOT NULL
  ) book
  ORDER BY is_shadow, abs(qty * entry_price) DESC, symbol
`;

const SUMMARY_SIGNALS_SQL = `
  SELECT ${isoUtc('ts')} AS ts, symbol, direction, reasoning
  FROM signals
  ORDER BY ts DESC, id DESC
  LIMIT $1::int
`;

const route = (handler) => (req, res, next) => handler(req, res).catch(next);

export const dashboardRoutes = express.Router();

dashboardRoutes.get(
  '/watchlist',
  route(async (req, res) => {
    const { rows } = await pool.query(WATCHLIST_SQL, [SPARKLINE_HOURS, ACTIVE_SIGNAL_HOURS, WATCHLIST]);
    res.json(rows);
  })
);

dashboardRoutes.get(
  '/trades',
  route(async (req, res) => {
    const [open, closed] = await Promise.all([pool.query(OPEN_TRADES_SQL), pool.query(CLOSED_TRADES_SQL)]);
    res.json({
      open: open.rows.map(({ params, features, ...trade }) => ({
        ...trade,
        side: params.side,
        ...exitStatus(params, features, trade.pnl_pct, trade.hold_hours),
      })),
      closed: closed.rows,
    });
  })
);

dashboardRoutes.get(
  '/shadow',
  route(async (req, res) => {
    const [open, closed, byStrategy, drops] = await Promise.all([
      pool.query(SHADOW_OPEN_SQL),
      pool.query(SHADOW_CLOSED_SQL, [SHADOW_CLOSED_LIMIT]),
      pool.query(SHADOW_STATS_SQL, [SHADOW_SLIPPAGE_PCT_PER_SIDE]),
      pool.query(SHADOW_DROPS_SQL),
    ]);
    res.json({
      slippage_pct_per_side: SHADOW_SLIPPAGE_PCT_PER_SIDE,
      drops: drops.rows[0],
      open: open.rows.map(({ params, features, ...trade }) => ({
        ...trade,
        side: params.side,
        ...exitStatus(params, features, trade.pnl_pct, trade.hold_hours),
      })),
      closed: closed.rows,
      by_strategy: byStrategy.rows,
    });
  })
);

dashboardRoutes.get(
  '/strategies',
  route(async (req, res) => {
    const { rows } = await pool.query(STRATEGIES_SQL);
    res.json(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        generation: row.generation,
        status: row.status,
        params: row.params,
        created_at: row.created_at,
        parent:
          row.parent_id === null
            ? null
            : { id: row.parent_id, name: row.parent_name, generation: row.parent_generation },
        stats: {
          trades_n: row.trades_n,
          win_rate: row.win_rate,
          avg_win_pct: row.avg_win_pct,
          avg_loss_pct: row.avg_loss_pct,
          expectancy: row.expectancy,
          excess_expectancy: row.excess_expectancy,
          excess_trades_n: row.excess_trades_n,
          beat_basket_n: row.beat_basket_n,
          max_drawdown: row.max_drawdown,
        },
        equity_curve: row.equity_curve,
      }))
    );
  })
);

dashboardRoutes.get(
  '/signals',
  route(async (req, res) => {
    const { rows } = await pool.query(SIGNALS_SQL, [SIGNAL_FEED_LIMIT]);
    res.json(rows);
  })
);

// Standing only: a warning that has cleared is kept in the table but is no longer a condition of
// the system, and a health surface that keeps showing resolved faults teaches its reader to skim.
dashboardRoutes.get(
  '/warnings',
  route(async (req, res) => {
    const { rows } = await pool.query(WARNINGS_SQL);
    res.json(rows);
  })
);

dashboardRoutes.get(
  '/evolution',
  route(async (req, res) => {
    const { rows } = await pool.query(EVOLUTION_SQL);
    res.json(
      rows.map((row) => ({
        id: row.id,
        ts: row.ts,
        action: row.action,
        rationale: row.rationale,
        holdout_expectancy: row.holdout_expectancy,
        strategy:
          row.strategy_id === null
            ? null
            : {
                id: row.strategy_id,
                name: row.strategy_name,
                generation: row.strategy_generation,
                status: row.strategy_status,
              },
        parent:
          row.parent_id === null
            ? null
            : { id: row.parent_id, name: row.parent_name, generation: row.parent_generation },
      }))
    );
  })
);

dashboardRoutes.get(
  '/ticker/:symbol',
  route(async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const [meta, series, wikiSeries] = await Promise.all([
      pool.query(TICKER_META_SQL, [symbol]),
      pool.query(TICKER_SERIES_SQL, [symbol, TICKER_SERIES_HOURS]),
      pool.query(TICKER_WIKI_SERIES_SQL, [symbol, TICKER_WIKI_SERIES_DAYS]),
    ]);
    if (meta.rows.length === 0) {
      res.status(404).json({ error: `no ticker "${symbol}" on the watchlist` });
      return;
    }
    res.json({
      ...meta.rows[0],
      series_hours: TICKER_SERIES_HOURS,
      series: series.rows,
      // Null distinguishes "deliberately unmapped" from "mapped but not yet measured".
      wiki_article: WIKI_ARTICLES[symbol] ?? null,
      wiki_series_days: TICKER_WIKI_SERIES_DAYS,
      wiki_series: wikiSeries.rows,
    });
  })
);

dashboardRoutes.get(
  '/near-signals',
  route(async (req, res) => {
    const [tickers, strategies, open] = await Promise.all([
      pool.query(NEAR_SIGNAL_FEATURES_SQL),
      pool.query(ACTIVE_STRATEGIES_SQL),
      pool.query(OPEN_TRADE_KEYS_SQL),
    ]);

    // An open real trade is what actually stops the runner re-entering that pair.
    // Shadow positions do not: they were never sent, so the pair is still live.
    const held = new Set(open.rows.map((row) => `${row.strategy_id}:${row.symbol}`));
    const candidates = [];

    for (const strategy of strategies.rows) {
      for (const ticker of tickers.rows) {
        if (held.has(`${strategy.id}:${ticker.symbol}`)) continue;
        try {
          candidates.push({
            symbol: ticker.symbol,
            name: ticker.name,
            price: ticker.price,
            features_ts: ticker.features_ts,
            attention_breadth: ticker.attention_breadth,
            attention_breadth_of: ticker.attention_breadth_of,
            strategy_id: strategy.id,
            strategy_name: strategy.name,
            side: strategy.params.side,
            ...entryProximity(strategy.params, ticker.features),
            gate_error: null,
          });
        } catch (error) {
          candidates.push({
            symbol: ticker.symbol,
            name: ticker.name,
            price: ticker.price,
            features_ts: ticker.features_ts,
            attention_breadth: ticker.attention_breadth,
            attention_breadth_of: ticker.attention_breadth_of,
            strategy_id: strategy.id,
            strategy_name: strategy.name,
            side: strategy.params.side,
            entry_logic: null,
            gates: [],
            gates_met: 0,
            gates_total: 0,
            worst_gap: null,
            gate_error: error.message,
          });
        }
      }
    }

    candidates.sort(compareCandidates);
    res.json({
      active_strategies_n: strategies.rows.length,
      evaluated_n: candidates.length,
      candidates: candidates.slice(0, NEAR_SIGNAL_LIMIT),
    });
  })
);

dashboardRoutes.get(
  '/pnl',
  route(async (req, res) => {
    const [totals, curve] = await Promise.all([pool.query(PNL_TOTALS_SQL), pool.query(PNL_CURVE_SQL)]);
    res.json({ totals: totals.rows[0], equity_curve: curve.rows });
  })
);

dashboardRoutes.get(
  '/summary',
  route(async (req, res) => {
    const [day, positions, signals] = await Promise.all([
      pool.query(SUMMARY_DAY_SQL),
      pool.query(SUMMARY_POSITIONS_SQL),
      pool.query(SUMMARY_SIGNALS_SQL, [SUMMARY_SIGNAL_LIMIT]),
    ]);
    const { open_n: openN, shadow_n: shadowN, ...dayTotals } = day.rows[0];
    res.json({
      day: dayTotals,
      open_n: openN,
      shadow_n: shadowN,
      positions: positions.rows,
      signals: signals.rows,
    });
  })
);

/* ===================== The weekly recap =====================
   GET /api/weekly-recap?start=YYYY-MM-DD&end=YYYY-MM-DD, both São Paulo calendar dates and both
   inclusive, for hub's Friday review. Read-only in the strict sense: every statement below is a
   SELECT, so nothing here can touch a strategy, a seed, a position or any trading decision.

   Three obligations shape the payload rather than decorate it.

   Every rate travels with the sample it was measured over, so a win rate that moved on four
   trades can be called noise by whoever reads it: `by_strategy.win_rate` sits beside the `closed`
   it was divided by, and every `strategy_deltas` row carries `n_this` and `n_last`.

   A `reason` is only ever what Pulse recorded at the moment it decided, read back verbatim:
   `evolution_log.rationale` for a change the loop adopted, `evolution_rejections.reason` for a
   proposal its validator threw out. Nothing here composes an explanation after the fact, so a
   rejection from before migration 011 — when the reason reached a console line and nowhere else —
   stays absent rather than being summarised from what is left.

   A subsystem with nothing to say reports `unavailable: true` instead of sending zeros, because a
   week with no trades and a Pulse with no trade log are indistinguishable once both read 0. */

const RECAP_TIMEZONE = 'America/Sao_Paulo';
const RECAP_CURRENCY = 'USD';
const RECAP_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// $1 = start, $2 = end. Half-open once resolved to instants, so a trade that closed at 23:59 São
// Paulo on the last day is inside the window and one that closed at 00:00 the next morning is not.
const RECAP_WINDOW_CTE = `
  win AS (
    SELECT ($1::date)::timestamp AT TIME ZONE '${RECAP_TIMEZONE}' AS from_ts,
           ($2::date + 1)::timestamp AT TIME ZONE '${RECAP_TIMEZONE}' AS to_ts
  )
`;

// The same signed dollar figure /api/summary reports for a day, so a week can never disagree with
// the days that make it up. Requires the `trades t` / `strategies st` aliases.
const RECAP_PNL_USD = `
  t.qty * CASE WHEN COALESCE(st.params->>'side', 'long') = 'short'
               THEN t.entry_price - t.exit_price
               ELSE t.exit_price - t.entry_price END
`;

// `log_rows` counts the whole trades table, not the window: it is the one thing that separates
// "no trade closed this week", which is a measurement, from "this Pulse has no trade log", which
// is the absence of one.
const RECAP_TRADES_SQL = `
  WITH ${RECAP_WINDOW_CTE},
  closed AS (
    SELECT t.symbol,
           st.name AS strategy,
           t.pnl_pct,
           round(t.hold_hours, 1)::float8 AS held_hours,
           (${RECAP_PNL_USD})::numeric AS pnl
    FROM trades t
    JOIN strategies st ON st.id = t.strategy_id
    CROSS JOIN win w
    WHERE t.status = 'closed'
      AND t.exit_ts >= w.from_ts AND t.exit_ts < w.to_ts
      AND t.pnl_pct IS NOT NULL
  )
  SELECT (SELECT count(*) FROM trades)::int AS log_rows,
         count(*)::int AS closed,
         (count(*) FILTER (WHERE pnl_pct > 0))::int AS winners,
         (count(*) FILTER (WHERE pnl_pct <= 0))::int AS losers,
         -- A week that closed nothing netted zero; a week whose trades carry no fill prices nets
         -- an unknown. A bare COALESCE would report both as 0.
         (CASE WHEN count(*) = 0 THEN 0 ELSE round(sum(pnl), 2) END)::float8 AS net,
         (SELECT to_jsonb(x) FROM (
            SELECT symbol, round(pnl, 2)::float8 AS pnl, strategy, held_hours
            FROM closed WHERE pnl IS NOT NULL ORDER BY pnl DESC LIMIT 1) x) AS best,
         (SELECT to_jsonb(x) FROM (
            SELECT symbol, round(pnl, 2)::float8 AS pnl, strategy, held_hours
            FROM closed WHERE pnl IS NOT NULL ORDER BY pnl ASC LIMIT 1) x) AS worst
  FROM closed
`;

// `closed` is this row's win_rate denominator as well as its trade count, which is what keeps the
// rate from ever being read without its sample size.
const RECAP_BY_STRATEGY_SQL = `
  WITH ${RECAP_WINDOW_CTE}
  SELECT st.name AS strategy,
         count(*)::int AS closed,
         round(sum(${RECAP_PNL_USD}), 2)::float8 AS net,
         round((count(*) FILTER (WHERE t.pnl_pct > 0))::numeric / count(*), 4)::float8 AS win_rate
  FROM trades t
  JOIN strategies st ON st.id = t.strategy_id
  CROSS JOIN win w
  WHERE t.status = 'closed'
    AND t.exit_ts >= w.from_ts AND t.exit_ts < w.to_ts
    AND t.pnl_pct IS NOT NULL
  GROUP BY st.name
  ORDER BY count(*) DESC, st.name
`;

// The comparison window is the equally long stretch immediately before this one, so a seven-day
// recap compares against seven days and a window of any other length still compares like with
// like. `prev.from_ts` runs up to exactly `win.from_ts`, which lets one range scan feed both
// buckets and leaves `this_window` never ambiguous.
const RECAP_DELTAS_SQL = `
  WITH ${RECAP_WINDOW_CTE},
  prev AS (
    SELECT ($1::date - ($2::date - $1::date + 1))::timestamp AT TIME ZONE '${RECAP_TIMEZONE}'
             AS from_ts
  ),
  scored AS (
    SELECT st.name AS strategy,
           (t.exit_ts >= w.from_ts) AS this_window,
           t.pnl_pct
    FROM trades t
    JOIN strategies st ON st.id = t.strategy_id
    CROSS JOIN win w
    CROSS JOIN prev p
    WHERE t.status = 'closed'
      AND t.pnl_pct IS NOT NULL
      AND t.exit_ts >= p.from_ts AND t.exit_ts < w.to_ts
  )
  SELECT strategy,
         (count(*) FILTER (WHERE this_window))::int AS n_this,
         (count(*) FILTER (WHERE NOT this_window))::int AS n_last,
         round((count(*) FILTER (WHERE this_window AND pnl_pct > 0))::numeric
               / NULLIF(count(*) FILTER (WHERE this_window), 0), 4)::float8 AS win_rate_this,
         round((count(*) FILTER (WHERE NOT this_window AND pnl_pct > 0))::numeric
               / NULLIF(count(*) FILTER (WHERE NOT this_window), 0), 4)::float8 AS win_rate_last,
         round(avg(pnl_pct) FILTER (WHERE this_window), 4)::float8 AS expectancy_this,
         round(avg(pnl_pct) FILTER (WHERE NOT this_window), 4)::float8 AS expectancy_last
  FROM scored
  GROUP BY strategy
  ORDER BY count(*) FILTER (WHERE this_window) DESC, strategy
`;

// `ever_promoted` deliberately looks outside the window: a candidate the loop later took up was
// not rejected, whenever that happened. `run_date` comes back as text so the distinct-day count is
// a string comparison rather than a Date identity one.
const RECAP_EVOLUTION_SQL = `
  WITH ${RECAP_WINDOW_CTE}
  SELECT ${isoUtc('e.ts')} AS at,
         (e.ts AT TIME ZONE '${RECAP_TIMEZONE}')::date::text AS run_date,
         e.action::text AS action,
         s.name AS strategy,
         e.rationale AS reason,
         e.holdout_expectancy::float8 AS holdout_expectancy,
         EXISTS (
           SELECT 1 FROM evolution_log p
           WHERE p.strategy_id = e.strategy_id AND p.action = 'promote'
         ) AS ever_promoted
  FROM evolution_log e
  LEFT JOIN strategies s ON s.id = e.strategy_id
  CROSS JOIN win w
  WHERE e.ts >= w.from_ts AND e.ts < w.to_ts
  ORDER BY e.ts, e.id
`;

// The proposals the validator threw out before they could become strategies: a malformed side,
// or an exit block that cannot close a loser. A sibling of evolution_log rather than a row in it,
// so there is no strategy to join to and the name is the one the model gave the proposal.
const RECAP_REJECTIONS_SQL = `
  WITH ${RECAP_WINDOW_CTE}
  SELECT ${isoUtc('r.ts')} AS at,
         (r.ts AT TIME ZONE '${RECAP_TIMEZONE}')::date::text AS run_date,
         r.candidate,
         r.reason
  FROM evolution_rejections r
  CROSS JOIN win w
  WHERE r.ts >= w.from_ts AND r.ts < w.to_ts
  ORDER BY r.ts, r.id
`;

const RECAP_PROMOTED_SQL = `
  WITH ${RECAP_WINDOW_CTE}
  SELECT s.name AS strategy,
         (e.ts AT TIME ZONE '${RECAP_TIMEZONE}')::date::text AS on_date,
         (SELECT count(*) FROM trades t
          WHERE t.strategy_id = s.id AND t.status = 'closed' AND t.exit_ts > e.ts)::int
           AS closed_since
  FROM evolution_log e
  JOIN strategies s ON s.id = e.strategy_id
  CROSS JOIN win w
  WHERE e.action = 'promote' AND e.ts >= w.from_ts AND e.ts < w.to_ts
  ORDER BY e.ts
`;

// Open positions are read as of now rather than as of the window, because what carries into next
// week is what is open when the report is written. The real book only: a shadow position is a
// counterfactual and nobody has to watch it.
const RECAP_OPEN_SQL = `
  SELECT t.symbol,
         st.name AS strategy,
         (t.entry_ts AT TIME ZONE '${RECAP_TIMEZONE}')::date::text AS on_date,
         round(t.hold_hours, 1)::float8 AS hold_hours,
         round(t.pnl_pct, 2)::float8 AS pnl_pct
  FROM trades t
  JOIN strategies st ON st.id = t.strategy_id
  WHERE t.status = 'open'
  ORDER BY t.entry_ts
`;

const digest = (value) => createHash('sha256').update(value).digest();

// The key convention belongs to the caller: hub holds the secret as PULSE_API_KEY and sends it as
// X-Pulse-Key, and sends nothing at all until Pulse has a key to check it against. So an unset key
// here leaves the route open and says so at boot, the same shape warnMissingHubKey takes in the
// outbound direction — answering 401 while unconfigured would only break the one caller that is
// waiting on this side to be configured first. Digesting both sides gives timingSafeEqual the
// equal lengths it requires without leaking the real key's length.
function pulseKeyAccepted(req) {
  const expected = process.env.PULSE_API_KEY;
  if (!expected) return true;
  const supplied = req.get('X-Pulse-Key');
  return typeof supplied === 'string' && timingSafeEqual(digest(supplied), digest(expected));
}

export function warnMissingPulseKey() {
  if (!process.env.PULSE_API_KEY) {
    console.warn(
      '[pulse] PULSE_API_KEY is not set, so /api/weekly-recap answers anyone who asks; set the same secret here and in hub, which sends it as the X-Pulse-Key header'
    );
  }
}

// A date that survives the round trip is a date that exists: 2026-02-31 matches the pattern, and
// Postgres would answer it with a 500 rather than the 400 it is.
function calendarDate(value) {
  if (typeof value !== 'string' || !RECAP_DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

/**
 * `runs` counts the days in the window on which the loop recorded something — a decision in
 * evolution_log, or a refusal in evolution_rejections — not the days it woke up. A cycle that
 * bails before it proposes anything, because too few strategies qualify to rank a worst against a
 * best or because the model returned nothing usable, still writes no row anywhere and leaves no
 * record of having run. That is why an empty window reports `unavailable` rather than `runs: 0`:
 * "the loop found nothing to do" and "the loop never ran" are the same silence, and a zero would
 * quietly pick one of them.
 */
function recapEvolution(rows, rejections) {
  if (rows.length === 0 && rejections.length === 0) return { unavailable: true };

  return {
    // A cycle that threw out every proposal it was given adopted nothing and so wrote nothing to
    // evolution_log, but it did run, and the rejections are now the only record saying so.
    runs: new Set([...rows, ...rejections].map((row) => row.run_date)).size,
    changes: rows
      .filter((row) => row.action !== 'mutate')
      .map((row) => ({
        at: row.at,
        strategy: row.strategy,
        change: row.action === 'promote' ? 'promoted' : 'retired',
        reason: row.reason,
        // evolution_log stores the single expectancy the decision turned on, never a pair, so
        // `before` stays null rather than becoming a number lifted from a neighbouring row.
        metric: row.holdout_expectancy === null ? null : 'holdout_expectancy',
        before: null,
        after: row.holdout_expectancy,
      })),
    // Two ways a proposal is refused, merged into the order they happened: thrown out by the
    // validator before it could become a strategy, or recorded as a candidate the loop then never
    // took up. `at` orders them and is then dropped — the contract carries the pair, not the time.
    rejected: [
      ...rejections.map((row) => ({ at: row.at, candidate: row.candidate, reason: row.reason })),
      ...rows
        .filter((row) => row.action === 'mutate' && !row.ever_promoted)
        .map((row) => ({ at: row.at, candidate: row.strategy, reason: row.reason })),
    ]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map(({ at, ...rejection }) => rejection),
  };
}

// Two rows per strategy rather than one. Expectancy is what the loop optimises and win rate is
// what it is explicitly told never to optimise, so a report carrying only the second would point
// the review at the wrong number. Both carry the same pair of sample sizes.
const recapDeltas = (row) =>
  [
    { metric: 'win_rate', this_week: row.win_rate_this, last_week: row.win_rate_last },
    { metric: 'expectancy_pct', this_week: row.expectancy_this, last_week: row.expectancy_last },
  ].map((delta) => ({ strategy: row.strategy, ...delta, n_this: row.n_this, n_last: row.n_last }));

function recapWatching(promoted, open) {
  return [
    ...promoted.map((row) => ({
      note: `${row.strategy} is newly active`,
      why:
        row.closed_since === 0
          ? `promoted ${row.on_date} and no trade has closed under it since`
          : `promoted ${row.on_date}, ${row.closed_since} trade${row.closed_since === 1 ? '' : 's'} closed under it since`,
    })),
    ...open.map((row) => ({
      note: `${row.symbol} is still open on ${row.strategy}`,
      why: [
        `entered ${row.on_date}`,
        row.hold_hours === null ? null : `held ${row.hold_hours}h`,
        row.pnl_pct === null ? 'not marked yet' : `last marked ${row.pnl_pct}%`,
      ]
        .filter((part) => part !== null)
        .join(', '),
    })),
  ];
}

dashboardRoutes.get(
  '/weekly-recap',
  route(async (req, res) => {
    if (!pulseKeyAccepted(req)) {
      res.status(401).json({ error: 'missing or wrong X-Pulse-Key' });
      return;
    }

    const start = calendarDate(req.query.start);
    const end = calendarDate(req.query.end);
    if (start === null || end === null) {
      res.status(400).json({
        error: `start and end are required and must be real calendar dates as YYYY-MM-DD, read as ${RECAP_TIMEZONE} days and both inclusive`,
      });
      return;
    }
    if (end < start) {
      res.status(400).json({ error: `end ${end} is before start ${start}` });
      return;
    }

    const bounds = [start, end];
    const [trades, byStrategy, deltas, evolutionLog, rejections, promoted, open] = await Promise.all([
      pool.query(RECAP_TRADES_SQL, bounds),
      pool.query(RECAP_BY_STRATEGY_SQL, bounds),
      pool.query(RECAP_DELTAS_SQL, bounds),
      pool.query(RECAP_EVOLUTION_SQL, bounds),
      pool.query(RECAP_REJECTIONS_SQL, bounds),
      pool.query(RECAP_PROMOTED_SQL, bounds),
      pool.query(RECAP_OPEN_SQL),
    ]);

    const totals = trades.rows[0];
    res.json({
      window: { start, end },
      trades:
        totals.log_rows === 0
          ? { unavailable: true }
          : {
              closed: totals.closed,
              winners: totals.winners,
              losers: totals.losers,
              net: totals.net,
              currency: RECAP_CURRENCY,
              best: totals.best,
              // With one closed trade the best and the worst are the same trade. Reporting it
              // twice would read as two findings, so the second slot stays empty.
              worst: totals.closed > 1 ? totals.worst : null,
              by_strategy: byStrategy.rows,
            },
      evolution: recapEvolution(evolutionLog.rows, rejections.rows),
      strategy_deltas: deltas.rows.flatMap(recapDeltas),
      watching: recapWatching(promoted.rows, open.rows),
    });
  })
);
