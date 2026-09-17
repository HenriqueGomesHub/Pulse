# THE MONTHLY REVIEW — standard

Pulse keeps perfect records and nobody reads them. That is the finding that created this file: the
first month produced a flawless audit trail while an evolution loop sat deadlocked, two seeds sat
dormant, and two correctly-firing warnings reached nobody, all of it visible in the database the
whole time. The review is how the records get read. It runs on the 17th of each month, written by a
scheduled cloud agent, committed here as `reviews/YYYY-MM-DD-<slug>.md`.

`2026-09-17-month-one.md` is the worked example. Match it.

---

## The one rule

**Diagnostic only. The review changes nothing.** No code, config, strategy status, migration or
database row is modified in producing it. It reads. If something needs changing, the review says so
under RECOMMENDED CHANGES and stops there — the owner rules, and the rulings are implemented as a
separate, later piece of work.

The corollary matters as much: **an agent that cannot verify something must not produce a verdict.**
If the database is unreachable, title the artifact `REVIEW NOT EXECUTED`, say exactly what was
refused and what was tried, commit that, and fire a push notification. Do not write a review from
the source files alone and do not infer numbers. A hollow review that looks complete is worse than a
missing one. There is precedent: the 2026-08-15 gate routine could not reach its data, titled its
output `GATE VERIFICATION NOT EXECUTED`, changed nothing, and was right to.

## Where the numbers come from

Every figure is read from the Railway PostgreSQL database at `DATABASE_URL`, or from source files at
a named commit. State which, and state the read window as a UTC timestamp range. Where a number is
derived rather than stored, **state the derivation** — the reader must be able to recompute it.

## Sections

Keep these, in this order. A section with nothing to report says so and says why; it never pads.

0. **Correction to the premise** — only if the brief or the prior month's assumption is wrong on the
   data. Lead with it. The first review's premise was "expectancy is ~zero"; it was −3.71%, and
   nothing downstream would have made sense without fixing that first.
1. **TRADE CENSUS** — live book and shadow book, per strategy: closed, wins, win rate, avg win, avg
   loss, expectancy, **excess expectancy over the equal-weight watchlist basket**, sum P&L, max
   drawdown. Excess expectancy is the primary metric and absolute P&L is context (owner ruling,
   2026-09-17): a book that loses less than the tape it is drawn from has an edge and one that loses
   more does not. Shadow figures are reported both as priced and restated at the current slippage
   constant. Trades that are not strategy behaviour — smoke tests, wiring checks — are named as such
   and excluded from the strategy read.
2. **EVOLUTION AUDIT** — every scheduled cycle in the window, what each did, and what it wrote to
   `evolution_log` and `evolution_rejections`. If a cycle did nothing, give the exact mechanism that
   stopped it, quoted from the code. Distinguish "the loop decided not to act" from "the loop never
   reached a decision".
3. **EXIT AUTOPSY** — which exit leg fired, how often, at what mean P&L, and what price did next.
   Test legs that never fired against the tape rather than declaring them unanswerable.
4. **CONVICTION CORRELATION** — the distribution of the score, Pearson and Spearman against
   realized P&L with n stated, and the forward returns of gated-out versus acted-on signals. The
   0.4 gate was dropped on 2026-09-17; the score is still taken and still logged, so this section
   remains the record of whether it has started meaning anything.
5. **GATE STARVATION** — per seed, over every feature tick inside the entry window: how many ticks
   met the full entry block, how many met n−1, and which leg blocked. Separate genuine starvation
   from self-inflicted causes (a filter conflict, a dormant status, a dead leg).
6. **INSTRUMENT CHECK** — per data source: days covered, observations, last row, verdict. Name any
   source that has never delivered. Then the standing `system_warnings` rows and how long each has
   stood. Then the parked items, each with its current status.
7. **TOP 3 HYPOTHESES** — ranked, each with evidence for, **what would confirm it**, and **what
   would falsify it**. A hypothesis with no falsifier is not one.
8. **RECOMMENDED CHANGES — RANKED** — ordered by what must be known before the next thing is worth
   doing, not by size. Say plainly which items are blocked on which other items' results.

## The standard

- **Every rate travels with its sample.** A win rate that moved on four trades must be callable as
  noise by whoever reads it. `n` is never omitted, never implied.
- **Correct the premise before answering it.** If the question is built on a wrong number, the first
  job is the number.
- **Name the caveat with the number, not after it.** 5-minute bars make a measured fill cost an
  upper bound; say so in the same breath as the figure, not in a footnote.
- **Distinguish "no evidence" from "evidence of no".** Zero rows because a gate returned early and
  zero rows because nothing qualified are different facts and are reported differently.
- **n = 2 is an anecdote.** Say so, in those words, rather than reporting a two-trade expectancy as
  a result.
- **Quote the code that caused the behaviour.** A mechanism claim carries the line that implements
  it.
- **No recommendation is implemented.** See the one rule.

## Mechanics

- Read-only database access is sufficient and preferred.
- Commit the artifact to `reviews/` on `main` with a `docs:` commit. Nothing else in the repo is
  touched.
- The review's own commit is the only write the run makes.
