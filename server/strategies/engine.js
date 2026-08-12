const FEATURES = new Set([
  'social_velocity',
  'social_accel',
  'author_quality',
  'mention_zscore',
  'mentions_1h',
  'unique_authors_1h',
  'mentions_24h',
  'mention_growth_24h',
  'rel_volume_zscore',
  'price_momentum',
  'price_momentum_1d',
  'price_momentum_2d',
  'days_to_cover',
  'exhaustion_score',
  'pnl_pct',
  'hold_hours',
]);

const OPERATORS = {
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
};

export const VOCABULARY = Object.freeze({
  features: Object.freeze([...FEATURES]),
  operators: Object.freeze(Object.keys(OPERATORS)),
});

function isMet(condition, features) {
  if (!FEATURES.has(condition.feature)) {
    throw new Error(`engine: unsupported feature "${condition.feature}"`);
  }
  const operator = OPERATORS[condition.op];
  if (!operator) {
    throw new Error(`engine: unsupported operator "${condition.op}"`);
  }
  if (typeof condition.value !== 'number' || !Number.isFinite(condition.value)) {
    throw new Error(`engine: condition on "${condition.feature}" has a non-numeric value`);
  }

  const value = features[condition.feature];
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return operator(value, condition.value);
}

function blockConditions(block) {
  const conditions = block?.all ?? block?.any;
  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new Error('engine: condition block must be { all: [...] } or { any: [...] } with at least one condition');
  }
  return conditions;
}

function evaluateBlock(block, features) {
  const conditions = blockConditions(block);
  const met = conditions.filter((condition) => isMet(condition, features));
  if (block.all) return met.length === conditions.length ? met : null;
  return met.length > 0 ? met : null;
}

export function describeBlock(block, features) {
  const conditions = blockConditions(block);
  return {
    logic: block.all ? 'all' : 'any',
    conditions: conditions.map((condition) => ({
      feature: condition.feature,
      op: condition.op,
      value: condition.value,
      met: isMet(condition, features),
    })),
  };
}

export function evaluate(strategyParams, features) {
  const inPosition = features.in_position === true;
  const block = inPosition ? strategyParams.exit : strategyParams.entry;
  const met = evaluateBlock(block, features);
  if (met === null) return null;

  return {
    direction: inPosition ? 'exit' : 'entry',
    conditions_met: met,
  };
}
