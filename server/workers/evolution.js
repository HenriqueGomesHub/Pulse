import { pool } from '../db/pool.js';
import { callClaude } from '../services/claude.js';
import { VOCABULARY, evaluate } from '../strategies/engine.js';
import { statsRollup } from './statsRollup.js';

const EVOLUTION_MODEL = 'claude-sonnet-4-6';
const EVOLUTION_MAX_TOKENS = 2000;
const PROPOSALS = 4;
const MIN_CLOSED_TRADES = 10;
const MIN_QUALIFIERS = 2;
const MIN_ACTIVE_STRATEGIES = 3;
const MAX_ACTIVE_STRATEGIES = 6;
const HOLDOUT_DAYS = 30;
const RECENCY_WEIGHT_7D = 2;

const HOUR_MS = 60 * 60 * 1000;
const REPLAY_MAX_PRICE_AGE_MS = 24 * HOUR_MS;
const REPLAY_MAX_OPEN_TRADES = 5;
const REPLAY_MIN_PRICE = 1;
const REPLAY_MAX_PRICE = 50;
const REPLAY_MIN_AVG_VOLUME_30D = 500000;
const REPLAY_EXCHANGES = ['NYSE', 'NASDAQ', 'AMEX'];
const REPLAY_ENTRY_OPEN_MINUTES = 9 * 60 + 45;
const REPLAY_ENTRY_CLOSE_MINUTES = 15 * 60 + 45;
const REPLAY_SESSION_OPEN_MINUTES = 9 * 60 + 30;
const REPLAY_SESSION_CLOSE_MINUTES = 16 * 60;
const EXIT_STOP_OPERATORS = ['lte', 'lt'];
const EXIT_HOLD_OPERATORS = ['gte', 'gt'];

const POSITION_ONLY_FEATURES = new Set(['pnl_pct', 'hold_hours']);
const REPLAY_FEATURE_COLUMNS = VOCABULARY.features.filter((feature) => !POSITION_ONLY_FEATURES.has(feature));

const ACTIVE_STATS_SQL = `
  SELECT s.id::int AS id,
         s.name,
         s.generation,
         s.params,
         COALESCE(w7.trades_n, 0) AS trades_7d,
         w7.expectancy::float8 AS expectancy_7d,
         COALESCE(w30.trades_n, 0) AS trades_30d,
         w30.expectancy::float8 AS expectancy_30d,
         w30.win_rate::float8 AS win_rate_30d,
         w30.avg_win_pct::float8 AS avg_win_pct_30d,
         w30.avg_loss_pct::float8 AS avg_loss_pct_30d,
         w30.max_drawdown::float8 AS max_drawdown_30d,
         w30.sharpe_naive::float8 AS sharpe_naive_30d
  FROM strategies s
  LEFT JOIN strategy_stats w7 ON w7.strategy_id = s.id AND w7."window" = '7d'
  LEFT JOIN strategy_stats w30 ON w30.strategy_id = s.id AND w30."window" = '30d'
  WHERE s.status = 'active'
  ORDER BY s.id
`;

const TRADE_AGGREGATES_SQL = `
  SELECT strategy_id::int AS strategy_id,
         count(*)::int AS closed_trades,
         count(DISTINCT symbol)::int AS distinct_symbols,
         avg(hold_hours)::float8 AS avg_hold_hours,
         max(hold_hours)::float8 AS max_hold_hours,
         avg(trade_max_adverse_pct)::float8 AS avg_adverse_pct,
         max(trade_max_adverse_pct)::float8 AS worst_adverse_pct
  FROM trades
  WHERE status = 'closed'
    AND pnl_pct IS NOT NULL
    AND exit_ts > now() - make_interval(days => $1::int)
    AND strategy_id = ANY($2::bigint[])
  GROUP BY strategy_id
`;

const HOLDOUT_SYMBOLS_SQL = `
  SELECT symbol FROM tickers
  WHERE avg_volume_30d > $1 AND exchange = ANY($2::text[])
  ORDER BY symbol
`;

const HOLDOUT_FEATURES_SQL = `
  SELECT symbol, ts, ${REPLAY_FEATURE_COLUMNS.join(', ')}
  FROM features
  WHERE ts > now() - make_interval(days => $1::int) AND symbol = ANY($2::text[])
  ORDER BY ts, symbol
`;

