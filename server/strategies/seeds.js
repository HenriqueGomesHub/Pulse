export const SEEDS = [
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
          { feature: 'mentions_1h', op: 'gte', value: 5 },
          { feature: 'unique_authors_1h', op: 'gte', value: 3 },
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
        all: [{ feature: 'mention_zscore', op: 'gt', value: 2 }],
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
        all: [{ feature: 'exhaustion_score', op: 'gt', value: 0.9 }],
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
