import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BookOpen,
  CalendarDays,
  Clock,
  DollarSign,
  Eye,
  Flame,
  Gauge,
  Hash,
  Layers,
  LineChart as LineChartIcon,
  MessageSquare,
  Scissors,
  TrendingUp,
} from 'lucide-react';
import { usePoll } from '../api.js';
import Sheet from '../Sheet.jsx';
import { chartColors, tickStyle } from '../chart.js';
import { RailBlock, RailLine, RailNote } from '../Rail.jsx';
import { useRail } from '../railContext.jsx';
import { useTheme } from '../theme.jsx';
import { Breadth, Empty, ErrorBanner, InlineNum, NoData, Num, Section, Stat } from '../ui.jsx';
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

const dayLabel = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});

const utcDay = (value) => dayLabel.format(new Date(`${value}T00:00:00Z`));

function WikiTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="tooltip">
      <div>
        <span>UTC day</span> {utcDay(point.period_date)}
      </div>
      <div>
        <span>Views</span> {isNum(point.wiki_views) ? num(point.wiki_views, 0) : 'not measured'}
      </div>
      <div>
        <span>Last price</span> {isNum(point.price) ? price(point.price) : 'no snapshot'}
      </div>
    </div>
  );
}

function WikiChart({ series }) {
  const { theme } = useTheme();
  const colors = chartColors(theme);
  const tick = tickStyle(colors);
  const prices = series.filter((point) => isNum(point.price)).length;

  return (
    <>
      <div className="chart">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="2 3" vertical={false} />
            <XAxis
              dataKey="period_date"
              tickFormatter={utcDay}
              tick={tick}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              yAxisId="views"
              tickFormatter={(value) => num(value, 0)}
              tick={tick}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              tickFormatter={(value) => price(value)}
              tick={tick}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <Tooltip content={<WikiTooltip />} cursor={{ stroke: colors.grid }} />
            <Line
              yAxisId="views"
              type="linear"
              dataKey="wiki_views"
              stroke={colors.ink}
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="price"
              type="linear"
              dataKey="price"
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
        Solid line: daily pageviews, left axis. Dashed line: the last price observed on that UTC
        day, right axis — a UTC day is not a trading session, so this is not a close.{' '}
        <InlineNum>{series.length}</InlineNum> days carry a view count,{' '}
        <InlineNum>{prices}</InlineNum> carry a price.
      </p>
    </>
  );
}

function WikiSection({ data }) {
  if (!data.wiki_article) {
    return (
      <Empty icon={BookOpen} label="Wikipedia" title="No article is mapped for this ticker.">
        The mapping is curated rather than guessed, and no sensible English Wikipedia article
        exists for this company. This instrument is excluded from its attention breadth
        denominator rather than counted as quiet.
      </Empty>
    );
  }

  return (
    <>
      <dl className="stats">
        <Stat icon={Eye} label="Views">
          <Num value={data.wiki_views} format={(value) => num(value, 0)} reason="not measured yet" />
        </Stat>
        <Stat icon={CalendarDays} label="UTC day measured">
          {data.wiki_views_date ? (
            <span className="num">{data.wiki_views_date}</span>
          ) : (
            <NoData reason="no daily count has been read yet" />
          )}
        </Stat>
        <Stat icon={Gauge} label="Views z-score">
          <Num
            value={data.wiki_views_zscore}
            format={decimal}
            reason="fewer than 20 daily observations"
          />
        </Stat>
      </dl>
      {data.wiki_series.length > 0 ? (
        <WikiChart series={data.wiki_series} />
      ) : (
        <Empty icon={BookOpen} label="Wikipedia" title="No daily counts have landed yet.">
          The article is mapped, but no pageview rows have been read for it.
        </Empty>
      )}
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
          <Section icon={Gauge} title="Where it stands now" note="The latest feature row computed for this ticker.">
            <dl className="stats">
              <Stat icon={DollarSign} label="Price">
                <Num value={data.price} format={price} reason="no recent quote" />
              </Stat>
              <Stat icon={MessageSquare} label="Mention z-score">
                <Num value={data.mention_zscore} format={decimal} reason="no social observations" />
              </Stat>
              <Stat icon={MessageSquare} label="Mentions 24h">
                <Num value={data.mentions_24h} format={(value) => num(value, 0)} reason="not computed" />
              </Stat>
              <Stat icon={TrendingUp} label="Mention growth 24h">
                <Num value={data.mention_growth_24h} format={decimal} reason="not computed" />
              </Stat>
              <Stat icon={Flame} label="Exhaustion">
                <Num value={data.exhaustion_score} format={decimal} reason="not computed" />
              </Stat>
              <Stat icon={TrendingUp} label="Price momentum">
                <Num value={data.price_momentum} format={decimal} reason="not computed" />
              </Stat>
              <Stat icon={Layers} label="Attention breadth">
                <Breadth value={data.attention_breadth} of={data.attention_breadth_of} />
              </Stat>
            </dl>
          </Section>

          <Section
            icon={BookOpen}
            title="Wikipedia attention"
            note="One observation per UTC day, published by Wikimedia about a day in arrears and held unchanged across that day's ticks. Automated traffic is excluded."
          >
            <WikiSection data={data} />
          </Section>

          <Section
            icon={LineChartIcon}
            title="Price and attention over time"
            note="Both series come from our own snapshots. Where an hour was never observed, the line breaks instead of guessing."
          >
            <Chart series={data.series} />
          </Section>

          <Section icon={Scissors} title="Short interest" note="Reported by FINRA, twice a month.">
            <dl className="stats">
              <Stat icon={Clock} label="Days to cover">
                <Num value={data.days_to_cover} format={decimal} reason="no short interest recorded" />
              </Stat>
              <Stat icon={Hash} label="Shares short">
                <Num value={data.shares_short} format={(value) => num(value, 0)} reason="no short interest recorded" />
              </Stat>
              <Stat icon={CalendarDays} label="Settlement date">
                {data.short_interest_settlement_date ? (
                  <span className="num">{stamp(data.short_interest_settlement_date)}</span>
                ) : (
                  <NoData reason="no short interest recorded" />
                )}
              </Stat>
            </dl>
          </Section>
        </>
      ) : null}
    </Sheet>
  );
}
