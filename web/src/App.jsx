import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import Canvas from './canvas/Canvas.jsx';
import FloatingBar from './FloatingBar.jsx';
import Rail from './Rail.jsx';
import { RailProvider } from './railContext.jsx';
import { StoreProvider, useStore } from './store.jsx';
import { ThemeProvider, useTheme } from './theme.jsx';

// Sheets load on open. This keeps recharts — the bulk of the bundle — out of the
// chunk that has to arrive before the canvas can be drawn.
const Overview = lazy(() => import('./sheets/Overview.jsx'));
const Watchlist = lazy(() => import('./sheets/Watchlist.jsx'));
const TickerDetail = lazy(() => import('./sheets/TickerDetail.jsx'));
const Strategies = lazy(() => import('./sheets/Strategies.jsx'));
const StrategyDetail = lazy(() => import('./sheets/StrategyDetail.jsx'));
const CurrentTrades = lazy(() => import('./sheets/CurrentTrades.jsx'));
const TradeLog = lazy(() => import('./sheets/TradeLog.jsx'));
const Evolution = lazy(() => import('./sheets/Evolution.jsx'));
const Health = lazy(() => import('./sheets/Health.jsx'));

function activeNodeId(pathname) {
  const [, first, second] = pathname.split('/');
  if (!first) return null;
  if (first === 'strategies' && second) return `strategy-${second}`;
  return first;
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const Icon = dark ? Sun : Moon;

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to night theme'}
      title={dark ? 'Light' : 'Night'}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}

function StrategySheet({ onClose }) {
  const { id } = useParams();
  return <StrategyDetail id={id} onClose={onClose} />;
}

function TickerSheet({ onClose }) {
  const { symbol } = useParams();
  return <TickerDetail symbol={symbol} onClose={onClose} />;
}

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { strategies } = useStore();
  const close = () => navigate('/');

  return (
    <div className="shell">
      <div className="stage">
        <header className="topbar">
          <p className="brand">
            Pulse
            <span>Paper trading</span>
          </p>
          <ThemeToggle />
        </header>

        <Canvas strategies={strategies.data ?? []} activeId={activeNodeId(location.pathname)} />
        <FloatingBar />
      </div>

      <Rail />

      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={null} />
          <Route path="/overview" element={<Overview onClose={close} />} />
          <Route path="/watchlist" element={<Watchlist onClose={close} />} />
          <Route path="/watchlist/:symbol" element={<TickerSheet onClose={close} />} />
          <Route path="/strategies" element={<Strategies onClose={close} />} />
          <Route path="/strategies/:id" element={<StrategySheet onClose={close} />} />
          <Route path="/positions" element={<CurrentTrades onClose={close} />} />
          <Route path="/log" element={<TradeLog onClose={close} />} />
          <Route path="/evolution" element={<Evolution onClose={close} />} />
          <Route path="/health" element={<Health onClose={close} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <StoreProvider>
          <RailProvider>
            <Shell />
          </RailProvider>
        </StoreProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
