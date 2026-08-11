import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate } from './engine.js';
import { SEEDS } from './seeds.js';

const socialBreakout = SEEDS.find((seed) => seed.name === 'social-breakout').params;

const NO_FEATURES = {
  social_velocity: null,
  social_accel: null,
  author_quality: null,
  mention_zscore: null,
  mentions_1h: null,
  unique_authors_1h: null,
  rel_volume_zscore: null,
  price_momentum: null,
  exhaustion_score: null,
};

const ENTRY_MET = {
  ...NO_FEATURES,
  in_position: false,
  mention_zscore: 3.4,
  social_accel: 0.2,
  rel_volume_zscore: 2.5,
  mentions_1h: 9,
  unique_authors_1h: 6,
};

test('entry: all conditions met returns an entry signal listing every matched condition', () => {
  const signal = evaluate(socialBreakout, ENTRY_MET);
  assert.equal(signal.direction, 'entry');
  assert.deepEqual(
    signal.conditions_met.map((condition) => condition.feature),
    ['mention_zscore', 'social_accel', 'rel_volume_zscore', 'mentions_1h', 'unique_authors_1h']
  );
});

test('entry: a value exactly on the threshold does not satisfy gt', () => {
  assert.equal(evaluate(socialBreakout, { ...ENTRY_MET, mention_zscore: 3 }), null);
});

test('entry: one unmet condition suppresses the signal', () => {
  assert.equal(evaluate(socialBreakout, { ...ENTRY_MET, rel_volume_zscore: 1.9 }), null);
});

test('entry: a NULL feature counts as not met, never as a numeric comparison', () => {
  assert.equal(evaluate(socialBreakout, { ...ENTRY_MET, social_accel: null }), null);
  assert.equal(evaluate(socialBreakout, { ...ENTRY_MET, mention_zscore: null }), null);
  assert.equal(evaluate(socialBreakout, { ...ENTRY_MET, rel_volume_zscore: null }), null);
});

test('entry: an absent feature key behaves the same as NULL', () => {
  const { social_accel, ...withoutAccel } = ENTRY_MET;
  assert.equal(evaluate(socialBreakout, withoutAccel), null);
});

test('entry: all-NULL features (no social data at all) produce no signal', () => {
  assert.equal(evaluate(socialBreakout, { ...NO_FEATURES, in_position: false }), null);
});

test('entry: NaN is treated as missing, not compared numerically', () => {
  assert.equal(evaluate(socialBreakout, { ...ENTRY_MET, mention_zscore: NaN }), null);
});

test('exit: stop loss fires at -8%', () => {
  const signal = evaluate(socialBreakout, { ...NO_FEATURES, in_position: true, pnl_pct: -8, hold_hours: 2 });
  assert.equal(signal.direction, 'exit');
  assert.deepEqual(signal.conditions_met, [{ feature: 'pnl_pct', op: 'lte', value: -8 }]);
});

test('exit: profit target fires at +15%', () => {
  const signal = evaluate(socialBreakout, { ...NO_FEATURES, in_position: true, pnl_pct: 16.2, hold_hours: 2 });
  assert.equal(signal.direction, 'exit');
  assert.deepEqual(signal.conditions_met, [{ feature: 'pnl_pct', op: 'gte', value: 15 }]);
});

test('exit: max hold fires at 72 hours', () => {
  const signal = evaluate(socialBreakout, { ...NO_FEATURES, in_position: true, pnl_pct: 1, hold_hours: 72 });
  assert.equal(signal.direction, 'exit');
  assert.deepEqual(signal.conditions_met, [{ feature: 'hold_hours', op: 'gte', value: 72 }]);
});

test('exit: exhaustion fires above the threshold', () => {
  const signal = evaluate(socialBreakout, {
    ...NO_FEATURES,
    in_position: true,
    exhaustion_score: 0.75,
    pnl_pct: 3,
    hold_hours: 4,
  });
  assert.equal(signal.direction, 'exit');
  assert.deepEqual(signal.conditions_met, [{ feature: 'exhaustion_score', op: 'gt', value: 0.7 }]);
});

test('exit: an open trade inside every threshold stays open', () => {
  assert.equal(
    evaluate(socialBreakout, { ...NO_FEATURES, in_position: true, pnl_pct: 2.5, hold_hours: 10 }),
    null
  );
});

test('exit: a NULL exhaustion_score does not block the other OR branches', () => {
  const signal = evaluate(socialBreakout, {
    ...NO_FEATURES,
    in_position: true,
    exhaustion_score: null,
    pnl_pct: -9,
    hold_hours: 1,
  });
  assert.equal(signal.direction, 'exit');
  assert.deepEqual(signal.conditions_met, [{ feature: 'pnl_pct', op: 'lte', value: -8 }]);
});

test('exit: every OR branch NULL means no exit', () => {
  assert.equal(evaluate(socialBreakout, { ...NO_FEATURES, in_position: true }), null);
});

test('exit: several branches met are all reported', () => {
  const signal = evaluate(socialBreakout, {
    ...NO_FEATURES,
    in_position: true,
    exhaustion_score: 1,
    pnl_pct: -20,
    hold_hours: 100,
  });
  assert.equal(signal.conditions_met.length, 3);
});

test('in_position selects the exit block, its absence selects the entry block', () => {
  assert.equal(evaluate(socialBreakout, { ...ENTRY_MET, in_position: true }), null);
  assert.equal(evaluate(socialBreakout, { ...ENTRY_MET, in_position: false }).direction, 'entry');
  assert.equal(evaluate(socialBreakout, { ...ENTRY_MET }).direction, 'entry');
});

test('all four comparison operators are supported', () => {
  const features = { in_position: false, price_momentum: 5 };
  const cases = [
    ['gt', 4, true],
    ['gt', 5, false],
    ['gte', 5, true],
    ['lt', 6, true],
    ['lt', 5, false],
    ['lte', 5, true],
  ];
  for (const [op, value, expected] of cases) {
    const params = { entry: { all: [{ feature: 'price_momentum', op, value }] } };
    assert.equal(evaluate(params, features) !== null, expected, `${op} ${value}`);
  }
});

test('params outside the supported vocabulary throw rather than silently never firing', () => {
  assert.throws(
    () => evaluate({ entry: { all: [{ feature: 'short_interest_pct', op: 'gt', value: 15 }] } }, { in_position: false }),
    /unsupported feature/
  );
  assert.throws(
    () => evaluate({ entry: { all: [{ feature: 'price_momentum', op: 'eq', value: 1 }] } }, { in_position: false }),
    /unsupported operator/
  );
  assert.throws(
    () => evaluate({ entry: { all: [{ feature: 'price_momentum', op: 'gt', value: '1' }] } }, { in_position: false }),
    /non-numeric value/
  );
  assert.throws(() => evaluate({ entry: {} }, { in_position: false }), /condition block/);
  assert.throws(() => evaluate({ entry: { all: [] } }, { in_position: false }), /condition block/);
});

test('evaluate is pure: it does not mutate its arguments', () => {
  const params = JSON.parse(JSON.stringify(socialBreakout));
  const features = { ...ENTRY_MET };
  evaluate(params, features);
  assert.deepEqual(params, socialBreakout);
  assert.deepEqual(features, ENTRY_MET);
});
