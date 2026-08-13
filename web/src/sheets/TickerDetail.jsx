import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LineChart as LineChartIcon } from 'lucide-react';
import { usePoll } from '../api.js';
import Sheet from '../Sheet.jsx';
import { chartColors, tickStyle } from '../chart.js';
import { RailBlock, RailLine, RailNote } from '../Rail.jsx';
import { useRail } from '../railContext.jsx';
import { useTheme } from '../theme.jsx';
import { Empty, ErrorBanner, InlineNum, NoData, Num, Stat } from '../ui.jsx';
import { isNum, num, price, stamp } from '../format.js';

const decimal = (value) => num(value, 2);

const hourLabel = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  hourCycle: 'h23',
});

function SeriesTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="tooltip">
      <div>
        <span>Hour</span> {hourLabel.format(new Date(point.ts))}
      </div>
      <div>
        <span>Price</span> {isNum(point.price) ? price(point.price) : 'no snapshot'}
      </div>
      <div>
        <span>Mention z</span> {isNum(point.mention_zscore) ? decimal(point.mention_zscore) : 'not computed'}
      </div>
    </div>
  );
}

function Chart({ series }) {
  const { theme } = useTheme();
  const colors = chartColors(theme);
  const tick = tickStyle(colors);

  const prices = series.filter((point) => isNum(point.price)).length;
  const zscores = series.filter((point) => isNum(point.mention_zscore)).length;

  if (prices === 0 && zscores === 0) {
    return (
      <Empty icon={LineChartIcon} label="History" title="Nothing observed in the last 7 days.">
        No price snapshot and no computed mention z-score fell inside the window, so there is no
        line to draw. Gaps are never interpolated.
      </Empty>
    );
  }

  return (
    <>
      <div className="chart">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="2 3" vertical={false} />
            <XAxis
              dataKey="ts"
              tickFormatter={(value) => hourLabel.format(new Date(value))}
              tick={tick}
              axisLine={false}
              tickLine={false}
              minTickGap={56}
            />
            <YAxis
              yAxisId="price"
              tickFormatter={(value) => price(value)}
              tick={tick}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <YAxis
              yAxisId="z"
              orientation="right"
              tickFormatter={(value) => decimal(value)}
              tick={tick}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip content={<SeriesTooltip />} cursor={{ stroke: colors.grid }} />
            <Line
              yAxisId="price"
              type="linear"
              dataKey="price"
              stroke={colors.ink}
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="z"
              type="linear"
              dataKey="mention_zscore"
              stroke={colors.muted}
              strokeWidth={1.25}
              strokeDasharray="3 3"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="caveat">
        Solid line: price, left axis. Dashed line: mention z-score, right axis. Gaps are hours
        with no observation — the lines break rather than bridge them.{' '}
        <InlineNum>{prices}</InlineNum> of <InlineNum>{series.length}</InlineNum> hours carry a
        price, <InlineNum>{zscores}</InlineNum> carry a z-score.
      </p>
    </>
  );
}

export default function TickerDetail({ symbol, onClose }) {
  const { data, error, loading, updatedAt, refetch } = usePoll(`/api/ticker/${symbol}`);

  useRail(
    () => (
      <>
        <RailBlock icon={LineChartIcon} title={symbol}>
          <RailLine label="Price">
            <Num value={data?.price} format={price} reason="no recent quote" />
          </RailLine>
          <RailLine label="Mention z">
            <Num value={data?.mention_zscore} format={decimal} reason="not computed" />
          </RailLine>
          <RailLine label="Velocity">
            <Num value={data?.social_velocity} format={decimal} reason="not computed" />
          </RailLine>
          <RailLine label="Exhaustion">
            <Num value={data?.exhaustion_score} format={decimal} reason="not computed" />
          </RailLine>
          <RailLine label="Rel volume z">
            <Num value={data?.rel_volume_zscore} format={decimal} reason="not computed" />
          </RailLine>
          <RailLine label="Days to cover">
            <Num value={data?.days_to_cover} format={decimal} reason="no short interest" />
          </RailLine>
        </RailBlock>
        <RailNote>
          {data?.features_ts ? (
            <>
              Latest feature row <InlineNum>{stamp(data.features_ts)}</InlineNum>.
            </>
          ) : (
            'No feature row has been computed for this ticker.'
          )}
        </RailNote>
      </>
    ),
    [data]
  );

  return (
    <Sheet
      title={symbol}
      lead={
        data ? (
          <>
            <b>{data.name ?? 'Name not recorded'}.</b> Price and mention history over the last{' '}
            <InlineNum>{Math.round(data.series_hours / 24)}</InlineNum> days, from our own snapshots.
          </>
        ) : null
      }
      updatedAt={updatedAt}
      onClose={onClose}
    >
      {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
      {loading && !data ? <p className="hint">Loading {symbol}…</p> : null}

      {data ? (
        <>
          <dl className="stats">
            <Stat label="Price">
              <Num value={data.price} format={price} reason="no recent quote" />
            </Stat>
            <Stat label="Mention z-score">
              <Num value={data.mention_zscore} format={decimal} reason="no social observations" />
            </Stat>
            <Stat label="Mentions 24h">
              <Num value={data.mentions_24h} format={(value) => num(value, 0)} reason="not computed" />
            </Stat>
            <Stat label="Mention growth 24h">
              <Num value={data.mention_growth_24h} format={decimal} reason="not computed" />
            </Stat>
            <Stat label="Exhaustion">
              <Num value={data.exhaustion_score} format={decimal} reason="not computed" />
            </Stat>
            <Stat label="Price momentum">
              <Num value={data.price_momentum} format={decimal} reason="not computed" />
            </Stat>
          </dl>

          <hr className="rule" />
          <p className="micro">Price and mention z-score</p>
          <Chart series={data.series} />

          <hr className="rule" />
          <p className="micro">Short interest</p>
          <dl className="stats">
            <Stat label="Days to cover">
              <Num value={data.days_to_cover} format={decimal} reason="no short interest recorded" />
            </Stat>
            <Stat label="Shares short">
              <Num value={data.shares_short} format={(value) => num(value, 0)} reason="no short interest recorded" />
            </Stat>
            <Stat label="Settlement date">
              {data.short_interest_settlement_date ? (
                <span className="num">{stamp(data.short_interest_settlement_date)}</span>
              ) : (
                <NoData reason="no short interest recorded" />
              )}
            </Stat>
          </dl>
        </>
      ) : null}
    </Sheet>
  );
}
