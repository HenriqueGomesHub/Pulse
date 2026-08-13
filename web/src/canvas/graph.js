import {
  Briefcase,
  GitBranch,
  GitCommitVertical,
  Gauge,
  HeartPulse,
  Radar,
  ScrollText,
} from 'lucide-react';

export const ROOT = {
  id: 'overview',
  label: 'Overview',
  icon: Gauge,
  route: '/overview',
};

export const DOMAINS = [
  { id: 'watchlist', label: 'Watchlist', icon: Radar, route: '/watchlist' },
  { id: 'strategies', label: 'Strategies', icon: GitBranch, route: '/strategies' },
  { id: 'positions', label: 'Current trades', icon: Briefcase, route: '/positions' },
  { id: 'log', label: 'Trade log', icon: ScrollText, route: '/log' },
  { id: 'evolution', label: 'Evolution', icon: GitCommitVertical, route: '/evolution' },
  { id: 'health', label: 'System health', icon: HeartPulse, route: '/health' },
];

const DESKTOP = { w: 196, h: 64, colGap: 300, rowGap: 92, subW: 216, subH: 52, subRowGap: 66 };
const MOBILE = { w: 244, h: 58, colGap: 34, rowGap: 78, subW: 214, subH: 50, subRowGap: 62 };

// Sub-nodes are built from the strategies the API actually returns, never from a
// hardcoded four — evolution adds generations and a fixed fan would go stale.
const subNodesFor = (strategies) =>
  strategies.map((strategy) => ({
    id: `strategy-${strategy.id}`,
    label: strategy.name,
    route: `/strategies/${strategy.id}`,
    parent: 'strategies',
    sub: true,
    status: strategy.status,
  }));

function desktopLayout(strategies) {
  const size = DESKTOP;
  const subs = subNodesFor(strategies);
  const nodes = [];
  const edges = [];

  const columnHeight = (DOMAINS.length - 1) * size.rowGap;
  const top = -columnHeight / 2;

  nodes.push({ ...ROOT, x: 0, y: -size.h / 2, w: size.w, h: size.h, root: true });

  DOMAINS.forEach((domain, index) => {
    const y = top + index * size.rowGap - size.h / 2;
    nodes.push({ ...domain, x: size.colGap, y, w: size.w, h: size.h });
    edges.push({ from: ROOT.id, to: domain.id });
  });

  const parent = nodes.find((node) => node.id === 'strategies');
  const subHeight = (subs.length - 1) * size.subRowGap;
  const subTop = parent.y + size.h / 2 - subHeight / 2 - size.subH / 2;

  subs.forEach((sub, index) => {
    nodes.push({
      ...sub,
      x: size.colGap + size.w + 104,
      y: subTop + index * size.subRowGap,
      w: size.subW,
      h: size.subH,
    });
    edges.push({ from: 'strategies', to: sub.id });
  });

  return { nodes, edges, axis: 'x' };
}

function mobileLayout(strategies) {
  const size = MOBILE;
  const subs = subNodesFor(strategies);
  const nodes = [];
  const edges = [];

  nodes.push({ ...ROOT, x: 0, y: 0, w: size.w, h: size.h, root: true });

  let y = 0;
  DOMAINS.forEach((domain) => {
    y += size.rowGap;
    nodes.push({ ...domain, x: size.colGap, y, w: size.w, h: size.h });
    edges.push({ from: ROOT.id, to: domain.id });

    if (domain.id === 'strategies') {
      subs.forEach((sub) => {
        y += size.subRowGap;
        nodes.push({ ...sub, x: size.colGap * 2, y, w: size.subW, h: size.subH });
        edges.push({ from: 'strategies', to: sub.id });
      });
    }
  });

  return { nodes, edges, axis: 'y' };
}

export const layoutGraph = (strategies, desktop) =>
  desktop ? desktopLayout(strategies) : mobileLayout(strategies);

export function bounds(nodes) {
  const xs = nodes.flatMap((node) => [node.x, node.x + node.w]);
  const ys = nodes.flatMap((node) => [node.y, node.y + node.h]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

// n8n-style connector: leaves the parent and enters the child along the layout
// axis, so the curve reads as a wire rather than a diagonal.
export function edgePath(from, to, axis) {
  if (axis === 'x') {
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const bend = Math.max(28, (x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }

  // Vertical layout: drop a trunk from the parent's left shoulder and elbow into
  // each child. Six beziers fanning from one point bundle into noise; a trunk reads
  // as a spine.
  const trunkX = from.x + 24;
  const y1 = from.y + from.h;
  const y2 = to.y + to.h / 2;
  const radius = Math.min(14, Math.max(0, (y2 - y1) / 2));
  return `M ${trunkX} ${y1} L ${trunkX} ${y2 - radius} Q ${trunkX} ${y2} ${trunkX + radius} ${y2} L ${to.x} ${y2}`;
}
