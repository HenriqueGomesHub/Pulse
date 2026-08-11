import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { usePoll } from '../api.js';
import EquityChart from '../EquityChart.jsx';
import { Empty, ErrorBanner, InlineNum, NoData, Num, PageHead, Pill, Stat } from '../ui.jsx';
import { duration, num, pct, pnlTone, price, qty, ratioAsPct, signedPct, stamp } from '../format.js';

const OUTCOME_TONE = { win: 'green', loss: 'red' };

function Outcome({ outcome }) {
  if (!outcome) return <Pill tone="gray">Unscored</Pill>;
  return <Pill tone={OUTCOME_TONE[outcome]}>{outcome === 'win' ? 'Win' : 'Loss'}</Pill>;
}

function Reasoning({ title, text, conviction }) {
  return (
    <div>
      <p className="micro">{title}</p>
      <p className="reason">{text ?? <NoData reason="no reasoning recorded" />}</p>
      <p>
        Conviction <Num value={conviction} format={(v) => num(v, 2)} reason="conviction not scored" />
      </p>
    </div>
  );
}

function Row({ trade }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <tbody>
      <tr>
        <th scope="row">
          <span className="sym">{trade.symbol}</span>
        </th>
        <td>{trade.strategy_name}</td>
        <td>
          <Outcome outcome={trade.outcome} />
        </td>
        <td className="right">
          <Num value={trade.pnl_pct} format={signedPct} tone={pnlTone(trade.pnl_pct)} reason="no PnL recorded" />
        </td>
        <td className="right">
          <Num value={trade.max_drawdown_pct} format={pct} reason="not measured" />
        </td>
        <td className="right">
          <Num value={trade.qty} format={qty} />
        </td>
        <td className="right">
          <Num value={trade.entry_price} format={price} reason="no fill price" />
        </td>
        <td className="right">
          <Num value={trade.exit_price} format={price} reason="no fill price" />
        </td>
        <td className="right">
          <Num value={trade.hold_hours} format={duration} reason="no timestamps" />
        </td>
        <td className="right">
          {trade.exit_ts ? (
            <span className="num" title={trade.exit_ts}>
              {stamp(trade.exit_ts)}
            </span>
          ) : (
            <NoData reason="not closed" />
          )}
        </td>
        <td>
          <button
            type="button"
            className="btn-ghost"
            aria-expanded={open}
            aria-controls={`trade-${trade.id}-detail`}
            onClick={() => setOpen((value) => !value)}
          >
            <Chevron size={16} strokeWidth={1.5} aria-hidden="true" />
            {open ? 'Hide' : 'Details'}
            <span className="sr-only"> for {trade.symbol} trade {trade.id}</span>
          </button>
        </td>
      </tr>
      {open ? (
        <tr id={`trade-${trade.id}-detail`}>
          <td colSpan={11}>
            <div className="detail">
              <div className="detail-grid">
                <Reasoning title="Entry reasoning" text={trade.entry_reasoning} conviction={trade.entry_conviction} />
                <Reasoning title="Exit reasoning" text={trade.exit_reasoning} conviction={trade.exit_conviction} />
              </div>
              <p>
                Entered{' '}
                {trade.entry_ts ? <InlineNum>{stamp(trade.entry_ts)}</InlineNum> : 'at an unrecorded time'} · trade{' '}
                <InlineNum>#{trade.id}</InlineNum> · strategy <InlineNum>#{trade.strategy_id}</InlineNum>
              </p>
            </div>
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

function Totals({ totals }) {
  return (
    <dl className="stats">
      <Stat label="Closed trades">
        <Num value={totals.closed_n} format={(v) => num(v, 0)} />
      </Stat>
      <Stat label="Win rate">
        <Num value={totals.win_rate} format={ratioAsPct} reason="no closed trades" />
      </Stat>
      <Stat label="Avg win">
        <Num value={totals.avg_win_pct} format={signedPct} tone="pos" reason="no winning trades yet" />
      </Stat>
      <Stat label="Avg loss">
        <Num value={totals.avg_loss_pct} format={signedPct} tone="neg" reason="no losing trades yet" />
      </Stat>
      <Stat label="Expectancy">
        <Num
          value={totals.expectancy}
          format={signedPct}
          tone={pnlTone(totals.expectancy)}
          reason="no closed trades"
        />
      </Stat>
      <Stat label="Total PnL">
        <Num
          value={totals.total_pnl_pct}
          format={signedPct}
          tone={pnlTone(totals.total_pnl_pct)}
          reason="no closed trades"
        />
      </Stat>
      <Stat label="Max drawdown">
        <Num value={totals.max_drawdown} format={pct} reason="no closed trades" />
      </Stat>
    </dl>
  );
}

export default function TradeLog() {
  const trades = usePoll('/api/trades');
  const pnl = usePoll('/api/pnl');
  const [strategy, setStrategy] = useState('all');
  const [outcome, setOutcome] = useState('all');

  const closed = trades.data?.closed ?? [];
  const strategyNames = useMemo(
    () => [...new Set(closed.map((trade) => trade.strategy_name))].sort(),
    [closed]
  );
  const shown = closed.filter(
    (trade) =>
      (strategy === 'all' || trade.strategy_name === strategy) &&
      (outcome === 'all' || trade.outcome === outcome)
  );

  const error = trades.error ?? pnl.error;
  const retry = trades.error ? trades.refetch : pnl.refetch;

  return (
    <>
      <PageHead
        title="Trade log"
        lead={
          trades.data ? (
            <>
              <b>
                <InlineNum>{closed.length}</InlineNum> closed {closed.length === 1 ? 'round trip' : 'round trips'}.
              </b>{' '}
              Expand a row for the reasoning recorded at entry and exit.
            </>
          ) : null
        }
        updatedAt={trades.updatedAt}
      />
      {error ? <ErrorBanner error={error} onRetry={retry} /> : null}
      {trades.loading && !trades.data ? <p className="hint">Loading trades…</p> : null}

      {pnl.data ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Realised performance</h2>
            <span className="stamp">All closed trades</span>
          </div>
          <hr className="rule" />
          <Totals totals={pnl.data.totals} />
          {pnl.data.equity_curve.length > 0 ? (
            <>
              <hr className="rule" />
              <p className="micro">Cumulative PnL by closed trade</p>
              <EquityChart points={pnl.data.equity_curve} />
            </>
          ) : null}
        </section>
      ) : null}

      {trades.data ? (
        <>
          <hr className="rule" />
          <div className="filters">
            <div className="field">
              <label className="micro" htmlFor="filter-strategy">
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
        </>
      ) : null}

      {trades.data && closed.length === 0 ? (
        <Empty icon={ScrollText} label="Trade log" title="No trades have closed yet.">
          Closed round trips appear here once a strategy has entered and exited a position.
        </Empty>
      ) : null}

      {shown.length > 0 ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Closed paper trades</caption>
            <thead>
              <tr>
                <th scope="col">Ticker</th>
                <th scope="col">Strategy</th>
                <th scope="col">Outcome</th>
                <th scope="col" className="right">
                  PnL
                </th>
                <th scope="col" className="right">
                  Max drawdown
                </th>
                <th scope="col" className="right">
                  Qty
                </th>
                <th scope="col" className="right">
                  Entry
                </th>
                <th scope="col" className="right">
                  Exit
                </th>
                <th scope="col" className="right">
                  Held
                </th>
                <th scope="col" className="right">
                  Closed
                </th>
                <th scope="col">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            {shown.map((trade) => (
              <Row key={trade.id} trade={trade} />
            ))}
          </table>
        </div>
      ) : null}

      {trades.data && closed.length > 0 && shown.length === 0 ? (
        <p className="hint">No closed trades match this filter.</p>
      ) : null}
    </>
  );
}
