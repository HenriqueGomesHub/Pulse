# BUILD_LOG

Single source of truth for build progress. On resume: read this file, continue from the
first unpassed gate or deferred verification. Never redo a passed phase.

| Phase | Gate | Date |
|---|---|---|
| 1 — skeleton + data in | **PASSED** (amended gate) | 2026-08-11 |
| 2 — features + one dumb strategy | **PASSED** | 2026-08-11 |
| 3 — dashboard | **PASSED** | 2026-08-11 |
| 4 — full strategy set + stats | **built; gate PARTIAL** — live conviction lifecycle deferred to next open | 2026-08-11 |
| 5 — evolution | **built; gate PARTIAL** — inherits phase 4's deferred live lifecycle | 2026-08-11 |

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

## BRIDGE SOCIAL SOURCE (ApeWisdom) — GATE PASSED 2026-08-12 04:10 UTC

Running in production on Railway. First tick from the deployed service:

```
04:10:00.977   apewisdom ingest   20 rows, 222 mentions total
04:10:03.137   featureEngine      20 rows, mentions_24h on 20, mention_growth_24h on 17
```

Ingest before `featureEngine`, both on Railway's 5-minute boundary — the pipeline order holding
in production, not just locally.

**Real mention counts, not merely non-NULL:**

| symbol | mentions_24h | upvotes_24h | mentions_1h | mentions_24h_ago |
|---|---|---|---|---|
| RKLB | 100 | 288 | **null** | 340 |
| ASTS | 53 | 117 | **null** | 229 |
| RIOT | 18 | 27 | **null** | 23 |
| PLUG | 13 | 20 | **null** | 8 |
| SOFI | 9 | 11 | **null** | 1 |

`mentions_1h` NULL on every row — the window ruling holding in production. Growth arithmetic
verified by hand: RKLB 100−340 = −240, PLUG 13−8 = +5, SOFI 9−1 = +8, all matching the stored
`mention_growth_24h`.

**Seed #1's live gates are the apewisdom variant:** `mention_zscore`, `social_accel`,
`rel_volume_zscore`, **`mentions_24h`, `mention_growth_24h`** — so the seed sync and
`featureEngine` agree on the primary source, which is the property the single-definition rule
exists to guarantee.

`mention_zscore` is NULL, correctly: the baseline needs 20 observations and has a handful.

### Root cause of the deploy failures — there was no GitHub connection

Railway's Source showed **"GitHub Repo not found"**. Every deployment in the service's history,
including each manual redeploy, rebuilt the same original commit the service was created from.
It never saw `844c5e2` or anything after. Root Directory was empty, so that was never the issue.

**Two hypotheses were advanced from this side and both were wrong** — first that a missing
`ANTHROPIC_API_KEY` was killing the new container at boot, then that `watchPatterns` were
resolving against a non-root Root Directory and matching nothing. Both fitted the evidence:
punctual ticks, healthy `/health`, correct behaviour for the code actually running. The error was
reasoning about *why a deploy did not apply* while never testing whether the service could see
the repository at all. The earlier stale-writer episode had already taught that lesson — a
process was assumed to be Railway's when it was local — and the same assumption was made again
one level up.

`watchPatterns` were removed anyway (`7cd7451`); harmless, and for a four-dependency backend
deploying on every push is the right default. But it was not the fix.

---

## BRIDGE SOCIAL SOURCE (ApeWisdom) — original proposal and rulings

The task's item 4 gates the rest, and the answer is not obvious. Worse, investigating the API
surfaced a second gating problem the task did not anticipate. Both need an owner decision.

### What ApeWisdom actually returns — verified against a live response

`GET https://apewisdom.io/api/v1.0/filter/all-stocks/page/{n}` — keyless, no auth, HTTP 200.
944 tickers over 10 pages, 100 per page. Fields per ticker, verbatim:

```json
{ "rank": 1, "ticker": "HTZ", "name": "Hertz",
  "mentions": 692, "upvotes": 1792,
  "rank_24h_ago": 2, "mentions_24h_ago": 353 }
```

**17 of our 20 tickers are present**, spread across pages 1, 2, 5, 8 and 9 — so full coverage
costs 9–10 requests per cycle, not one. BITF, FCEL and EOSE are absent, which means below the
ranking cutoff, i.e. **zero mentions — real data, not missing data**.

Live watchlist sample: RKLB 110, ASTS 60, RIOT 23, PLUG 13, SOFI 9, WULF 7, APLD 5, IONQ 5.

### Cadence — measured, not assumed

The docs state no refresh interval, so it was sampled directly every 5 minutes:

```
t0    01:36:54Z   RKLB 110  ASTS 60  RIOT 23  PLUG 13  SOFI 9  WULF 7  APLD 5  IONQ 5
+5m   01:41:55Z   changed: RKLB 110->109, RIOT 23->22, IONQ 5->6
+10m  01:46:55Z   changed: RKLB 109->108
```

**The data updates at least every 5 minutes**, so it is no slower than our tick and the task's
"fetch on their cadence, skip when unchanged" concern is milder than expected. A per-ticker
dedup against the last stored `raw` is still worth keeping — most tickers are unchanged between
ticks, and inserting identical rows would inflate the z-score baseline with duplicate
observations that carry no new information.

Note the direction of travel: RKLB fell 110 → 109 → 108. Counts *decrease* as old mentions age
out of the trailing window — which is itself confirmation that the window is rolling, and is a
behaviour no 1-hour counter of ours has ever exhibited.

### GATING PROBLEM 1 — the window is 24 hours, not 1 hour

`mentions` is a **rolling 24-hour count** (confirmed by the presence of `mentions_24h_ago`, its
24-hours-ago counterpart). Our column is `mentions_1h`, and every downstream consumer assumes a
one-hour window.

This is not a labelling nit. **Seed #1 gates on `mentions_1h >= 5` and `unique_authors_1h >= 3`** —
absolute thresholds added specifically to stop single-post triggers. "5 mentions in 24 hours" is
a far weaker bar than "5 mentions in 1 hour": on today's data 8 of 17 tickers clear it right now,
in a quiet overnight tape. Writing a 24h count into `mentions_1h` would silently loosen the gate
the H4 decision existed to tighten.

Differencing consecutive snapshots does not recover an hourly count either: sampling a rolling
24h window an hour apart yields *(mentions this hour) − (mentions in the hour 24h ago)*, which
can go negative and is not a mention count at all.

Options: **(a)** store the 24h count as-is and accept that seed #1's absolute gates mean
something different under this source; **(b)** recalibrate seed #1's absolute thresholds per
source; **(c)** add a window-scoped column so the two are never confused. None is free.

### GATING PROBLEM 2 — how multiple mention sources combine (task item 4)

`featureEngine`'s `SOCIAL_SQL` currently does `sum(mentions_1h) … GROUP BY symbol, ts` and then
takes the newest row. Deferred finding **H1** already records that this never actually merges
sources, because each ingest stamps its own `new Date()` and they never share a `ts` — so the
newest writer silently wins. Adding a third source makes that worse *and* raises real
double-counting, because **ApeWisdom is itself aggregated Reddit**: summing it with
Reddit-direct counts the same posts twice.

**Proposed rule — one primary mention source, never blended:**

- Mention-derived features (`mentions_1h`, `unique_authors_1h`, `mention_zscore`,
  `social_velocity`, `social_accel`, `author_quality`) come from **exactly one source**, chosen
  by fixed precedence: **`reddit` > `apewisdom`**. Reddit-direct is the ground truth; ApeWisdom
  is a proxy for the same population and yields to it the moment OAuth lands.
- **Stocktwits is excluded from mention counts entirely.** It is a different platform with a
  different volume scale; blending it into the same count makes the z-score baseline a mixture
  whose meaning changes with source availability.
