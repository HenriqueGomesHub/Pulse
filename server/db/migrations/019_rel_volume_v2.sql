-- THE CLOCK ARTEFACT, AND THE INSTRUMENT SEAM IT CREATES.
--
-- rel_volume is volume_1h / avgHourlyVolume, where volume_1h is read from an hourly bar that is
-- still accumulating. Alpaca serves the new bar from minute :15 (4,120 of 4,126 observed resets),
-- so a reading at :00-:10 is the previous COMPLETED bar and readings from :15 onward are a bar
-- filling up. Measured on MARA 2026-09-16 the same quantity ran 0.635 → 0.210 → 0.669 inside one
-- hour. Pooled into a 30-day baseline this makes the z-score partly a clock: mean rel_volume_zscore
-- by position in hour was +0.821 / -0.373 / +0.058 / +0.521, a 1.19 swing on evenly distributed
-- ticks, holding in every hour of the day. 108 of seed 3's 115 entry signals landed in the two high
-- buckets.
--
-- rel_volume_v2 reads the last COMPLETED bar instead, so it does not depend on when in the hour it
-- is sampled. Pro-rating the partial bar to a full-hour equivalent was tested and rejected: it
-- flattens the mean to a 0.166 spread (failing the 0.15 gate) but inflates early-hour variance,
-- because dividing a quarter-hour of volume by 0.25 multiplies its noise as well as its signal —
-- the fire rate at z>2 came out 6.62% at :15-:25 against 2.88% at :45-:55, a 2.3x spread. v2 reads
-- 0.122 and 1.21x.
--
-- THE SEAM: rel_volume and rel_volume_zscore keep their old meaning exactly and are never
-- recomputed. v2 is a new column throughout. No strategy, replay or report may mix the two.
--
-- WHY THE RECOMPUTATION IS HONEST, and how it differs from days_to_cover: avgHourlyVolume is
-- recoverable from what is already stored, since rel_volume = volume_1h / avgHourlyVolume implies
-- avgHourlyVolume = volume_1h / rel_volume. So v2 = completed_bar_volume * rel_volume / volume_1h
-- is a deterministic function of rows Pulse already wrote, and the backfilled value is bit-identical
-- to what the forward path will compute — the wiki precedent, where a backfilled observation is the
-- same kind of thing as a live one. days_to_cover was different: it was NULL before FINRA data
-- existed and no arithmetic on stored rows could conjure it, so it carries a genuine time seam that
-- replay must respect. v2 carries none: it is defined uniformly over the whole tape.

ALTER TABLE market_snapshots ADD COLUMN rel_volume_v2 NUMERIC;
ALTER TABLE features ADD COLUMN rel_volume_zscore_v2 NUMERIC;

COMMENT ON COLUMN market_snapshots.rel_volume_v2 IS 'Volume of the last COMPLETED hourly bar over the 30-day average hourly volume. Unlike rel_volume it does not move with position in the hour, because it never reads a bar that is still filling. Costs freshness: between 15 and 115 minutes old against rel_volume''s 0-60, which is immaterial at seed 3''s 95-hour average hold and would not be at a scalping horizon. NULL before the first completed-bar reading exists for that symbol.';
COMMENT ON COLUMN features.rel_volume_zscore_v2 IS 'z-score of market_snapshots.rel_volume_v2 against its own trailing 30-day baseline, under a minimum-observation floor of 1300 (about 15 days at the measured 88.5 rows/day) rather than rel_volume_zscore''s 20. The old floor admitted a baseline spanning 100 minutes; this one requires half the nominal window. NULL where the floor is not met, which is most of the first fortnight of the tape — that is the honest cost of the floor and not a defect.';

-- Backfill v2 on every stored observation. grp increments at each :00-:10 reading, so first_value
-- within a grp is the completed-bar volume that reading carried.
WITH base AS (
  SELECT id, symbol, ts, rel_volume, volume_1h,
         count(*) FILTER (WHERE extract(minute FROM ts)::int < 15)
           OVER (PARTITION BY symbol ORDER BY ts ROWS UNBOUNDED PRECEDING) AS grp
  FROM market_snapshots
  WHERE rel_volume IS NOT NULL AND rel_volume > 0 AND volume_1h IS NOT NULL AND volume_1h > 0
),
calc AS (
  SELECT id, grp,
         first_value(volume_1h) OVER (PARTITION BY symbol, grp ORDER BY ts) AS completed_vol,
         rel_volume, volume_1h
  FROM base
)
UPDATE market_snapshots m
SET rel_volume_v2 = c.completed_vol::numeric * c.rel_volume / c.volume_1h
FROM calc c
WHERE c.id = m.id AND c.grp > 0;

-- Backfill the feature z-scores the same way featureEngine will compute them forward: the latest
-- market snapshot at or before the feature row, scored against a trailing 30-day baseline of v2.
CREATE TEMP TABLE v2_baseline ON COMMIT DROP AS
SELECT symbol, ts, rel_volume_v2,
       avg(rel_volume_v2) OVER w AS mean_v2,
       stddev_samp(rel_volume_v2) OVER w AS sd_v2,
       count(rel_volume_v2) OVER w AS n_v2
FROM market_snapshots
WINDOW w AS (PARTITION BY symbol ORDER BY ts RANGE BETWEEN INTERVAL '30 days' PRECEDING AND CURRENT ROW);

CREATE INDEX ON v2_baseline (symbol, ts DESC);
ANALYZE v2_baseline;

UPDATE features f
SET rel_volume_zscore_v2 = b.z
FROM (
  SELECT f2.id,
         CASE
           WHEN m.rel_volume_v2 IS NULL OR m.n_v2 < 1300 OR m.sd_v2 IS NULL OR m.sd_v2 = 0 THEN NULL
           ELSE (m.rel_volume_v2 - m.mean_v2) / m.sd_v2
         END AS z
  FROM features f2
  LEFT JOIN LATERAL (
    SELECT * FROM v2_baseline v
    WHERE v.symbol = f2.symbol AND v.ts <= f2.ts
    ORDER BY v.ts DESC LIMIT 1
  ) m ON true
) b
WHERE b.id = f.id AND b.z IS NOT NULL;
