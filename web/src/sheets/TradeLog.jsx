import { useMemo, useState } from 'react';
import { FileText, Filter, LogIn, LogOut, ScrollText, Trophy } from 'lucide-react';
import Rows from '../Rows.jsx';
import Sheet from '../Sheet.jsx';
import { RailBlock, RailLine, RailNote } from '../Rail.jsx';
import { useRail } from '../railContext.jsx';
import { useStore } from '../store.jsx';
import { Empty, ErrorBanner, InlineNum, NoData, Num, Pill, Section } from '../ui.jsx';
import { duration, num, pct, pnlTone, price, qty, ratioAsPct, signedPct, stamp } from '../format.js';

const OUTCOME_TONE = { win: 'green', loss: 'red' };

function Outcome({ outcome }) {
  if (!outcome) return <Pill tone="gray">Unscored</Pill>;
  return <Pill tone={OUTCOME_TONE[outcome]}>{outcome === 'win' ? 'Win' : 'Loss'}</Pill>;
}

function Detail({ trade }) {
  return (
    <div className="detail">
      <div className="detail-grid">
        <div className="cond-block">
          <p className="cond-head">
            <LogIn size={16} strokeWidth={1.5} aria-hidden="true" />
            Why it entered
          </p>
          <p className="reason">{trade.entry_reasoning ?? <NoData reason="no reasoning recorded" />}</p>
          <p>
            Conviction{' '}
            <Num value={trade.entry_conviction} format={(value) => num(value, 2)} reason="not scored" />
          </p>
        </div>
        <div className="cond-block">
          <p className="cond-head">
            <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
            Why it exited
          </p>
          <p className="reason">{trade.exit_reasoning ?? <NoData reason="no reasoning recorded" />}</p>
          <p>
            Conviction{' '}
            <Num value={trade.exit_conviction} format={(value) => num(value, 2)} reason="not scored" />
          </p>
        </div>
      </div>
      <p>
        Worst move against the position from its own high-water mark:{' '}
        <Num value={trade.trade_max_adverse_pct} format={pct} reason="not measured" />
      </p>
    </div>
  );
}

