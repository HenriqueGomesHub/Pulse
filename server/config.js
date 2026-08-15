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

// Canonical en.wikipedia article titles, resolved and verified at curation time. Titles are stored
// as redirect TARGETS, never as redirects: the pageviews API attributes views to the title
// requested, so `Marathon Digital Holdings` measures a redirect stub at 1.9 views/day against
// `MARA Holdings` at 39.0. An explicit null means "no sensible article exists" and is a decision;
// a symbol absent from this map is an oversight and is warned about at boot.
export const WIKI_ARTICLES = {
  SOFI: 'SoFi',
  MARA: 'MARA Holdings',
  RIOT: null,
  CLSK: null,
  BITF: null,
  HIVE: null,
  IONQ: 'IonQ',
  RGTI: 'Rigetti Computing',
  QBTS: 'D-Wave Systems',
  BBAI: null,
  SOUN: 'SoundHound AI',
  LUNR: 'Intuitive Machines',
  ASTS: 'AST SpaceMobile',
  RKLB: 'Rocket Lab',
  PLUG: 'Plug Power',
  FCEL: 'FuelCell Energy',
  EOSE: null,
  OPEN: 'Opendoor',
  WULF: 'TeraWulf',
  APLD: null,
};

export const SUBREDDITS = ['wallstreetbets', 'pennystocks', 'Shortsqueeze'];

export const MAX_DAY_TRADES_PER_5_SESSIONS = 3;

export const MAX_CONVICTION_CALLS_PER_DAY = 50;

export const SHADOW_SLIPPAGE_PCT_PER_SIDE = 0.05;

export const MIN_ACTIVE_STRATEGIES = 3;

export const MAX_ACTIVE_STRATEGIES = 6;

export const PORT = Number(process.env.PORT) || 3000;
