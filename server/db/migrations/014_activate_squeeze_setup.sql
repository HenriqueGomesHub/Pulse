-- A one-time correction to the row that already exists. On a database where strategies has not
-- been seeded yet this matches nothing and writes nothing, which is correct and not a silent
-- failure: runPipeline seeds from seeds.js moments later and seeds.js now gives squeeze-setup a
-- birth status of 'active' directly, so a fresh database arrives at the same state by the same
-- decision without needing a correction applied to it. The consequence is that a fresh database
-- carries no 'activate' row for it — the same position seeds 1 and 3 have always been in, since a
-- birth status is not a decision the log records.
WITH activated AS (
  UPDATE strategies SET status = 'active'
  WHERE name = 'squeeze-setup' AND generation = 0 AND status = 'candidate'
  RETURNING id
)
INSERT INTO evolution_log (ts, action, strategy_id, rationale)
SELECT now(), 'activate', id,
  'Owner decision, 2026-09-17, on the month-one review. squeeze-setup was born candidate on 2026-08-11 '
  'because two of its three entry conditions could not be expressed: short_interest_pct was not a feature '
  'and price_momentum_1d was not written. Both have since landed — days_to_cover is populated for 19 of 20 '
  'tickers as of the 2026-09-16 meta refresh — and a replay of its entry block over 32,880 feature ticks in '
  'the 31 days to 2026-09-17 shows 439 full fires. It took no trades not because it is starved but because '
  'strategyRunner reads status = ''active'' and nothing could ever change its status: the evolution loop '
  'needs two active strategies at 10+ closed trades in 30 days before it ranks anything, only one has ever '
  'qualified, and a candidate can only be woken by a promote row that only that loop can write. Activating '
  'it by decision breaks that circle and supplies the second qualifier within a few weeks. MIN_QUALIFIERS '
  'stays 2: ranking one strategy against itself produces a decision with no information in it.'
FROM activated;
