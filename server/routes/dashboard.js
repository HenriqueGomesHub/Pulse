import express from 'express';
import { SHADOW_SLIPPAGE_PCT_PER_SIDE, WIKI_ARTICLES } from '../config.js';
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
  WITH bounds AS (
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
    FROM tickers t
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
    FROM tickers t
    CROSS JOIN hour_slot s
    LEFT JOIN hourly h ON h.symbol = t.symbol AND h.ts = s.ts
    GROUP BY t.symbol
  ),
  latest AS (
    SELECT t.symbol, f.ts, f.mention_zscore, f.social_velocity, f.exhaustion_score,
           f.attention_breadth, f.attention_breadth_of
    FROM tickers t
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
  FROM tickers t
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
  WHERE t.status = 'closed'
  ORDER BY t.exit_ts DESC NULLS LAST, t.id DESC
`;

const STRATEGIES_SQL = `
  WITH closed AS (
    SELECT id, strategy_id, pnl_pct, exit_ts
    FROM trades
    WHERE status = 'closed' AND pnl_pct IS NOT NULL
  ),
  stats AS (
    SELECT strategy_id,
           count(*)::int AS trades_n,
           (count(*) FILTER (WHERE pnl_pct > 0))::float8 / count(*) AS win_rate,
           (avg(pnl_pct) FILTER (WHERE pnl_pct > 0))::float8 AS avg_win_pct,
           (avg(pnl_pct) FILTER (WHERE pnl_pct <= 0))::float8 AS avg_loss_pct,
           avg(pnl_pct)::float8 AS expectancy
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
    SELECT id, exit_ts, pnl_pct
    FROM trades
    WHERE status = 'closed' AND pnl_pct IS NOT NULL
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

const SHADOW_STATS_SQL = `
  WITH agg AS (
    SELECT strategy_id,
           (count(pnl_pct))::int AS trades_n,
           (count(pnl_pct) FILTER (WHERE pnl_pct > 0))::int AS wins,
           avg(pnl_pct) FILTER (WHERE pnl_pct > 0) AS avg_win_pct,
           avg(pnl_pct) FILTER (WHERE pnl_pct <= 0) AS avg_loss_pct
    FROM shadow_trades
    WHERE status = 'closed' AND pnl_pct IS NOT NULL AND exit_ts IS NOT NULL
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
         COALESCE(r.trades_n, 0) AS real_trades_n,
         r.expectancy::float8 AS real_expectancy
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
// unrealized_pnl_usd is derived from the pnl_pct the trackers already maintain rather than from a
// second price lookup, so it cannot disagree with the percentage shown beside it. pnl_pct is
// already sign-corrected for side, which makes qty * entry * pct/100 correct for shorts too, and
// identical to the qty * (exit - entry) form the day sums use. NULL until a tracker has run.
//
// Real first, then largest: the consumer caps the list before it sorts, so ordering here is what
// keeps a real position from being cut by a crowd of shadows. The union is wrapped in a subquery
// only so that ordering can use an expression -- a set operation may be ordered by output column
// name alone, and notional is a sort key rather than part of the contract.
const SUMMARY_POSITIONS_SQL = `
  SELECT symbol, qty, entry_price, is_shadow, unrealized_pnl_usd
  FROM (
    SELECT symbol,
           qty::float8 AS qty,
           entry_price::float8 AS entry_price,
           false AS is_shadow,
           (qty * entry_price * pnl_pct / 100)::float8 AS unrealized_pnl_usd
    FROM trades
    WHERE status = 'open' AND qty IS NOT NULL AND entry_price IS NOT NULL
    UNION ALL
    SELECT symbol,
           qty::float8 AS qty,
           entry_price::float8 AS entry_price,
           true AS is_shadow,
           (qty * entry_price * pnl_pct / 100)::float8 AS unrealized_pnl_usd
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
    const { rows } = await pool.query(WATCHLIST_SQL, [SPARKLINE_HOURS, ACTIVE_SIGNAL_HOURS]);
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
      pool.query(SHADOW_STATS_SQL),
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