const HOLDOUT_PRICES_SQL = `
  SELECT symbol, ts, price::float8 AS price
  FROM market_snapshots
  WHERE ts > now() - make_interval(days => $1::int + 1)
    AND price IS NOT NULL
    AND symbol = ANY($2::text[])
  ORDER BY symbol, ts
`;

const RETIRE_SQL = `
  WITH retired AS (
    UPDATE strategies SET status = 'retired' WHERE id = $1 AND status = 'active' RETURNING id
  )
  INSERT INTO evolution_log (ts, action, strategy_id, rationale, holdout_expectancy)
  SELECT now(), 'retire', id, $2, $3 FROM retired
  RETURNING strategy_id::int AS strategy_id
`;

const MUTATE_SQL = `
  WITH created AS (
    INSERT INTO strategies (name, generation, params, status, parent_id)
    VALUES ($1, $2, $3, 'candidate', $4) RETURNING id, parent_id
  )
  INSERT INTO evolution_log (ts, action, strategy_id, parent_id, rationale, holdout_expectancy)
  SELECT now(), 'mutate', id, parent_id, $5, $6 FROM created
  RETURNING strategy_id::int AS strategy_id
`;

const PROMOTE_SQL = `
  WITH promoted AS (
    UPDATE strategies SET status = 'active' WHERE id = $1 AND status = 'candidate' RETURNING id, parent_id
  )
  INSERT INTO evolution_log (ts, action, strategy_id, parent_id, rationale, holdout_expectancy)
  SELECT now(), 'promote', id, parent_id, $2, $3 FROM promoted
  RETURNING strategy_id::int AS strategy_id
`;

const CONDITION_SCHEMA = {
  type: 'object',
  properties: {
    feature: {
      type: 'string',
      enum: [...VOCABULARY.features],
      description:
        'pnl_pct and hold_hours are only observable while a position is open and belong in exit blocks only. rel_volume_zscore, price_momentum, price_momentum_1d, price_momentum_2d and days_to_cover currently carry live data. Mention counts come from exactly one source at a time: while that source is apewisdom, mentions_24h and mention_growth_24h carry data over a rolling 24-hour window and mentions_1h and unique_authors_1h are NULL; while it is reddit the reverse holds, over a 1-hour window. mention_zscore, social_velocity, social_accel and author_quality are NULL until social data flows, as is exhaustion_score, which is derived from them, and a NULL feature never satisfies a condition.',
    },
    op: { type: 'string', enum: [...VOCABULARY.operators] },
    value: { type: 'number', description: 'Threshold. Percentages are whole numbers: -8 means -8%.' },
  },
  required: ['feature', 'op', 'value'],
  additionalProperties: false,
};

const blockSchema = (description) => ({
  type: 'object',
  description,
  properties: {
    logic: {
      type: 'string',
      enum: ['all', 'any'],
      description: 'all = every condition must hold, any = one is enough.',
    },
    conditions: { type: 'array', minItems: 1, items: CONDITION_SCHEMA },
  },
  required: ['logic', 'conditions'],
  additionalProperties: false,
});

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      minItems: 1,
      description:
        'Exactly four entries: three mutations of the supplied strategies plus one novel combination that is not a mutation of either.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short lowercase hyphenated name, e.g. "social-breakout-tight-stop".' },
          kind: { type: 'string', enum: ['mutation', 'novel'] },
          parent: { type: 'string', description: 'Name of the supplied strategy this descends from.' },
          side: { type: 'string', enum: ['long', 'short'] },
          rationale: {
            type: 'string',
            description: 'One or two sentences on what in the supplied statistics motivates this change.',
          },
          entry: blockSchema('Conditions that open a position.'),
          exit: blockSchema(
            'Conditions that close it. Logic must be "any", and the conditions must include a stop (pnl_pct with lte or lt) and a time bound (hold_hours with gte or gt), or the proposal is rejected: an exit that cannot close a losing position holds it forever.'
          ),
        },
        required: ['name', 'kind', 'parent', 'side', 'rationale', 'entry', 'exit'],
        additionalProperties: false,
      },
    },
  },
  required: ['proposals'],
  additionalProperties: false,
};

const SESSION_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function num(value) {
  return value === null || value === undefined ? null : Number(value);
}

