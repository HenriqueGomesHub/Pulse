import { blockConditions, evaluate } from './engine.js';

const ALWAYS_MET = Object.freeze({ feature: 'hold_hours', op: 'gte', value: 0 });

const ALWAYS_MET_FEATURES = Object.freeze({ in_position: false, hold_hours: 0 });

const SUBSTANCE_GATES = {
  reddit: [
    { feature: 'mentions_1h', op: 'gte', value: 5 },
    { feature: 'unique_authors_1h', op: 'gte', value: 3 },
  ],
  apewisdom: [
    { feature: 'mentions_24h', op: 'gte', value: 25 },
    { feature: 'mention_growth_24h', op: 'gt', value: 0 },
  ],
};

export function canFireUnder(primaryMentionSource, params) {
  const unavailable = new Set(
    Object.entries(SUBSTANCE_GATES)
      .filter(([source]) => source !== primaryMentionSource)
      .flatMap(([, gates]) => gates.map((gate) => gate.feature))
  );
  const probe = blockConditions(params.entry).map((condition) =>
    unavailable.has(condition.feature) ? condition : ALWAYS_MET
  );
  const entry = params.entry.all ? { all: probe } : { any: probe };
  return evaluate({ entry }, ALWAYS_MET_FEATURES) !== null;
}

export function seedsFor(primaryMentionSource) {
  const substance = SUBSTANCE_GATES[primaryMentionSource];
  if (!substance) {
    throw new Error(`seeds: no absolute-substance gates defined for mention source "${primaryMentionSource}"`);
  }

  return [
    {
      name: 'social-breakout',
      generation: 0,
      status: 'active',
      params: {
        side: 'long',
        entry: {
          all: [
            { feature: 'mention_zscore', op: 'gt', value: 3 },
            { feature: 'social_accel', op: 'gt', value: 0 },
            { feature: 'rel_volume_zscore', op: 'gt', value: 2 },
            ...substance,
          ],
        },
        exit: {
          any: [
            { feature: 'exhaustion_score', op: 'gt', value: 0.7 },
            { feature: 'pnl_pct', op: 'lte', value: -8 },
            { feature: 'pnl_pct', op: 'gte', value: 15 },
            { feature: 'hold_hours', op: 'gte', value: 72 },
          ],
        },
      },
    },
    {
      name: 'squeeze-setup',
      generation: 0,
      status: 'candidate',
      params: {
        side: 'long',
        entry: {
          all: [
            { feature: 'days_to_cover', op: 'gt', value: 3 },
            { feature: 'mention_zscore', op: 'gt', value: 2 },
            { feature: 'price_momentum_1d', op: 'gt', value: 3 },
          ],
        },
        exit: {
          any: [
            { feature: 'exhaustion_score', op: 'gt', value: 0.7 },
            { feature: 'pnl_pct', op: 'lte', value: -10 },
            { feature: 'pnl_pct', op: 'gte', value: 25 },
            { feature: 'hold_hours', op: 'gte', value: 120 },
          ],
        },
      },
    },
    {
      name: 'quiet-accumulation',
      generation: 0,
      status: 'active',
      params: {
        side: 'long',
        entry: {
          all: [
            { feature: 'rel_volume_zscore', op: 'gt', value: 2 },
            { feature: 'price_momentum', op: 'gt', value: 1 },
            { feature: 'mention_zscore', op: 'lt', value: 1 },
          ],
        },
        exit: {
          any: [
            { feature: 'mention_zscore', op: 'gt', value: 3 },
            { feature: 'pnl_pct', op: 'lte', value: -6 },
            { feature: 'hold_hours', op: 'gte', value: 336 },
          ],
        },
      },
    },
    {
      name: 'fade-the-peak',
      generation: 0,
      status: 'candidate',
      params: {
        side: 'short',
        entry: {
          all: [
            { feature: 'exhaustion_score', op: 'gt', value: 0.9 },
            { feature: 'price_momentum_2d', op: 'gt', value: 30 },
          ],
        },
        exit: {
          any: [
            { feature: 'pnl_pct', op: 'gte', value: 10 },
            { feature: 'pnl_pct', op: 'lte', value: -8 },
            { feature: 'hold_hours', op: 'gte', value: 48 },
          ],
        },
      },
    },
  ];
}
