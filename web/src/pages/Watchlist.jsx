import { usePoll } from '../api.js';
import { ErrorBanner, InlineNum, NoData, Num, PageHead, Pill, Sparkline } from '../ui.jsx';
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

export default function Watchlist() {
  const { data, error, loading, updatedAt, refetch } = usePoll('/api/watchlist');
  const rows = data ?? [];

  return (
    <>
      <PageHead title="Watchlist" lead={data ? lead(rows) : null} updatedAt={updatedAt} />
      {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
      {loading && !data ? <p className="hint">Loading watchlist…</p> : null}
      {data ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Watchlist tickers with their latest social and market features</caption>
            <thead>
              <tr>
                <th scope="col">Ticker</th>
                <th scope="col" className="right">
                  Price
                </th>
                <th scope="col" className="right">
                  Max conviction
                </th>
                <th scope="col" className="right">
                  Mention z-score
                </th>
                <th scope="col">24h trend</th>
                <th scope="col" className="right">
                  Social velocity
                </th>
                <th scope="col" className="right">
                  Exhaustion
                </th>
                <th scope="col">Signals (24h)</th>
                <th scope="col" className="right">
                  Feature age
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.symbol}>
                  <th scope="row">
                    <span className="sym">{row.symbol}</span>
                    {row.name ? <span className="sub">{row.name}</span> : null}
                  </th>
                  <td className="right">
                    <Num value={row.price} format={price} reason="no recent quote" />
                  </td>
                  <td className="right">
                    <Num value={row.max_conviction} format={(v) => num(v, 2)} reason="no conviction scored" />
                  </td>
                  <td className="right">
                    <Num value={row.mention_zscore} format={(v) => num(v, 2)} reason="no social observations" />
                  </td>
                  <td>
                    <Sparkline
                      points={row.mention_zscore_sparkline}
                      valueKey="mention_zscore"
                      label={`${row.symbol} mention z-score`}
                    />
                  </td>
                  <td className="right">
                    <Num value={row.social_velocity} format={(v) => num(v, 2)} reason="no social observations" />
                  </td>
                  <td className="right">
                    <Num value={row.exhaustion_score} format={(v) => num(v, 2)} reason="no social observations" />
                  </td>
                  <td>
                    <Signals signals={row.active_signals} />
                  </td>
                  <td className="right">
                    {row.features_ts ? (
                      <span className="num" title={row.features_ts}>
                        {ago(row.features_ts)}
                      </span>
                    ) : (
                      <NoData reason="no feature rows" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
