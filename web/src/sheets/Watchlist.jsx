import { useNavigate } from 'react-router-dom';
import { Radar } from 'lucide-react';
import { usePoll } from '../api.js';
import Rows from '../Rows.jsx';
import Sheet from '../Sheet.jsx';
import { RailBlock, RailLine, RailNote } from '../Rail.jsx';
import { useRail } from '../railContext.jsx';
import { ErrorBanner, InlineNum, NoData, Num, Pill, Sparkline } from '../ui.jsx';
import { ago, isNum, num, price } from '../format.js';

function lead(rows) {
  if (rows.some((row) => isNum(row.max_conviction))) {
    return (
      <>
        <b>Ranked by max strategy conviction</b>, then by mention z-score.
      </>
    );
  }
  if (rows.some((row) => isNum(row.mention_zscore))) {
    return (
      <>
        <b>No convictions recorded yet</b>, so the ranking falls back to mention z-score.
      </>
    );
  }
  return (
    <>
      <b>Not ranked.</b> No conviction or mention z-score has been recorded for any ticker yet, so the{' '}
      <InlineNum>{rows.length}</InlineNum> watchlist tickers are listed alphabetically — the order carries no
      meaning.
    </>
  );
}

function Signals({ signals }) {
  if (signals.length === 0) return <NoData reason="no signals in the last 24 hours" />;
  const entries = signals.filter((signal) => signal.direction === 'entry').length;
  const exits = signals.length - entries;
  return (
    <span className="pill-row">
      {entries > 0 ? (
        <Pill tone="blue">
          <InlineNum>{entries}</InlineNum> entry
        </Pill>
      ) : null}
      {exits > 0 ? (
        <Pill tone="gray">
          <InlineNum>{exits}</InlineNum> exit
        </Pill>
      ) : null}
    </span>
  );
}

const decimal = (value) => num(value, 2);

export default function Watchlist({ onClose }) {
  const navigate = useNavigate();
  const { data, error, loading, updatedAt, refetch } = usePoll('/api/watchlist');
  const rows = data ?? [];

  const observed = rows.filter((row) => isNum(row.mention_zscore)).length;
  const signalling = rows.filter((row) => row.active_signals.length > 0).length;

  useRail(
    () => (
      <>
        <RailBlock icon={Radar} title="Watchlist">
          <RailLine label="Tickers">
            <Num value={rows.length || undefined} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="With z-score">
            <Num value={rows.length ? observed : undefined} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Signalling 24h">
            <Num value={rows.length ? signalling : undefined} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Freshest">
            {rows[0]?.features_ts ? (
              <span className="num">{ago(rows[0].features_ts)}</span>
            ) : (
              <NoData reason="no feature rows" />
            )}
          </RailLine>
        </RailBlock>
        <RailNote>Open a ticker for its price and mention history.</RailNote>
      </>
    ),
    [rows.length, observed, signalling]
  );

  const columns = [
    {
      key: 'symbol',
      header: 'Ticker',
      cell: (row) => (
        <>
          <span className="sym">{row.symbol}</span>
          {row.name ? <span className="sub">{row.name}</span> : null}
        </>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      cell: (row) => <Num value={row.price} format={price} reason="no recent quote" />,
    },
    {
      key: 'conviction',
      header: 'Max conviction',
      align: 'right',
      cell: (row) => <Num value={row.max_conviction} format={decimal} reason="no conviction scored" />,
    },
    {
      key: 'zscore',
      header: 'Mention z-score',
      align: 'right',
      cell: (row) => <Num value={row.mention_zscore} format={decimal} reason="no social observations" />,
    },
    {
      key: 'trend',
      header: '24h trend',
      cell: (row) => (
        <Sparkline
          points={row.mention_zscore_sparkline}
          valueKey="mention_zscore"
          label={`${row.symbol} mention z-score`}
        />
      ),
    },
    {
      key: 'velocity',
      header: 'Social velocity',
      align: 'right',
      cell: (row) => <Num value={row.social_velocity} format={decimal} reason="no social observations" />,
    },
    {
      key: 'exhaustion',
      header: 'Exhaustion',
      align: 'right',
      cell: (row) => <Num value={row.exhaustion_score} format={decimal} reason="no social observations" />,
    },
    {
      key: 'signals',
      header: 'Signals (24h)',
      cell: (row) => <Signals signals={row.active_signals} />,
    },
    {
      key: 'age',
      header: 'Feature age',
      align: 'right',
      cell: (row) =>
        row.features_ts ? (
          <span className="num" title={row.features_ts}>
            {ago(row.features_ts)}
          </span>
        ) : (
          <NoData reason="no feature rows" />
        ),
    },
  ];

  return (
    <Sheet
      title="Watchlist"
      lead={data ? lead(rows) : null}
      updatedAt={updatedAt}
      onClose={onClose}
    >
      {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
      {loading && !data ? <p className="hint">Loading watchlist…</p> : null}
      {data ? (
        <Rows
          caption="Watchlist tickers with their latest social and market features"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.symbol}
          rowLabel={(row) => row.symbol}
          onRowClick={(row) => navigate(`/watchlist/${row.symbol}`)}
        />
      ) : null}
    </Sheet>
  );
}
