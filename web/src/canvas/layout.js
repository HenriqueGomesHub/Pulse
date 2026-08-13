// Where the reader dragged each box, remembered between visits.
// A cookie, like the theme — localStorage is unavailable in some contexts.
// Desktop and mobile keep separate maps: the two layouts have different shapes,
// so a position dragged on one would land nowhere on the other.
const COOKIE = 'pulse-layout';
const YEAR_SECONDS = 31536000;
const EMPTY = { d: {}, m: {} };

export const breakpointKey = (desktop) => (desktop ? 'd' : 'm');

export function readLayout() {
  const match = document.cookie.match(/(?:^|;\s*)pulse-layout=([^;]*)/);
  if (!match) return EMPTY;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    return { d: parsed.d ?? {}, m: parsed.m ?? {} };
  } catch {
    // A malformed cookie is not worth an error state: fall back to the default
    // layout and let the next drag overwrite it.
    return EMPTY;
  }
}

export function writeLayout(layout) {
  const value = encodeURIComponent(JSON.stringify(layout));
  document.cookie = `${COOKIE}=${value}; path=/; max-age=${YEAR_SECONDS}; SameSite=Lax`;
}

export function clearLayout(desktop) {
  const next = { ...readLayout(), [breakpointKey(desktop)]: {} };
  writeLayout(next);
  return next;
}

export function saveNode(desktop, id, x, y) {
  const current = readLayout();
  const key = breakpointKey(desktop);
  const next = {
    ...current,
    [key]: { ...current[key], [id]: [Math.round(x), Math.round(y)] },
  };
  writeLayout(next);
  return next;
}

// Saved positions are applied over the computed layout, so a box the reader never
// touched still lands where the default layout puts it — including strategy boxes
// that did not exist when the layout was saved.
export function applyLayout(nodes, layout, desktop) {
  const saved = layout[breakpointKey(desktop)] ?? {};
  return nodes.map((node) => {
    const position = saved[node.id];
    return position ? { ...node, x: position[0], y: position[1], moved: true } : node;
  });
}
