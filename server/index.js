import express from 'express';
import cron from 'node-cron';
import { MAX_ACTIVE_STRATEGIES, MIN_ACTIVE_STRATEGIES, PORT, WATCHLIST } from './config.js';
import { pool } from './db/pool.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { primaryMentionSource } from './services/mentionSource.js';
import { apewisdomIngest } from './workers/apewisdomIngest.js';
import { evolution } from './workers/evolution.js';
import { featureEngine } from './workers/featureEngine.js';
import { marketIngest } from './workers/marketIngest.js';
import { positionTracker } from './workers/positionTracker.js';
import { redditIngest } from './workers/redditIngest.js';
import { shadowTracker } from './workers/shadowTracker.js';
import { stocktwitsIngest } from './workers/stocktwitsIngest.js';
import { statsRollup } from './workers/statsRollup.js';
import { strategyRunner } from './workers/strategyRunner.js';
import { tickerMetaRefresh } from './workers/tickerMetaRefresh.js';
import { canFireUnder, seedsFor } from './strategies/seeds.js';

const WINDOW_OPEN_MINUTES = 7 * 60 + 30;
const WINDOW_CLOSE_MINUTES = 18 * 60;

const FIRABILITY_SQL = `
  SELECT s.id, s.name, s.status, s.params,
         EXISTS (
           SELECT 1 FROM evolution_log p
           WHERE p.strategy_id = s.id AND p.action = 'promote'
             AND NOT EXISTS (
               SELECT 1 FROM evolution_log r
               WHERE r.strategy_id = s.id AND r.action = 'retire' AND r.ts > p.ts
             )
         ) AS promoted_and_not_retired
  FROM strategies s
  WHERE s.status IN ('active', 'candidate')
  ORDER BY s.id
`;

function inMarketWindow(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;

  const weekday = value('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const minutes = Number(value('hour')) * 60 + Number(value('minute'));
  return minutes >= WINDOW_OPEN_MINUTES && minutes <= WINDOW_CLOSE_MINUTES;
}

async function reconcileFirability(source) {
  const { rows } = await pool.query(FIRABILITY_SQL);
  let active = rows.filter((row) => row.status === 'active').length;
  let demoted = 0;

  for (const row of rows) {
    const firable = canFireUnder(source, row.params);

    if (row.status === 'active' && !firable) {
      await pool.query("UPDATE strategies SET status = 'candidate' WHERE id = $1 AND status = 'active'", [row.id]);
      active -= 1;
      demoted += 1;
      console.warn(
        `[pulse] "${row.name}" (id ${row.id}) demoted active → candidate: its entry block gates on a mention feature that is NULL while ${source} is the primary mention source, so it is structurally unable to fire`
      );
    } else if (row.status === 'candidate' && firable && row.promoted_and_not_retired && active < MAX_ACTIVE_STRATEGIES) {
      await pool.query("UPDATE strategies SET status = 'active' WHERE id = $1 AND status = 'candidate'", [row.id]);
      active += 1;
      console.warn(
        `[pulse] "${row.name}" (id ${row.id}) restored candidate → active: the evolution loop promoted it and never retired it, and its entry block can fire again under ${source}`
      );
    }
  }

  if (active < MIN_ACTIVE_STRATEGIES) {
    console.warn(
      `[pulse] FLOOR BREACHED: ${active} active strategies, below the floor of ${MIN_ACTIVE_STRATEGIES}, with ${demoted} demoted on this tick for being unable to fire under ${source}. Spec §5.2 wins over the §6.2 floor here: the floor exists to stop the evolution loop retiring strategies that work, and a strategy that cannot fire is not one of those — held active it would inflate the active count and the evolution cap with a strategy that can never open a position. A demotion is reversible and reverses itself when the primary mention source changes back; a retirement never does.`
    );
  }
}

async function runPipeline(forceMarket) {
  const startedAt = Date.now();
  await pool.query(
    'INSERT INTO tickers (symbol) SELECT unnest($1::text[]) ON CONFLICT (symbol) DO NOTHING',
    [WATCHLIST]
  );

  const source = await primaryMentionSource();
  for (const seed of seedsFor(source)) {
    await pool.query(
      'UPDATE strategies SET params = $3 WHERE name = $1 AND generation = $2',
      [seed.name, seed.generation, seed.params]
    );
    await pool.query(
      `INSERT INTO strategies (name, generation, params, status)
       SELECT $1, $2, $3, $4::strategy_status
       WHERE NOT EXISTS (SELECT 1 FROM strategies WHERE name = $1 AND generation = $2)`,
      [seed.name, seed.generation, seed.params, seed.status]
    );
  }
  await reconcileFirability(source);

  const tasks = [redditIngest(), stocktwitsIngest(), apewisdomIngest()];
  if (forceMarket || inMarketWindow(new Date())) {
    tasks.push(marketIngest());
  } else {
    console.log('[pipeline] outside market hours ±2h, skipping marketIngest');
  }

  await Promise.all(tasks);
  await featureEngine();
  await strategyRunner();
  await positionTracker();
  await shadowTracker();
  console.log(`[pipeline] tick finished in ${Date.now() - startedAt}ms`);
}

async function warnInactiveSeeds() {
  const { rows } = await pool.query(
    "SELECT name, status FROM strategies WHERE generation = 0 AND status <> 'active' ORDER BY id"
  );
  for (const row of rows) {
    console.warn(
      `[pulse] generation-0 strategy "${row.name}" is status=${row.status}; strategyRunner will not evaluate it`
    );
  }
}

if (process.argv[2] === 'tick') {
  await runPipeline(true);
  await pool.end();
} else if (process.argv[2] === 'meta') {
  await tickerMetaRefresh();
  await pool.end();
} else if (process.argv[2] === 'stats') {
  await statsRollup();
  await pool.end();
} else if (process.argv[2] === 'evolve') {
  await evolution();
  await pool.end();
} else {
  const app = express();
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api', dashboardRoutes);

  cron.schedule(
    '*/5 * * * *',
    () => {
      runPipeline(false).catch((err) => console.error('[pipeline] tick failed', err));
    },
    { timezone: 'America/New_York' }
  );

  cron.schedule(
    '0 6 * * *',
    () => {
      tickerMetaRefresh().catch((err) => console.error('[tickerMetaRefresh] run failed', err));
    },
    { timezone: 'America/New_York' }
  );

  cron.schedule(
    '0 * * * *',
    () => {
      statsRollup().catch((err) => console.error('[statsRollup] run failed', err));
    },
    { timezone: 'America/New_York' }
  );

  cron.schedule(
    '0 3 * * 0',
    () => {
      evolution().catch((err) => console.error('[evolution] run failed', err));
    },
    { timezone: 'America/New_York' }
  );

  await warnInactiveSeeds();

  app.listen(PORT, () =>
    console.log(
      `[pulse] listening on ${PORT}, cron registered for */5 * * * *, 0 * * * *, 0 6 * * * and 0 3 * * 0`
    )
  );
}
