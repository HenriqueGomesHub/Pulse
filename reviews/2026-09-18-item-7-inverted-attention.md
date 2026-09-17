# ITEM 7 — INVERTED ATTENTION — REPLAY ONLY

Written 2026-09-18 on owner ruling of 2026-09-17, item 7. **Replay only. Nothing was deployed, no
seed was changed, no borrow path was built, and no order of any kind was placed.** Two experiments
were asked for: (a) a long-side filter that avoids elevated attention, (b) an attention-spike short
entry.

Data read from the Railway database (`railway`, PostgreSQL 18.6) at 2026-09-17 21:25–21:40 UTC.
Source read at commit `bd97642` **plus the uncommitted working tree of 2026-09-18** — the month-one
rulings are implemented but not yet committed, so `MAX_PRICE = 100` and the 0.15% slippage constant
are working-tree values, not values any deployed code has ever run under.

Tape: 2026-08-11 16:24 UTC → 2026-09-17 21:25 UTC, 10,647 distinct feature-tick timestamps over the
19 priced watchlist symbols (BITF excluded — it has never produced a `market_snapshots` row).

---

## 0. Correction to the premise, first

Item 7's motivation was §6 of the month-one review: *"Elevated attention on this tape has been a
bearish marker"*, resting on 1-of-2 breadth events returning −3.35% over five days against a
watchlist baseline of −2.44%.

**That comparison does not survive matching the windows, and the finding largely dissolves when it
is.** The −2.44% baseline was the average 5-day return over *all* symbol-days. The −3.35% was the
average over *breadth* symbol-days. Those are different sets of days, on a tape where the market
moved a lot day to day. Measuring each breadth event against the equal-weight basket **over that
event's own window**:

| breadth ≥ 1 events | n | symbol return | basket, same windows | **excess** | t |
|---|---:|---:|---:|---:|---:|
| +24 h | 51 | −0.78% | −0.46% | **−0.32%** | −0.78 |
| +72 h | 38 | −2.70% | −1.95% | **−0.75%** | −1.35 |
| +120 h | 33 | −4.52% | −4.29% | **−0.22%** | −0.39 |

The 5-day gap the review read as −0.9 pp of edge is **−0.22 pp, t = −0.39**. Elevated-attention days
were not worse *names*; they were days on which **the whole watchlist fell**. The review compared a
number to a baseline drawn from different days, and the difference it found is almost entirely that
mismatch.

This is the same error item 1 was created to prevent, appearing one level down — and it is the
reason item 7's answer comes out the way it does.

---

## 1. Method, and how it was calibrated

**The replay harness** mirrors `evolution.js`'s `replay()`: identical session windows (entries
09:45–15:45 ET, exits 09:30–16:00 ET, weekdays), identical 24-hour price-staleness rule, max 5
concurrent, one position per symbol, no re-entry on the tick a position closed, and positions still
open at the window end marked to the last observed price and counted rather than dropped. Entry
blocks are evaluated by importing `evaluate()` from `engine.js`, so the strategy semantics are the
production ones and not a re-implementation.

It adds two things `evolution.js`'s replay does not have, and both matter here:

- **0.15% per side** applied adversely to both legs, the constant ruled on 2026-09-17. `evolution`'s
  internal replay applies none, so **none of the numbers below are comparable to
  `evolution_log.holdout_expectancy` values.**
- **Excess over the equal-weight basket**, by the same definition `trade_excess` uses for live
  trades: equal-weight mean over every watchlist member carrying a price within 24 hours of each
  side of that trade's own window. For a short the benchmark is shorting the same basket, so its
  sign flips.

**Calibration against the live book.** Replaying seed 3's actual parameters over the same tape:

| | n | expectancy | basket | excess | beat basket |
|---|---:|---:|---:|---:|---:|
| seed 3, replayed | 31 | −2.51% | −1.44% | −1.07% | 11 of 31 |
| seed 3, live book | 22 | −3.09% | −1.39% | −1.70% | 7 of 22 |

Same sign and same order of magnitude on all three, with the basket nearly exact (−1.44 vs −1.39).
The replay takes 9 more trades because it has no PDT budget and no conviction call; those are the
live constraints it cannot model. **It is trustworthy as a relative comparison engine between
variants on one tape, and it is not a predictor of live results.** Every conclusion below is drawn
from differences between rows of the same table, never from a level.

