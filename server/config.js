import 'dotenv/config';

const REQUIRED = [
  'DATABASE_URL',
  'ALPACA_KEY_ID',
  'ALPACA_SECRET',
  'ALPACA_BASE_URL',
  'ALPACA_DATA_URL',
  'ANTHROPIC_API_KEY',
];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `Missing required environment variables: ${missing.join(', ')}\n` +
      'Copy .env.example to .env and fill them in, or set them in the Railway environment.'
  );
  process.exit(1);
}

export const WATCHLIST = [
  'SOFI',
  'MARA',
  'RIOT',
  'CLSK',
  'BITF',
  'HIVE',
  'IONQ',
  'RGTI',
  'QBTS',
  'BBAI',
  'SOUN',
  'LUNR',
  'ASTS',
  'RKLB',
  'PLUG',
  'FCEL',
  'EOSE',
  'OPEN',
  'WULF',
  'APLD',
];

export const SUBREDDITS = ['wallstreetbets', 'pennystocks', 'Shortsqueeze'];

export const MAX_DAY_TRADES_PER_5_SESSIONS = 3;

export const MAX_CONVICTION_CALLS_PER_DAY = 50;

export const SHADOW_SLIPPAGE_PCT_PER_SIDE = 0.05;

export const MIN_ACTIVE_STRATEGIES = 3;

export const MAX_ACTIVE_STRATEGIES = 6;

export const PORT = Number(process.env.PORT) || 3000;
