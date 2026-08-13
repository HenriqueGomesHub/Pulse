import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { clock } from './format.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Sheet({ title, lead, updatedAt, onClose, children }) {
  const sheetRef = useRef(null);
  const returnTo = useRef(null);

  useEffect(() => {
    returnTo.current = document.activeElement;
    sheetRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = overflow;
      // Send focus back to the node that opened this sheet, not to the page top.
      if (returnTo.current instanceof HTMLElement && document.contains(returnTo.current)) {
        returnTo.current.focus();
      }
    };
  }, []);

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...sheetRef.current.querySelectorAll(FOCUSABLE)].filter(
      (element) => element.offsetParent !== null
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="sheet-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        tabIndex={-1}
        ref={sheetRef}
        onKeyDown={onKeyDown}
      >
        <header className="sheet-head">
          <div className="sheet-title">
            <h1 id="sheet-title">{title}</h1>
            {lead ? <p>{lead}</p> : null}
          </div>
          <div className="sheet-tools">
            {updatedAt ? <p className="stamp">Updated {clock(updatedAt)} · polls every 30s</p> : null}
            <button type="button" className="icon-btn" onClick={onClose} aria-label={`Close ${title}`}>
              <X size={18} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}