- **`bull_ratio` continues to come from Stocktwits only** — it is the only source with sentiment.
- Precedence is applied **across the whole baseline window, not per tick**. A z-score is only
  meaningful if its 7-day baseline is measured on one instrument; switching sources mid-window
  compares a count to a history of differently-scaled counts.

That rule also closes H1 for mentions as a side effect.

**Consequence to accept up front:** when Reddit-direct arrives, the primary source changes and
every mention baseline restarts from scratch — 7 days of ApeWisdom history does not transfer to
Reddit-direct, because the two measure the same thing on different scales and windows.

### Proposed sequencing — ingest now, consume after ratification

The 7-day baseline is the long pole, so I propose **starting ingestion immediately** while
`featureEngine` explicitly ignores `source = 'apewisdom'` until the two decisions above are
made. Rows accumulate and the baseline clock starts now; features are untouched and cannot be
corrupted in the meantime. Without that guard, apewisdom rows would immediately start winning
the `rn = 1` race at random and swing the mention scale tick to tick.

### Timeline for seed #1, once ratified

`mention_zscore` needs `MIN_OBS_MENTIONS_7D = 20` observations, and the deferred finding **M5**
already records that 20 observations is ~100 minutes rather than a real 7-day baseline. So a
non-NULL `mention_zscore` appears **~100 minutes after the first apewisdom row**, but it will be
a z-score against a near-degenerate sample until roughly **7 days** of history exists. Seed #1
cannot fire before the first of those, and should not be trusted before the second.

### RULINGS — all ratified 2026-08-12, implementation proceeding

**1. Window — semantic honesty (option c).** New columns `mentions_24h` and `upvotes_24h` on
`social_snapshots` and `features`. **ApeWisdom rows never write `mentions_1h`**; that column
keeps its 1-hour meaning and stays NULL under this source. No differencing, no reinterpretation.

**2. Seed #1 gets a source-conditional entry gate.** While apewisdom is primary, the H4
absolute-substance gates (`mentions_1h >= 5 AND unique_authors_1h >= 3`) are replaced by:

```
mentions_24h >= 25  AND  mentions_24h > mentions_24h_ago
```

The H4 gates exist to block single-post noise. On a 24-hour window the equivalent substance test
is absolute volume **plus growth** — the window rising rather than aging out — and ApeWisdom's
`mentions_24h_ago` field supplies growth for free.

**The author gate is dropped under this source explicitly, not accidentally.**
`unique_authors_1h` is unsatisfiable here — the aggregator does not expose author identity, so it
is NULL forever. It returns automatically when Reddit-direct becomes primary.

**25 is provisional.** The observation that motivated setting it materially above the H4 value:
on the overnight snapshot taken during the investigation, **8 of 17 watchlist tickers cleared a
`>= 5` bar** on a quiet tape — a threshold that would have been nearly free. **Review after two
weeks of live distribution data.**

**3. `mention_zscore`** — computed over `mentions_24h` while apewisdom is primary, single
instrument per the precedence rule. On source switch the baseline restarts from zero, including
the ~7-day quiet period that implies. Accepted.

**4. Precedence — ratified exactly as proposed.** One primary mention source, `reddit` >
`apewisdom`, applied across the whole baseline window, Stocktwits excluded from mentions and
retained for `bull_ratio`. **This closes deferred finding H1 for mentions** — cross-source `ts`
grouping can no longer pick a winner at random, because only one source is ever consulted.

**5. Sequencing** — straight through: ingest, migration, source-aware `featureEngine`, seed #1's
conditional gate, audit, gate. The 10-page fetch per cycle is acceptable (keyless and cheap),
with a courtesy `User-Agent` identifying Pulse and polite backoff on 429/5xx.

### TIMELINE — for phase 6 expectations

**Corrected 2026-08-12.** The original figure below assumed one observation per 5-minute tick.
The dedup ruling, in the same commit, made that unreachable for most tickers — three live ingest
ticks produced 20, 1 and 4 rows, with fifteen of twenty tickers contributing a single
observation. The heartbeat ruling sets the real cadence.

- **~10 hours** from cold: first non-NULL `mention_zscore`. `MIN_OBS_MENTIONS_7D = 20`
  observations at the 30-minute heartbeat is 10 hours for a ticker whose payload never changes.
  An actively-discussed ticker reaches it sooner, since every genuine change also writes a row.
- ~~**~100 minutes** … at one row per 5-minute tick~~ — wrong, superseded. Recorded rather than
  deleted, because the wrong number was committed and a phase-6 observer may have read it.
- **~7 days**: the z-score becomes statistically meaningful rather than a score against a
  near-degenerate sample. Deferred **M5** records that the 20-observation minimum is far below
  the window it claims to cover.
- **Seed #1 is not trustworthy before that 7-day mark**, even though it becomes *able* to fire at
  the 100-minute mark.
- **2 weeks**: review the provisional `mentions_24h >= 25` threshold against real distribution.

Phase 6 observation notes should not read early seed #1 signals as validation, nor its silence
before the ~10-hour mark as a defect.

### Fix-cycle rulings 2026-08-12 (audit of `844c5e2`)

The audit confirmed all six original rulings honoured at the write path, `evaluate()`
byte-identical, source switching fail-safe in both directions, and **H1 genuinely closed**. It
also found five HIGH defects. Owner rulings:

**Dedup → heartbeat.** Keep the intent — identical payloads must not multiply — but write a row
at least **every 30 minutes per watchlist ticker regardless of change**. The reasoning that
matters: *the baseline needs continuous observation of a continuous quantity — "unchanged" is an
observation, not an absence.*

Without it, two defects compounded. Dedup had no time filter while the baseline is a rolling
7-day inner join, so a ticker whose payload stopped changing would leave the pipeline
**permanently** — BITF, EOSE and FCEL carry `{"absent_from_ranking": true}`, constant by
construction, and would have dropped out on 2026-08-19, self-perpetuating because no row written
means nothing re-enters the window. And dedup starved the observation minimums exactly when the
signal appears: a cold ticker sits at n=1, so its spike *is* its second observation,
`mention_zscore` is NULL at the breakout, and dedup converted "fires" into "structurally cannot
fire". It also killed seed #3, whose target — the quiet ticker — is by definition the one whose
payload never moves.

**Instrument seam → null the historical mention columns.** `social_snapshots` has never held a
single reddit row, so every historical mention-derived value in `features` is
**Stocktwits-derived**. The audit verified it numerically: the last pre-seam row showed LUNR 3,
PLUG 5, BBAI 4, SOUN 1, ASTS 2, RKLB 5, QBTS 0, FCEL 0 — an exact match for the `stocktwits`
rows at 02:25:00, with the four symbols lacking a Stocktwits row being exactly the four NULLs.

Left in place, the holdout replay would evaluate `mentions_1h >= 5` against a month of Stocktwits
message counts and hand the resulting fabricated expectancy to the evolution loop as the bar
gating every promotion and retirement.

So `mentions_1h`, `unique_authors_1h`, `mention_zscore`, `social_velocity`, `social_accel`,
`author_quality` and `exhaustion_score` are nulled on pre-seam `features` rows. Same principle as
the `days_to_cover` non-backfill: **NULL blocks entries and a replay reading it honestly says "no
data", whereas a plausible-looking number from the wrong instrument is worse than a hole.**

**The raw `social_snapshots` rows are preserved untouched.** `bull_ratio` stays valid and the
snapshots remain honest data about what Stocktwits said. Only their masquerade as mention
features dies.

**Precedence requires sustained presence.** Reddit becomes primary only after sustained
successful ingestion, not on a single row, and demotes symmetrically — one transient HTTP 200
would otherwise have blacked out the mention pipeline for seven days. Implemented as **N = 20 =
`MENTION_BASELINE_MIN_OBS`**, derived rather than chosen: a source may displace another only once
it can produce the `mention_zscore` that displacing is *for*. The precedence window and the
z-score window are now the same exported constant and cannot disagree.

