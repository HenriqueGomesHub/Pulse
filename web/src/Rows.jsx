import { ChevronRight } from 'lucide-react';
import { useDesktop } from './useMedia.js';

// One column spec, two renderers. Desktop gets a real <table>; below 768px the
// same columns become stacked cards. Reflowing the table with display:block
// would keep the markup but strip the row/column semantics screen readers use.
export default function Rows({ caption, columns, rows, rowKey, onRowClick, rowLabel }) {
  const desktop = useDesktop();
  const [head, ...rest] = columns;

  if (desktop) {
    return (
      <div className="table-wrap">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={column.align === 'right' ? 'right' : undefined}>
                  {column.header}
                </th>
              ))}
              {onRowClick ? (
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column, index) =>
                  index === 0 ? (
                    <th key={column.key} scope="row">
                      {column.cell(row)}
                    </th>
                  ) : (
                    <td key={column.key} className={column.align === 'right' ? 'right' : undefined}>
                      {column.cell(row)}
                    </td>
                  )
                )}
                {onRowClick ? (
                  <td>
                    <button type="button" className="btn-ghost" onClick={() => onRowClick(row)}>
                      Open
                      <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
                      <span className="sr-only"> {rowLabel ? rowLabel(row) : ''}</span>
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // The card is a div, never a button: a <dl> inside a <button> is invalid, and it
  // flattens every label and value into one enormous accessible name. Instead a
  // real button in the head carries the name and stretches over the whole card, so
  // the tap target is the card while the announced name stays just the row's.
  return (
    <ul className="row-cards" aria-label={caption}>
      {rows.map((row) => (
        <li key={rowKey(row)}>
          <div className={onRowClick ? 'row-card row-card--tap' : 'row-card'}>
            <div className="row-card-head">
              {onRowClick ? (
                <button type="button" className="row-card-open" onClick={() => onRowClick(row)}>
                  {head.cell(row)}
                  <span className="sr-only">Open {rowLabel ? rowLabel(row) : ''}</span>
                </button>
              ) : (
                head.cell(row)
              )}
              {onRowClick ? <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" /> : null}
            </div>
            <dl className="row-card-grid">
              {rest.map((column) => (
                <div key={column.key}>
                  <dt className="micro">{column.header}</dt>
                  <dd>{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </li>
      ))}
    </ul>
  );
}
