import {
  AlertTriangle,
  Briefcase,
  CircleOff,
  Clock,
  EyeOff,
  HeartPulse,
  Percent,
  Radio,
  Trash2,
} from 'lucide-react';
import { usePoll } from '../api.js';
import Sheet from '../Sheet.jsx';
import { RailBlock, RailLine, RailNote } from '../Rail.jsx';
import { useRail } from '../railContext.jsx';
import { useStore } from '../store.jsx';
import { ErrorBanner, InlineNum, NoData, Num, Section, Stat } from '../ui.jsx';
import { ago, isNum, num, pct, stamp } from '../format.js';

const newest = (values) => {
  const times = values.filter(Boolean).map((value) => new Date(value).getTime());
  return times.length === 0 ? null : new Date(Math.max(...times)).toISOString();
};

const oldest = (values) => {
  const times = values.filter(Boolean).map((value) => new Date(value).getTime());
  return times.length === 0 ? null : new Date(Math.min(...times)).toISOString();
};

function Age({ iso, reason }) {
  if (!iso) return <NoData reason={reason} />;
  return (
    <span className="num" title={stamp(iso)}>
      {ago(iso)}
    </span>
  );
}

export default function Health({ onClose }) {
  const { strategies } = useStore();
  const watchlist = usePoll('/api/watchlist');
  const signals = usePoll('/api/signals');
  const shadow = usePoll('/api/shadow');

  const tickers = watchlist.data ?? [];
  const feed = signals.data ?? [];
  const rows = strategies.data ?? [];

  const freshest = newest(tickers.map((row) => row.features_ts));
  const stalest = oldest(tickers.map((row) => row.features_ts));
  const withoutFeatures = tickers.filter((row) => !row.features_ts).length;
  const withoutPrice = tickers.filter((row) => !isNum(row.price)).length;
  const withoutZscore = tickers.filter((row) => !isNum(row.mention_zscore)).length;
  const active = rows.filter((row) => row.status === 'active').length;

  const error = watchlist.error ?? signals.error ?? shadow.error;
  const retry = watchlist.error ? watchlist.refetch : signals.error ? signals.refetch : shadow.refetch;

  useRail(
    () => (
      <>
        <RailBlock icon={HeartPulse} title="Freshness">
          <RailLine label="Features">
            <Age iso={freshest} reason="no feature rows" />
          </RailLine>
          <RailLine label="Last signal">
            <Age iso={feed[0]?.ts} reason="no signals recorded" />
          </RailLine>
          <RailLine label="Active strategies">
            <Num value={rows.length ? active : undefined} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          <RailLine label="Tickers">
            <Num value={tickers.length || undefined} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
        </RailBlock>
        <RailNote>
          These are observations, not verdicts. Pulse publishes no health thresholds, so none are
          invented here.
        </RailNote>
      </>
    ),
    [freshest, feed.length, active, tickers.length]
  );

  return (
    <Sheet
      title="System health"
      lead={
        watchlist.data ? (
          <>
            <b>
              <InlineNum>{tickers.length}</InlineNum> tickers,{' '}
              <InlineNum>{active}</InlineNum> active strategies.
            </b>{' '}
            Every figure below is measured from the same endpoints the rest of the dashboard reads —
            nothing is a self-report.
          </>
        ) : null
      }
      updatedAt={watchlist.updatedAt}
      onClose={onClose}
    >
      {error ? <ErrorBanner error={error} onRetry={retry} /> : null}
      {watchlist.loading && !watchlist.data ? <p className="hint">Loading health…</p> : null}

      {watchlist.data ? (
        <>
          <Section
            icon={Clock}
            title="How fresh the data is"
            note="How long ago the pipeline last produced each kind of row."
          >
            <dl className="stats">
              <Stat icon={Clock} label="Newest feature row">
                <Age iso={freshest} reason="no feature rows at all" />
              </Stat>
              <Stat icon={Clock} label="Oldest feature row">
                <Age iso={stalest} reason="no feature rows at all" />
              </Stat>
              <Stat icon={Radio} label="Last signal">
                <Age iso={feed[0]?.ts} reason="no signals recorded" />
              </Stat>
            </dl>
          </Section>

          <Section
            icon={AlertTriangle}
            title="Coverage gaps"
            note="A gap is a ticker the pipeline has not produced that value for. It is not necessarily a fault — a ticker nobody has mentioned has no z-score to compute."
          >
            <dl className="stats">
              <Stat icon={CircleOff} label="No feature row">
                <Num value={withoutFeatures} format={(value) => num(value, 0)} />
              </Stat>
              <Stat icon={CircleOff} label="No recent price">
                <Num value={withoutPrice} format={(value) => num(value, 0)} />
              </Stat>
              <Stat icon={CircleOff} label="No mention z-score">
                <Num value={withoutZscore} format={(value) => num(value, 0)} />
              </Stat>
              <Stat icon={Radio} label="Signals in feed">
                <Num
                  value={signals.data ? feed.length : undefined}
                  format={(value) => num(value, 0)}
                  reason="not loaded"
                />
              </Stat>
            </dl>
          </Section>

          <Section
            icon={EyeOff}
            title="Shadow book"
            note="Counterfactual entries the guards refused, and how many were dropped without being recorded."
          >
            <dl className="stats">
              <Stat icon={Trash2} label="Dropped today">
                <Num value={shadow.data?.drops?.today} format={(value) => num(value, 0)} reason="not loaded" />
              </Stat>
              <Stat icon={Trash2} label="Dropped total">
                <Num value={shadow.data?.drops?.total} format={(value) => num(value, 0)} reason="not loaded" />
              </Stat>
              <Stat icon={Percent} label="Slippage per side">
                <Num value={shadow.data?.slippage_pct_per_side} format={pct} reason="not loaded" />
              </Stat>
              <Stat icon={Briefcase} label="Open shadow">
                <Num
                  value={shadow.data ? shadow.data.open.length : undefined}
                  format={(value) => num(value, 0)}
                  reason="not loaded"
                />
              </Stat>
            </dl>
          </Section>
        </>
      ) : null}
    </Sheet>
  );
}
