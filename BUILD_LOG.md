# BUILD_LOG

Single source of truth for build progress. On resume: read this file, continue from the
first unpassed gate or deferred verification. Never redo a passed phase.

| Phase | Gate | Date |
|---|---|---|
| 1 — skeleton + data in | **PASSED** (amended gate) | 2026-08-11 |
| 2 — features + one dumb strategy | **PASSED** | 2026-08-11 |
| 3 — dashboard | **PASSED** | 2026-08-11 |
| 4 — full strategy set + stats | not started | — |
| 5 — evolution | not started | — |

---

## Owner decisions 2026-08-11 (second set)

### H4 resolved — floored z-score + absolute-substance gates

`mention_zscore` keeps zero-observation rows in its baseline (silence is real data), but the
denominator is floored: `z = (x − mean) / max(std, 1.0)`. Seed #1's entry additionally gains
`mentions_1h >= 5 AND unique_authors_1h >= 3`. Together these restore the meaning of
"3-sigma spike" and stop a single post from triggering an entry once social data flows.

**The floor is NOT applied to `rel_volume_zscore`.** The owner made this conditional on
whether it shows the same degenerate baseline. Measured against live data — n = 310 over
30 days, mean 0.3308, stddev 0.3068, range 0.0054–1.9732, **zero** zero-valued rows. That is
a genuine continuous distribution whose spread is comparable to its mean, unlike the
zero-inflated mention baseline. A 1.0 floor would crush every z-score toward zero and
permanently disable `rel_volume_zscore > 2`, so it is left unfloored.

Recorded in spec §4 and §5.1. **Implemented and verified 2026-08-11.**

Migration `003_features_social_counts.sql` adds `features.mentions_1h` and
`features.unique_authors_1h`; `featureEngine` populates them, both worker feature bags carry
them, and `engine.js`'s vocabulary accepts them so the new conditions validate rather than
throw. Spec §4 already named `unique_authors_1h` as a per-tick feature.

NULL-vs-zero semantics: a social row reporting zero mentions writes `0` — that is data, the
crowd was silent. Only the *absence* of any social row for that symbol writes NULL. This keeps
the "insufficient data → NULL" rule intact without turning genuine silence into missing data.

Floor effect against the real baseline (mean 0.000496, sd 0.0223):

| mentions | z before | z after | clears `> 3`? |
|---|---|---|---|
| 1 | 44.8 | 1.00 | before yes → **after no** |
| 3 | 134.5 | 3.00 | before yes → **after no** |
| 5 | 224.2 | 5.00 | yes → yes |
| 10 | 448.4 | 10.00 | yes → yes |

Four mentions are now the minimum to clear `> 3`; with the substance gates the effective entry
requires 5 mentions from 3 distinct authors. The single-mention trigger is closed.

Verified: migration applied cleanly, `npm test` 19/19, live tick inserts 20 feature rows with
both new columns NULL (correct — `social_snapshots` is still empty), zero signals.

### Seed #2 short-interest source — FINRA

`short_interest_pct` comes from FINRA's free API (bi-monthly publication, adequate for a
slow-moving level gate), via `FINRA_API_CLIENT` / `FINRA_API_SECRET`. Owner registration at
developer.finra.org is in progress.

Phase 4 rule: if the credentials exist in env, `tickerMetaRefresh` fetches
`short_interest_pct` on its daily run using plain HTTPS `fetch` and no new dependency — halt
if FINRA genuinely requires an SDK. If they are absent when phase 4 runs, seed #2 is inserted
with `status = 'candidate'` rather than `'active'`, with a warning logged at boot while it
stays NULL-blocked. A strategy must never sit `active` while structurally unable to fire.

Recorded in spec §5.2.

### Anthropic billing — RESOLVED

Retested: 1-token `claude-haiku-4-5` call returns **200 OK**. No phase 4 halt on this.

---

## Phase 3 — GATE PASSED 2026-08-11

`quiet-precision.md` was supplied by the owner and is committed at the repo root, unblocking
this phase.

### Backend — five endpoints (`server/routes/dashboard.js`)

`/api/watchlist`, `/api/trades`, `/api/strategies`, `/api/signals`, `/api/pnl`, all read-only,
all verified HTTP 200 against the live Railway database:

