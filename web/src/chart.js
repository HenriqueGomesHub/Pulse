// Charts are drawn on canvas by recharts, so they cannot inherit CSS custom
// properties. These mirror the token values in styles.css for both themes.
const PALETTE = {
  light: { ink: '#1c1d1f', muted: '#9b9da1', grid: '#e8e9eb', tick: '#5c5e63' },
  dark: { ink: '#f2f3f5', muted: '#6f7379', grid: '#32363c', tick: '#a1a4aa' },
};

export const chartColors = (theme) => PALETTE[theme] ?? PALETTE.light;

export const tickStyle = (colors) => ({
  fontSize: 11,
  fill: colors.tick,
  fontFamily: "'Geist Mono', ui-monospace, monospace",
});
