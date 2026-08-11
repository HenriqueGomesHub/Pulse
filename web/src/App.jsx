import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './Layout.jsx';
import Evolution from './pages/Evolution.jsx';
import Watchlist from './pages/Watchlist.jsx';
import Positions from './pages/Positions.jsx';
import Strategies from './pages/Strategies.jsx';
import TradeLog from './pages/TradeLog.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Watchlist />} />
          <Route path="positions" element={<Positions />} />
          <Route path="strategies" element={<Strategies />} />
          <Route path="trades" element={<TradeLog />} />
          <Route path="evolution" element={<Evolution />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
