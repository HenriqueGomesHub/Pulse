export const SEEDS = [
  {
    name: 'social-breakout',
    generation: 0,
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
];