**A second, independent validation.** In the event study of §4, the row `every symbol-day` returns
excess **0.00% at every horizon** — which it must, since the average symbol *is* the basket, and any
other answer would have meant the harness was broken. Its absolute 5-day return of **−2.48% on
n = 323** reproduces the month-one review's independently derived −2.44% on n = 323.

---

## 2. Experiment (a) — long entries that avoid elevated attention

"Elevated" is defined from the tape rather than guessed. `mention_zscore` over the 210,064 ticks
carrying one: p50 −0.341, p75 +0.083, **p90 +0.958**, p95 +1.931, p99 +3.704.

Seed 3's existing `mention_zscore < 1` leg therefore already sits at **roughly the 90th percentile**
— it is already an attention-avoidance filter, and has been since day one. The experiment is
whether avoiding *harder* helps. `a5` is the control that asks the prior question nobody had asked:
whether the leg does anything at all.

| variant | n | wins | expectancy | basket | **excess** | t | beat |
|---|---:|---:|---:|---:|---:|---:|---:|
| `a0` seed 3 as it stands (mz < 1, ≈p90) | 31 | 8 | −2.51% | −1.44% | **−1.07%** | −0.75 | 11 |
| `a5` **control: quiet leg removed** | 43 | 13 | −1.59% | −0.88% | **−0.71%** | −0.71 | 15 |
| `a1` mz < 0 (≈p58) | 38 | 7 | −3.63% | −1.77% | **−1.86%** | −2.13 | 11 |
| `a2` mz < −0.341 (p50) | 29 | 7 | −1.28% | −1.85% | **+0.57%** | +0.40 | 13 |
| `a3` seed 3 + `attention_breadth = 0` | 31 | 8 | −2.51% | −1.44% | **−1.07%** | −0.75 | 11 |
| `a4` seed 3 + wiki z < 1 (NULL fails) | 33 | 6 | −3.34% | −1.48% | **−1.86%** | −1.59 | 8 |
| `a4b` seed 3 + wiki z < 1 (NULL passes) | 30 | 8 | −2.50% | −1.62% | **−0.88%** | −0.60 | 11 |

**The hypothesis does not survive, and three rows say so independently.**

**Removing the attention filter entirely (`a5`) beats keeping it (`a0`)** — excess −0.71% against
−1.07%, on a larger sample. The "quiet" leg is not earning its place. The month-one review noted
that the leg is met on 89.8% of ticks and called seed 3 "a volume-plus-momentum strategy with a
formality attached"; this is that formality measured, and it costs about 0.36 pp per trade.

**Filtering harder makes it worse, not better.** `a1` at −1.86% is the worst row in the table and
carries the largest |t| in the experiment. If the inversion hypothesis were right, `a1` should have
been the best row.

**`a3` is identical to `a0` in every column** — 31 trades, same expectancy to the decimal. The
breadth filter never binds: seed 3's entries never once landed on a tick where any attention
instrument was elevated. It was already, in effect, a breadth-0 strategy.

**`a2` is the one positive row, and it should not be believed.** Ordering the thresholds
1 → 0 → −0.341 gives excess −1.07% → −1.86% → **+0.57%**. That is not monotone in either direction.
A real effect strengthens or weakens with the threshold; a surface that jumps sign between adjacent
cuts on n ≈ 30 is noise being read as structure. `a2` is also the smallest sample in the table.

**`a4` versus `a4b` is a NULL-handling artefact, not a result.** The 1.0 pp gap between them is
almost entirely the 7 watchlist symbols with no mapped Wikipedia article: under the engine's rule
that a NULL never satisfies a condition, `a4` silently drops them from the universe. This is worth
recording separately from item 7 — **any strategy gating on `wiki_views_zscore` is also, invisibly,
gating on "has a Wikipedia article we mapped"**, which is a curation decision, not a market fact.

---

## 3. Experiment (b) — attention-spike short entry

Entry on `mention_zscore` above a threshold, exit on +10% target / −8% stop / a time bound. Long
controls run the identical geometry on the other side, which is what makes the short numbers
readable.