| endpoint | payload | contents |
|---|---|---|
| `/api/watchlist` | 32.8 KB | 20 tickers, 24-point sparkline each, active signals |
| `/api/trades` | 1.3 KB | `{ open: [], closed: [3] }` |
| `/api/strategies` | 1.1 KB | params, stats, equity curve, parent |
| `/api/signals` | 2.6 KB | 6 signals with feature snapshots |
| `/api/pnl` | 634 B | portfolio totals + equity curve |

Positions and Trade log are both served from `/api/trades` rather than adding a sixth
endpoint. Every `NUMERIC` is cast `::float8` and every `BIGINT` id `::int` **in SQL**, so no
number crosses the wire as a string. All SQL is parameterised; no N+1; no endpoint mutates.

`strategy_stats` is phase 4, so per-strategy expectancy / win rate / drawdown are computed
live from closed `trades` in the shape `statsRollup` will later fill. Audit checked the
arithmetic by hand against the live DB: expectancy `−0.06779431996033554` = `avg(pnl_pct)`
over the three closed trades, matching exactly.

### Frontend — `web/` (Vite + React)

Four pages: Watchlist, Positions, Strategies, Trade log. Polling every 30s per spec §7, one
interval per hook, `AbortController` on cleanup — verified no leak across route changes.
Dependencies are exactly the approved set; `lucide-react` per the owner's design-doc
allowance. Build: 604 KB raw / 182 KB gzip.

**Evolution page deliberately not built** — `evolution_log` is phase 5 and no endpoint exists.
Building it now would mean a placeholder, which the phase rules forbid. It lands in phase 5.

`/api/signals` is currently unconsumed by any page: spec §7 defines no signals page, and the
signal data the pages need already arrives inside `/api/watchlist` and `/api/trades`. The
endpoint exists because spec §3 mandates it.

### Design-system compliance (`quiet-precision.md`)

Audited concretely against the CSS and JSX: every token matches the specified hexes; the
accent `#276BF0` appears in exactly two rules (links, `:focus-visible`) giving 0–1 uses per
screen against a budget of 3; primary button is `#1C1D1F`; colour is used only for data;
Lucide icons are all 16px / 1.5px stroke / gray / labelled; no gradients, glows, emoji, zebra
striping, second accent, or dark mode.

**NULL is the normal case today** and is handled deliberately — an em dash plus a specific
screen-reader reason ("no recent quote", "no social observations", "conviction not scored").
The all-null sparkline renders a dashed hairline, *not* a flatline at zero implying real data.
The Watchlist lead sentence states plainly that the list is unranked while every conviction
and z-score is null, rather than implying a ranking exists.

### Audit + fix cycle 1

No CRITICAL or HIGH findings. Four MEDIUMs fixed:

- **Timestamps** rendered in the viewer's locale and timezone, unlabelled — the owner's machine
  showed `"11 de ago., 13:53"`, Portuguese, at UTC−3. Every session rule in this system is
  `America/New_York`, so times that cannot be tied to session boundaries are actively
  misleading. Now pinned to `en-US` / `America/New_York` with the zone shown:
  `Aug 11, 12:53 EDT`. DST verified (`Jan 5, 16:53 EST`).
- **"24h trend" showed the last 24 rows**, roughly 1–2 hours, beside a "Signals (24h)" column
  that was a true 24-hour window. Fixed by making the data match the label: 24 hourly buckets
  over a fixed 24-hour window. Verified live — 24 points spanning 22:00Z → 21:00Z, 1.8 ms.
- **The route re-implemented `engine.js`'s operator table**, so a phase-5 vocabulary mutation
  or a malformed `params.exit` would throw and 500 `/api/trades`, taking down *both* Positions
  and Trade log. The route now imports `describeBlock` from `engine.js`; `evaluate()` is
  unchanged and still pure. Both crash cases now return 200 with the error surfaced in the UI.