### Fix cycle 2 — two HIGHs found after cycle 1 shipped

An anti-slop audit reported after cycle 1 was already committed. Two defects that change runtime
outcomes:

**The completeness guard was backwards for a growing ranking.** It asserted
`results.length !== count`, but the ranking is live and read over ~10 sequential requests — a
ticker entering mid-fetch makes the collected total *exceed* `count` and the guard killed the
whole tick. The investigation's own measurements showed the ranking moving (948, 948, 945).
Now a shortfall of **a whole page or more** aborts; over-count is treated as churn. Verified:
growth (303 of 300) writes 20 rows where `04b0812` wrote 0; shortfall of a page and an empty
page 1 still write nothing.

`MAX_BACKOFF_MS` was also deleted — it silently converted a server's `Retry-After: 60` into 5
seconds while `RETRY_BUDGET_MS` already bounded the total, so it disobeyed the rate limiter
and bought nothing.

**Firability did not gate evolution's promotion.** `canFireUnder` ran only in the pipeline
reconciler. Because `replay()` scores candidates against 30 days of history in which the *other*
source's columns still held data, an unfirable candidate could win, trigger `swap()` — retiring a
working strategy in the same transaction — and then be demoted back to `candidate` on the next
tick. **Net loss of one active strategy, permanently**, which is exactly the shrinkage the
swap-semantics ruling exists to prevent; cycle 1 made this worse than before. Now gated at the
promotion loop, modelled on the short-side restriction: skipped without consuming the
retirement, so the retirement stays available to a candidate that can fire. Demonstrated —
`04b0812` ends the cycle with 3 active and one unfirable; the fix ends with 4 active, all firable.

### CONTROLLING INTERPRETATION — §5.2 over the §6.2 floor (ratified 2026-08-12)

**Where spec §5.2 ("a strategy must never sit `active` while structurally unable to fire") and
§6.2's floor ("the active set never drops below 3") cannot both hold, §5.2 controls. The floor
yields, and the breach is logged loudly.** This is the owner-ratified reading of the two rulings
and governs any future case where they conflict.

The reasoning, as ratified:

> The floor exists to stop the *evolution loop* retiring strategies that work, because retirement
> is permanent and there is no un-retire path. A strategy that cannot fire is not one that works,
> and holding it active buys a number that lies — a number that feeds `active.length`, the
> retirement permission and the cap of 6, so a padded floor would let the loop retire a real
> strategy on the strength of a phantom. Demotion, unlike retirement, is reversible and reverses
> itself when the primary source changes back.

The log line names the active count, how many were demoted on that tick, and the reasoning, so an
observer seeing 2 active does not read it as decay.

### A conflict between two ratified rulings — firability wins, loudly

The reconciler enforced the cap of 6 but ignored the floor of 3, so demotions could breach it.
**§5.2 (never active while unable to fire) and §6.2 (never below 3 active) cannot both always
hold.**

**Decision: §5.2 wins; the floor yields and the breach is logged loudly.** The floor exists to
stop the *evolution loop* retiring strategies that work, because retirement is permanent and
there is no un-retire path. A strategy that cannot fire is not one that works, and holding it
active buys a number that lies — a number that feeds `active.length`, the retirement permission
and the cap of 6, so a padded floor would let the loop retire a real strategy on the strength of
a phantom. Demotion, unlike retirement, is reversible and reverses itself when the primary source
changes back.

`MIN_ACTIVE_STRATEGIES` and `MAX_ACTIVE_STRATEGIES` moved to `config.js` alongside the other
ratified operating limits, so the cap is no longer exported from a worker purely to be
re-enforced elsewhere.

---

## Owner decisions 2026-08-11 (third set) — implemented

### 1. Seed #2's gate is now days-to-cover, on real FINRA data

`short_interest_pct` is unobtainable — FINRA publishes shares short, not a percentage, and
converting needs float, which no approved source provides. Redefined:
`days_to_cover = shares_short / avg_volume_30d`, entry gate `> 3`. `avg_volume_30d` was already a
true daily mean, so it is a direct division.