| variant | n | wins | expectancy | basket | **excess** | t | hold |
|---|---:|---:|---:|---:|---:|---:|---:|
| `b0` **SHORT** mz > 3, 48 h | 24 | 14 | **+0.26%** | −1.07% | **−0.81%** | −0.74 | 54.8 h |
| `b1` **SHORT** mz > 3, 24 h | 24 | 13 | **+0.04%** | −0.55% | **−0.51%** | −0.46 | 33.0 h |
| `b2` **SHORT** mz > 3, 72 h | 23 | 14 | **+1.37%** | −1.77% | **−0.40%** | −0.33 | 77.2 h |
| `b3` **SHORT** mz > 2, 48 h | 40 | 24 | **+0.07%** | −1.01% | **−0.94%** | −1.24 | 49.4 h |
| `b4` LONG mz > 3, 48 h (control) | 25 | 10 | −1.48% | −1.30% | **−0.18%** | −0.16 | 44.5 h |
| `b5` LONG mz > 2, 48 h (control) | 42 | 15 | −0.96% | −0.93% | **−0.03%** | −0.05 | 48.7 h |

**Every short variant makes money. Every short variant loses to its benchmark. Both statements are
true and the second is the one that matters.**

`b2` is the trap in its clearest form: **+1.37% expectancy, 14 wins in 23** — on any pre-item-1
dashboard that is the first profitable strategy the system has ever produced, and it is wrong. Over
those same 23 windows the basket fell 1.77%, so simply shorting the whole watchlist would have
returned **+1.77%**. The attention-spike short captured +1.37% of an available +1.77% and **gave up
0.40 pp for the privilege of picking**. It is short beta in a falling market wearing a signal's
clothes.

The long controls close the argument. `b4` and `b5` sit at excess **−0.18% and −0.03%** — a long
entry triggered purely on an attention spike, with no volume or momentum leg at all, is
**indistinguishable from the basket**. If elevated attention carried directional information, the
long and short sides could not both be flat against their benchmarks. They are.

**This experiment carries costs it does not model, and they all point the same way.** No borrow
availability check, no locate fee, no borrow rate, no hard-to-borrow screening — and on a watchlist
of small-cap movers these are not rounding errors. The 0.15%/side slippage is applied, but it was
measured on *long* fills in a paper account. A real version of `b2` would earn less than +1.37%
against a benchmark that would still have been +1.77%.

---

## 4. The signal itself, independent of any strategy

Experiments (a) and (b) each wrap the hypothesis in entry rules, exit geometry and slippage, any of
which could mask a real effect. This section removes all of them: for each attention event, the
symbol's forward return against the basket over the identical window. One event per symbol per
session day, since a spike persisting across 40 consecutive ticks is one piece of information. No
slippage, no stops, no bounds.

| event set | horizon | n | return | basket | **excess** | t |
|---|---:|---:|---:|---:|---:|---:|
| `mention_zscore > 3` | 24 h | 24 | −1.02% | −0.58% | **−0.44%** | −0.51 |
| | 72 h | 16 | −1.18% | −1.60% | **+0.42%** | +0.29 |
| | 120 h | 17 | −3.52% | −4.42% | **+0.89%** | +0.55 |
| `mention_zscore > 2` | 24 h | 48 | +0.02% | −0.30% | **+0.32%** | +0.56 |
| | 72 h | 37 | −1.51% | −1.11% | **−0.40%** | −0.54 |
| | 120 h | 32 | −3.98% | −4.41% | **+0.44%** | +0.51 |
| `mention_zscore` 1–2 | 24 h | 79 | −0.81% | −0.31% | **−0.50%** | **−1.97** |
| | 72 h | 55 | −1.39% | −1.14% | **−0.25%** | −0.39 |
| | 120 h | 56 | −2.77% | −3.39% | **+0.62%** | +0.87 |
| `attention_breadth ≥ 1` | 24 h | 51 | −0.78% | −0.46% | **−0.32%** | −0.78 |
| | 72 h | 38 | −2.70% | −1.95% | **−0.75%** | −1.35 |
| | 120 h | 33 | −4.52% | −4.29% | **−0.22%** | −0.39 |
| **every symbol-day** (validation) | 24 h | 494 | −0.12% | −0.12% | **0.00%** | 0.00 |
| | 72 h | 342 | −0.30% | −0.30% | **0.00%** | 0.00 |
| | 120 h | 323 | −2.48% | −2.48% | **0.00%** | 0.00 |

**The strongest attention signal in the system has no basket-relative content.** `mention_zscore >
3` — the only positive-expectancy exit leg the live book has, the thing that motivated this whole
item — is −0.44%, +0.42%, +0.89% across the three horizons. It changes sign twice. Its largest |t|
is 0.55.

