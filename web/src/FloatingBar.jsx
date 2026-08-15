import { useNavigate } from 'react-router-dom';
import { Radar } from 'lucide-react';
import { useStore } from './store.jsx';
import { NoData, Num } from './ui.jsx';
import { conditionLabel, conditionThreshold, featureValue, isNum, num, pnlTone, signedPct } from './format.js';

const sumPnl = (trades) => {
  const marked = trades.filter((trade) => isNum(trade.pnl_pct));
  if (marked.length === 0) return null;
  return marked.reduce((total, trade) => total + trade.pnl_pct, 0);
};

function Slot({ label, children }) {
  return (
    <div className="bar-slot">
      <span className="micro">{label}</span>
      <span className="bar-value">{children}</span>
    </div>
  );
}

function gateSummary(candidate) {
  return candidate.gates
    .map((gate) => {
      const current = isNum(gate.current) ? featureValue(gate.feature, gate.current) : 'not computed';
      return `${gate.met ? 'cleared' : 'not cleared'}: ${conditionLabel(gate)} ${conditionThreshold(gate)}, now ${current}`;
    })
    .join('. ');
}

function breadthSummary(candidate) {
  if (!isNum(candidate.attention_breadth) || !isNum(candidate.attention_breadth_of)) {
    return 'No attention instrument has a baseline for this ticker yet';
  }
  return `${candidate.attention_breadth} of ${candidate.attention_breadth_of} attention instruments elevated`;
}

function Candidate({ candidate, onOpen }) {
  const breadth =
    isNum(candidate.attention_breadth) && isNum(candidate.attention_breadth_of)
      ? `${candidate.attention_breadth}/${candidate.attention_breadth_of}`
      : '—';

  return (
    <li>
      <button
        type="button"
        className="cand"
        onClick={onOpen}
        title={gateSummary(candidate)}
        aria-label={`${candidate.symbol}, ${candidate.gates_met} of ${candidate.gates_total} entry gates cleared for ${candidate.strategy_name}. ${breadthSummary(candidate)}. ${gateSummary(candidate)}`}
      >
        <span className="cand-top">
          <span className="sym">{candidate.symbol}</span>
          <span className="num cand-score">
            {candidate.gates_met}/{candidate.gates_total}
          </span>
        </span>
        <span className="cand-bottom">
          <span className="cand-strategy">{candidate.strategy_name}</span>
          <span className="num cand-breadth" aria-hidden="true">
            {breadth}
          </span>
          <span className="cand-gates" aria-hidden="true">
            {candidate.gates.map((gate, index) => (
              <i
                key={`${gate.feature}-${gate.op}-${index}`}
                className={gate.met ? 'gate gate--met' : isNum(gate.current) ? 'gate' : 'gate gate--unknown'}
              />
            ))}
          </span>
        </span>
      </button>
    </li>
  );
}

export default function FloatingBar() {
  const navigate = useNavigate();
  const { pnl, trades, near } = useStore();

  const open = trades.data?.open ?? [];
  const realized = pnl.data?.totals?.total_pnl_pct ?? null;
  const unrealized = sumPnl(open);
  const total =
    isNum(realized) || isNum(unrealized) ? (realized ?? 0) + (unrealized ?? 0) : null;
  const candidates = near.data?.candidates ?? [];

  return (
    <div className="bar" role="region" aria-label="Book summary and nearest entry candidates">
      <div className="bar-stats">
        <Slot label="Total">
          <Num value={total} format={signedPct} tone={pnlTone(total)} reason="nothing marked yet" />
        </Slot>
        <Slot label="Realized">
          <Num value={realized} format={signedPct} tone={pnlTone(realized)} reason="no closed trades" />
        </Slot>
        <Slot label="Unrealized">
          <Num value={unrealized} format={signedPct} tone={pnlTone(unrealized)} reason="nothing open" />
        </Slot>
        <Slot label="Open">
          <Num value={open.length} format={(value) => num(value, 0)} />
        </Slot>
      </div>

      <div className="bar-near">
        <p className="micro bar-near-label">
          <Radar size={14} strokeWidth={1.5} aria-hidden="true" />
          Nearest entries
        </p>
        {candidates.length > 0 ? (
          <ul className="cand-scroll">
            {candidates.map((candidate) => (
              <Candidate
                key={`${candidate.strategy_id}-${candidate.symbol}`}
                candidate={candidate}
                onOpen={() => navigate(`/watchlist/${candidate.symbol}`)}
              />
            ))}
          </ul>
        ) : (
          <p className="hint bar-near-empty">
            {near.error ? (
              'Candidates unavailable.'
            ) : near.loading ? (
              'Reading gates…'
            ) : (
              <>
                No active strategy has a ticker in range. <NoData reason="no candidates" />
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
