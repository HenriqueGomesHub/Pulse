import { Link } from 'react-router-dom';
import { Briefcase, Check, Circle } from 'lucide-react';
import { usePoll } from '../api.js';
import ShadowBook from '../ShadowBook.jsx';
import { ConditionText, Empty, ErrorBanner, InlineNum, NoData, Num, PageHead, Pill, Stat } from '../ui.jsx';
import { duration, featureValue, isNum, pct, pnlTone, price, qty, signedPct, stamp } from '../format.js';

function Condition({ condition }) {
  const Icon = condition.met ? Check : Circle;
  return (
    <li>
      <span>
        <ConditionText condition={condition} />
      </span>
      <span className="cond-right">
        <span className="cond-now">
          <span className="micro">now</span>
          {isNum(condition.current) ? (
            <span className="num">{featureValue(condition.feature, condition.current)}</span>
          ) : (
            <NoData reason="feature not computed" />
          )}
        </span>
        <span className="flag">
          <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
          {condition.met ? 'met' : 'not met'}
        </span>
      </span>
    </li>
  );
}

function Position({ trade }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          <span className="sym">{trade.symbol}</span> · {trade.strategy_name}
        </h2>
        <span className="pill-row">
          <Pill tone="gray">{trade.side === 'short' ? 'Short' : 'Long'}</Pill>
          <Pill tone="blue">Open</Pill>
        </span>
      </div>
      <hr className="rule" />
      <dl className="stats">
        <Stat label="Entry">
          <Num value={trade.entry_price} format={price} reason="no fill price" />
        </Stat>
        <Stat label="Quantity">
          <Num value={trade.qty} format={qty} />
        </Stat>
        <Stat label="PnL">
          <Num value={trade.pnl_pct} format={signedPct} tone={pnlTone(trade.pnl_pct)} reason="not marked yet" />
        </Stat>
        <Stat label="Max adverse excursion">
          <Num value={trade.trade_max_adverse_pct} format={pct} reason="not measured yet" />
        </Stat>
        <Stat label="Held">
          <Num value={trade.hold_hours} format={duration} reason="no entry timestamp" />
        </Stat>
        <Stat label="Entered">
          {trade.entry_ts ? (
            <span className="num" title={trade.entry_ts}>
              {stamp(trade.entry_ts)}
            </span>
          ) : (
            <NoData reason="no entry timestamp" />
          )}
        </Stat>
      </dl>
      <hr className="rule" />
      {trade.exit_error ? (
        <>
          <p className="micro">Exit conditions</p>
          <p className="hint">Not evaluated — {trade.exit_error}</p>
        </>
      ) : (
        <>
          <p className="micro">Exit conditions — {trade.exit_logic === 'all' ? 'all of' : 'any of'}</p>
          <ul className="conds">
            {trade.exit_conditions.map((condition, index) => (
              <Condition key={`${condition.feature}-${condition.op}-${index}`} condition={condition} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default function Positions() {
  const { data, error, loading, updatedAt, refetch } = usePoll('/api/trades');
  const open = data?.open ?? [];

  return (
    <>
      <PageHead
        title="Positions"
        lead={
          data ? (
            <>
              <b>
                <InlineNum>{open.length}</InlineNum> open paper {open.length === 1 ? 'trade' : 'trades'}.
              </b>{' '}
              Exit conditions are evaluated against each ticker's latest feature row.
            </>
          ) : null
        }
        updatedAt={updatedAt}
      />
      {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
      <div className="with-rail">
        <div>
          {loading && !data ? <p className="hint">Loading positions…</p> : null}
          {data && open.length === 0 ? (
            <Empty icon={Briefcase} label="Positions" title="Nothing is open right now.">
              The agent is flat. Closed round trips are in the <Link to="/trades">trade log</Link>.
            </Empty>
          ) : null}
          {open.length > 0 ? (
            <div className="cards">
              {open.map((trade) => (
                <Position key={trade.id} trade={trade} />
              ))}
            </div>
          ) : null}
        </div>
        <div className="rail">
          <ShadowBook />
        </div>
      </div>
    </>
  );
}