**The one cell that comes close is not the extreme, it is the middle.** `mention_zscore` between 1
and 2 at 24 hours: excess −0.50%, **t = −1.97**, n = 79 — moderate attention, short horizon, and it
has decayed to nothing by 72 h and reversed by 120 h.

It does not survive the two checks it needs to pass:

- **Multiple comparisons.** This report tests 15 event-study cells plus 13 replay variants, 28
  comparisons. At α = 0.05 you expect roughly 1.4 |t| > 1.96 by chance alone. It found exactly 2
  (`a1` at −2.13 and this cell at −1.97). **That is what chance predicts, to the count.** A
  Bonferroni threshold across 28 tests is |t| ≈ 3.0; nothing here is within 1.0 of it.
- **Split-half stability.** Splitting the tape at 2026-08-30: first half excess −0.20% (t = −0.69,
  n = 44), second half −0.88% (t = −2.01, n = 35). The sign holds in both halves, which is mildly
  encouraging, but the magnitude differs 4× and the whole-sample result is carried by the second
  half. That is a lead, not a finding.

---

## 5. Verdict

**Both experiments fail, and they fail in the same way.** The inverted-attention hypothesis was
built on a comparison of un-matched windows. Once every attention measurement is made against the
basket over its own window — the discipline item 1 introduced — the effect that motivated the item
is not there on either side.

- Avoiding elevated attention on the long side does not help. Seed 3's `mention_zscore < 1` leg is
  already a p90 attention filter, **removing it improves excess by 0.36 pp**, and tightening it makes
  things worse.
- Shorting attention spikes produces positive absolute expectancy up to +1.37% and **negative excess
  at every variant tested**. It is short beta, not selection.
- The signal carries no directional information against the basket at 24, 72 or 120 hours.

**Nothing here justifies a deployment, a seed change, or building the borrow path.** That was the
ruling's constraint and it is also, independently, the right answer on the evidence.

**The result that is worth keeping is not about attention.** `a5` and `b4`/`b5` together say that on
this tape, **entry rules built from the current feature vocabulary do not distinguish one watchlist
name from another.** Seed 3's excess is −1.07%; strip its attention leg and it is −0.71%; enter on a
pure attention spike and it is −0.18%; enter on nothing at all and it is 0.00% by construction. The
entry blocks are moving the number in the wrong direction from zero. **This points at the feature
vocabulary and the universe, not at any threshold inside it** — which is where the owner has already
pointed the next mini-phase.

---

## 6. What would change this answer

- **More tape.** Every |t| here is under 2.2 on n between 16 and 79, over 37 days containing one
  market regime in which the equal-weight basket fell 5.12% and 15 of 19 names declined (measured
  first-to-last snapshot per symbol). A rising or mixed tape is the single most informative missing
  input, and it cannot be manufactured — only waited for.
- **An out-of-sample window.** "Elevated" was defined from percentiles of the same tape the
  variants were then tested on. With 37 days there is no room for a holdout that yields enough
  trades to measure. Every number here is in-sample and should be read as an upper bound on the
  effect size.
- **A directional prior on the 1–2 z-score band at 24 hours.** It is the only cell with a consistent
  sign across both halves. If a later month reproduces it at similar magnitude, it becomes worth
  designing a test around — as a pre-registered single hypothesis, not as the survivor of another
  28-cell sweep.
- **A feature that separates names.** The vocabulary currently contains no measure that has
  demonstrated basket-relative selection. Until one exists, exit geometry, thresholds and sides are
  all rearrangements of the same zero.

## 7. Recommended, ranked

1. **Drop seed 3's `mention_zscore < 1` leg** — or rather, propose it to the evolution loop rather
   than hand-editing the seed. It is met on 89.8% of ticks, it costs 0.36 pp of excess per trade,
   and `a3` shows it never binds on a breadth event anyway. **This is a recommendation, not a
   change: nothing in this report was implemented.**
2. **Do not pursue the short side.** Neither the borrow path nor seed 4 is justified by anything
   measured here.
3. **Let the universe mini-phase go next**, as ruled. §5's finding is that the entries do not
   distinguish between the names available to them, which is a statement about the names as much as
   about the entries.
4. **Re-run §4's event study each month** as part of the monthly review. It is 15 cells, it is cheap,
   and it is the cleanest available test of whether any attention measure has started to mean
   something.

---

*Replay only. No code path was deployed, no strategy status changed, no order placed, no borrow
facility touched, and no database row written in producing this report.*