**19 of 20 tickers carry real values**, latest settlement `2026-07-31`. PLUG 5.73, BBAI 5.62,
SOUN 4.56, MARA 2.28, RKLB 2.18 — 12 of 19 clear the gate. The only NULL is BITF, which fails on
both legs independently (delisted, so no volume; absent from FINRA's file). NULL, never 0.

**The FINRA endpoint requires no authentication.** The supplied credentials fail OAuth
(`400 invalid_client`) and are not needed — they have been removed from `.env.example` and the
spec. `settlementDate` is the dataset's partition key so it cannot be sorted on; the query
filters a trailing 60-day window (≥ 2 publication cycles) and picks the latest per symbol
client-side. One request, 76 rows for the whole watchlist.

Our days-to-cover diverges from FINRA's own by up to **±17%**, unbiased in sign, entirely from
the volume denominator (they average over their semi-monthly cycle, we use 30 trailing
sessions). No symbol crosses the `> 3` gate differently today, but CLSK (3.26 vs 3.25) and WULF
(3.07 vs 3.34) sit close enough to matter later.

### 2. Evolution is now swap semantics with a floor of 3

A strategy is retired **only** in a cycle where a validated candidate replaces it; no qualifying
candidate means no retirement, logged as a skipped cycle. The active set never drops below 3.

The retirement moved from before the Claude call to inside the promotion loop. The bar is
unchanged — the worst qualifier's own holdout expectancy through the identical harness — only
its timing moved; `replay` is pure and reads nothing about `status`, so the number is bit-for-bit
what the old code produced. A swap is two guarded CTEs inside one `BEGIN…COMMIT`, so neither half
can land alone; demonstrated by forcing the second to fail and confirming the retirement and its
log row both rolled back.

Floor semantics: retirement requires ≥ 4 active, so the set never reaches 3 by shrinking, not
even transiently inside the transaction. **At exactly 3, promotion still happens and grows the
set** — a swap is net-neutral, so that is the only state where the floor bites.

A winning **short** candidate is not promoted and explicitly does **not** consume the retirement,
leaving it available to a long candidate in the same cycle.

Six scenarios demonstrated on a throwaway database (created and dropped): swap, tie → no
retirement, Claude returns nothing → no retirement, floor → additive promotion only, short wins →
no retirement, two winners → swap plus one addition.

### 3. `price_momentum_1d` and `price_momentum_2d` added

Closes deferred **M9** and makes seed #4's "price up > 30% in 2 days" expressible. Both populated
for all 19 live tickers. Seed #4 stays `candidate` regardless, per the owner — the short path has
no borrow check and has never executed live.

### The replay was blind to every new feature — caught and structurally fixed

The holdout replay selected an explicit feature column list and built its own bag; neither
included the three new columns. Replayed seed-#2/#4 mutations would have scored "condition not
met", produced no entries, and returned NULL holdout expectancy — which under swap semantics
means **no swap could ever happen for those lineages**, silently, looking exactly like "no
candidate was good enough".

Fixed by deriving both lists from `engine.js`'s `VOCABULARY`, the same authority that generates
the proposal schema. Adding a feature now requires no change here, and a feature that is not a
`features` column fails loudly with `column … does not exist` rather than silently reading NULL.

Verified the seeds still replay to zero trades for a *legitimate* reason, not this one: the 38
rows carrying the new columns fall on 2 of 39 replay ticks, both stamped 19:02 and 19:15 ET —
after the replay's entry window. `featureEngine` has only run twice since migration 006 and both
runs were after hours.

### Minor decisions — resolved as recommended

- **M5** `MIN_QUALIFIERS = 2` — ratified. Composes with swap semantics rather than conflicting.
- **M4** the weekly Claude call stays outside `claude_call_budget`. Under swap semantics a
  starved call is now worse: no candidate means no swap and a wasted cycle.
- **M2** the replay's fixed session clock — left, disclosed. Affects baseline and candidates
  identically, so ranking is unaffected.
- **M1** the replay's optimism — disclosed, not modelled. This matters *more* under swap
  semantics: promotion is the only thing that moves the population, so an overstated candidate
  makes swaps rest on thinner evidence than they appear to.

### Days-to-cover divergence from FINRA's published figure — ACCEPTED, do not "fix"

Our `days_to_cover` differs from FINRA's own `daysToCoverQuantity` by up to **±17%**, unbiased in
sign (APLD 3.70 vs 3.15; FCEL 1.38 vs 1.64; CLSK 3.26 vs 3.25). The entire difference is the
volume denominator: FINRA averages over its semi-monthly short cycle, we use `avg_volume_30d`,
a trailing 30 completed sessions.

**Owner decision: accepted as-is, no action.** What matters is internal consistency — the same
computation gates entries, feeds `strategy_stats`, and drives the §6.4 holdout replay, so the
`> 3` threshold is calibrated to our own metric. Substituting FINRA's published figure would make
the gate disagree with the §3 eligibility guard, which uses the same `avg_volume_30d` column, and
would silently recalibrate a threshold that was set against ours.

**Recorded here so nobody later "corrects" it into an inconsistency.** If the two figures ever
need reconciling, change the threshold and the replay together, not the denominator alone.

### Single-writer rule (owner decision, 2026-08-11)

**Railway's cron is the sole routine writer to the production database.** Local runs happen only
for explicit verification tasks, never as a background habit. This closes the duplicate-writer
exposure that produced doubled `features` rows earlier in the build and, later, rows written by
two different code versions at once.

**Wednesday's lifecycle run executes LOCALLY, with Railway's service paused for the window.**
Reasoning:

- The run needs the temporary-threshold edit to `seeds.js` and its restoration, both verified by
  reading the `strategies` row back. Driving that through Railway would mean deploying a
  deliberately weakened strategy to production and redeploying to restore it — two deploys, with
  a window in which production carries thresholds that are not the spec's.
- The run must be executed step by step with inspection between ticks (entry fills, conviction
  written, exit submitted, exit settled). A 5-minute cron cannot be stepped.
- Pausing Railway for the window makes the writer unambiguous rather than merely unlikely to
  collide, which is the point of the rule.

Sequence: pause the Railway service → confirm no further cron ticks arrive → run the lifecycle
locally → restore thresholds and verify against the `strategies` row → resume Railway. If the
service cannot be paused, the fallback is to run the lifecycle inside a single tick window and
accept one interleaved Railway tick, recorded as such — but pausing is preferred and is the plan.

### Stale-build rows and the holdout replay — assessed, backfill proposed not performed

Of the 860 `features` rows in the 30-day replay window, **803 carry NULL** in `days_to_cover`,
`price_momentum_1d` and `price_momentum_2d` — written by the pre-`111d9eb` build. **260 of those
fall inside the replay's 09:45–15:45 ET entry window**, so this is not the after-hours-only case
first assumed.

**Direction of the error: under-representation, not corruption.** A NULL never satisfies a
condition, so a replayed strategy gating on any of the three simply takes no entry at those
ticks. Nothing is scored wrongly; entries are missed. The consequence is that seed-#2 and
seed-#4 lineages replay to few or zero trades, fall under the 10-trade minimum, and return NULL
holdout expectancy — and **under swap semantics a NULL holdout means no swap can ever happen for
that lineage.** The failure is silent and looks exactly like "no candidate was good enough".

All 57 non-stale rows fall *outside* the entry window, so **at present zero in-window rows carry
the three features**.

**BACKFILL — owner decision, 2026-08-11. Two columns filled, the third deliberately not.**

- **`price_momentum_1d` and `price_momentum_2d` ARE backfilled**, each row reconstructed from the
  `market_snapshots` state at or before its own `ts`. These are genuine per-tick reconstructions
  of what was true at the time, validated against the rows current code had already written
  correctly.
- **`days_to_cover` is deliberately NOT backfilled and stays NULL for historical rows.**
  `tickers.days_to_cover` holds a single *current* value; writing it onto past ticks would stamp
  today's short interest onto history — exactly the look-ahead that per-tick denormalisation
  exists to prevent (spec §4). An honest backfill needs a join to the FINRA settlement in force
  at each row's own timestamp. NULL is the conservative error: it blocks entries rather than
  inventing them.

**The asymmetry is a choice, not an oversight.** Anyone reading two filled columns beside one
empty one should not "complete" the third.

**Executed 2026-08-12.** 931 rows updated, matching the dry run exactly. Coverage of the 30-day
window afterwards:

| | rows | `price_momentum_1d` | `price_momentum_2d` | `days_to_cover` |
|---|---|---|---|---|
| inside 09:45–15:45 ET | 260 | 247 | 247 | **0** |
| outside | 800 | 741 | 741 | 57 |

The in-window replay tape went from **zero** usable rows to 247, with 48 clearing seed #2's
`price_momentum_1d > 3`. The 52 unfillable rows are all BITF, which has never had a single
`market_snapshots` row — NULL is correct there.

Reconstruction was validated against the 57 rows current code had already written, on four
independent checks, all 57 bit-identical (the chained 2-day formula to 1.6e-14). A falsification
check confirmed the implied in-progress close falls inside the day's actual high–low range for
all 710 snapshots, excluding a shifted-bar misreading. Column md5s confirm `days_to_cover` and
every other table were untouched.

**Consequence to carry into phase 6:** seed #2's lineage stays NULL-holdout-blocked until the
live window accumulates roughly 30 days of real `days_to_cover` rows — no swap can occur on that
lineage until around **mid-September 2026**. That is correct behaviour, not a defect. Phase 6
observation notes should expect it, and should not read "seed #2 never evolves" as a bug.

Original assessment of what was computable, retained for reference:

- `price_momentum_1d` / `price_momentum_2d` — `market_snapshots.pct_change_1d` already exists for
  the whole window; `pct_change_2d` exists only on rows written by current code, but both are
  recomputable from the `price` series already in `market_snapshots` at the matching timestamps.
- `days_to_cover` — `tickers.days_to_cover` is a single current value per symbol. Backfilling it
  onto historical rows would stamp today's short interest onto past ticks, which is **exactly the
  look-ahead the per-tick denormalisation exists to prevent**. FINRA's dataset does carry
  historical settlement dates, so an honest backfill would need to join each row to the
  settlement in force at its timestamp.

Recommendation: **backfill the two momentum columns, leave `days_to_cover` NULL for historical
rows.** The momentum values are genuine reconstructions of what was true at each tick. A
`days_to_cover` backfill is only honest with a per-settlement-date join, which is more work than
the current 30-day window justifies — and letting it stay NULL is the conservative error, since
NULL blocks entries rather than inventing them. Awaiting the owner's decision.

Note this self-heals: once the deploy is current, every new tick carries all three, and the
30-day window rolls the stale rows out.

### ROOT CAUSE — there was never a backend on Railway

**The "Railway cron" did not exist.** The Railway project contained only Postgres. Every tick
attributed to it was a **stale local `node server/index.js` process on the owner's machine**,
running pre-`111d9eb` code, writing to the production database over the public Postgres URL.
Both "redeploys" restarted the Postgres service, which is why neither changed the behaviour.

Confirmed from both sides: the owner hit `EADDRINUSE` on :3000 starting a second copy and found
the PID via `netstat`; from this side, `Get-CimInstance Win32_Process` found **PID 2444,
`node server/index.js`, started 19:31:37 local, holding the listener on :3000**. It survived an
earlier kill attempt. Killing it stopped the ticks.

**This is where the diagnosis went wrong, and it is worth recording.** The evidence — on-time
5-minute ticks writing NULL into columns that current code populates — was read as "Railway is
serving a stale build". It was equally consistent with "something else is running stale code",
and that alternative was never tested, because the existence of a deployed backend was assumed
rather than checked. A single question — *is there actually a backend service in the Railway
project?* — would have settled it in one step. Two "redeploys" and roughly an hour were spent
on a hypothesis that had never been grounded.

The irony worth noting: an earlier entry in this log already recorded a subagent's stray backend
surviving its first kill and firing an unattended cron tick. That was the same failure mode,
already observed, and it was not connected to this.

The original (incorrect) diagnosis follows, retained deliberately rather than deleted:

---

### ~~Railway is STILL serving a stale build after the redeploy~~ — SUPERSEDED, see root cause above

The owner redeployed from `main` at HEAD. **The redeploy has not taken effect**, verified across
two consecutive ticks 10 minutes apart:

| tick (UTC) | rows | with `days_to_cover` |
|---|---|---|
| 23:35:03 | 20 | **0** |
| 23:30:02 | 20 | **0** |
| 23:25:40 *(local, at HEAD)* | 20 | 19 |

At HEAD, `featureEngine` reads `tickers.days_to_cover` — which is populated for 19 of 20 symbols
— and writes it into every row. Railway writes NULL, so it is running pre-`111d9eb` code. The
database schema is migrated; the code writing to it is not.

Ticks are arriving on schedule, so the service is up — an older container is still serving.

**Second redeploy also had no effect.** Verified across **eleven consecutive ticks** spanning
23:30 → 00:20 UTC, every one writing NULL into all three columns. Exactly one tick per 5-minute
interval throughout, so this is a single stale instance, not a new deployment running alongside
an old one (that would produce two ticks per interval, one of each kind).

~~Leading hypothesis: the new build cannot boot on a missing `ANTHROPIC_API_KEY`.~~ Wrong — there
was no build. The variable check was a red herring built on the unexamined premise that a
backend service existed at all.

---

### Deploy configuration added

`railway.json` at the repo root, for a backend service built from `main`:

- **Nixpacks** builds from the repo root, where `package.json` *is* the backend — four
  dependencies, no devDependencies, `package-lock.json` committed, `engines.node >= 20`.
  `web/` has its own `package.json` and is not recursed into.
- **`preDeployCommand: npm run migrate`** applies migrations before the new container takes
  traffic, so schema and code never diverge the way they did here. The runner is idempotent —
  applied migrations are skipped.
- **`startCommand: npm start`** → `node server/index.js`, which registers all four crons.
- **`healthcheckPath: /health`**, so a container that cannot boot fails the deploy visibly
  instead of being assumed healthy.
- **`watchPatterns`** limited to `server/**`, `package.json`, `package-lock.json` and
  `railway.json`, so frontend-only commits do not redeploy the backend.
- `restartPolicyType: ON_FAILURE` with 3 retries.

`PORT` is injected by Railway and read by `config.js` with a 3000 fallback; Express binds all
interfaces by default. No `.railwayignore` was added — excluding `web/` at the repo root would
break a future frontend service deployed from the same repo, and `watchPatterns` already covers
the redeploy concern.

### DEPLOYMENT COMPLETE — verified 2026-08-12 00:55 UTC

A backend service now exists on Railway, built from `main` at the `railway.json` commit.
Healthcheck passed, status Active. Boot line:

```
[pulse] listening on 8080, cron registered for */5 * * * *, 0 * * * *, 0 6 * * * and 0 3 * * 0
```

All four schedules registered — 5-minute pipeline, hourly `statsRollup`, daily 06:00 ET
`tickerMetaRefresh`, weekly Sunday 03:00 ET `evolution`. `PORT` 8080 is Railway's injection,
picked up correctly.

**Database-side verification.** The stale writer was killed at 00:30; the `00:35`, `00:40`,
`00:45` and `00:50` windows all passed with nothing written, so the database had **no writer at
all** before the service came up. The first tick from the real service landed at
**00:55:01.451Z**, 20 rows, with all three migration-006 columns populated for **19 of 20**:

| symbol | days_to_cover | price_momentum_1d | price_momentum_2d | price_momentum (1h) |
|---|---|---|---|---|
| APLD | 3.695 | 2.168 | 1.608 | 0.422 |
| ASTS | 3.536 | 4.174 | −0.431 | 0.043 |
| BBAI | 5.624 | 3.096 | 1.835 | 0.000 |
| **BITF** | null | null | null | null |
| CLSK | 3.260 | −0.604 | −6.341 | −0.171 |

The single NULL is BITF, delisted, which is correct and expected. Values are real, not merely
non-NULL — they match the figures `tickerMetaRefresh` and `marketIngest` produced locally.

`schema_migrations` shows 001–006 applied, so `preDeployCommand` ran cleanly (all were already
applied, and the runner skipped them idempotently as designed).

**The single-writer rule now genuinely holds.** Railway is the only routine writer; the
production database has exactly one process talking to it. Local runs happen only inside
supervised verification windows with the service paused — which is the shape of Wednesday's
lifecycle run.

### Resolved 2026-08-11 (fourth set)

- **Seed #3 gained a time bound** — max hold 10 trading days, added as a third exit leg. Spec
  §5.3 previously had no max hold, so a position whose social spike never arrived could be held
  indefinitely. The rule is now uniform: no strategy in the system, hand-written or evolved, may
  hold indefinitely — the seeds meet the same bar §6's exit-shape check imposes on Claude's
  proposals. Stop and social-spike exit unchanged.
- **The stale prompt string was corrected.** `CONDITION_SCHEMA`'s feature description claimed
  "Every other feature is NULL until social data flows", which stopped being true at migration
  006. Reworded to state factually which features carry live data and which are NULL, without
  steering the model toward or away from any of them.

---

## SHADOW BOOK — PROPOSAL, awaiting decisions before implementation

Three decisions were asked for. Two have clear answers from the code. **The third has a blocker
that makes the design intent unimplementable as written**, and needs an owner ruling.

### 1. Storage — separate `shadow_trades` table. Not a status enum.

The brief asks which isolates harder, and the code answers it decisively: **`trades` is read or
written at 26 sites across 5 files**, including the three that must never see a shadow row —
`statsRollup.js:15` (real strategy stats), `evolution.js:63` (the holdout replay's trade
aggregates), and `strategyRunner.js:61,67` (the PDT counters themselves).

A `status = 'shadow'` enum value makes correctness depend on 26 filters being right, and staying
right forever. Every future query against `trades` becomes a new opportunity to blend
counterfactual outcomes into real expectancy, and **the failure is silent** — a missing
`AND status <> 'shadow'` produces a plausible number, not an error. That is the same failure
shape as the instrument seam nulled on 2026-08-12, which reached the evolution loop's promotion
bar undetected.

A separate table isolates *structurally*: a query that does not name `shadow_trades` cannot read
one, and none of the 26 existing sites name it. Isolation becomes a property of the schema rather
than of 26 remembered predicates. It also keeps `trades`' columns honest — `alpaca_order_id`,
`exit_order_id` and `exit_attempt` are meaningless for a position that never reaches a broker.

### 2. BLOCKER — at the moment every named guard fires, there is no signal to reuse

The brief requires shadow entries to "reuse the real signal + conviction, not re-derive them".
**They cannot, because none exists yet.** Traced through `strategyRunner`:

| guard | line | what it does | signal exists? |
|---|---|---|---|
| session blackout | `:145-148` | `return` before anything | **no** |
| PDT budget | `:163-167` | `return` before eligibility | **no** |
| eligibility | `:171` | SQL filter; ineligible symbols never enter the loop | **no** |
| max-concurrent | `:195` | `break` before `evaluate()` | **no** |
| duplicate position | `:196` | `continue` before `evaluate()` | **no** |

`evaluate()` is not called until `:202`, and the `signals` row is not inserted until `:221`. All
five blocks precede both. The only skips that happen *after* a signal row exists are the
conviction ones — `budgetExceeded` at `:227` and `conviction < 0.4` at `:233` — and those are
deliberate counterfactual records already, not guard blocks.

So shadowing a guard-blocked entry requires **evaluating strategies the guards have already
refused**, which means restructuring the early returns. **The brief forbids "touching any guard
logic".** The design intent and the forbidden list are in direct conflict, and only you can
resolve it.

Three ways out:

- **(a) Shadow only the post-signal skips.** Zero guard changes; the conviction-blocked cases
  already have a signal and conviction to reuse. But it shadows nothing the brief actually named —
  and notably **not the PDT lockout that motivated this work**, so the current 6-session blackout
  would still produce no evidence.
- **(b) Split "evaluate" from "act".** Let evaluation run unconditionally, and move the guards to
  the point of *acting* on a signal. This is the honest fix and gives full coverage. It is
  structurally a change to where guards sit, though not to what any guard decides — the same
  refusals, reached the same way, applied one step later. It needs explicit authorisation given
  the forbidden list, and it touches the money path's most-audited file.
- **(c) A parallel shadow evaluation pass** that runs after the real runner returns, re-deriving
  signals independently. No guard is touched. But it duplicates the evaluation path, which is the
  exact duplication the phase-3 and cycle-2 audits both flagged as a defect class, and it
  re-derives rather than reuses — contradicting the brief's own instruction.

**My recommendation is (b)**, with the guard *decisions* left byte-identical and only their
position in the flow changed, audited specifically for that.

**A cost consequence that applies to (b) and (c) either way:** conviction is a real Claude call,
capped at 50/day. Shadowing means signals fire on ticks that currently produce none, so shadow
entries consume that budget and can starve real entries once the lockout lifts. Options: a
separate shadow budget, shadow entries recording conviction as NULL and being excluded from the
"conviction passed" requirement, or accepting the shared cap. **This needs a decision too** — the
brief says shadow must never consume *PDT* budget, but is silent on the Claude budget.

### 3. Exit tracking — structural impossibility via module boundary

Make it impossible by construction rather than by condition: put shadow exit tracking in its own
module that **does not import `services/alpaca.js` at all**. `submitOrder` is then not in scope,
so no code path can reach order submission — not because a branch avoids it, but because the
function does not exist in that file. That is greppable, testable, and cannot regress silently the
way an `if (!isShadow)` can.

Pricing comes from `market_snapshots` (the same source `positionTracker`'s `LATEST_PRICE_SQL`
already uses), so the shadow path makes **no Alpaca call whatsoever** — not orders, not positions,
not quotes. Exit legs reuse `engine.js`'s `evaluate()` with `in_position: true`, exactly as the
real tracker does, so the exit semantics cannot drift.

Slippage: the real trades measured ~0.067% round-trip cost on three fills. A shadow fill should
apply a stated constant in the adverse direction at both entry and exit rather than assuming a
free fill. Propose 0.05% per side as a starting figure, flagged provisional and reviewable
against real fills, in the same way the `mentions_24h >= 25` threshold is.

### RULINGS — all three ratified 2026-08-12, implementation proceeding

**1. Guard classification (owner decision).** Option (b) authorised, but narrower than proposed:
**not every guard is shadow-worthy**, and the split reflects that.

| class | guards | ruling |
|---|---|---|
| **BUDGET** | PDT budget, max-concurrent | Temporary refusals of trades the system genuinely wanted — exactly what the shadow book measures. **Relocate to act-time**, after `evaluate()` and the `signals` row. |
| **UNIVERSE** | eligibility | A permanent property of the ticker, not a blocked trade. An OTC ticker refused is not a counterfactual worth tracking. **Stays pre-evaluation, in SQL.** |
| **STATE** | session blackout, duplicate position | Blackout means "not yet", within minutes — shadowing it produces noise, not evidence. A duplicate means the trade already exists. **Both stay as early exits.** |

So the control flow changes at **exactly two points**, not five. Guard *decisions* stay
byte-identical — same refusals, same reasons, same arithmetic, reached one step later.

**Because this is the most-audited file on the money path, the audit must verify
refusal-equivalence explicitly**: the throwaway-database scenario method, demonstrating each
relocated guard refuses the same entries for the same reasons before and after, including the
entry-side reservation arithmetic computing identically at its new location.

**2. Claude conviction budget — shared cap, real-first, shadow-dropped under pressure.**

Shadow entries make the **same real conviction call**. A shadow book built without the conviction
gate measures a different system and answers nothing about ours.

Within a tick, conviction calls for actionable entries are made before shadow ones. If the 50/day
cap is reached, **shadow entries are dropped with a log line, never recorded with conviction
NULL** — a shadow row that skipped the gate would contaminate the book's comparability, whereas a
dropped shadow is just a smaller sample. The drop count is recorded so cap pressure is visible.

No separate allowance: signal volume is a handful a day against a cap of 50, and during a lockout
there are no real entries competing at all. **If cap pressure ever becomes real, that is a finding
worth surfacing, not budgeting around.**

**3. Slippage — 0.05% per side, adverse in both directions.** Provisional. Evidence base: the
three real fills of 2026-08-11 cost ~0.067% round trip. **Reviewed alongside the seed-#1
`mentions_24h >= 25` threshold review on ~2026-08-26**, by which point there may be more real
fills to calibrate against. The UI caveat names the constant.

Storage as a separate table and the module-boundary exit isolation are approved exactly as
argued above.

---

## PDT IS A HARD RISK GUARD, NOT A TEST KNOB — owner decision, 2026-08-12

**Precedent, binding on all future verification work: verification plans bend around the risk
guards. The guards do not bend around verification schedules.**

On 2026-08-12 the Phase 4/5 lifecycle run was blocked by the PDT guard, and three routes around
it were considered. Two were declined on principle:

- **Relaxing the guard for the test** — declined. PDT is a hard risk guard.
- **Revisiting the reservation policy's design to rescue the schedule** — declined, as the same
  principle one level up. Redesigning a guard because it inconvenienced a test is the same act as
  disabling it, with extra steps.

**The reservation policy stands as designed:** a position must never exist without same-day stop
capacity, because a stop is not optional and an intention to hold overnight is not enforceable
against one. `strategyRunner:162` computes `dayTradeBudget = 3 − used − reserved` and refuses all
entries at zero.

### The finding that made it bite: a full day-trade budget locks out ALL entries

Because every position opened in a session reserves a day-trade slot, three closed day trades
leave `used = 3`, `budget = 0`, and **no new entry is possible for the rest of the rolling
window** — regardless of the intended holding period. There is no "I promise to hold this
overnight" path, and there should not be.

This was not visible until it bound. Tuesday's lifecycle ran **three** round trips (APLD, CLSK,
FCEL) where **one** would have proven the same lifecycle; that choice consumed the entire budget
and cost the following five sessions. One round trip is sufficient proof.

