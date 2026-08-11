import { NavLink, Outlet } from 'react-router-dom';
import { Activity, Briefcase, GitBranch, GitCommitVertical, ScrollText } from 'lucide-react';

const NAV = [
  { to: '/', label: 'Watchlist', icon: Activity, end: true },
  { to: '/positions', label: 'Positions', icon: Briefcase },
  { to: '/strategies', label: 'Strategies', icon: GitBranch },
  { to: '/trades', label: 'Trade log', icon: ScrollText },
  { to: '/evolution', label: 'Evolution', icon: GitCommitVertical },
];

export default function Layout() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          Pulse
          <span>Paper trading</span>
        </div>
        <nav className="nav" aria-label="Sections">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
