# Dashboard redesign — node canvas navigation

Owner-approved 2026-08-12. Design authority remains `quiet-precision.md`
plus the owner amendments recorded at the bottom of that file.

## Why

The dashboard is desktop-only. At 390px the 220px sidebar consumes 56% of
the viewport and every page's primary data sits behind a horizontal
scroll in the remaining ~106px. One media query exists in 816 lines of
CSS, at 1100px, for the shadow rail. Desktop is faithful to Quiet
Precision and is preserved; mobile is rebuilt.

## Navigation

The canvas is the layout, not a page. It never unmounts. Sheets are
routes rendered as overlays above it, so back, deep links and refresh
all behave.

| Route | Sheet |
|---|---|
| `/` | canvas only |
| `/overview` | totals, cumulative PnL curve |
| `/watchlist` | ticker table (desktop) / cards (mobile) |
| `/watchlist/:symbol` | ticker detail, price + mention z-score chart |
| `/strategies` | strategy cards |
| `/strategies/:id` | params, stats, equity curve |
| `/positions` | Current Trades — real + shadow |
| `/log` | trade log |
| `/evolution` | evolution timeline |
| `/health` | system health |

Graph: `Overview → {Watchlist, Strategies, Current Trades, Trade Log,
Evolution, System Health}` and `Strategies → one sub-node per strategy`.

The strategy fan is built from `/api/strategies` at runtime. It is NOT
hardcoded to the four seeds — evolution adds generations and a hardcoded
fan would silently go stale.

Pan/zoom is hand-rolled: one CSS `transform` layer, pointer events to
drag, wheel and pinch to zoom. Nodes stay real `<button>` elements so tab
order, focus and screen-reader semantics survive. No graph library, no
new dependency.

## Server — three read-only routes, `dashboard.js` only

No worker, engine, strategy or service file is touched. `describeBlock`
is already imported by `dashboard.js`, so gate evaluation needs no engine
change.

1. **`GET /api/near-signals`** — feeds the floating bar's candidate
   scroller.
2. **`SHADOW_OPEN_SQL` extension** — adds `entry_ts`, `params` and latest
   features so shadow positions can render a holding plan through the
   same `exitStatus()` treatment real trades already get. Without it,
   "real + shadow together" is not buildable.
3. **`GET /api/ticker/:symbol`** — price series from `market_snapshots`
   plus the mention z-score series. No endpoint exposes a price series
   today. Fetched on sheet-open rather than bolted onto the 20-ticker
   `/api/watchlist` poll that runs every 30s.

### Proximity definition (new computed value)

For each active strategy × ticker with no open position, evaluate the
entry block against the ticker's latest feature row.

- Primary sort: entry gates cleared, descending.
- Tiebreak: smallest normalized gap on the worst unmet gate, where
  `gap = |current − threshold| / max(|threshold|, 1)`. The guard keeps
  `gt 0` thresholds from dividing by zero.
- A gate whose feature is NULL is unmet, its gap is NULL, it sorts last
  within its tier, and it displays as an em-dash — never as zero.

This is the only new computed value in the redesign. No existing
computed value changes meaning.

## Floating bar

Equity is omitted. There is no account balance, starting capital or cash
ledger anywhere in the schema; trades are a flat `NOTIONAL_USD = 1000`.
Showing equity would mean inventing a number.

Slots: `TOTAL`, `REALIZED`, `UNREALIZED`, `OPEN` count, then the
horizontally sliding candidate scroller.

Realized is the existing closed-trade sum of `pnl_pct`; unrealized is the
same sum over open trades. Both remain sums of percentages — the
established convention, unchanged. `TOTAL` as realized + unrealized is a
new aggregate, not a redefinition of the API's `total_pnl_pct`, and its
two components sit beside it so the composition is never ambiguous.

## Current Trades — the holding plan

`/api/trades` already returns `exit_conditions` with each leg's
threshold, operator and live `current` value. Remaining time and the term
label are display derivations of the max-hold leg, computed client-side.

Term ladder, from the max-hold threshold:

| Threshold | Label |
|---|---|
| ≤ 24h | intraday |
| ≤ 72h | short swing |
| ≤ 168h | multi-day |
| ≤ 336h | multi-week |
| beyond | position |

Real and shadow render in one list, distinguished by a solid vs dashed
left border, a `REAL`/`SHADOW` pill, and the blocker reason on shadow
rows — reusing the existing dashed-border language for counterfactuals.

On arrival this page is shadow-only: 0 real open, 3 shadow open. The
shadow-first empty state is a first-class case, not an afterthought.

## Theme

`pulse-theme` cookie, `SameSite=Lax`, one-year max-age, read once on
boot, applied as `data-theme` on `<html>`. System preference is the
default when unset. Never localStorage.

Chrome is black / white / grey only — see the owner amendments in
`quiet-precision.md`. The `#276BF0` accent is retired from chrome and
survives only as a data pill.

Dot grid: 1px dots on a 24px pitch at roughly 4% ink, scaled with the
zoom transform so it reads as paper texture, not moiré.

## Rolled-in fixes

- `ShadowBook`'s ASCII `--` placeholders become the standard `NoData`
  em-dash with its `sr-only` reason, killing the `---0.07%` collision
  where they wrap into the right-aligned expectancy column.
- Sheets lazy-load, moving recharts out of the initial chunk.
- Tables get one column spec feeding two renderers: a real `<table>` at
  ≥768px, stacked cards below. No `display:block` CSS that would strip
  table semantics.

## Verification

Screenshots at 390px and 1440px, both themes, canvas and every sheet.
Bundle size before and after. Vercel deploy verified live at both widths
and both themes.

Baseline: JS 613.72 kB (184.42 gzip), CSS 9.22 kB (2.47 gzip).
