// Phases B and C add an instrument by appending one entry here. Nothing counts instruments by
// hand, so no formula changes when the roster grows. The threshold is a measurement threshold,
// not a trading gate — no strategy can read these features, and none of them is in engine.js's
// VOCABULARY.
export const ATTENTION_INSTRUMENTS = Object.freeze([
  Object.freeze({ name: 'mentions', zscoreFeature: 'mention_zscore', elevatedAbove: 2 }),
  Object.freeze({ name: 'wikipedia', zscoreFeature: 'wiki_views_zscore', elevatedAbove: 2 }),
]);

// Breadth is NULL rather than 0/0 when no instrument has a baseline: "measured, nothing elevated"
// and "nothing was measured" are different facts and must not render the same.
export function attentionBreadth(zscores) {
  // Registering an instrument without supplying its z-score would quietly shrink the denominator
  // — the same silent-omission shape as the replay's feature list before it was derived from
  // VOCABULARY. Fail loudly instead; only a registration mistake can trigger it, never data.
  const unsupplied = ATTENTION_INSTRUMENTS.filter(
    (instrument) => !(instrument.zscoreFeature in zscores)
  );
  if (unsupplied.length > 0) {
    throw new Error(
      `attentionBreadth: registered instruments supplied no z-score: ${unsupplied.map((i) => i.name).join(', ')}`
    );
  }

  const eligible = ATTENTION_INSTRUMENTS.filter(
    (instrument) => typeof zscores[instrument.zscoreFeature] === 'number'
  );
  if (eligible.length === 0) return { breadth: null, of: null };

  const elevated = eligible.filter(
    (instrument) => zscores[instrument.zscoreFeature] > instrument.elevatedAbove
  );
  return { breadth: elevated.length, of: eligible.length };
}
