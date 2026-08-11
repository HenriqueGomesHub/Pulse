# BUILD_LOG

Single source of truth for build progress. On resume: read this file, continue from the
first unpassed gate or deferred verification. Never redo a passed phase.

| Phase | Gate | Date |
|---|---|---|
| 1 — skeleton + data in | **BLOCKED** — verification could not run | 2026-08-11 |
| 2 — features + one dumb strategy | not started | — |
| 3 — dashboard | not started | — |
| 4 — full strategy set + stats | not started | — |
| 5 — evolution | not started | — |

---

## Phase 1 — skeleton + data in

**Gate: NOT PASSED. Run halted. Human action required.**

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
| 1 | Use Railway public `DATABASE_URL` | **STILL NOT ON DISK** — `.env` byte-identical, 515 bytes, mtime Aug 10 21:51; host still `postgres.railway.internal` |
| 2 | Keep dual-path Reddit; social verification DEFERRED to deployment | in effect |
| 3 | Keep Stocktwits as written; verification DEFERRED to deployment | in effect |
| 4 | Anthropic credit added | **STILL FAILING** — identical `400 invalid_request_error`, "credit balance is too low" |
| 5 | `quiet-precision.md` in repo root for phase 3 | **STILL NOT ON DISK** — repo root holds only `BUILD_LOG.md`, `pulse-spec.md`, `package.json`, dotfiles |
| 6 | `git remote add origin` + push | **DONE** — `origin` → `github.com/HenriqueGomesHub/Pulse.git`, `main` pushed, 3 commits |

Items 1, 4 and 5 have now failed verification twice, with no change between passes. `.env`
has not been written to since Aug 10 21:51. A filesystem check confirmed only one `Pulse`
directory exists under `OneDrive\Documentos\Coding`, and no copy on Desktop, Downloads or
Documents — so this is not an edit landing in a duplicate checkout. Something is preventing
the edits from reaching disk (unsaved buffer, OneDrive sync, or a different machine).

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