export default function TradeLog({ onClose }) {
  const { trades, pnl } = useStore();
  const [strategy, setStrategy] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [expanded, setExpanded] = useState(null);

  const closed = trades.data?.closed ?? [];
  const totals = pnl.data?.totals ?? null;
  const strategyNames = useMemo(
    () => [...new Set(closed.map((trade) => trade.strategy_name))].sort(),
    [closed]
  );
  const shown = closed.filter(
    (trade) =>
      (strategy === 'all' || trade.strategy_name === strategy) &&
      (outcome === 'all' || trade.outcome === outcome)
  );

  useRail(
    () => (
      <>
        <RailBlock icon={ScrollText} title="Realised">
          <RailLine label="Closed">
            <Num value={totals?.closed_n} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Wins">
            <Num value={totals?.wins} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Losses">
            <Num value={totals?.losses} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Win rate">
            <Num value={totals?.win_rate} format={ratioAsPct} reason="no closed trades" />
          </RailLine>
          <RailLine label="Total PnL">
            <Num
              value={totals?.total_pnl_pct}
              format={signedPct}
              tone={pnlTone(totals?.total_pnl_pct)}
              reason="no closed trades"
            />
          </RailLine>
          <RailLine label="Showing">
            <span className="num">
              {shown.length}/{closed.length}
            </span>
          </RailLine>
        </RailBlock>
        <RailNote>Sum of per-trade percentages, not a compounded return.</RailNote>
      </>
    ),
    [totals, shown.length, closed.length]
  );

  const columns = [
    {
      key: 'symbol',
      header: 'Ticker',
      cell: (trade) => (
        <>
          <span className="sym">{trade.symbol}</span>
          <span className="sub">{trade.strategy_name}</span>
        </>
      ),
    },
    { key: 'outcome', header: 'Outcome', cell: (trade) => <Outcome outcome={trade.outcome} /> },
    {
      key: 'pnl',
      header: 'PnL',
      align: 'right',
      cell: (trade) => (
        <Num value={trade.pnl_pct} format={signedPct} tone={pnlTone(trade.pnl_pct)} reason="no PnL recorded" />
      ),
    },
    { key: 'qty', header: 'Qty', align: 'right', cell: (trade) => <Num value={trade.qty} format={qty} /> },
    {
      key: 'entry',
      header: 'Entry',
      align: 'right',
      cell: (trade) => <Num value={trade.entry_price} format={price} reason="no fill price" />,
    },
    {
      key: 'exit',
      header: 'Exit',
      align: 'right',
      cell: (trade) => <Num value={trade.exit_price} format={price} reason="no fill price" />,
    },
    {
      key: 'held',
      header: 'Held',
      align: 'right',
      cell: (trade) => <Num value={trade.hold_hours} format={duration} reason="no timestamps" />,
    },
    {
      key: 'closed',
      header: 'Closed',
      align: 'right',
      cell: (trade) =>
        trade.exit_ts ? (
          <span className="num" title={trade.exit_ts}>
            {stamp(trade.exit_ts)}
          </span>
        ) : (
          <NoData reason="not closed" />
        ),
    },
  ];

  return (
    <Sheet
      title="Trade log"
      lead={
        trades.data ? (
          <>
            <b>
              <InlineNum>{closed.length}</InlineNum> closed{' '}
              {closed.length === 1 ? 'round trip' : 'round trips'}.
            </b>{' '}
            Open one for the reasoning recorded at entry and exit.
          </>
        ) : null
      }
      updatedAt={trades.updatedAt}
      onClose={onClose}
    >
      {trades.error ? <ErrorBanner error={trades.error} onRetry={trades.refetch} /> : null}
      {trades.loading && !trades.data ? <p className="hint">Loading trades…</p> : null}

      {trades.data && closed.length > 0 ? (
        <div className="filters">
          <div className="field">
            <label className="micro" htmlFor="filter-strategy">
              <Filter size={14} strokeWidth={1.5} aria-hidden="true" />
              Strategy
            </label>
            <select id="filter-strategy" value={strategy} onChange={(event) => setStrategy(event.target.value)}>
              <option value="all">All strategies</option>
              {strategyNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="micro" htmlFor="filter-outcome">
              <Trophy size={14} strokeWidth={1.5} aria-hidden="true" />
              Outcome
            </label>
            <select id="filter-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)}>
              <option value="all">All outcomes</option>
              <option value="win">Wins</option>
              <option value="loss">Losses</option>
            </select>
          </div>
          <p className="stamp">
            {shown.length} of {closed.length} shown
          </p>
        </div>
      ) : null}

      {trades.data && closed.length === 0 ? (
        <Empty icon={ScrollText} label="Trade log" title="No trades have closed yet.">
          Closed round trips appear here once a strategy has entered and exited a position.
        </Empty>
      ) : null}

      {shown.length > 0 ? (
        <Section icon={ScrollText} title="Closed round trips" note="Open a row to read why it was entered and exited.">
          <Rows
            caption="Closed paper trades"
            columns={columns}
            rows={shown}
            rowKey={(trade) => trade.id}
            rowLabel={(trade) => `${trade.symbol} trade ${trade.id}`}
            onRowClick={(trade) => setExpanded((current) => (current === trade.id ? null : trade.id))}
          />
        </Section>
      ) : null}

      {expanded !== null && shown.some((trade) => trade.id === expanded) ? (
        <Section icon={FileText} title={`Trade #${expanded}`}>
          <Detail trade={shown.find((trade) => trade.id === expanded)} />
        </Section>
      ) : null}

      {trades.data && closed.length > 0 && shown.length === 0 ? (
        <p className="hint">No closed trades match this filter.</p>
      ) : null}
    </Sheet>
  );
}