### Why this counts as real rather than theatre

**The paper account holds $100,000, where real PDT rules would not bind at all.** Enforcing it
anyway was the day-one decision in spec §3 — "respect PDT from day one so results transfer to
live". Today is the day that decision cost something: it blocked a verification the build wanted,
on an account the rule does not legally apply to, and it was upheld anyway. A guard that has
never refused anything inconvenient has not been tested; this one now has.

### Consequence — entry-locked until 2026-08-18, for every writer

The lockout is a property of the database, not of any particular process, so it binds Railway and
supervised local runs identically. **Resuming Railway therefore costs nothing on the trade side**
— it cannot open a position either — while the ingest and baseline side continues to mature.

### Reschedule

- **Supervised lifecycle: Tuesday 2026-08-18 at the open**, same sequence — pause Railway,
  confirm no ticks, run locally at HEAD under temporary thresholds, real Claude conviction call,
  order carrying conviction, tracked to a closed trade, restore thresholds and verify against the
  `strategies` row, resume.
- **ONE round trip.** Sufficient proof, and it leaves 2 of 3 budget rather than consuming it all.
- Phase 4 and Phase 5 gates close that day.

**Until then, Phase 6 observation effectively begins.** Ingest runs, baselines mature, and seed
#1's `mention_zscore` reaches a genuine 7-day baseline right around the 18th — so the trustworthy
z-score and the reopened trade budget arrive together.

