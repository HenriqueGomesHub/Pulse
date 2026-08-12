import { EyeOff } from 'lucide-react';
import { usePoll } from './api.js';
import { ErrorBanner, NoData, Num } from './ui.jsx';
import { duration, isNum, pnlTone, price, qty, ratioAsPct, signedPct, stamp } from './format.js';

const BLOCKED_BY = {
  pdt_budget: 'PDT budget',
  max_concurrent: 'Max concurrent',
};

const blockedLabel = (key) => BLOCKED_BY[key] ?? key;

function StrategyRow({ row }) {
  return (
    <tr>
      <th scope="row">
        {row.strategy_name}
        <span className="sub">
          n {row.shadow_trades_n} · win {isNum(row.shadow_win_rate) ? ratioAsPct(row.shadow_win_rate) : '--'} · avg{' '}
          {isNum(row.shadow_avg_win_pct) ? signedPct(row.shadow_avg_win_pct) : '--'} /{' '}
          {isNum(row.shadow_avg_loss_pct) ? signedPct(row.shadow_avg_loss_pct) : '--'}
        </span>
      </th>
      <td className="right">
        <Num
          value={row.shadow_expectancy}
          format={signedPct}
          tone={pnlTone(row.shadow_expectancy)}
          reason="no closed shadow trades yet"
        />
      </td>
      <td className="right">
        <Num
          value={row.real_expectancy}
          format={signedPct}
          tone={pnlTone(row.real_expectancy)}
          reason="no closed real trades yet"
        />
      </td>
    </tr>
  );
}

function Expectancy({ rows }) {
  return (
    <table className="shadow-table">
      <caption className="sr-only">
        Counterfactual expectancy per strategy beside real expectancy over all closed real trades. Each strategy also
        carries its counterfactual trade count, win rate and average win and loss.
      </caption>
      <thead>
        <tr>
          <th scope="col">Strategy</th>
          <th scope="col" className="right">
            Shadow
          </th>
          <th scope="col" className="right">
            Real
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <StrategyRow key={row.strategy_id} row={row} />
        ))}
      </tbody>
    </table>
  );
}

function OpenRow({ position }) {
  return (
    <li>
      <p className="shadow-line">
        <span className="sym">{position.symbol}</span>
        <Num value={position.pnl_pct} format={signedPct} tone={pnlTone(position.pnl_pct)} reason="not marked yet" />
      </p>
      <p className="shadow-meta">
        {position.strategy_name} · {blockedLabel(position.blocked_by)}
      </p>
      <p className="shadow-meta">
        entry <Num value={position.entry_price} format={price} reason="no entry price" /> ×{' '}
        <Num value={position.qty} format={qty} reason="no size" /> ·{' '}
        <Num value={position.hold_hours} format={duration} reason="not held yet" />
      </p>
    </li>
  );
}

function ClosedRow({ trade }) {
  return (
    <li>
      <p className="shadow-line">
        <span className="sym">{trade.symbol}</span>
        <Num value={trade.pnl_pct} format={signedPct} tone={pnlTone(trade.pnl_pct)} reason="no result recorded" />
      </p>
      <p className="shadow-meta">
        {trade.strategy_name} · {blockedLabel(trade.blocked_by)}
      </p>
      <p className="shadow-meta">
        <Num value={trade.entry_price} format={price} reason="no entry price" /> →{' '}
        <Num value={trade.exit_price} format={price} reason="no exit price" /> ·{' '}
        <Num value={trade.hold_hours} format={duration} reason="no hold time" /> ·{' '}
        {trade.exit_ts ? (
          <span className="num" title={trade.exit_ts}>
            {stamp(trade.exit_ts)}
          </span>
        ) : (
          <NoData reason="no exit timestamp" />
        )}
      </p>
      {trade.exit_reason ? <p className="shadow-meta">{trade.exit_reason}</p> : null}
    </li>
  );
}

function Head() {
  return (
    <div className="panel-head">
      <h2>
        <EyeOff size={16} strokeWidth={1.5} aria-hidden="true" /> Shadow book
      </h2>
      <span className="micro">Counterfactual</span>
    </div>
  );
}

export default function ShadowBook() {
  const { data, error, loading, refetch } = usePoll('/api/shadow');

  if (!data) {
    return (
      <section className="panel shadow">
        <Head />
        {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
        {loading && !error ? <p className="hint">Loading the shadow book…</p> : null}
      </section>
    );
  }

  const { open, closed, by_strategy: byStrategy, drops, slippage_pct_per_side: slippage } = data;

  return (
    <section className="panel shadow">
      <Head />
      {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
      <p className="hint">
        Entries a budget guard refused. No order was ever sent, and none of this counts toward the PDT budget, the
        reservation, max-concurrent or any strategy statistic.
      </p>

      {open.length === 0 && closed.length === 0 && drops.total === 0 ? (
        <>
          <hr className="rule rule--dashed" />
          <p className="hint">
            Nothing refused yet. A row appears here when a strategy fires, conviction passes, and the PDT budget or the
            max-concurrent cap turns the entry away.
          </p>
        </>
      ) : null}

      {byStrategy.length > 0 ? (
        <>
          <hr className="rule rule--dashed" />
          <p className="micro">Expectancy — shadow against real</p>
          <Expectancy rows={byStrategy} />
        </>
      ) : null}

      {open.length > 0 ? (
        <>
          <hr className="rule rule--dashed" />
          <p className="micro">Open — {open.length}</p>
          <ul className="shadow-list">
            {open.map((position) => (
              <OpenRow key={position.id} position={position} />
            ))}
          </ul>
        </>
      ) : null}

      {closed.length > 0 ? (
        <>
          <hr className="rule rule--dashed" />
          <p className="micro">Recent closes — {closed.length}</p>
          <ul className="shadow-list">
            {closed.map((trade) => (
              <ClosedRow key={trade.id} trade={trade} />
            ))}
          </ul>
        </>
      ) : null}

      {drops.total > 0 ? (
        <>
          <hr className="rule rule--dashed" />
          <p className="hint">
            <span className="num">{drops.today}</span> shadow entries dropped today and{' '}
            <span className="num">{drops.total}</span> in all because the shared daily conviction cap was already spent.
            A shadow entry makes the same conviction call as a real one and is never recorded without it, so cap
            pressure shows up as a smaller sample.
          </p>
        </>
      ) : null}

      <hr className="rule rule--dashed" />
      <p className="caveat">
        Shadow fills assume the order would have filled at the signal price with {slippage}% slippage per side, applied
        adversely at both entry and exit. That figure is provisional — the evidence base is three real fills at roughly
        0.067% round trip — and real fills can differ.
      </p>
    </section>
  );
}
