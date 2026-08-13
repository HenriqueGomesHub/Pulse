import { GitCommitVertical } from 'lucide-react';
import { usePoll } from '../api.js';
import Sheet from '../Sheet.jsx';
import { RailBlock, RailLine, RailNote } from '../Rail.jsx';
import { useRail } from '../railContext.jsx';
import { Empty, ErrorBanner, InlineNum, Num, Pill, Section } from '../ui.jsx';
import { num, pnlTone, signedPct, stamp } from '../format.js';

const ACTION = {
  retire: { label: 'Retired', tone: 'gray' },
  mutate: { label: 'Mutated', tone: 'blue' },
  promote: { label: 'Promoted', tone: 'green' },
};

function Event({ event }) {
  const action = ACTION[event.action] ?? { label: event.action, tone: 'gray' };
  return (
    <li className="tl-item">
      <span className="tl-mark" aria-hidden="true" />
      <div>
        <p className="tl-head">
          <Pill tone={action.tone}>{action.label}</Pill>
          <span className="sym">{event.strategy ? event.strategy.name : 'unknown strategy'}</span>
          {event.strategy ? <span className="badge">Gen {event.strategy.generation}</span> : null}
          <span className="stamp">{stamp(event.ts)}</span>
        </p>
        <p className="tl-note">{event.rationale}</p>
        <p className="tl-meta">
          Holdout expectancy{' '}
          <Num
            value={event.holdout_expectancy}
            format={signedPct}
            tone={pnlTone(event.holdout_expectancy)}
            reason="not measurable from the replay"
          />
          {event.parent ? (
            <>
              {' '}
              · descended from {event.parent.name} (generation{' '}
              <InlineNum>{event.parent.generation}</InlineNum>)
            </>
          ) : null}
          {event.strategy ? (
            <>
              {' '}
              · now <InlineNum>{event.strategy.status}</InlineNum>
            </>
          ) : null}
        </p>
      </div>
    </li>
  );
}

export default function Evolution({ onClose }) {
  const { data, error, loading, updatedAt, refetch } = usePoll('/api/evolution');
  const events = data ?? [];
  const counts = ACTION;

  useRail(
    () => (
      <>
        <RailBlock icon={GitCommitVertical} title="Evolution">
          <RailLine label="Events">
            <Num value={data ? events.length : undefined} format={(value) => num(value, 0)} reason="not loaded" />
          </RailLine>
          {Object.keys(counts).map((action) => (
            <RailLine key={action} label={counts[action].label}>
              <Num
                value={data ? events.filter((event) => event.action === action).length : undefined}
                format={(value) => num(value, 0)}
                reason="not loaded"
              />
            </RailLine>
          ))}
          <RailLine label="Latest">
            {events[0] ? <span className="num">{stamp(events[0].ts)}</span> : <span className="rail-text">—</span>}
          </RailLine>
        </RailBlock>
        <RailNote>The cycle runs weekly, on Sunday.</RailNote>
      </>
    ),
    [data, events.length]
  );

  return (
    <Sheet
      title="Evolution"
      lead={
        data ? (
          <>
            <b>
              <InlineNum>{events.length}</InlineNum> {events.length === 1 ? 'event' : 'events'}.
            </b>{' '}
            The weekly cycle retires the worst qualifying strategy, asks for parameter mutations, and
            promotes only the candidates whose holdout replay beats the strategy it retired.
          </>
        ) : null
      }
      updatedAt={updatedAt}
      onClose={onClose}
    >
      {error ? <ErrorBanner error={error} onRetry={refetch} /> : null}
      {loading && !data ? <p className="hint">Loading the evolution log…</p> : null}

      {data && events.length === 0 ? (
        <Empty icon={GitCommitVertical} label="Evolution log" title="No evolution events yet.">
          The cycle runs weekly on Sunday and judges a strategy only once it has at least{' '}
          <InlineNum>10</InlineNum> closed trades in the last 30 days. Until one does, it retires
          nothing and records nothing here.
        </Empty>
      ) : null}

      {events.length > 0 ? (
        <Section
          icon={GitCommitVertical}
          title="What the weekly cycle did"
          note="Newest first. Each entry records what changed and the holdout result that justified it."
        >
          <ol className="timeline">
            {events.map((event) => (
              <Event key={event.id} event={event} />
            ))}
          </ol>
        </Section>
      ) : null}
    </Sheet>
  );
}