---

## FINAL SUMMARY — end of the build run, 2026-08-11

Phases 1–3 passed their gates. Phases 4 and 5 are built, audited and fixed, but **both gates are
PARTIAL** for one shared reason: the live conviction lifecycle could not run because the market
closed. Phase 6 is explicitly not part of this run.

### Where each phase stands

| Phase | Gate | What is outstanding |
|---|---|---|
| 1 — skeleton + data in | **PASSED** | `social_snapshots` deferred to deployment |
| 2 — features + strategy #1 | **PASSED** | full lifecycle verified live: 3 round trips |
| 3 — dashboard | **PASSED** | Evolution page was deferred to phase 5, now built |
| 4 — full strategy set + stats | **PARTIAL** | live conviction lifecycle — next open |
| 5 — evolution | **PARTIAL** | inherits the same deferral |

### The single blocking item — rescheduled to 2026-08-18

**A real entry signal → real Claude conviction call → real order carrying that conviction has
never run.** Everything around it is verified — the call works (305 in / 103 out tokens,
conviction 0.73 parsed), the budget guard works, the failure paths work, exits provably make no
call — but the end-to-end path through `strategyRunner` has not executed against a live market.

**Attempted 2026-08-12 and blocked by the PDT guard**, which had been fully consumed by Tuesday's
three round trips. See the PDT precedent above. Rescheduled to **Tuesday 2026-08-18 at the open**,
one round trip, using the temporary-threshold method from spec §8 phase 2 — lower the entry, run
the lifecycle, restore, and verify the restoration against the `strategies` row.

