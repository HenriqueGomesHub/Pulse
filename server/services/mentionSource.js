import { pool } from '../db/pool.js';

export const MENTION_SOURCE_PRECEDENCE = Object.freeze(['reddit', 'apewisdom']);

export const MENTION_BASELINE_INTERVAL = '7 days';

const SOURCES_IN_BASELINE_SQL = `
  SELECT DISTINCT source
  FROM social_snapshots
  WHERE source = ANY($1) AND ts > now() - interval '${MENTION_BASELINE_INTERVAL}'
`;

export async function primaryMentionSource() {
  const { rows } = await pool.query(SOURCES_IN_BASELINE_SQL, [[...MENTION_SOURCE_PRECEDENCE]]);
  const present = new Set(rows.map((row) => row.source));
  return MENTION_SOURCE_PRECEDENCE.find((source) => present.has(source)) ?? MENTION_SOURCE_PRECEDENCE[0];
}
