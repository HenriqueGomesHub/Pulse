import express from 'express';
import { pool } from '../db/pool.js';
import { describeBlock } from '../strategies/engine.js';

const SPARKLINE_HOURS = 24;
const ACTIVE_SIGNAL_HOURS = 24;
const SIGNAL_FEED_LIMIT = 200;

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
    SELECT t.symbol, f.ts, f.mention_zscore, f.social_velocity, f.exhaustion_score
    FROM tickers t
    CROSS JOIN LATERAL (
      SELECT ts, mention_zscore, social_velocity, exhaustion_score
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
  '/pnl',
  route(async (req, res) => {
    const [totals, curve] = await Promise.all([pool.query(PNL_TOTALS_SQL), pool.query(PNL_CURVE_SQL)]);
    res.json({ totals: totals.rows[0], equity_curve: curve.rows });
  })
);