By then social data will no longer be absent: the ApeWisdom bridge is live and `mention_zscore`
became non-NULL on all 20 tickers overnight on 2026-08-12, reaching a genuine 7-day baseline
around the 18th. The temporary-threshold method is still required, because seed #1's real gates
need a real 3-sigma attention spike that may simply not occur on the day.

### Owner decisions still open

1. **Seed #4's status.** Shipped `candidate` against instruction. Without a two-day price
   feature its entry reduces to `exhaustion_score > 0.9` alone — it would short any exhausted
   ticker rather than one that ran up. One word in `seeds.js` reverts it.
2. **The 2-day price feature itself.** Spec §5.4 needs "price up > 30% in 2 days"; spec §4
   defines `price_momentum` as "1h and 1d". Even fixing deferred M9 would not express seed #4.
   Adding a 2-day window is a spec change.
3. **Short interest.** FINRA's Consolidated Short Interest gives **shares short, not a
   percentage** — `currentShortPositionQuantity`, `daysToCoverQuantity`, no percent-of-float
   field. Computing `short_interest_pct` needs `float_shares`, which is NULL everywhere and
   which Alpaca does not expose. The supplied credentials also fail OAuth
   (`400 invalid_client`), though the dataset is readable unauthenticated. Options: redefine
   seed #2's gate as days-to-cover, source float elsewhere, or drop seed #2.
4. **H2 — the active set can only shrink.** Retirement is unconditional, promotion conditional.
   Any week where Claude fails, the baseline replay yields NULL, or no candidate wins, the set
   loses one strategy permanently — there is no un-retire path. Likely on the first real cycle.
5. **M5 — `MIN_QUALIFIERS = 2`** is an implementation-invented rule not in spec §6.
6. **M1 — the replay omits the conviction gate, the PDT cap and execution cost**, so
   `holdout_expectancy` is optimistic. The three real round trips each lost ~0.067% to spread —
   the same order of magnitude as seed #1's measured expectancy.
7. **Seed #3 would fail the new exit-shape check.** Spec §5.3 gives `quiet-accumulation` a stop
   but no time bound. The check applies only to Claude's proposals, not to owner-set seeds, so
   nothing is broken — but the spec defines a strategy that the evolution loop would now reject.

### Deployment checklist

- `NODE_ENV=production` in Railway, or Express 4 leaks stack traces in response bodies.
- `ANTHROPIC_API_KEY` must be set in Railway — `config.js` now exits at boot without it.
- Fill the placeholder in `vercel.json` with the Railway public domain. If the Vercel project's
  Root Directory is `web/`, a repo-root `vercel.json` is ignored entirely.
- Retest Reddit and Stocktwits from Railway egress. Both are 403-blocked from the dev machine;
  if Stocktwits is still Cloudflare-blocked there, drop it and rely on Reddit + market data.
- **H4 is closed but untested against real social data** — the floored z-score and the
  substance gates have never seen a non-NULL mention.

### What was found by auditing rather than by testing

Worth recording, because in every case the code passed its own tests first:

- **Phase 1:** `getBars` ignored `next_page_token`, silently dropping 9 of 20 tickers per tick.
- **Phase 2:** exits settled against unfilled orders at a stale quote, biasing every recorded
  PnL optimistic; the order path was not idempotent; `positionTracker` had no market-hours gate
  and would have fired weekend exits on any Wednesday entry.
- **Phase 3:** timestamps rendered in the viewer's locale and timezone, unreconcilable with
  session rules; the route re-implemented `engine.js`'s operator table and would have 500'd two
  pages on any phase-5 vocabulary mutation.
- **Phase 5:** the holdout replay was survivorship-biased — it never closed positions open at
  the window end and never checked that a proposed exit block could close a loser. A censored
  candidate scored +3.28 against an honest strategy's −1.33 on the same tape, and won **every
  tape in which it cleared the trade minimum** (10/10 and 6/6). After the fix it wins 2/17 and
  0/13 with a negative mean edge.

None of these would have been caught by the unit tests, which are correctly confined to
`engine.js`. The spec's "everything else verified manually against the DB" did the work.

---

## Phase 5 — BUILT, GATE PARTIAL 2026-08-11

Weekly Sunday cron (`0 3 * * 0` ET), runnable as `npm run evolve`. `evolution_log` is empty and
the live run correctly writes nothing:

```
[evolution] 2 active strategies, closed trades in 30d: social-breakout=3, quiet-accumulation=0
[evolution] 0 of 2 strategies clear the 10-closed-trade minimum... every strategy gets another week.
```

Verified by audit as correctly met: no look-ahead in either the price cursor or the feature rows
(`features.ts` is stamped after the `market_snapshots` it consumes); expectancy bit-for-bit
identical to `statsRollup`'s, so "beats the retired strategy" compares like with like; the
vocabulary constraint enforced on the way *back in* via `evaluate()` rather than merely requested
in the prompt; NULL never promoted; each retire/mutate/promote a single guarded CTE so the cycle
cannot retire or promote twice. The weekly call is `claude-sonnet-4-6`, `max_tokens` 2000, and
the prompt was read at string level — aggregates only, no per-trade rows, symbols or timestamps.

**Fix cycle 1** closed one CRITICAL and two others: the survivorship-biased replay (positions
open at the window end are now marked to the last observed price and counted; proposals must
carry a stop, a time bound, and `any` logic or they are rejected before reaching the database);
a promoted short now stays `candidate` rather than going live, so the loop cannot silently undo
the decision that keeps seed #4 out of production; and same-tick exit-and-re-enter is blocked,
which was inflating replayed trade counts by 31% on a churn-heavy test.

