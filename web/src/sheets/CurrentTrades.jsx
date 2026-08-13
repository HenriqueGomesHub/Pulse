import {
  Briefcase,
  Check,
  CircleDashed,
  Clock,
  DollarSign,
  EyeOff,
  Hash,
  ListChecks,
  LogIn,
  TrendingDown,
} from 'lucide-react';
import { usePoll } from '../api.js';
import Sheet from '../Sheet.jsx';
import { RailBlock, RailLine, RailNote } from '../Rail.jsx';
import { useRail } from '../railContext.jsx';
import { useStore } from '../store.jsx';
import { Empty, ErrorBanner, InlineNum, NoData, Num, Pill, Section, Stat } from '../ui.jsx';
import {
  conditionThreshold,
  duration,
  featureValue,
  isNum,
  legName,
  legProgress,
  maxHoldLeg,
  num,
  pct,
  pnlTone,
  price,
  qty,
  signedPct,
  stamp,
  termLabel,
} from '../format.js';

const BLOCKED_BY = { pdt_budget: 'PDT budget', max_concurrent: 'Max concurrent' };
const blockedLabel = (key) => BLOCKED_BY[key] ?? key;

function Meter({ value }) {
  if (value === null) {
    return <span className="meter meter--none" aria-hidden="true" />;
  }
  return (
    <span className="meter" aria-hidden="true">
      <span className="meter-fill" style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

function legDetail(condition) {
  const isMaxHold = condition.feature === 'hold_hours' && (condition.op === 'gte' || condition.op === 'gt');

  if (isMaxHold) {
    if (!isNum(condition.current)) {
      return { text: null, reason: 'no hold time recorded' };
    }
    const remaining = condition.value - condition.current;
    // Hours on both sides of "of": duration() rolls 72 into "3d", which reads as a
    // different quantity from the threshold the strategy actually carries.
    const limit = `${num(condition.value, 0)}h`;
    return {
      text: remaining > 0 ? `${duration(remaining)} remaining of ${limit}` : `past ${limit}`,
    };
  }

  if (!isNum(condition.current)) {
    return { text: null, reason: 'feature not computed' };
  }
  return {
    text: `${featureValue(condition.feature, condition.current)} of ${conditionThreshold(condition)}`,
  };
}

function Leg({ condition }) {
  const detail = legDetail(condition);
  const Icon = condition.met ? Check : CircleDashed;

  return (
    <li className="leg">
      <span className="leg-name">{legName(condition)}</span>
      <span className="leg-detail">
        {detail.text ? <span className="num">{detail.text}</span> : <NoData reason={detail.reason} />}
      </span>
      <Meter value={legProgress(condition.current, condition.value)} />
      <span className="flag leg-state">
        <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
        {condition.met ? 'met' : 'not met'}
      </span>
    </li>
  );
}

function HoldingPlan({ trade }) {
  if (trade.exit_error) {
    return (
      <div className="plan">
        <p className="plan-head">
          <ListChecks size={16} strokeWidth={1.5} aria-hidden="true" />
          Holding plan
        </p>
        <p className="hint">Not evaluated — {trade.exit_error}</p>
      </div>
    );
  }

  const hold = maxHoldLeg(trade.exit_conditions);
  const term = hold ? termLabel(hold.value) : null;

  return (
    <div className="plan">
      <p className="plan-head">
        <ListChecks size={16} strokeWidth={1.5} aria-hidden="true" />
        Holding plan
        {term ? <span className="term">{term}</span> : null}
      </p>
      <p className="plan-note">
        {trade.exit_logic === 'all'
          ? 'It closes only when every leg below is met.'
          : 'It closes as soon as any one leg below is met.'}
      </p>
      <ul className="legs">
        {trade.exit_conditions.map((condition, index) => (
          <Leg key={`${condition.feature}-${condition.op}-${index}`} condition={condition} />
        ))}
      </ul>
      {hold ? null : (
        <p className="caveat">
          This strategy has no max-hold leg, so there is no intended term — it exits only on the
          conditions above.
        </p>
      )}
    </div>
  );
}

function Position({ trade, shadow }) {
  return (
    <section className={shadow ? 'panel position position--shadow' : 'panel position'}>
      <div className="panel-head">
        <h2>
          <span className="sym">{trade.symbol}</span> · {trade.strategy_name}
        </h2>
        <span className="pill-row">
          <Pill tone="gray">{trade.side === 'short' ? 'Short' : 'Long'}</Pill>
          {shadow ? (
            <Pill tone="gray">
              <EyeOff size={12} strokeWidth={1.5} aria-hidden="true" />
              Shadow
            </Pill>
          ) : (
            <Pill tone="blue">Real</Pill>
          )}
        </span>
      </div>

      {shadow ? (
        <p className="caveat">
          Counterfactual — {blockedLabel(trade.blocked_by)} refused this entry, so no order was ever
          sent. It counts toward no budget and no strategy statistic.
        </p>
      ) : null}

      <dl className="stats">
        <Stat icon={DollarSign} label="Entry">
          <Num value={trade.entry_price} format={price} reason="no fill price" />
        </Stat>
        <Stat icon={Hash} label="Quantity">
          <Num value={trade.qty} format={qty} />
        </Stat>
        <Stat icon={TrendingDown} label="PnL now">
          <Num value={trade.pnl_pct} format={signedPct} tone={pnlTone(trade.pnl_pct)} reason="not marked yet" />
        </Stat>
        <Stat icon={TrendingDown} label="Worst so far">
          <Num value={trade.trade_max_adverse_pct} format={pct} reason="not measured on shadow trades" />
        </Stat>
        <Stat icon={Clock} label="Held">
          <Num value={trade.hold_hours} format={duration} reason="no entry timestamp" />
        </Stat>
        <Stat icon={LogIn} label="Entered">
          {trade.entry_ts ? (
            <span className="num" title={trade.entry_ts}>
              {stamp(trade.entry_ts)}
            </span>
          ) : (
            <NoData reason="no entry timestamp" />
          )}
        </Stat>
      </dl>

      <HoldingPlan trade={trade} />
    </section>
  );
}

export default function CurrentTrades({ onClose }) {
  const { trades } = useStore();
  const shadow = usePoll('/api/shadow');

  const real = trades.data?.open ?? [];
  const shadows = shadow.data?.open ?? [];
  const error = trades.error ?? shadow.error;
  const loading = (trades.loading && !trades.data) || (shadow.loading && !shadow.data);

  useRail(
    () => (
      <>
        <RailBlock icon={Briefcase} title="Open now">
          <RailLine label="Real">
            <Num value={trades.data ? real.length : undefined} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Shadow">
            <Num value={shadow.data ? shadows.length : undefined} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
        </RailBlock>
        <RailBlock icon={EyeOff} title="Shadow book">
          <RailLine label="Slippage/side">
            <Num value={shadow.data?.slippage_pct_per_side} format={pct} reason="not loaded" />
          </RailLine>
          <RailLine label="Dropped today">
            <Num value={shadow.data?.drops?.today} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
        </RailBlock>
        <RailNote>
          Shadow rows are counterfactual. They never touched the market and never enter a strategy
          statistic.
        </RailNote>
      </>
    ),
    [real.length, shadows.length, shadow.data]
  );

  return (
    <Sheet
      title="Current trades"
      lead={
        trades.data && shadow.data ? (
          <>
            <b>
              <InlineNum>{real.length}</InlineNum> real,{' '}
              <InlineNum>{shadows.length}</InlineNum> shadow.
            </b>{' '}
            Each holding plan is evaluated against that ticker's latest feature row.
          </>
        ) : null
      }
      updatedAt={trades.updatedAt}
      onClose={onClose}
    >
      {error ? <ErrorBanner error={error} onRetry={trades.error ? trades.refetch : shadow.refetch} /> : null}
      {loading ? <p className="hint">Loading positions…</p> : null}

      {trades.data && real.length === 0 ? (
        <Empty icon={Briefcase} label="Real book" title="Nothing real is open right now.">
          The agent is flat.
          {shadows.length > 0 ? (
            <>
              {' '}
              The <InlineNum>{shadows.length}</InlineNum> shadow{' '}
              {shadows.length === 1 ? 'position' : 'positions'} below were refused by a budget guard —
              they show what would have happened, not what did.
            </>
          ) : null}
        </Empty>
      ) : null}

      {real.length > 0 ? (
        <Section
          icon={Briefcase}
          title="Real positions"
          note="Orders that were actually sent. These are the ones that count."
        >
          <div className="cards">
            {real.map((trade) => (
              <Position key={`real-${trade.id}`} trade={trade} />
            ))}
          </div>
        </Section>
      ) : null}

      {shadows.length > 0 ? (
        <Section
          icon={EyeOff}
          title="Shadow positions"
          note="Entries a budget guard refused. No order was sent — they show what would have happened, and count toward nothing."
        >
          <div className="cards">
            {shadows.map((trade) => (
              <Position key={`shadow-${trade.id}`} trade={trade} shadow />
            ))}
          </div>
        </Section>
      ) : null}

      {shadow.data && shadows.length === 0 && real.length === 0 ? (
        <p className="caveat">No shadow entries are open either.</p>
      ) : null}
    </Sheet>
  );
}
