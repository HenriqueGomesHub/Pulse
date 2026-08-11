import express from 'express';
import cron from 'node-cron';
import { PORT, WATCHLIST } from './config.js';
import { pool } from './db/pool.js';
import { marketIngest } from './workers/marketIngest.js';
import { redditIngest } from './workers/redditIngest.js';
import { stocktwitsIngest } from './workers/stocktwitsIngest.js';

const WINDOW_OPEN_MINUTES = 7 * 60 + 30;
const WINDOW_CLOSE_MINUTES = 18 * 60;

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

async function runPipeline(forceMarket) {
  const startedAt = Date.now();
  await pool.query(
    'INSERT INTO tickers (symbol) SELECT unnest($1::text[]) ON CONFLICT (symbol) DO NOTHING',
    [WATCHLIST]
  );

  const tasks = [redditIngest(), stocktwitsIngest()];
  if (forceMarket || inMarketWindow(new Date())) {
    tasks.push(marketIngest());
  } else {
    console.log('[pipeline] outside market hours ±2h, skipping marketIngest');
  }

  await Promise.all(tasks);
  console.log(`[pipeline] tick finished in ${Date.now() - startedAt}ms`);
}

if (process.argv[2] === 'tick') {
  await runPipeline(true);
  await pool.end();
} else {
  const app = express();
  app.get('/health', (req, res) => res.json({ ok: true }));

  cron.schedule(
    '*/5 * * * *',
    () => {
      runPipeline(false).catch((err) => console.error('[pipeline] tick failed', err));
    },
    { timezone: 'America/New_York' }
  );

  app.listen(PORT, () => console.log(`[pulse] listening on ${PORT}, cron registered for */5 * * * *`));
}
