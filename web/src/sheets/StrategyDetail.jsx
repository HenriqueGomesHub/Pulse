import {
  ArrowDownRight,
  ArrowUpRight,
  GitBranch,
  Hash,
  LineChart,
  ListChecks,
  LogIn,
  LogOut,
  Percent,
  Target,
  TrendingDown,
  Trophy,
} from 'lucide-react';
import EquityChart from '../EquityChart.jsx';
import Sheet from '../Sheet.jsx';
import { RailBlock, RailLine, RailNote } from '../Rail.jsx';
import { useRail } from '../railContext.jsx';
import { useStore } from '../store.jsx';
import { ConditionText, Empty, ErrorBanner, InlineNum, Num, Pill, Section, Stat } from '../ui.jsx';
import { num, pct, pnlTone, ratioAsPct, signedPct, stamp, termLabel } from '../format.js';

const STATUS_TONE = { active: 'green', candidate: 'amber', retired: 'gray' };

function Block({ icon: Icon, title, block }) {
  const conditions = block.all ?? block.any ?? [];
  return (
    <div className="cond-block">
      <p className="cond-head">
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
        {title} <span>{block.all ? 'all of these' : 'any of these'}</span>
      </p>
      <ul className="conds">
        {conditions.map((condition, index) => (
          <li key={`${condition.feature}-${condition.op}-${index}`}>
            <ConditionText condition={condition} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function StrategyDetail({ id, onClose }) {
  const { strategies } = useStore();
  const strategy = (strategies.data ?? []).find((row) => String(row.id) === String(id)) ?? null;
  const hold = strategy
    ? (strategy.params.exit.any ?? strategy.params.exit.all ?? []).find(
        (condition) => condition.feature === 'hold_hours' && (condition.op === 'gte' || condition.op === 'gt')
      )
    : null;

  useRail(
    () => (
      <>
        <RailBlock icon={GitBranch} title={strategy?.name ?? 'Strategy'}>
          <RailLine label="Generation">
            <Num value={strategy?.generation} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Status">
            <span className="rail-text">{strategy?.status ?? '—'}</span>
          </RailLine>
          <RailLine label="Side">
            <span className="rail-text">{strategy?.params.side ?? '—'}</span>
          </RailLine>
          <RailLine label="Closed">
            <Num value={strategy?.stats.trades_n} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Expectancy">
            <Num
              value={strategy?.stats.expectancy}
              format={signedPct}
              tone={pnlTone(strategy?.stats.expectancy)}
              reason="no closed trades"
            />
          </RailLine>
          <RailLine label="Intended term">
            <span className="rail-text">{hold ? termLabel(hold.value) : 'no max hold'}</span>
          </RailLine>
        </RailBlock>
        <RailNote>Term is derived from the max-hold exit leg, which is shown in full below.</RailNote>
      </>
    ),
    [strategy, hold]
  );

  return (
    <Sheet
      title={strategy?.name ?? 'Strategy'}
      lead={
        strategy ? (
          <>
            <b>
              Generation <InlineNum>{strategy.generation}</InlineNum>,{' '}
              {strategy.params.side === 'short' ? 'short' : 'long'}.
            </b>{' '}
            {strategy.parent
              ? `Mutated from ${strategy.parent.name} (generation ${strategy.parent.generation}).`
              : 'Seed strategy — no parent.'}{' '}
            Created {stamp(strategy.created_at)}.
          </>
        ) : null
      }
      updatedAt={strategies.updatedAt}
      onClose={onClose}
    >
      {strategies.error ? <ErrorBanner error={strategies.error} onRetry={strategies.refetch} /> : null}
      {strategies.loading && !strategies.data ? <p className="hint">Loading strategy…</p> : null}

      {strategies.data && !strategy ? (
        <Empty icon={GitBranch} label="Strategies" title="No strategy with that id.">
          It may have been retired and removed, or the link may be stale.
        </Empty>
      ) : null}

      {strategy ? (
        <>
          <span className="pill-row">
            <span className="badge">Gen {strategy.generation}</span>
            <Pill tone={STATUS_TONE[strategy.status] ?? 'gray'}>
              {strategy.status[0].toUpperCase() + strategy.status.slice(1)}
            </Pill>
            <Pill tone="gray">{strategy.params.side === 'short' ? 'Short' : 'Long'}</Pill>
            {hold ? <Pill tone="gray">{termLabel(hold.value)}</Pill> : null}
          </span>

          <Section icon={Trophy} title="How it has performed" note="Across every trade this strategy has closed.">
            <dl className="stats">
              <Stat icon={Hash} label="Closed trades">
                <Num value={strategy.stats.trades_n} format={(value) => num(value, 0)} />
              </Stat>
              <Stat icon={Percent} label="Win rate">
                <Num value={strategy.stats.win_rate} format={ratioAsPct} reason="no closed trades" />
              </Stat>
              <Stat icon={ArrowUpRight} label="Avg win">
                <Num value={strategy.stats.avg_win_pct} format={signedPct} tone="pos" reason="no winning trades yet" />
              </Stat>
              <Stat icon={ArrowDownRight} label="Avg loss">
                <Num value={strategy.stats.avg_loss_pct} format={signedPct} tone="neg" reason="no losing trades yet" />
              </Stat>
              <Stat icon={Target} label="Expectancy">
                <Num
                  value={strategy.stats.expectancy}
                  format={signedPct}
                  tone={pnlTone(strategy.stats.expectancy)}
                  reason="no closed trades"
                />
              </Stat>
              <Stat icon={TrendingDown} label="Max drawdown">
                <Num value={strategy.stats.max_drawdown} format={pct} reason="no closed trades" />
              </Stat>
            </dl>
          </Section>

          <Section
            icon={ListChecks}
            title="What it trades on"
            note="These conditions are the whole strategy. Evolution mutates their numbers, never the code."
          >
            <div className="detail-grid">
              <Block icon={LogIn} title="Enters when" block={strategy.params.entry} />
              <Block icon={LogOut} title="Exits when" block={strategy.params.exit} />
            </div>
          </Section>

          <Section icon={LineChart} title="Cumulative PnL" note="Each point is one closed trade for this strategy.">
            {strategy.equity_curve.length > 0 ? (
              <EquityChart points={strategy.equity_curve} />
            ) : (
              <p className="hint">No closed trades yet, so there is no equity curve to draw.</p>
            )}
          </Section>
        </>
      ) : null}
    </Sheet>
  );
}