function sessionClock(time) {
  const parts = SESSION_FORMAT.formatToParts(new Date(time));
  const value = (type) => parts.find((part) => part.type === type).value;
  const weekday = value('weekday');
  return {
    weekend: weekday === 'Sat' || weekday === 'Sun',
    minutes: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

function toBlockShape(block) {
  const logic = block.all ? 'all' : 'any';
  return { logic, conditions: block[logic] };
}

function fromBlockShape(block) {
  return {
    [block.logic]: block.conditions.map((condition) => ({
      feature: condition.feature,
      op: condition.op,
      value: condition.value,
    })),
  };
}

function assertExitClosesLosers(exit) {
  if (exit.any === undefined) {
    throw new Error(
      'exit block uses "all" logic, so a loser closes only when every other exit condition is met at the same time — it must use "any"'
    );
  }
  const carries = (feature, operators) =>
    exit.any.some((condition) => condition.feature === feature && operators.includes(condition.op));
  if (!carries('pnl_pct', EXIT_STOP_OPERATORS)) {
    throw new Error(
      `exit block has no stop — it needs a pnl_pct condition with ${EXIT_STOP_OPERATORS.join(' or ')}, otherwise a losing position is never closed`
    );
  }
  if (!carries('hold_hours', EXIT_HOLD_OPERATORS)) {
    throw new Error(
      `exit block has no time bound — it needs a hold_hours condition with ${EXIT_HOLD_OPERATORS.join(' or ')}, otherwise a position that never hits a threshold is held forever`
    );
  }
}

export function paramsFromProposal(proposal) {
  try {
    const params = {
      side: proposal.side,
      entry: fromBlockShape(proposal.entry),
      exit: fromBlockShape(proposal.exit),
    };
    if (params.side !== 'long' && params.side !== 'short') {
      throw new Error(`side must be "long" or "short", got ${JSON.stringify(proposal.side)}`);
    }
    assertExitClosesLosers(params.exit);
    evaluate(params, { in_position: false });
    evaluate(params, { in_position: true });
    return params;
  } catch (error) {
    console.warn(`[evolution] REJECTED proposal ${JSON.stringify(proposal?.name)}: ${error.message}`);
    return null;
  }
}

function recencyWeighted(expectancy7d, expectancy30d) {
  if (expectancy30d === null) return null;
  if (expectancy7d === null) return expectancy30d;
  return (RECENCY_WEIGHT_7D * expectancy7d + expectancy30d) / (RECENCY_WEIGHT_7D + 1);
}

function expectancyOf(pnls) {
  if (pnls.length < MIN_CLOSED_TRADES) return null;
  const wins = pnls.filter((pnl) => pnl > 0);
  const losses = pnls.filter((pnl) => pnl <= 0);
  const mean = (values) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);
  return (wins.length / pnls.length) * mean(wins) + (losses.length / pnls.length) * mean(losses);
}

async function loadHoldout() {
  const symbols = (
    await pool.query(HOLDOUT_SYMBOLS_SQL, [REPLAY_MIN_AVG_VOLUME_30D, REPLAY_EXCHANGES])
  ).rows.map((row) => row.symbol);

  if (symbols.length === 0) return { symbols, ticks: [], priceSeries: new Map() };

  const [features, prices] = await Promise.all([
    pool.query(HOLDOUT_FEATURES_SQL, [HOLDOUT_DAYS, symbols]),
    pool.query(HOLDOUT_PRICES_SQL, [HOLDOUT_DAYS, symbols]),
  ]);

  const ticks = [];
  for (const row of features.rows) {
    const time = row.ts.getTime();
    if (ticks.length === 0 || ticks[ticks.length - 1].time !== time) ticks.push({ time, rows: [] });
    ticks[ticks.length - 1].rows.push(row);
  }

  const priceSeries = new Map();
  for (const row of prices.rows) {
    if (!priceSeries.has(row.symbol)) priceSeries.set(row.symbol, []);
    priceSeries.get(row.symbol).push({ time: row.ts.getTime(), price: row.price });
  }

  return { symbols, ticks, priceSeries };
}

function replayBag(row, extra) {
  const bag = {};
  for (const feature of REPLAY_FEATURE_COLUMNS) bag[feature] = num(row?.[feature]);
  return { ...bag, ...extra };
}

function replay(params, holdout) {
  const isShort = params.side === 'short';
  const cursors = new Map();
  const open = new Map();
  const pnls = [];

  const pointAt = (symbol, time) => {
    const series = holdout.priceSeries.get(symbol);
    if (series === undefined) return null;
    let index = cursors.get(symbol) ?? -1;
    while (index + 1 < series.length && series[index + 1].time <= time) index += 1;
    cursors.set(symbol, index);
    return index < 0 ? null : series[index];
  };

  const priceAt = (symbol, time) => {
    const point = pointAt(symbol, time);
    if (point === null) return null;
    return time - point.time > REPLAY_MAX_PRICE_AGE_MS ? null : point.price;
  };

  const pnlOf = (position, price) =>
    isShort
      ? ((position.entryPrice - price) / position.entryPrice) * 100
      : ((price - position.entryPrice) / position.entryPrice) * 100;

  for (const tick of holdout.ticks) {
    const clock = sessionClock(tick.time);
    if (clock.weekend) continue;

    const rowBySymbol = new Map(tick.rows.map((row) => [row.symbol, row]));
    const closedThisTick = new Set();
    const canExit =
      clock.minutes >= REPLAY_SESSION_OPEN_MINUTES && clock.minutes < REPLAY_SESSION_CLOSE_MINUTES;
    const canEnter =
      clock.minutes >= REPLAY_ENTRY_OPEN_MINUTES && clock.minutes < REPLAY_ENTRY_CLOSE_MINUTES;

    if (canExit) {
      for (const [symbol, position] of [...open]) {
        const price = priceAt(symbol, tick.time);
        if (price === null) continue;

        const pnlPct = pnlOf(position, price);
        const holdHours = (tick.time - position.entryTime) / HOUR_MS;
        const bag = replayBag(rowBySymbol.get(symbol), {
          in_position: true,
          pnl_pct: pnlPct,
          hold_hours: holdHours,
        });

        if (evaluate(params, bag) === null) continue;
        open.delete(symbol);
        closedThisTick.add(symbol);
        pnls.push(pnlPct);
      }
    }

    if (!canEnter) continue;

    for (const row of tick.rows) {
      if (open.size >= REPLAY_MAX_OPEN_TRADES) break;
      if (open.has(row.symbol) || closedThisTick.has(row.symbol)) continue;

      const price = priceAt(row.symbol, tick.time);
      if (price === null || price < REPLAY_MIN_PRICE || price > REPLAY_MAX_PRICE) continue;
      if (evaluate(params, replayBag(row, { in_position: false })) === null) continue;

      open.set(row.symbol, { entryPrice: price, entryTime: tick.time });
    }
  }

  const windowEnd = holdout.ticks[holdout.ticks.length - 1];
  for (const [symbol, position] of open) {
    const point = pointAt(symbol, windowEnd.time);
    if (point === null) {
      console.warn(
        `[evolution] replay: ${symbol} was still open when the holdout window ended and has no price to mark against, so this entry is missing from the result`
      );
      continue;
    }
    pnls.push(pnlOf(position, point.price));
  }

  return { trades_n: pnls.length, expectancy: expectancyOf(pnls) };
}

function uniqueName(raw, taken) {
  const base =
    String(raw ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'mutation';
  let name = base;
  let suffix = 2;
  while (taken.has(name)) {
    name = `${base}-${suffix}`;
    suffix += 1;
  }
  taken.add(name);
  return name;
}

async function proposalsFor(ranked, weakest, aggregates) {
  const brief = {
    objective:
      'Maximise expectancy = win_rate * avg_win_pct + loss_rate * avg_loss_pct (avg_loss_pct is signed negative) and keep max_drawdown small. Never optimise win rate.',
    vocabulary: { features: [...VOCABULARY.features], operators: [...VOCABULARY.operators] },
    strategy_to_replace: {
      name: weakest.name,
      expectancy_30d: weakest.expectancy_30d,
      recency_weighted_expectancy: weakest.score,
      note: 'Still active. It is retired only if one of your proposals beats its holdout expectancy and takes its place; if none does, nothing is retired this cycle.',
    },
    best_strategies: ranked.slice(0, 2).map((strategy) => ({
      rank: strategy.rank,
      name: strategy.name,
      generation: strategy.generation,
      is_strategy_to_replace: strategy.id === weakest.id,
      side: strategy.params.side,
      entry: toBlockShape(strategy.params.entry),
      exit: toBlockShape(strategy.params.exit),
      aggregate_stats_30d: {
        closed_trades: strategy.trades_30d,
        win_rate: strategy.win_rate_30d,
        avg_win_pct: strategy.avg_win_pct_30d,
        avg_loss_pct: strategy.avg_loss_pct_30d,
        expectancy: strategy.expectancy_30d,
        max_drawdown: strategy.max_drawdown_30d,
        sharpe_naive: strategy.sharpe_naive_30d,
        ...(aggregates.get(strategy.id) ?? {}),
      },
      aggregate_stats_7d: { closed_trades: strategy.trades_7d, expectancy: strategy.expectancy_7d },
    })),
  };

  console.log(
    `[evolution] one ${EVOLUTION_MODEL} call with aggregate stats for ${brief.best_strategies.length} strategies, no trade rows`
  );

  return callClaude(
    `Propose ${PROPOSALS - 1} parameter mutations of these strategies and 1 novel parameter combination.\n${JSON.stringify(brief)}`,
    PROPOSAL_SCHEMA,
    { model: EVOLUTION_MODEL, maxTokens: EVOLUTION_MAX_TOKENS }
  );
}

async function swap(retire, promote) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const retired = await client.query(RETIRE_SQL, [retire.id, retire.rationale, retire.expectancy]);
    if (retired.rowCount === 0) {
      throw new Error(`evolution: strategy ${retire.id} (${retire.name}) was not active at retirement time`);
    }
    const promoted = await client.query(PROMOTE_SQL, [promote.id, promote.rationale, promote.expectancy]);
    if (promoted.rowCount === 0) {
      throw new Error(`evolution: strategy ${promote.id} (${promote.name}) was not a candidate at promotion time`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function evolution() {
  await statsRollup();

  const active = (await pool.query(ACTIVE_STATS_SQL)).rows;
  const ranked = active
    .map((strategy) => ({ ...strategy, score: recencyWeighted(strategy.expectancy_7d, strategy.expectancy_30d) }))
    .filter((strategy) => strategy.trades_30d >= MIN_CLOSED_TRADES && strategy.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((strategy, index) => ({ ...strategy, rank: index + 1 }));

  console.log(
    `[evolution] ${active.length} active strategies, closed trades in 30d: ${
      active.map((s) => `${s.name}=${s.trades_30d}`).join(', ') || 'none'
    }`
  );

  if (ranked.length < MIN_QUALIFIERS) {
    console.log(
      `[evolution] ${ranked.length} of ${active.length} strategies clear the ${MIN_CLOSED_TRADES}-closed-trade minimum, fewer than the ${MIN_QUALIFIERS} needed to rank a worst against a best. Nothing retired, nothing proposed, no evolution_log rows written — every strategy gets another week.`
    );
    return;
  }

  const worst = ranked[ranked.length - 1];
  const retirementAllowed = active.length - 1 >= MIN_ACTIVE_STRATEGIES;
  const holdout = await loadHoldout();
  console.log(
    `[evolution] holdout window ${HOLDOUT_DAYS}d: ${holdout.ticks.length} feature ticks over ${holdout.symbols.length} eligible symbols`
  );

  const baseline = replay(worst.params, holdout);
  const baselineText = baseline.expectancy === null ? 'NULL' : baseline.expectancy.toFixed(4);
  const standing =
    `Ranked ${worst.rank} of ${ranked.length} qualifiers on recency-weighted expectancy ` +
    `${worst.score.toFixed(4)} (30d ${worst.expectancy_30d.toFixed(4)} over ${worst.trades_30d} closed trades, ` +
    `7d ${worst.expectancy_7d === null ? 'no trades' : worst.expectancy_7d.toFixed(4)} over ${worst.trades_7d}). ` +
    `Holdout replay over the last ${HOLDOUT_DAYS} days closed ${baseline.trades_n} trades, expectancy ` +
    `${baselineText}${baseline.expectancy === null ? ' (too few replayed trades to measure)' : ''}.`;

  console.log(
    `[evolution] ${worst.name} (id ${worst.id}) is the strategy a candidate must beat and would replace. ${standing} ` +
      (retirementAllowed
        ? `It is retired only if a long candidate beats that holdout expectancy and takes its place in the same transaction.`
        : `The active set is ${active.length}, so removing it would leave ${active.length - 1}, below the floor of ${MIN_ACTIVE_STRATEGIES}: NOTHING is retired this cycle whatever the candidates do, and a winning candidate is promoted as an addition instead.`)
  );

  const aggregates = new Map(
    (await pool.query(TRADE_AGGREGATES_SQL, [HOLDOUT_DAYS, ranked.slice(0, 2).map((s) => s.id)])).rows.map(
      ({ strategy_id: id, ...stats }) => [id, stats]
    )
  );

  const verdict = await proposalsFor(ranked, worst, aggregates);
  if (verdict === null) {
    console.warn(
      `[evolution] SKIPPED CYCLE: ${EVOLUTION_MODEL} returned nothing usable, so no candidate exists to replace ${worst.name}. Nothing retired, nothing promoted, no evolution_log rows written — the active set stays at ${active.length}.`
    );
    return;
  }

  if (verdict.proposals.length !== PROPOSALS) {
    console.warn(
      `[evolution] ${EVOLUTION_MODEL} returned ${verdict.proposals.length} proposals, not the ${PROPOSALS} asked for; validating what came back`
    );
  }

  const byName = new Map(active.map((strategy) => [strategy.name, strategy]));
  const taken = new Set((await pool.query('SELECT name FROM strategies')).rows.map((row) => row.name));
  const created = [];

  for (const proposal of verdict.proposals) {
    const params = paramsFromProposal(proposal);
    if (params === null) continue;

    const parent = byName.get(proposal.parent) ?? ranked[0];
    const result = replay(params, holdout);
    const name = uniqueName(proposal.name, taken);
    const rationale =
      `${proposal.kind === 'novel' ? 'Novel combination' : 'Mutation'} of ${parent.name}: ${proposal.rationale} ` +
      `Holdout replay closed ${result.trades_n} trades over the last ${HOLDOUT_DAYS} days, expectancy ` +
      `${result.expectancy === null ? `NULL (fewer than ${MIN_CLOSED_TRADES} replayed trades, so it is unknown rather than bad)` : result.expectancy.toFixed(4)}` +
      `, against the ${worst.name} it would replace, whose holdout expectancy over the same tape is ${baselineText}.` +
      (params.side === 'short'
        ? ' Short side: the evolution loop cannot promote it, so it stays a candidate until a human activates it, and it therefore cannot replace or retire anything.'
        : '');

    const { strategy_id: id } = (
      await pool.query(MUTATE_SQL, [
        name,
        parent.generation + 1,
        params,
        parent.id,
        rationale,
        result.expectancy,
      ])
    ).rows[0];

    created.push({ id, name, parent, params, result });
    console.log(
      `[evolution] MUTATE ${name} (id ${id}, generation ${parent.generation + 1}, parent ${parent.name}): holdout ${result.trades_n} trades, expectancy ${result.expectancy === null ? 'NULL' : result.expectancy.toFixed(4)}`
    );
  }

  if (baseline.expectancy === null) {
    console.warn(
      `[evolution] SKIPPED CYCLE: ${worst.name} closed only ${baseline.trades_n} trades in the holdout replay, so its holdout expectancy is NULL and no candidate can be shown to beat it. ${created.length} candidates recorded, NONE promoted, NOTHING retired — the active set stays at ${active.length}.`
    );
    return;
  }

  let activeCount = active.length;
  let retirementPending = retirementAllowed;
  let replacement = null;
  let promoted = 0;

  for (const candidate of [...created].sort((a, b) => (b.result.expectancy ?? -Infinity) - (a.result.expectancy ?? -Infinity))) {
    if (candidate.result.expectancy === null) {
      console.log(
        `[evolution] ${candidate.name} not promoted: holdout expectancy is NULL (${candidate.result.trades_n} replayed trades, fewer than ${MIN_CLOSED_TRADES}). Unknown is not better, so it stays a candidate.`
      );
      continue;
    }
    if (candidate.result.expectancy <= baseline.expectancy) {
      console.log(
        `[evolution] ${candidate.name} not promoted: holdout expectancy ${candidate.result.expectancy.toFixed(4)} does not beat ${worst.name}'s ${baseline.expectancy.toFixed(4)}, so it has not earned the right to replace it.`
      );
      continue;
    }
    if (candidate.params.side === 'short') {
      console.warn(
        `[evolution] ${candidate.name} (id ${candidate.id}) beat ${worst.name}'s ${baseline.expectancy.toFixed(4)} with holdout expectancy ${candidate.result.expectancy.toFixed(4)} but is NOT promoted: it is a short, and a short reaches live trading only when a human activates it. It stays a candidate, where seed #4 fade-the-peak also sits — there is no borrow check anywhere, a rejected short sell throws out of strategyRunner's loop and kills the rest of that tick, and the short path has never executed against the live broker. Because it is not promoted it takes nobody's place, so it does NOT retire ${worst.name}${retirementPending ? ', whose retirement stays available to a long candidate in this cycle' : ''}.`
      );
      continue;
    }
    if (!retirementPending && activeCount >= MAX_ACTIVE_STRATEGIES) {
      console.log(
        `[evolution] ${candidate.name} not promoted: it would be an addition rather than a replacement and the active set is already at the cap of ${MAX_ACTIVE_STRATEGIES}.`
      );
      continue;
    }

    const edge =
      `Holdout expectancy ${candidate.result.expectancy.toFixed(4)} over ${candidate.result.trades_n} replayed trades ` +
      `beats ${worst.name}'s ${baseline.expectancy.toFixed(4)} over ${baseline.trades_n} on the same holdout tape.`;

    if (retirementPending) {
      await swap(
        {
          id: worst.id,
          name: worst.name,
          rationale: `Replaced by ${candidate.name} (id ${candidate.id}), promoted in the same transaction. ${standing} The replacement scored ${candidate.result.expectancy.toFixed(4)} over ${candidate.result.trades_n} replayed trades on that same tape.`,
          expectancy: baseline.expectancy,
        },
        {
          id: candidate.id,
          name: candidate.name,
          rationale: `${edge} Promoted in place of ${worst.name}, which is retired in the same transaction. Active strategies ${activeCount} of ${MAX_ACTIVE_STRATEGIES}, unchanged by the swap.`,
          expectancy: candidate.result.expectancy,
        }
      );
      retirementPending = false;
      replacement = candidate;
      console.log(
        `[evolution] SWAPPED ${worst.name} (id ${worst.id}) → ${candidate.name} (id ${candidate.id}): retirement and promotion committed together, active strategies still ${activeCount} of ${MAX_ACTIVE_STRATEGIES}`
      );
    } else {
      const rationale =
        `${edge} Promoted as an addition rather than a replacement: ` +
        `${replacement === null ? `removing ${worst.name} would take the active set of ${active.length} below the floor of ${MIN_ACTIVE_STRATEGIES}, so nothing is retired this cycle` : `${worst.name}'s place was already taken by ${replacement.name}`}. ` +
        `Active strategies ${activeCount} of ${MAX_ACTIVE_STRATEGIES} before promotion.`;
      const { rowCount } = await pool.query(PROMOTE_SQL, [candidate.id, rationale, candidate.result.expectancy]);
      if (rowCount === 0) {
        throw new Error(`evolution: strategy ${candidate.id} (${candidate.name}) was not a candidate at promotion time`);
      }
      activeCount += 1;
      console.log(`[evolution] PROMOTED ${candidate.name} (id ${candidate.id}) — ${rationale}`);
    }
    promoted += 1;
  }

  if (replacement === null) {
    console.warn(
      retirementAllowed
        ? `[evolution] SKIPPED CYCLE: no long candidate beat ${worst.name}'s holdout expectancy ${baseline.expectancy.toFixed(4)}, so it stays active and NOTHING was retired. A strategy leaves only when a validated replacement takes its place.`
        : `[evolution] no retirement this cycle: the active set of ${active.length} is at the floor of ${MIN_ACTIVE_STRATEGIES}, so ${worst.name} stays whatever the candidates score and the loop can only grow.`
    );
  }

  console.log(
    `[evolution] cycle complete: ${replacement === null ? 'nothing retired' : `swapped ${worst.name} → ${replacement.name}`}, ${created.length} candidates recorded, ${promoted} promoted, ${activeCount} active strategies`
  );
}