- **Numbers embedded in prose were set in Geist, not Geist Mono**, against the design doc's
  explicit Pulse clause. Fixed with an inline mono span so digits change face without
  dragging the sentence with them. Also reversed `.detail .reason` (Claude's prose reasoning)
  from mono back to sans — from phase 4 that field holds paragraphs.

Verified after the cycle: `npm test` 19/19, `npm run build` clean, all five endpoints 200,
sparkline 24 points, `OPERATORS` gone from the route, timezone and mono class present in the
built bundle.

### Open — needs an owner decision

**`max_drawdown` is the worst single trade, not the strategy's drawdown.** `max(max_drawdown_pct)`
returns `0.10%` while the equity curve from the *same endpoint* bottoms at `−0.20%` — the
Strategies card shows both, disagreeing by 2×, right now. Ten consecutive −5% trades would
report "max drawdown 5%" for a strategy that actually went 50% peak-to-trough. Max drawdown is
half the spec's prime directive, phase 5 retires strategies on it, and phase 4's `statsRollup`
will inherit whichever definition is chosen. This compounds deferred M4 (per-trade drawdown is
measured from entry rather than from peak).

### Noted

Duplicate `features` rows appeared from 20:15Z (two per tick) because two backend instances
were running concurrently during verification — an artifact of testing, not a product defect,
now stopped. It does demonstrate the deferred "no cron overlap guard" concretely: two
instances, or a Railway redeploy overlap, double-write every table.

Also worth setting on Railway: `NODE_ENV=production`, or Express 4's default error handler
puts stack traces in response bodies.

**CORS / production API base URL remains open.** The frontend calls `/api/*` relative, resolved
by the Vite dev proxy. A Vercel-hosted build has no route to Railway. The deployment decision
must cover both the headers and the base URL — a Vercel rewrite keeping it same-origin avoids
CORS entirely.

---

## Phase 2 — GATE PASSED 2026-08-11 17:05 UTC

Full `signal → order → tracked-trade → closed-trade` lifecycle verified live against the
Alpaca paper account during market hours.

### Lifecycle evidence

Three round trips, all closed. Entry orders placed at 12:55 PM ET, exits submitted on the
following tick, settled on the tick after that.

| id | symbol | status | qty | entry | exit | pnl_pct | max_dd | hold_h | entry order | exit order | attempt |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | APLD | closed | 33 | 29.82 | 29.80 | −0.0671 | 0.1006 | 0.0057 | 717bbbb0… | c481656d… | 1 |
| 2 | CLSK | closed | 86 | 11.64 | 11.63 | −0.0859 | 0.0859 | 0.0059 | 4e5c5c15… | 995c43b6… | 1 |
| 3 | FCEL | closed | 50 | 19.84 | 19.83 | −0.0504 | 0.1008 | 0.0058 | eba1f9d8… | adcbab51… | 1 |

Six signals written (3 entry, 3 exit), each carrying the condition that fired.
`conviction` is NULL throughout — correct, conviction is the phase 4 Claude call.

Alpaca confirms: **0 open positions**, 6 filled orders (3 buy, 3 sell), equity $99,997.98.
The $2.02 is round-trip spread on three positions, consistent with the recorded PnLs.

Row counts at gate: `tickers` 20, `market_snapshots` 300, `social_snapshots` 0 (deferred),
`features` 200, `strategies` 1, `signals` 6, `trades` 3.

### Temporary-threshold method — applied and RESTORED

Per the owner decision recorded in spec §8 phase 2. Strategy #1 cannot fire on real thresholds
while social data is absent, so entry was temporarily narrowed to a single market-data
condition and the max-hold was dropped to force the exit leg:

- entry, temporary: `price_momentum gt 0` (replacing the three-way social AND)
- exit, temporary: `hold_hours gte 0` (replacing `gte 72`)

**Both restored immediately after the lifecycle closed**, and the restoration was verified by
reading the `strategies` row back out of the database after a propagation tick — it matches
spec §5.1 byte-for-byte: entry `mention_zscore > 3 AND social_accel > 0 AND
rel_volume_zscore > 2`; exit `exhaustion_score > 0.7 OR pnl_pct <= −8 OR pnl_pct >= 15 OR
hold_hours >= 72`. The post-restore tick placed zero entries, as expected.

### Guards observed firing in production

- **$1,000 notional** — $983.73 / $999.75 / $991.50. Under the cap on all three, sized from a
  fresh last-trade price rather than the stale hourly close.
- **PDT** — after three same-session entries the runner reported
  `3 reserved by positions opened this session, no entries` and stopped. Post-close it reads
  `3 day-trades used`. The limit held on both sides.
- **Exit settlement** — exits went `pending_new` on submission and only closed on the next
  tick at the real `filled_avg_price` (29.8 / 11.63 / 19.83), never at a snapshot quote.

### Fix cycle 1 — all seven findings closed

C2 exit-fill reconciliation (submission and settlement split across ticks, real
`filled_avg_price` and `filled_at`, exit order id persisted via migration `002`);
C3 idempotency (trade row written before the order, deterministic `client_order_id`,
lookup-then-submit recovery on both legs); C4 market-hours gate on exits via Alpaca
`/v2/clock`; H2 two-sided PDT with entry-side reservation; H3 terminal unfilled entries marked
`expired`; M3 entry window from `/v2/clock` with a strictly exclusive close boundary;
M7 sizing from a fresh last-trade price.

Two judgement calls worth knowing: PDT reserves a day-trade slot for every same-session
position, which caps entries at 3 per session rather than 5 — chosen because a real PDT breach
freezes the account for 90 days. And `notional` orders were rejected in favour of computed
`qty`, because small caps are frequently not fractionable at Alpaca and seed #4's short side
cannot use notional at all.

Migration `002_trade_exit_order.sql` adds `trades.exit_order_id` and `trades.exit_attempt`.

### Still open after the gate

The deferred list below stands. **H4 is the one to resolve before deployment** — with social
data flowing, `mention_zscore > 3` currently means "mentioned at least once", so seed #1 would
start trading on almost any mention.

---

## Phase 2 — implementation and audit detail

Implemented: `strategies/engine.js` (pure, unit-tested), `strategies/seeds.js` (seed #1 only),
`workers/featureEngine.js`, `workers/strategyRunner.js`, `workers/positionTracker.js`,
order methods on `services/alpaca.js`, pipeline chaining in `index.js`.

`npm test` — **19 tests, 19 pass**, covering entry and exit conditions, NULL handling,
operator matrix, vocabulary enforcement, and purity. `features` is populating: 20 rows per
tick, one per active ticker.

Seed #1 params verified byte-for-byte against spec §5.1. Cron sequencing verified: one
pipeline per tick, ingests in parallel, then featureEngine → strategyRunner → positionTracker.
Zero signals so far, which is **correct** — the entry is an AND over three social-derived
features that are all NULL while `social_snapshots` is empty. No threshold was lowered.

### Prerequisite closed — `tickerMetaRefresh` (owner-authorised)

The eligibility guard requires `avg_volume_30d > 500k` and `exchange` in NYSE/NASDAQ/AMEX.
Both columns were NULL for all 20 tickers, so the guard matched **zero** tickers and no trade
could ever fire in any phase. `tickerMetaRefresh` is listed in spec §3 but assigned to no
phase in §8 — a gap in the build order. The owner authorised building it now.

`server/workers/tickerMetaRefresh.js` populates `name`, `exchange` and `avg_volume_30d` from
Alpaca, on a daily 06:00 ET cron, separate from the 5-minute pipeline. Eligible tickers went
**0 → 17 of 20**. Failing: ASTS ($69.58) and RKLB ($78.16) are above the spec's $50 ceiling;
BITF has no volume data (delisted).

`float_shares` and `short_interest_pct` remain NULL — Alpaca does not expose them and no other
source is approved. **Seed #2 (`squeeze-setup`) gates on `short_interest_pct > 15` and will
therefore never fire in phase 4 until a source for it is chosen.**

### Independent audit — findings

A separate audit subagent reviewed the diff against the spec and the forbidden list. It
confirmed as correctly met: cron sequencing, seed #1 params, seeds 2–4 absent, the
insufficient-data-NULL rule, `engine.js` purity, NULL-as-not-met, the 5-concurrent-trades cap,
the price/volume/exchange guard, no swallowed errors, no narrating comments, no new
dependencies, no gratuitous edits to phase 1 files, and tests confined to `engine.js`.

**Fix cycle 1 dispatched for these:**

| ID | Sev | Finding |
|---|---|---|
| C2 | CRITICAL | Exits close on an unfilled order — `filled_avg_price` is null milliseconds after submit, so `exit_price` records a stale quote and `pnl_pct` is biased optimistic on every trade. A rejected close marks the trade closed while the position stays open. |
| C3 | CRITICAL | Order path is not idempotent — a failure between submit and DB write duplicates entries (doubling the position) or double-sells an exit (flipping long to short). |
| C4 | CRITICAL | `positionTracker` has no market-hours guard and runs 24/7. Seed #1's 72h max-hold lands on a Saturday for any Wednesday entry — routine, not edge case. |
| H2 | HIGH | PDT guard is one-sided — day trades are created by *exits*, which never consult the counter. Five correlated stop-outs = five day trades in one session. |
| H3 | HIGH | A rejected/cancelled entry strands the trade `open` forever, holding an open-trade slot and blocking re-entry. The `expired` enum value is never written. |
| M3 | MEDIUM | Entry window admits 15:45 exactly (a real cron tick) when [15:45, 16:00) is forbidden; no holiday or early-close awareness. |
| M7 | MEDIUM | `qty = floor(1000/price)` uses an up-to-60-minute-stale hourly close, so notional can exceed the fixed $1,000. |

**Deferred, tracked, NOT fixed in this cycle** — these need either social data or an owner
decision, and none blocks today's lifecycle verification:

- **H4 (HIGH) — `mention_zscore > 3` degenerates to "mentioned once".** The 7-day baseline
  includes a zero row for every unmentioned ticker every tick (~2016 near-zero observations),
  so a single mention scores z ≈ 45. Seed #1's entry gate collapses to `rel_volume_zscore > 2
  AND mentioned once` rather than the 3-sigma spike spec §5.1 intends. **This will start
  placing orders the moment social data flows on Railway — it needs a decision before then.**
- **H1 (HIGH)** — featureEngine groups social rows by exact `ts`, but Reddit and Stocktwits
  stamp independent timestamps, so the two sources never aggregate and one is dropped at
  random per tick. Also intermittently nulls `bull_ratio`, disabling the exhaustion exit.
- **M5** — minimum-observation thresholds (20 obs ≈ 100 minutes) are far below the 30-day and
  24-hour windows they claim to cover.
- **M4** — `max_drawdown_pct` is measured from entry, not from peak; a trade that runs +50%
  then falls to +20% records 0 drawdown. Max drawdown is half the spec's objective function.
- **M6** — `author_quality` is a unique-author ratio, not the spec's "account age & karma
  weighted" astroturf filter.
- **M9** — `price_momentum` stores only the 1h component; spec §4 defines it as 1h *and* 1d.
  Seeds #2 and #4 need the 1d value in phase 4. Needs a schema decision.
- **M2** — PDT window is 7 calendar days rather than 5 sessions; undercounts on holiday weeks
  (~9 occurrences/year).
- **M8** — which 5 positions get taken is nondeterministic (no `ORDER BY`), so phase 5's
  holdout replay cannot reproduce trade selection.
- LOW: seed params overwritten every tick, no cron overlap guard, `social_accel` not
  time-normalised, z-score baselines include the scored observation, unused short-side
  branches, unused vocabulary entries.

---

## Phase 1 — GATE PASSED 2026-08-11 16:16 UTC (amended gate)

All four amended criteria met against the live Railway database.

### (a) Migrations apply cleanly — PASS

`npm run migrate` → `applied 001_init.sql`. Schema verified by querying the catalog:

- **tables (10):** `tickers`, `social_snapshots`, `market_snapshots`, `features`, `strategies`,
  `signals`, `trades`, `strategy_stats`, `evolution_log`, `schema_migrations` — all 9 spec
  tables plus the migration tracker
- **enums (5):** `strategy_status`, `signal_direction`, `trade_status`, `stats_window`,
  `evolution_action`
- **indexes:** `features_symbol_ts_idx`, `market_snapshots_symbol_ts_idx`,
  `social_snapshots_symbol_ts_idx`

### (b) Server boots and crons register — PASS

```
[pulse] listening on 3000, cron registered for */5 * * * *
```

`GET /health` → `{"ok":true}`. The registered cron fired unattended at 16:15:01 UTC and wrote
a tick, confirming registration is live rather than just logged.

### (c) Market ingestion inserts real rows — PASS (19/20, one delisted)

`[marketIngest] inserted 19 rows`, `no bars returned for: BITF`.

Row counts after three ticks:

| table | rows |
|---|---|
| `tickers` | 20 |
| `market_snapshots` | 40 |
| `social_snapshots` | 0 (deferred, see below) |
| `features` | 0 (phase 2) |

Per tick: 16:11:53 → 11 rows, 16:15:01 → 10 rows, 16:16:10 → **19 rows**. The first two ticks
ran before the pagination fix below.

Three sample rows from the post-fix tick:

| symbol | ts | price | volume_1h | rel_volume | pct_change_1h | pct_change_1d |
|---|---|---|---|---|---|---|
| APLD | 2026-08-11T16:16:10.575Z | 29.56 | 464554 | 0.153 | −0.404 | 1.721 |
| ASTS | 2026-08-11T16:16:10.575Z | 70.28 | 267609 | 0.108 | 0.450 | 2.211 |
| BBAI | 2026-08-11T16:16:10.575Z | 3.275 | 207308 | 0.051 | 0.306 | 1.393 |

### (d) Social workers degrade without crashing — PASS

```
[reddit] REDDIT_* not set — using public JSON endpoints (unauthenticated rate limits)
[stocktwitsIngest] source fetch failed for SOFI, skipping tick: … 403 (Cloudflare)
[redditIngest] source fetch failed, skipping tick: … 403 (Reddit block page)
[pipeline] tick finished in 4013ms
```

Both warned, inserted zero rows, and the tick completed. `social_snapshots` = 0 rows,
DEFERRED-TO-DEPLOYMENT as agreed.

### Bug found and fixed during verification — Alpaca pagination

The first tick inserted only 11 of 20 rows. `getBars` was returning `body.bars` and ignoring
`body.next_page_token`. Alpaca paginates far below the requested `limit=10000` — the
20-symbol `1Hour` call returned 242 bars with a non-null token, silently dropping every
symbol after `OPEN` alphabetically.

`server/services/alpaca.js` now follows the token, concatenating per-symbol bars across pages
(bound `MAX_PAGES = 50`, ~20× the worst real case; exhausting it throws rather than returning
truncated data). `1Hour` now takes 2 pages, 456 bars, 19/20 symbols. `OPEN` splits 2 + 22
across the page boundary — a naive merge would have kept only the 22 and reintroduced the bug
for that symbol.

The `1Day` call was single-page and was never affected.

### Deferred / open items

- **BITF is delisted.** `GET /v2/assets/BITF` → `status: inactive`, `tradable: false`; its
  bar feed stops at 2026-04-02. It will log `no bars returned for: BITF` every tick and hold
  `market_snapshots` at 19 rows. The watchlist is owner-maintained, so it has been left in
  place — replace or drop it in `server/config.js` when convenient.
- **ASTS is priced $70.28**, outside the spec's $1–$50 tradable band. Ingest is unfiltered by
  design; the price guard belongs to `strategyRunner` (phase 2) and will exclude it at trade
  time.
- **403 HTML bodies are logged in full** — the Cloudflare and Reddit block pages run to
  ~190KB of markup per tick. Harmless but noisy; worth truncating the error body if this
  persists past deployment.

---

## Phase 1 — original gate (superseded)

**Not passed. Superseded by the amended gate above.**

Phase 1 code was already present at the start of this run and was not rebuilt. The task was
to verify it. Verification could not be executed because the database is unreachable from
this machine.

### What passed

| Check | Result |
|---|---|
| `node --check` on all 11 server JS files | pass |
| `npm install` — dependency set | pass: express, pg, node-cron, dotenv only, no extras |
| Alpaca `GET /v2/account` | **200 OK** — account ACTIVE, equity 100000, shorting_enabled true |
| Alpaca `GET /v2/stocks/bars` (SOFI, 1Hour) | **200 OK** — 5 bars returned |
| Anthropic API key validity | key is **valid** (not an auth failure) — see blocker 3 |
| Git repository | initialized, 17 files staged, `.env` and `node_modules` correctly excluded |

### What failed

`npm run migrate` — could not connect:

```
Error: getaddrinfo ENOTFOUND postgres.railway.internal
    errno: -3008, code: 'ENOTFOUND', syscall: 'getaddrinfo'
```

`DATABASE_URL` in `.env` points at `postgres.railway.internal`. That hostname only resolves
inside Railway's private network. From a local machine it cannot resolve, so **no migration,
no pipeline run, and no row-count verification is possible** — for this phase or any later one.

Not attempted as a result: `npm run migrate`, `npm start`, `npm run tick`, all row counts,
all sample rows.

Separately, both social data sources return 403 from this network — see blockers 2 and 3.
Of the three phase 1 ingest sources, only Alpaca is reachable from here.

### Phase 1 fix applied during this run

Reddit OAuth credentials are pending, and `server/config.js` listed all four `REDDIT_*` vars
as required, so the app called `process.exit(1)` at boot and could not start at all.

- `server/config.js` — dropped the four `REDDIT_*` entries from the required-env list. Boot
  now succeeds without them. Other required vars unchanged.
- `server/services/reddit.js` — added a `request(path)` branch that uses the public JSON
  endpoints (`https://www.reddit.com/r/{sub}/new.json?limit=100`,
  `.../comments.json?limit=100`) with User-Agent `nodejs:pulse:v1.0 (by /u/MY_REDDIT_USERNAME)`
  when the `REDDIT_*` vars are unset, warning once. When they are set, the original OAuth path
  runs unchanged. Marked `TODO(#1)` for the swap-back. Exported signatures and the normalized
  `{id, subreddit, author, text, score, createdAt}` shape are unchanged.

Audited: minimal diff, no swallowed errors (403s throw with status + body), one comment, no
new dependencies, no new files. `node --check` passes on both.

The `MY_REDDIT_USERNAME` placeholder in the User-Agent is a literal, as specified. Replace it
with a real handle if Reddit access is ever restored.

---

## Decisions recorded 2026-08-11

Owner decisions on the blocker list. Two are policy and take effect immediately; four
require a change on disk that has not landed yet (see the status table below).

| # | Decision | Status (re-verified 2026-08-11, second pass) |
|---|---|---|
| 1 | Use Railway public `DATABASE_URL` | **RESOLVED** — written directly to `.env`, host `altaria.proxy.rlwy.net:48382`, mtime moved to 16:11:28 UTC |
| 2 | Keep dual-path Reddit; social verification DEFERRED to deployment | in effect |
| 3 | Keep Stocktwits as written; verification DEFERRED to deployment | in effect |
| 4 | Anthropic credit added | **RESOLVED** — 1-token `claude-haiku-4-5` call returns 200 |
| 5 | `quiet-precision.md` in repo root for phase 3 | **STILL NOT ON DISK** — proceed now, halt at phase 3's start if still missing (owner decision) |
| 6 | `git remote add origin` + push | **DONE** — `origin` → `github.com/HenriqueGomesHub/Pulse.git`, `main` pushed |

Root cause of the three failed rounds: unsaved editor buffers. Resolved by writing `.env`
directly rather than through the editor. Only one `Pulse` checkout exists — the edits were
never landing on disk at all.

### DEFERRED-TO-DEPLOYMENT — social_snapshots population

`social_snapshots` will remain empty until the app runs on Railway. Both social sources are
blocked from the development machine (Reddit 403 at IP level, Stocktwits 403 Cloudflare
challenge). This is a deferral, not a failure, and is excluded from the phase 1 gate.

- **Reddit** — dual-path implementation stands: public JSON fallback now, OAuth once Reddit
  approves the script app. Swap point is `TODO(#1)` in `server/services/reddit.js`.
- **Stocktwits** — implementation stands as written. Cloudflare-blocked from dev machine;
  retest from Railway egress after deployment; if still blocked there, drop the source and
  rely on Reddit + market data.
- No workarounds, scraping alternatives, or Cloudflare-bypass code are to be built.

### AMENDED PHASE 1 GATE

Supersedes the original gate. Passes when all four hold:

- **(a)** migrations apply cleanly to the Railway database
- **(b)** server boots and crons register
- **(c)** market ingestion inserts real rows into `market_snapshots` for the watchlist
- **(d)** both social ingest workers run without crashing, log their blocked-network
  warnings, and insert zero rows

### Downstream consequences of the deferral

- `featureEngine` (phase 2) must handle NULL / absent social history — the same code path as
  insufficient data for a z-score.
- Strategy #1 (social-breakout) will emit no signals until social data flows. That is correct
  behaviour, not a defect.
- Phase 2's lifecycle verification uses the temporary-threshold method: lower strategy #1's
  entry conditions so a signal fires on market data alone, run the full
  signal → order → tracked → forced-exit → closed lifecycle against Alpaca during market
  hours, then restore the real thresholds and record the restoration here.

**Provenance note.** The temporary-threshold method and the NULL-z-score-on-insufficient-data
rule are both owner instructions, not text found in `pulse-spec.md`. The spec does not mention
either. They are sound and are being followed as directed; recorded here so a later reader
does not go looking for them in the spec.

---

## HALT — blockers requiring a human

### 1. `DATABASE_URL` is Railway-internal — blocks every phase

Every verification gate in phases 1–5 ends in a DB query. Until this resolves, nothing can
be verified and the run cannot proceed. Two ways out:

- **Use Railway's public URL.** In the Railway dashboard, open the Postgres service →
  Variables → copy `DATABASE_PUBLIC_URL` (host looks like `<something>.proxy.rlwy.net:<port>`,
  not `postgres.railway.internal`). Put that in `.env` as `DATABASE_URL`.
- **Verify against a local Postgres instead.** Docker is installed on this machine but the
  daemon is not running. A throwaway `postgres:16` container on `localhost:5433` would allow
  the full build to be verified locally, with Railway used only for deployment.

### 2. Reddit returns 403 to unauthenticated requests from this network

```
GET https://www.reddit.com/r/pennystocks/new.json?limit=5  →  403  text/html
```

Confirmed twice, independently. The block is IP/network level, not a User-Agent or URL
problem — `new.json`, `comments.json`, `about.json`, `old.reddit.com` and `api.reddit.com`
all return the same Varnish/`snooserv` block page, including with a plain browser
User-Agent. The public-endpoint fallback specified for this run is therefore correct in
shape but non-functional from here.

The fix is the `REDDIT_*` OAuth credentials (Reddit's OAuth endpoints are not blocked this
way). Until then `redditIngest` throws on every tick, which by design fails the whole tick
visibly.

### 3. Stocktwits is behind a Cloudflare challenge

```
GET https://api.stocktwits.com/api/2/streams/symbol/SOFI.json  →  403  "Just a moment..."
```

Spec section 1 describes this API as public and keyless. That is no longer true — it now
serves a Cloudflare interstitial. This affects the spec's assumption, not just the
credentials, so it needs a decision rather than a config change: obtain Stocktwits API
access, drop Stocktwits as a source, or run the ingest from a network it does not challenge.

Combined with blocker 2, **no social source is currently reachable**, so phase 1's
"rows landing in social_snapshots" cannot pass from this machine on any database.

### 4. Anthropic account has no credit — blocks phases 4 and 5

The key in `.env` is valid and authenticates correctly. The API rejects calls on billing:

```
400 invalid_request_error — "Your credit balance is too low to access the Anthropic API.
Please go to Plans & Billing to upgrade or purchase credits."
```

Phases 1–3 do not call Claude and are unaffected. Phase 4 (conviction per signal) and
phase 5 (weekly evolution) cannot be verified until the account has credit.

### 5. "Quiet Precision v2.1" design document not found — blocks phase 3

Spec section 7 states the design system doc applies to all frontend work, and the run
instructions repeat it for phase 3. The document is not in the repo and a filename search
across `OneDrive\Documentos` found nothing matching. Phase 3 cannot follow a design system
that is not available. Provide the file (drop it in the repo root), or state explicitly that
phase 3 should proceed without it.

### 6. No git remote — `push after each gate` cannot run

The repo had no `.git` directory; it has now been initialized locally. There is no remote
configured, so commits cannot be pushed. Add a remote, or accept local-only commits.

---

## Notes for the next run

- **Market was open** during this run (Tuesday 2026-08-11, 10:14 AM ET). Phase 2's
  signal → order → tracked-trade → closed-trade lifecycle verification needs an open market;
  if the next run lands outside 09:30–16:00 ET on a weekday, that verification defers per the
  market-hours exception and must be completed first on a subsequent in-hours run.
- **Resume order once unblocked:** fix `DATABASE_URL` → rerun phase 1 verification
  (`npm run migrate`, `npm start`, `npm run tick`, row counts + 3 sample rows per snapshot
  table) → only then start phase 2. Blockers 2 and 3 must also be resolved for the
  social half of phase 1 to pass; the market half can pass on Alpaca alone.
- **Nothing has been verified end to end.** No phase gate has passed. The phase 1 commit
  below records code state only, not a passed gate.
