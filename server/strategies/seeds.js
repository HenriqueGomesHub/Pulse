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
      // Born candidate on 2026-08-11 because two of its three entry conditions were inexpressible;
      // active by owner decision on 2026-09-17, once both had landed and a replay showed 439 full
      // fires in 31 days. This is the birth value only — migration 014 is what moved the row that
      // already existed, and the evolution_log 'activate' row there is the record of the decision.
      status: 'active',
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
            // v2, not v1, since 2026-09-18. rel_volume_zscore was substantially a clock: its mean
            // swung 1.19 across position-in-hour on evenly distributed ticks and 108 of this
            // strategy's 115 entry signals landed in the two high buckets. Correcting a broken
            // instrument is not a thesis change -- the thesis is still "unusual volume with
            // momentum and no crowd" and every threshold is unchanged. v1 keeps its own meaning and
            // its own column; nothing may gate on both.
            { feature: 'rel_volume_zscore_v2', op: 'gt', value: 2 },
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
            // Recalibrated from 30 on 2026-09-17 against 32,860 entry-window feature ticks over the
            // preceding 31 days. +30% in two days sat above the 99.9th percentile of that tape and
            // 0.14 pp under its observed maximum of 30.14: it fired once, ever. +10% is the
            // 95th percentile (1,726 ticks, 5.25%), which is what "ran up hard" means on this
            // universe. It does not revive the seed, and is not meant to — see the BUILD_LOG entry:
            // exhaustion_score is the mean of four booleans, so > 0.9 means all four, which
            // happened on 16 of those ticks, and the two legs are independent (corr 0.017). Their
            // joint rate is the product of two rare events either way.
            { feature: 'price_momentum_2d', op: 'gt', value: 10 },
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
