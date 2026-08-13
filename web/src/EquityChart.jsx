import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartColors, tickStyle } from './chart.js';
import { signedPct, stamp } from './format.js';
import { useTheme } from './theme.jsx';

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="tooltip">
      <div>
        <span>Trade</span> {point.symbol ? `${point.symbol} #${point.trade_id}` : `#${point.trade_id}`}
      </div>
      <div>
        <span>This trade</span> {signedPct(point.pnl_pct)}
      </div>
      <div>
        <span>Cumulative</span> {signedPct(point.cum_pnl_pct)}
      </div>
      <div>
        <span>Closed</span> {stamp(point.ts)}
      </div>
    </div>
  );
}

export default function EquityChart({ points, height = 200 }) {
  const { theme } = useTheme();
  const colors = chartColors(theme);
  const tick = tickStyle(colors);

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <ReferenceLine y={0} stroke={colors.grid} strokeDasharray="2 3" />
          <XAxis
            dataKey="trade_id"
            tickFormatter={(id) => `#${id}`}
            tick={tick}
            axisLine={false}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis
            tickFormatter={(value) => signedPct(value)}
            tick={tick}
            axisLine={false}
            tickLine={false}
            width={72}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: colors.grid }} />
          <Line
            type="linear"
            dataKey="cum_pnl_pct"
            stroke={colors.ink}
            strokeWidth={1.5}
            dot={{ r: 2, fill: colors.ink, strokeWidth: 0 }}
            activeDot={{ r: 3, fill: colors.ink, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
