import 'dotenv/config';

const REQUIRED = [
  'DATABASE_URL',
  'ALPACA_KEY_ID',
  'ALPACA_SECRET',
  'ALPACA_DATA_URL',
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

export const PORT = Number(process.env.PORT) || 3000;
