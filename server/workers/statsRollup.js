import { pool } from '../db/pool.js';

const ROLLUP_SQL = `
  WITH windows AS (
    SELECT * FROM (VALUES
      ('7d'::stats_window, interval '7 days'),
      ('30d'::stats_window, interval '30 days'),
      ('all'::stats_window, NULL::interval)
    ) AS w("window", span)
  ),
  scoped AS (
    SELECT s.id AS strategy_id, w."window", t.id AS trade_id, t.exit_ts, t.pnl_pct
    FROM strategies s
    CROSS JOIN windows w
    LEFT JOIN trades t
      ON t.strategy_id = s.id
     AND t.status = 'closed'
     AND t.pnl_pct IS NOT NULL
     AND t.exit_ts IS NOT NULL
     AND (w.span IS NULL OR t.exit_ts > now() - w.span)
  ),
  agg AS (
    SELECT strategy_id,
           "window",
           (count(pnl_pct))::int AS trades_n,
           (count(pnl_pct) FILTER (WHERE pnl_pct > 0))::int AS wins,
           avg(pnl_pct) FILTER (WHERE pnl_pct > 0) AS avg_win_pct,
           avg(pnl_pct) FILTER (WHERE pnl_pct <= 0) AS avg_loss_pct,
           avg(pnl_pct) AS mean_pnl_pct,
           stddev_samp(pnl_pct) AS sd_pnl_pct
    FROM scoped
    GROUP BY strategy_id, "window"
  ),
  cumulative AS (
    SELECT strategy_id,
           "window",
           row_number() OVER (PARTITION BY strategy_id, "window" ORDER BY exit_ts, trade_id) AS ord,
           sum(pnl_pct) OVER (PARTITION BY strategy_id, "window" ORDER BY exit_ts, trade_id) AS cum_pnl_pct
    FROM scoped
    WHERE pnl_pct IS NOT NULL
  ),
  drawdown AS (
    SELECT strategy_id, "window", max(GREATEST(peak, 0) - cum_pnl_pct) AS max_drawdown
    FROM (
      SELECT strategy_id,
             "window",
             cum_pnl_pct,
             max(cum_pnl_pct) OVER (PARTITION BY strategy_id, "window" ORDER BY ord) AS peak
      FROM cumulative
    ) d
    GROUP BY strategy_id, "window"
  )
  INSERT INTO strategy_stats (strategy_id, "window", trades_n, win_rate, avg_win_pct, avg_loss_pct,
                              expectancy, max_drawdown, sharpe_naive, updated_at)
  SELECT a.strategy_id,
         a."window",
         a.trades_n,
         a.wins::numeric / NULLIF(a.trades_n, 0),
         a.avg_win_pct,
         a.avg_loss_pct,
         CASE
           WHEN a.trades_n = 0 THEN NULL
           ELSE a.wins::numeric / a.trades_n * COALESCE(a.avg_win_pct, 0)
              + (a.trades_n - a.wins)::numeric / a.trades_n * COALESCE(a.avg_loss_pct, 0)
         END,
         d.max_drawdown,
         CASE
           WHEN a.trades_n < 2 THEN NULL
           ELSE a.mean_pnl_pct / NULLIF(a.sd_pnl_pct, 0)
         END,
         now()
  FROM agg a
  LEFT JOIN drawdown d ON d.strategy_id = a.strategy_id AND d."window" = a."window"
  ON CONFLICT (strategy_id, "window") DO UPDATE SET
    trades_n = EXCLUDED.trades_n,
    win_rate = EXCLUDED.win_rate,
    avg_win_pct = EXCLUDED.avg_win_pct,
    avg_loss_pct = EXCLUDED.avg_loss_pct,
    expectancy = EXCLUDED.expectancy,
    max_drawdown = EXCLUDED.max_drawdown,
    sharpe_naive = EXCLUDED.sharpe_naive,
    updated_at = EXCLUDED.updated_at
`;

export async function statsRollup() {
  const { rowCount } = await pool.query(ROLLUP_SQL);
  const summary = `wrote ${rowCount} strategy_stats rows`;
  console.log(`[statsRollup] ${summary}`);
  return summary;
}
