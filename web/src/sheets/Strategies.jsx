import { useNavigate } from 'react-router-dom';
import { EyeOff, GitBranch } from 'lucide-react';
import { usePoll } from '../api.js';
import Rows from '../Rows.jsx';
import Sheet from '../Sheet.jsx';
import { RailBlock, RailLine, RailNote } from '../Rail.jsx';
import { useRail } from '../railContext.jsx';
import { useStore } from '../store.jsx';
import { ErrorBanner, InlineNum, Num, Pill, Section } from '../ui.jsx';
import { num, pct, pnlTone, ratioAsPct, signedPct } from '../format.js';

const STATUS_TONE = { active: 'green', candidate: 'amber', retired: 'gray' };

// Counterfactual expectancy beside the real one. Every missing value goes through
// NoData with its own reason — the same em-dash the rest of the dashboard uses.
function ShadowCompare({ rows }) {
  const columns = [
    {
      key: 'strategy',
      header: 'Strategy',
      cell: (row) => (
        <>
          <span className="sym">{row.strategy_name}</span>
          <span className="sub">
            <InlineNum>{row.shadow_trades_n}</InlineNum> shadow closed
          </span>
        </>
      ),
    },
    {
      key: 'shadow_win',
      header: 'Shadow win rate',
      align: 'right',
      cell: (row) => <Num value={row.shadow_win_rate} format={ratioAsPct} reason="no closed shadow trades" />,
    },
    {
      key: 'shadow',
      header: 'Shadow expectancy',
      align: 'right',
      cell: (row) => (
        <Num
          value={row.shadow_expectancy}
          format={signedPct}
          tone={pnlTone(row.shadow_expectancy)}
          reason="no closed shadow trades"
        />
      ),
    },
    {
      key: 'real',
      header: 'Real expectancy',
      align: 'right',
      cell: (row) => (
        <Num
          value={row.real_expectancy}
          format={signedPct}
          tone={pnlTone(row.real_expectancy)}
          reason="no closed real trades"
        />
      ),
    },
  ];

  return (
    <Rows
      caption="Counterfactual expectancy per strategy beside its real expectancy"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.strategy_id}
    />
  );
}

export default function Strategies({ onClose }) {
  const navigate = useNavigate();
  const { strategies } = useStore();
  const shadow = usePoll('/api/shadow');
  const rows = strategies.data ?? [];
  const active = rows.filter((row) => row.status === 'active').length;
  const compare = shadow.data?.by_strategy ?? [];

  useRail(
    () => (
      <>
        <RailBlock icon={GitBranch} title="Population">
          <RailLine label="Total">
            <Num value={rows.length || undefined} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Active">
            <Num value={rows.length ? active : undefined} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Candidate">
            <Num
              value={rows.length ? rows.filter((row) => row.status === 'candidate').length : undefined}
              format={(value) => num(value, 0)}
              reason="not loaded"
            />
          </RailLine>
          <RailLine label="Retired">
            <Num
              value={rows.length ? rows.filter((row) => row.status === 'retired').length : undefined}
              format={(value) => num(value, 0)}
              reason="not loaded"
            />
          </RailLine>
        </RailBlock>
        <RailNote>Only active strategies are evaluated by the runner. Evolution mutates parameters, never code.</RailNote>
      </>
    ),
    [rows.length, active]
  );

  const columns = [
    {
      key: 'name',
      header: 'Strategy',
      cell: (row) => (
        <>
          <span className="sym">{row.name}</span>
          <span className="sub">
            Gen {row.generation} · {row.params.side === 'short' ? 'short' : 'long'}
          </span>
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Pill tone={STATUS_TONE[row.status] ?? 'gray'}>
          {row.status[0].toUpperCase() + row.status.slice(1)}
        </Pill>
      ),
    },
    {
      key: 'trades',
      header: 'Closed',
      align: 'right',
      cell: (row) => <Num value={row.stats.trades_n} format={(value) => num(value, 0)} />,
    },
    {
      key: 'win',
      header: 'Win rate',
      align: 'right',
      cell: (row) => <Num value={row.stats.win_rate} format={ratioAsPct} reason="no closed trades" />,
    },
    {
      key: 'expectancy',
      header: 'Expectancy',
      align: 'right',
      cell: (row) => (
        <Num
          value={row.stats.expectancy}
          format={signedPct}
          tone={pnlTone(row.stats.expectancy)}
          reason="no closed trades"
        />
      ),
    },
    {
      key: 'drawdown',
      header: 'Max drawdown',
      align: 'right',
      cell: (row) => <Num value={row.stats.max_drawdown} format={pct} reason="no closed trades" />,
    },
  ];

  return (
    <Sheet
      title="Strategies"
      lead={
        strategies.data ? (
          <>
            <b>
              <InlineNum>{rows.length}</InlineNum> {rows.length === 1 ? 'strategy' : 'strategies'},{' '}
              <InlineNum>{active}</InlineNum> active.
            </b>{' '}
            Open one for its entry and exit blocks.
          </>
        ) : null
      }
      updatedAt={strategies.updatedAt}
      onClose={onClose}
    >
      {strategies.error ? <ErrorBanner error={strategies.error} onRetry={strategies.refetch} /> : null}
      {strategies.loading && !strategies.data ? <p className="hint">Loading strategies…</p> : null}
      {strategies.data ? (
        <Section
          icon={GitBranch}
          title="The population"
          note="Only active strategies are evaluated. Open one to see the exact conditions it enters and exits on."
        >
          <Rows
            caption="Strategies with their closed-trade statistics"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowLabel={(row) => row.name}
            onRowClick={(row) => navigate(`/strategies/${row.id}`)}
          />
        </Section>
      ) : null}

      {compare.length > 0 ? (
        <Section
          icon={EyeOff}
          title="Shadow against real"
          note={
            <>
              Entries a budget guard refused, priced with{' '}
              <InlineNum>{shadow.data.slippage_pct_per_side}%</InlineNum> slippage per side. No order
              was ever sent, and none of this counts toward any statistic above.
            </>
          }
        >
          <ShadowCompare rows={compare} />
        </Section>
      ) : null}
    </Sheet>
  );
}
