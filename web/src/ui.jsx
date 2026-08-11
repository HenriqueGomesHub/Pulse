import { clock, conditionLabel, conditionThreshold, isNum } from './format.js';

export function InlineNum({ children }) {
  return <span className="num-inline">{children}</span>;
}

export function ConditionText({ condition }) {
  return (
    <>
      {conditionLabel(condition)} <InlineNum>{conditionThreshold(condition)}</InlineNum>
    </>
  );
}

export function NoData({ reason = 'no data' }) {
  return (
    <span className="nodata">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{reason}</span>
    </span>
  );
}

export function Num({ value, format, tone, reason }) {
  if (!isNum(value)) return <NoData reason={reason} />;
  return <span className={tone ? `num num--${tone}` : 'num'}>{format(value)}</span>;
}

export function Pill({ tone = 'gray', children }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

export function Stat({ label, children }) {
  return (
    <div className="stat">
      <dt className="micro">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function PageHead({ title, lead, updatedAt }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {lead ? <p>{lead}</p> : null}
      </div>
      {updatedAt ? (
        <p className="stamp">Updated {clock(updatedAt)} · polls every 30s</p>
      ) : null}
    </header>
  );
}

export function ErrorBanner({ error, onRetry }) {
  return (
    <div className="banner" role="alert">
      <div>
        <b>Request failed.</b> The dashboard is showing nothing new until this clears.
        <p>{error.message}</p>
      </div>
      <button type="button" className="btn" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export function Empty({ icon: Icon, label, title, children }) {
  return (
    <div className="empty">
      <p className="flag">
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
        {label}
      </p>
      <p>
        <strong>{title}</strong>
        {children}
      </p>
    </div>
  );
}

function runsOf(values) {
  const runs = [];
  let run = null;
  values.forEach((value, index) => {
    if (isNum(value)) {
      if (!run) {
        run = [];
        runs.push(run);
      }
      run.push({ index, value });
    } else {
      run = null;
    }
  });
  return runs;
}

export function Sparkline({ points, valueKey, width = 72, height = 24, label }) {
  const values = points.map((point) => point[valueKey]);
  const runs = runsOf(values);

  if (runs.length === 0) {
    return (
      <span className="spark" title={`${label}: no signal yet`}>
        <svg width={width} height={height} aria-hidden="true">
          <line
            x1="0"
            y1={height / 2}
            x2={width}
            y2={height / 2}
            stroke="#e8e9eb"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        </svg>
        <span className="sr-only">{label}: no signal yet</span>
      </span>
    );
  }

  const pad = 3;
  const observed = values.filter(isNum);
  const min = Math.min(...observed);
  const max = Math.max(...observed);
  const span = max - min;
  const x = (index) =>
    values.length < 2 ? width / 2 : pad + (index / (values.length - 1)) * (width - pad * 2);
  const y = (value) =>
    span === 0 ? height / 2 : pad + (1 - (value - min) / span) * (height - pad * 2);

  return (
    <span className="spark" title={`${label}: ${observed.length} of ${values.length} observed`}>
      <svg width={width} height={height} aria-hidden="true">
        {runs.map((run) =>
          run.length === 1 ? (
            <circle key={run[0].index} cx={x(run[0].index)} cy={y(run[0].value)} r="1.75" fill="#1c1d1f" />
          ) : (
            <polyline
              key={run[0].index}
              points={run.map((p) => `${x(p.index)},${y(p.value)}`).join(' ')}
              fill="none"
              stroke="#1c1d1f"
              strokeWidth="1.25"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )
        )}
      </svg>
      <span className="sr-only">
        {label}: {observed.length} of {values.length} points observed, latest {observed[observed.length - 1].toFixed(2)}
      </span>
    </span>
  );
}
