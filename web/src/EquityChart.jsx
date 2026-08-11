import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { signedPct, stamp } from './format.js';

const TICK = { fontSize: 11, fill: '#5c5e63', fontFamily: "'Geist Mono', ui-monospace, monospace" };

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
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <ReferenceLine y={0} stroke="#e8e9eb" strokeDasharray="2 3" />
          <XAxis
            dataKey="trade_id"
            tickFormatter={(id) => `#${id}`}
            tick={TICK}
            axisLine={false}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis
            tickFormatter={(value) => signedPct(value)}
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={72}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#e8e9eb' }} />
          <Line
            type="linear"
            dataKey="cum_pnl_pct"
            stroke="#1c1d1f"
            strokeWidth={1.5}
            dot={{ r: 2, fill: '#1c1d1f', strokeWidth: 0 }}
            activeDot={{ r: 3, fill: '#1c1d1f', strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
