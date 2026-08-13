import { Activity, GitBranch, Radar } from 'lucide-react';
import { useRailContent } from './railContext.jsx';
import { useStore } from './store.jsx';
import { NoData, Num } from './ui.jsx';
import { ago, num, pct, pnlTone, ratioAsPct, signedPct } from './format.js';

export function RailBlock({ icon: Icon, title, children }) {
  return (
    <section className="rail-block">
      <p className="rail-title">
        {Icon ? <Icon size={14} strokeWidth={1.5} aria-hidden="true" /> : null}
        {title}
      </p>
      <dl className="rail-list">{children}</dl>
    </section>
  );
}

export function RailLine({ label, children }) {
  return (
    <div className="rail-line">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function RailNote({ children }) {
  return <p className="rail-note">{children}</p>;
}

function DefaultRail() {
  const { pnl, trades, strategies, near } = useStore();
  const totals = pnl.data?.totals ?? null;
  const rows = strategies.data ?? [];
  const active = rows.filter((row) => row.status === 'active').length;
  const best = near.data?.candidates?.[0] ?? null;

  return (
    <>
      <RailBlock icon={Activity} title="Book">
        <RailLine label="Closed">
          <Num value={totals?.closed_n} format={(value) => num(value, 0)} reason="not loaded" />
        </RailLine>
        <RailLine label="Open">
          <Num value={trades.data?.open?.length} format={(value) => num(value, 0)} reason="not loaded" />
        </RailLine>
        <RailLine label="Win rate">
          <Num value={totals?.win_rate} format={ratioAsPct} reason="no closed trades" />
        </RailLine>
        <RailLine label="Expectancy">
          <Num
            value={totals?.expectancy}
            format={signedPct}
            tone={pnlTone(totals?.expectancy)}
            reason="no closed trades"
          />
        </RailLine>
        <RailLine label="Max drawdown">
          <Num value={totals?.max_drawdown} format={pct} reason="no closed trades" />
        </RailLine>
      </RailBlock>

      <RailBlock icon={GitBranch} title="Strategies">
        <RailLine label="Active">
          <Num value={rows.length ? active : undefined} format={(value) => num(value, 0)} reason="not loaded" />
        </RailLine>
        <RailLine label="Total">
          <Num value={rows.length || undefined} format={(value) => num(value, 0)} reason="not loaded" />
        </RailLine>
        <RailLine label="Generations">
          <Num
            value={rows.length ? new Set(rows.map((row) => row.generation)).size : undefined}
            format={(value) => num(value, 0)}
            reason="not loaded"
          />
        </RailLine>
      </RailBlock>

      <RailBlock icon={Radar} title="Nearest entry">
        {best ? (
          <>
            <RailLine label="Ticker">
              <span className="sym">{best.symbol}</span>
            </RailLine>
            <RailLine label="Strategy">
              <span className="rail-text">{best.strategy_name}</span>
            </RailLine>
            <RailLine label="Gates cleared">
              <span className="num">
                {best.gates_met}/{best.gates_total}
              </span>
            </RailLine>
            <RailLine label="Feature age">
              {best.features_ts ? (
                <span className="num">{ago(best.features_ts)}</span>
              ) : (
                <NoData reason="no feature rows" />
              )}
            </RailLine>
          </>
        ) : (
          <RailNote>
            {near.loading ? 'Reading gates…' : 'No candidate is in range of an active strategy.'}
          </RailNote>
        )}
      </RailBlock>

      <RailNote>Open a box on the canvas to see its detail here.</RailNote>
    </>
  );
}

export default function Rail() {
  const content = useRailContent();

  return (
    <aside className="rail" aria-label="Context">
      <div className="rail-inner">{content ?? <DefaultRail />}</div>
    </aside>
  );
}
