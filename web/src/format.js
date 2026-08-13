const MINUS = '−';

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const withSign = (text, negative) => (negative ? MINUS + text : text);

export function num(value, digits = 2) {
  return withSign(Math.abs(value).toFixed(digits), value < 0);
}

function signedNum(value, digits = 2) {
  if (value === 0) return value.toFixed(digits);
  return (value > 0 ? '+' : MINUS) + Math.abs(value).toFixed(digits);
}

export function pct(value, digits = 2) {
  return num(value, digits) + '%';
}

export function signedPct(value, digits = 2) {
  return signedNum(value, digits) + '%';
}

export function ratioAsPct(value, digits = 1) {
  return (value * 100).toFixed(digits) + '%';
}

export function price(value) {
  return num(value, 2);
}

export function qty(value) {
  return num(value, 0);
}

const trimZero = (text) => (text.endsWith('.0') ? text.slice(0, -2) : text);

export function duration(hours) {
  const abs = Math.abs(hours);
  if (abs < 1 / 60) return Math.round(abs * 3600) + 's';
  if (abs < 1) return Math.round(abs * 60) + 'm';
  if (abs < 48) return trimZero(abs.toFixed(abs < 10 ? 1 : 0)) + 'h';
  return trimZero((abs / 24).toFixed(1)) + 'd';
}

const SESSION_ZONE = 'America/New_York';

const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: SESSION_ZONE,
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

const timeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: SESSION_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

export function stamp(value) {
  return dateTimeFormat.format(new Date(value));
}

export function clock(value) {
  return timeFormat.format(new Date(value));
}

export function ago(iso, now = Date.now()) {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  return Math.floor(seconds / 86400) + 'd';
}

export function pnlTone(value) {
  if (!isNum(value) || value === 0) return null;
  return value > 0 ? 'pos' : 'neg';
}

const FEATURE_LABELS = {
  social_velocity: 'Social velocity',
  social_accel: 'Social acceleration',
  author_quality: 'Author quality',
  mention_zscore: 'Mention z-score',
  mentions_1h: 'Mentions (1h)',
  unique_authors_1h: 'Unique authors (1h)',
  rel_volume_zscore: 'Relative volume z-score',
  price_momentum: 'Price momentum',
  exhaustion_score: 'Exhaustion score',
  pnl_pct: 'PnL',
  hold_hours: 'Hold time',
};

const OP_WORDS = {
  gt: 'above',
  gte: 'at least',
  lt: 'below',
  lte: 'at most',
};

const featureLabel = (feature) => FEATURE_LABELS[feature] ?? feature;

export function featureValue(feature, value) {
  if (!isNum(value)) return null;
  if (feature === 'pnl_pct') return signedPct(value);
  if (feature === 'hold_hours') return duration(value);
  if (feature === 'mentions_1h' || feature === 'unique_authors_1h') return num(value, 0);
  return num(value, 2);
}

function threshold(feature, value) {
  const magnitude = String(Math.abs(value));
  if (feature === 'pnl_pct') return (value < 0 ? MINUS : '+') + magnitude + '%';
  if (feature === 'hold_hours') return duration(value);
  return (value < 0 ? MINUS : '') + magnitude;
}

export function conditionLabel({ feature, op }) {
  return `${featureLabel(feature)} ${OP_WORDS[op] ?? op}`;
}

export function conditionThreshold({ feature, value }) {
  return threshold(feature, value);
}

const EXIT_LEG_NAMES = {
  pnl_pct_down: 'stop',
  pnl_pct_up: 'target',
  hold_hours: 'max hold',
  exhaustion_score: 'exhaustion',
};

// The name a trader would give this exit leg. Falls back to the feature's own
// label so an evolved strategy gating on something new still reads sensibly.
export function legName(condition) {
  if (condition.feature === 'pnl_pct') {
    return EXIT_LEG_NAMES[condition.op === 'lte' || condition.op === 'lt' ? 'pnl_pct_down' : 'pnl_pct_up'];
  }
  return EXIT_LEG_NAMES[condition.feature] ?? featureLabel(condition.feature).toLowerCase();
}

// How far this leg has travelled toward firing, 0..1. Every exit leg in this
// system is anchored at zero — PnL from the entry, hours from the fill,
// exhaustion from a floor of 0 — so the threshold is the whole distance.
// A threshold of 0 has no distance to measure: null, not a full bar.
export function legProgress(current, thresholdValue) {
  if (!isNum(current) || !isNum(thresholdValue) || thresholdValue === 0) return null;
  return Math.min(1, Math.max(0, current / thresholdValue));
}

export const maxHoldLeg = (conditions) =>
  conditions.find(
    (condition) => condition.feature === 'hold_hours' && (condition.op === 'gte' || condition.op === 'gt')
  ) ?? null;

const TERM_LADDER = [
  [24, 'intraday'],
  [72, 'short swing'],
  [168, 'multi-day'],
  [336, 'multi-week'],
];

// Derived label only — the max-hold threshold itself is unchanged and shown beside it.
export function termLabel(hours) {
  if (!isNum(hours)) return null;
  const step = TERM_LADDER.find(([limit]) => hours <= limit);
  return step ? step[1] : 'position';
}

export function gatesLabel(met, total) {
  return `${met}/${total}`;
}
