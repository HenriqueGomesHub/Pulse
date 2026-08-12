import { pool } from '../db/pool.js';

export const MENTION_SOURCE_PRECEDENCE = Object.freeze(['reddit', 'apewisdom']);

export const MENTION_BASELINE_INTERVAL = '7 days';

export const MENTION_BASELINE_MIN_OBS = 20;

const FALLBACK_SOURCE = MENTION_SOURCE_PRECEDENCE[MENTION_SOURCE_PRECEDENCE.length - 1];

const BASELINE_OBSERVATIONS_SQL = `
  SELECT source, count(DISTINCT ts)::int AS observations
  FROM social_snapshots
  WHERE source = ANY($1) AND ts > now() - interval '${MENTION_BASELINE_INTERVAL}'
  GROUP BY source
`;

export async function primaryMentionSource() {
  const { rows } = await pool.query(BASELINE_OBSERVATIONS_SQL, [[...MENTION_SOURCE_PRECEDENCE]]);
  const usable = new Set(
    rows.filter((row) => row.observations >= MENTION_BASELINE_MIN_OBS).map((row) => row.source)
  );
  return MENTION_SOURCE_PRECEDENCE.find((source) => usable.has(source)) ?? FALLBACK_SOURCE;
}
