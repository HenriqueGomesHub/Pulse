import { createContext, useContext } from 'react';
import { usePoll } from './api.js';

// The endpoints the shell itself needs: the floating bar's numbers, the canvas
// strategy fan, and the rail's default summary. Polled once here rather than
// once per consumer. Heavier per-sheet data (watchlist, shadow, ticker series,
// evolution) stays with the sheet that opens it.
const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const pnl = usePoll('/api/pnl');
  const trades = usePoll('/api/trades');
  const strategies = usePoll('/api/strategies');
  const near = usePoll('/api/near-signals');

  return (
    <StoreContext.Provider value={{ pnl, trades, strategies, near }}>{children}</StoreContext.Provider>
  );
}

export const useStore = () => useContext(StoreContext);