`/api/evolution` and the Evolution page complete spec §7's five pages. The page uses zero accent
colours against a budget of 3, renders NULL holdout as an em dash with a screen-reader reason,
and pins timestamps to ET.

---

## Phase 4 — BUILT, GATE PARTIAL 2026-08-11

Seeds 2–4, `statsRollup`, and the Claude conviction path are implemented and verified against
the live database. **The gate does not pass yet**: the live conviction lifecycle — a real entry
signal triggering a real Claude call and a real order carrying its conviction — could not run
because the market closed at 16:00 ET. **DEFERRED to the next open (2026-08-12 09:30 ET) and
must be completed before any phase 5 work**, per the market-hours exception.

### Seeds — `strategies` after sync

| id | name | status | side |
|---|---|---|---|
| 1 | social-breakout | active | long |
| 2 | squeeze-setup | **candidate** | long |
| 3 | quiet-accumulation | active | long |
| 4 | fade-the-peak | **candidate** | short |

Status is written once at insert and never re-asserted by the tick sync — otherwise phase 5
retiring a gen-0 seed would be silently undone within 5 minutes. The DB row is authoritative
once it exists; `seeds.js` supplies only the birth value. `index.js` logs a warning at boot for
every gen-0 seed that is not `active`, per the owner rule in spec §5.2.

### Two seeds cannot be expressed as the spec writes them

This is a genuine spec gap, not an implementation shortfall, and it needs an owner decision.

**Seed #2 (`squeeze-setup`) loses 2 of its 3 entry conditions.**
- `short_interest_pct > 15` — not a feature at all. It is a `tickers` column, NULL for all 20
  rows, absent from `features`, and absent from `engine.js`'s vocabulary. Blocked on FINRA.
- `price_momentum_1d > 3%` — deferred **M9**: `featureEngine` writes only `pct_change_1h` into
  `features.price_momentum` and discards `pct_change_1d`.

What survives is `mention_zscore > 2` alone, which is not seed #2. It is `candidate`, so it
never runs — exactly what the §5.2 rule is for.

**Seed #4 (`fade-the-peak`) loses 1 of its 2 entry conditions.** `price up > 30% in 2 days`
needs a two-day price change. **Spec §4 defines no such feature** — it lists `price_momentum`
as "1h and 1d", so even fixing M9 in full would not express seed #4. Adding a 2-day window is
a spec change, not a bug fix.

**Deviation flagged for ratification:** seed #4 was shipped `candidate`, not `active` as
instructed. What survives of its entry is `exhaustion_score > 0.9` alone — which would short
*any* maximally-exhausted ticker with no requirement that it ran up first. That is a strictly
looser strategy than §5.4, it fires nothing today (exhaustion is NULL), and it would start
shorting the moment social data flows on Railway from a gate never exercised end to end. One
word in `seeds.js` reverts it.

**Seed #3 has no time bound.** Spec §5.3 gives it only a spike exit and a −6% stop — no target,
no max hold. Implemented literally rather than inventing a cap. A winner that never sees a
social spike holds indefinitely. Seed #3's entry *is* fully expressible, so it will be the
first seed to trade once social data flows.

### Short-side support — audited, three real gaps

Arithmetic and order plumbing are complete: `strategyRunner` maps `side: 'short'` → `sell`,
`positionTracker` handles `isShort` in all four places that matter (peak tracking, both PnL
computations, exit side), and the Alpaca account has `shorting_enabled: true`. But:

1. **No borrow check anywhere.** `tickers` has no `shortable` / `easy_to_borrow` column and
   `tickerMetaRefresh` discards those fields from `getAsset`. The watchlist is all small caps,
   which are routinely hard to borrow.
2. **A rejected short sell breaks the tick.** `submitOrder` throws, the runner's loop does not
   catch, so `positionTracker` never runs and every strategy's exits defer 5 minutes. It
   self-heals next tick but costs a cycle.
3. **The short path has never executed against the live broker.**

A second, independent reason not to ship seed #4 active.

### `statsRollup`

Hourly cron (`0 * * * *` ET), separate from the 5-minute pipeline, runnable as `npm run stats`.
One upsert; every strategy gets a row for every window, so 12 rows for 4 strategies. Verified
idempotent (ran twice, still 12 rows).

- **`max_drawdown` is peak-to-trough on the cumulative PnL curve within the window**, matching
  the owner decision and `/api/pnl` — verified equal at `0.2033829598810066`.
- **Expectancy** reproduces the hand-checked `−0.06779431996033554`. `avg_loss_pct` is stored
  signed negative, so §9's `(win% × avgWin) − (loss% × avgLoss)` becomes
  `win% × avg_win_pct + loss% × avg_loss_pct`; the minus cancels against the sign convention.
- **`sharpe_naive` is undefined in the spec.** Chosen definition: mean per-trade `pnl_pct`
  divided by its sample standard deviation over closed trades in the window; risk-free 0, no
  annualisation, one observation per trade. It is a per-trade information ratio, **not** a
  time-series Sharpe — not comparable across strategies with different holding periods and must
  not be annualised downstream. NULL when `trades_n < 2` or variance is zero.
- Insufficient-data discipline holds: `trades_n = 0` → row exists, count 0, everything else
  NULL. `win_rate = 0` with no wins is real data; `avg_win_pct` is NULL because there are none.

### Claude conviction path — all cost rules implemented

`services/claude.js` — `callClaude(prompt, schema, { model, maxTokens })`, no default model.
Reliable JSON comes from the API's structured outputs (`output_config.format.json_schema`), so
prose-wrapped JSON is not a shape the model can emit; this also keeps the user message literally
just the `feature_snapshot` and strategy name. One retry, then `null` with a loud warning.
`callClaude` never throws, so a Claude outage cannot fail a tick.

Call placement in `strategyRunner`: after sizing, before the trade row —
`entry window → PDT → eligibility → open cap → duplicate check → evaluate → price → qty ≥ 1 →
conviction → INSERT signals → skip checks → INSERT trades → submitOrder`. A skipped trade
writes a `signals` row and nothing else, so no orphan `trades` row occupies an open slot. All
phase-2 guards verified unchanged.

**Exits make no Claude call** — verified statically (`positionTracker.js` contains zero
references to Claude or Anthropic) and dynamically (a live `positionTracker` run made 0 requests
to `api.anthropic.com`). Stop, target, max-hold and the exhaustion exit are all pure numeric.

**Daily budget** — migration `005` adds `claude_call_budget(day, calls)`, one row per ET session
date, reserved with a single atomic conditional upsert *before* each call. At the cap the
`WHERE` fails and `rowCount = 0` is the refusal. Restart-safe by construction (a DB row, not
process state) and concurrency-safe across two backend instances, which BUILD_LOG records as
having actually happened.

**Two different NULLs, two different outcomes** — the distinction that matters:
- **budget exceeded** → conviction NULL, **trade skipped**. No judgement exists and the cap must
  actually cap spending.
- **parse failure or outage** → conviction NULL, **trade proceeds ungated**. The rule gates only
  when a conviction exists; an outage must not become a silent trading halt.
- **conviction present and < 0.4** → signal logged, trade skipped — the counterfactual dataset.

Real call verified end to end: 305 in / 103 out tokens, conviction `0.73` parsed cleanly.
About $0.0009 per call, so the 50-call cap is roughly **$0.045/day** worst case. Parse-failure
retry, outage, budget-exceeded and restart-safety were each demonstrated deliberately.

### Action required before the next deploy

`config.js` now requires `ANTHROPIC_API_KEY` at boot. **Confirm it is set in Railway's
variables or the app will `process.exit(1)` on start.**

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
