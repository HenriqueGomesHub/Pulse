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

// BITF was dropped on 2026-09-18 by owner decision: delisted since week one, it produced 0
// market_snapshots rows in 37 days while still accumulating 2,289 social and 10,647 feature rows,
// and it occupied a 20th slot that every basket already measured over 19. Its tickers row and that
// history stay — 12,936 rows reference the symbol and deleting it would destroy a month of the tape
// to tidy a list. Removing it here is what stops the ingest workers, all of which iterate this
// constant; the surfaces that read `tickers` directly filter against it instead.
export const WATCHLIST = [
  'SOFI',
  'MARA',
  'RIOT',
  'CLSK',
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

// Raised from 0.05 on 2026-09-17, the review parked on 2026-08-26 and finally done. The evidence
// is 24 real entry fills and 20 real exit fills compared against the nearest 5-minute snapshot:
// median adverse 0.142% on the entry side and 0.158% on the exit, mean 0.116% and 0.341%. This
// takes the median rather than the mean, because one bad exit drags the mean and the median is
// what a typical fill costs. Caveat recorded with the number: snapshots are 5-minute bars, so part
// of the measured gap is intra-bar drift rather than spread, which makes 0.15 an upper bound on
// the true per-side cost and 0.05 too generous by roughly 3x either way. Historical shadow rows
// keep the constant they were priced under in shadow_trades.slippage_pct_per_side; /api/shadow
// restates them under this one so the two are comparable rather than silently mixed.
export const SHADOW_SLIPPAGE_PCT_PER_SIDE = 0.15;

export const MIN_ACTIVE_STRATEGIES = 3;

export const MAX_ACTIVE_STRATEGIES = 6;

export const PORT = Number(process.env.PORT) || 3000;
