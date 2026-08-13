import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  LineChart,
  Percent,
  Target,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import EquityChart from '../EquityChart.jsx';
import Sheet from '../Sheet.jsx';
import { RailBlock, RailLine, RailNote } from '../Rail.jsx';
import { useRail } from '../railContext.jsx';
import { useStore } from '../store.jsx';
import { Empty, ErrorBanner, InlineNum, NoData, Num, Section, Stat } from '../ui.jsx';
import { isNum, num, pct, pnlTone, ratioAsPct, signedPct } from '../format.js';

const sumPnl = (trades) => {
  const marked = trades.filter((trade) => isNum(trade.pnl_pct));
  return marked.length === 0 ? null : marked.reduce((total, trade) => total + trade.pnl_pct, 0);
};

export default function Overview({ onClose }) {
  const { pnl, trades } = useStore();
  const totals = pnl.data?.totals ?? null;
  const curve = pnl.data?.equity_curve ?? [];
  const open = trades.data?.open ?? [];
  const unrealized = sumPnl(open);

  useRail(
    () => (
      <>
        <RailBlock icon={Activity} title="Realised">
          <RailLine label="Closed">
            <Num value={totals?.closed_n} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Wins">
            <Num value={totals?.wins} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Losses">
            <Num value={totals?.losses} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Avg win">
            <Num value={totals?.avg_win_pct} format={signedPct} tone="pos" reason="no winning trades" />
          </RailLine>
          <RailLine label="Avg loss">
            <Num value={totals?.avg_loss_pct} format={signedPct} tone="neg" reason="no losing trades" />
          </RailLine>
        </RailBlock>
        <RailNote>
          Every figure is a sum or mean of per-trade percentages. Pulse tracks no account
          balance, so there is no portfolio return to quote.
        </RailNote>
      </>
    ),
    [totals]
  );

  return (
    <Sheet
      title="Overview"
      lead={
        totals ? (
          <>
            <b>
              <InlineNum>{totals.closed_n}</InlineNum> closed,{' '}
              <InlineNum>{open.length}</InlineNum> open.
            </b>{' '}
            Percentages are summed per trade, not compounded on a balance.
          </>
        ) : null
      }
      updatedAt={pnl.updatedAt}
      onClose={onClose}
    >
      {pnl.error ? <ErrorBanner error={pnl.error} onRetry={pnl.refetch} /> : null}
      {pnl.loading && !pnl.data ? <p className="hint">Loading totals…</p> : null}

      {totals ? (
        <>
          <Section
            icon={Activity}
            title="How the book is doing"
            note="Realized is what closed trades actually returned. Unrealized is what open trades are showing right now."
          >
            <dl className="stats">
              <Stat icon={ArrowDownRight} label="Realized">
                <Num
                  value={totals.total_pnl_pct}
                  format={signedPct}
                  tone={pnlTone(totals.total_pnl_pct)}
                  reason="no closed trades"
                />
              </Stat>
              <Stat icon={ArrowUpRight} label="Unrealized">
                <Num value={unrealized} format={signedPct} tone={pnlTone(unrealized)} reason="nothing open" />
              </Stat>
              <Stat icon={Percent} label="Win rate">
                <Num value={totals.win_rate} format={ratioAsPct} reason="no closed trades" />
              </Stat>
              <Stat icon={Target} label="Expectancy">
                <Num
                  value={totals.expectancy}
                  format={signedPct}
                  tone={pnlTone(totals.expectancy)}
                  reason="no closed trades"
                />
              </Stat>
              <Stat icon={TrendingDown} label="Max drawdown">
                <Num value={totals.max_drawdown} format={pct} reason="no closed trades" />
              </Stat>
              <Stat icon={Wallet} label="Equity">
                <NoData reason="Pulse tracks no account balance" />
              </Stat>
            </dl>
          </Section>

          <Section
            icon={LineChart}
            title="Cumulative PnL"
            note="Each point is one closed trade, added to the running total."
          >
            {curve.length > 0 ? (
              <EquityChart points={curve} height={240} />
            ) : (
              <Empty icon={Activity} label="Overview" title="No closed trades yet.">
                The curve appears once a strategy has completed a round trip.
              </Empty>
            )}
          </Section>
        </>
      ) : null}
    </Sheet>
  );
}
