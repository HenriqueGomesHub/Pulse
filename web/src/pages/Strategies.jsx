import { usePoll } from '../api.js';
import EquityChart from '../EquityChart.jsx';
import { ConditionText, ErrorBanner, InlineNum, Num, PageHead, Pill, Stat } from '../ui.jsx';
import { num, pct, ratioAsPct, signedPct, stamp } from '../format.js';

const STATUS_TONE = { active: 'green', candidate: 'amber', retired: 'gray' };

function Block({ title, block }) {
  const conditions = block.all ?? block.any ?? [];
  return (
    <div>
      <p className="micro">
        {title} — {block.all ? 'all of' : 'any of'}
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

function Strategy({ strategy }) {
  const { params, stats, equity_curve: curve } = strategy;
  return (
    <section className="panel" id={`strategy-${strategy.id}`}>
      <div className="panel-head">
        <h2>{strategy.name}</h2>
        <span className="pill-row">
          <span className="badge">Gen {strategy.generation}</span>
          <Pill tone={STATUS_TONE[strategy.status] ?? 'gray'}>
            {strategy.status[0].toUpperCase() + strategy.status.slice(1)}
          </Pill>
          <Pill tone="gray">{params.side === 'short' ? 'Short' : 'Long'}</Pill>
        </span>
      </div>
      <p className="hint">
        {strategy.parent ? (
          <>
            Mutated from <a href={`#strategy-${strategy.parent.id}`}>{strategy.parent.name}</a> (generation{' '}
            <InlineNum>{strategy.parent.generation}</InlineNum>).
          </>
        ) : (
          <>Seed strategy — no parent.</>
        )}{' '}
        Created <InlineNum>{stamp(strategy.created_at)}</InlineNum>.
      </p>

      <hr className="rule" />
      <dl className="stats">
        <Stat label="Closed trades">
          <Num value={stats.trades_n} format={(v) => num(v, 0)} />
        </Stat>
        <Stat label="Win rate">
          <Num value={stats.win_rate} format={ratioAsPct} reason="no closed trades" />
        </Stat>
        <Stat label="Avg win">
          <Num value={stats.avg_win_pct} format={signedPct} tone="pos" reason="no winning trades yet" />
        </Stat>
        <Stat label="Avg loss">
          <Num value={stats.avg_loss_pct} format={signedPct} tone="neg" reason="no losing trades yet" />
        </Stat>
        <Stat label="Expectancy">
          <Num
            value={stats.expectancy}
            format={signedPct}
            tone={stats.expectancy > 0 ? 'pos' : stats.expectancy < 0 ? 'neg' : null}
            reason="no closed trades"
          />
        </Stat>
        <Stat label="Max drawdown">
          <Num value={stats.max_drawdown} format={pct} reason="no closed trades" />
        </Stat>
      </dl>

      <hr className="rule" />
      <div className="detail-grid">
        <Block title="Entry" block={params.entry} />
        <Block title="Exit" block={params.exit} />
      </div>

      <hr className="rule" />
      <p className="micro">Cumulative PnL by closed trade</p>
      {curve.length > 0 ? (
        <EquityChart points={curve} />
      ) : (
        <p className="hint">No closed trades yet, so there is no equity curve to draw.</p>
      )}
    </section>
  );
}

export default function Strategies() {
  const { data, error, loading, updatedAt, refetch } = usePoll('/api/strategies');
  const strategies = data ?? [];

  return (
    <>
      <PageHead
        title="Strategies"
        lead={
          data ? (
            <>
              <b>
                <InlineNum>{strategies.length}</InlineNum>{' '}
                {strategies.length === 1 ? 'strategy' : 'strategies'}
              </b>{' '}
              competing on expectancy and drawdown. Evolution mutates parameters, never code.
            </>
          ) : null
        }
        updatedAt={updatedAt}
      />
      {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
      {loading && !data ? <p className="hint">Loading strategies…</p> : null}
      <div className="cards">
        {strategies.map((strategy) => (
          <Strategy key={strategy.id} strategy={strategy} />
        ))}
      </div>
    </>
  );
}
