# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-sport betting prediction system (NFL, NBA, NHL, CBB, WNBA) built with Next.js 16 (App Router) + React 19, deployed on Vercel. Uses Elo ratings, team stats, weather data, and injury reports to generate betting predictions.

**Live Site:** https://www.predictionmatrix.com

## Commands

```bash
npm run dev      # Local dev server at http://localhost:3000
npm run build    # Production build (Vercel runs this; run before pushing to catch SSR/type errors)
npm run start    # Serve the production build locally
npm run lint     # ESLint (next/core-web-vitals + TypeScript rules)
npm run line-move-backtest   # Run scripts/line-move-backtest.mjs simulation
npm run injuries-smoke       # Prove the NFL injury feed is live: real ESPN fetch, real parser, 32 teams (Node 22.18+)
vercel --prod    # Deploy to production
```

There is no test suite. Verification = `npm run build` (catches the Firebase/SSR class of errors) plus hitting cron/admin endpoints and checking results pages.

## Multi-Sport Architecture

Each sport is an independent vertical: its own cron sync route, its own Vercel Blob file, and its own page tree under `src/app/<sport>/`. They share `src/services` (ESPN, Elo, odds) but have separate model parameters and separate stored data. Changing one sport's parameters or reset logic does not affect the others.

| Sport | Cron route | Schedule (`vercel.json`) | Blob file |
|-------|-----------|--------------------------|-----------|
| NFL | `cron/blob-sync-simple/route.ts` | `0 */2 * * *` (every 2h) | `prediction-matrix-data.json` |
| NBA | `cron/nba-sync/route.ts` | `*/30 * * * *` (every 30m) | `nba-prediction-data.json` |
| NHL | `cron/nhl-sync/route.ts` | `*/30 * * * *` (every 30m) | `nhl-prediction-data.json` |
| CBB | `cron/cbb-sync/route.ts` | `*/30 * * * *` (every 30m) | `cbb-prediction-data.json` |
| WNBA | `cron/wnba-sync/route.ts` | `*/30 * * * *` (every 30m) | `wnba-prediction-data.json` |

Also: `cron/health` (heartbeat for all sports), and daily odds backfills `admin/backfill-nba-odds` (`0 8`) and `admin/backfill-wnba-odds` (`0 9`). Each blob file contains that sport's predictions, teams, backtest, and historical odds. **Historical odds must never be cleared on reset** for any sport (see Notes 8–10) — backtests compare predictions against stored odds.

Each sport page tree (`src/app/<sport>/`) reads its blob through a same-name proxy route (`src/app/<sport>-prediction-data.json/route.ts`). Sport keys live in `SportKey` (`src/services/firestore-types.ts`). The sport sync endpoints (`nfl`/`nba`/`nhl`/`wnba`) are open (no auth); `cbb-sync` requires `?secret=$CRON_SECRET` only for the destructive `?reset=true` path.

**WNBA** was cloned from the NBA vertical (May 2026). It runs in-season May–Oct and uses lower scoring constants (`LEAGUE_AVG_PPG = 84`, O/U pivot ~165) and conference (not division) grouping. Its model parameters (`HOME_COURT_ADVANTAGE`, Elo constants, conviction avoid-lists) are NBA defaults pending grid-search tuning once historical WNBA odds are backfilled via `admin/backfill-wnba-odds`. ESPN league slug is `basketball/wnba`; The Odds API key is `basketball_wnba` (`fetchWNBAOdds` in `src/services/odds.ts`).

## Architecture Reference

See `ARCHITECTURE.md` for complete system documentation including:
- Data flow and storage architecture
- Prediction pipeline and model parameters
- Weather and injury systems
- API endpoints and caching strategies

## Key Files

### Primary Cron Job (NFL)
`src/app/api/cron/blob-sync-simple/route.ts`
- Runs every 2 hours via Vercel Cron (NBA/NHL sync every 30 min)
- Fetches data from ESPN (teams, games, odds), OpenWeather, NFL.com (injuries)
- Generates predictions and updates Vercel Blob storage
- **Vegas Line Locking**: Odds lock 1 hour before game time

### Frontend
`src/app/page.tsx`
- Main dashboard with live scoreboard, best bets, and game cards
- Fetches data from Vercel Blob storage
- Shows locked Vegas lines with timestamp indicator

### Services (`src/services/`)
- `injuries.ts` - NFL injuries from ESPN's injuries feed; FAILS CLOSED (null → "Unavailable"). Never add a hardcoded fallback: from 2025-12-21 to 2026-09-11 a dead NFL.com scraper fell back to a baked-in 13-player list that shipped as live data
- `espn.ts` - all ESPN calls go through `fetchEspnJson()` (retry + JSON check; ESPN's edge intermittently returns an HTML block page, and 403s spoofed browser User-Agents)
- `weather.ts` - OpenWeather API with stadium coordinates
- `elo.ts` - Elo rating calculations
- `espn.ts` - ESPN API for teams, games, scores, odds
- `odds.ts` - odds parsing/normalization; `nba-rest-days.ts` - NBA/WNBA fatigue (pass `'wnba'` as the league arg from the WNBA sync — it hardcoded the NBA path until 2026-09-11 and every WNBA game read as 3 rest days each side)
- `firestore-{store,admin-store,types}.ts` - user/premium data

### Admin Endpoints
Under `/api/admin/`. Roughly two families — patterns repeat per sport (look for `nba-*`, `nhl-*`, `cbb-*` prefixes):
- **Backfill** (populate historical odds/weather/stats): `backfill-weather`, `backfill-nba-odds`, `backfill-nhl-odds`, `backfill-nhl-season`, `backfill-injuries`, `fetch-historical-odds`, `nba-fetch-advanced-stats`
- **Optimize / backtest** (grid-search params, recalculate): `optimize-params`, `optimize-weather`, `recalculate-backtest`, `recalculate-with-cap`, `nba-optimize-params`, `nba-full-optimize`, `nhl-optimize-thresholds`, `cbb-optimize-params`, `situational`, `simulate`
- `mark-premium` - grant premium access to a user (Firestore)

## Key Model Parameters

### NFL (`blob-sync-simple/route.ts`)
```typescript
WEATHER_MULTIPLIER = 3;        // Optimal from simulation (55.7% win rate)
ELO_TO_POINTS = 0.11;          // 100 Elo = 11 point spread
HOME_FIELD_ADVANTAGE = 3.0;    // Frozen 2026-09-11; enters the spread only
SPREAD_REGRESSION = 0.45;      // Shrink spreads 45%
ELO_HOME_ADVANTAGE = 48;       // Elo bonus for home team
ELO_CAP = 16;                  // Max ±8 pts per team (prevents unrealistic 40-8 scores)
```

### NBA (`nba-sync/route.ts`)
```typescript
HOME_COURT_ADVANTAGE = 4.5;    // Increased from 2.0 to fix away team bias
```

## Current Performance (169 games with Vegas lines)

- **ATS**: 55.1% (92-75-2)
- **ML (15%+ edge)**: 77.9% (53-15)
- **O/U (5+ pt edge)**: 57.4% (39-29)
- **Best situations**: Late season (62.9%), Large spreads (61.7%), Divisional (61.5%)
- **Avoid**: Medium spreads 3.5-6.5 (46.7%)

## Environment Variables

```bash
NEXT_PUBLIC_WEATHER_API_KEY # OpenWeather API
NEXT_PUBLIC_ODDS_API_KEY    # The Odds API (multi-book consensus lines, all 5 sports)
CRON_SECRET                 # Vercel Cron auth
BLOB_READ_WRITE_TOKEN       # Vercel Blob storage
FIREBASE_ADMIN_CREDENTIALS  # Firestore admin (crons, Stripe webhook)
NEXT_PUBLIC_FIREBASE_*      # Client Firebase config (auth)
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET  # Shared StockAlarm Stripe account — see gotchas
```
These live only in Vercel's project env (not in `.env.local` on Shawn's Mac, which holds just the Blob token).
Do not spoof a browser User-Agent on ESPN or NFL.com calls: ESPN's edge answers 403 to those.

## Common Tasks

### Deploy
```bash
vercel --prod
```

### Trigger blob sync
```bash
curl https://www.predictionmatrix.com/api/cron/blob-sync-simple
```

### Force refresh injuries
```bash
curl "https://www.predictionmatrix.com/api/cron/blob-sync-simple?forceInjuries=true"
```

### Backfill historical weather
```bash
curl "https://www.predictionmatrix.com/api/admin/backfill-weather?limit=250"
```

### Run weather optimization
```bash
curl https://www.predictionmatrix.com/api/admin/optimize-weather
```

### Recalculate backtest with weather
```bash
curl https://www.predictionmatrix.com/api/admin/recalculate-backtest
```

## Data Storage

**Vercel Blob** (Primary) — one file per sport (see Multi-Sport Architecture table)
- NFL `prediction-matrix-data.json`, NBA `nba-prediction-data.json`, NHL `nhl-prediction-data.json`, CBB `cbb-prediction-data.json`
- Each contains: predictions, teams, backtest, weather/injury cache (NFL), historical odds

**Key Caching:**
- Vegas odds: Lock 1 hour before game (never update after)
- Weather: 6-hour cache
- Injuries: 6-hour cache for current week

## Critical: Firebase Configuration

**DO NOT modify `src/lib/firebase.ts` without understanding this:**

Firebase must only initialize in the browser, not during SSR/build:
```typescript
if (typeof window !== 'undefined') {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  db = getFirestore(app);
  auth = getAuth(app);
}
```

**Why:** Vercel's build process pre-renders static pages. During build, Firebase env vars aren't available, causing `auth/invalid-api-key` errors.

**Consumers must handle null:** All files using `auth` or `db` must check for null:
- `AuthProvider.tsx`: `if (!auth)` early return
- `AccountMenu.tsx`: `auth && signOut(auth)`
- `NavBar.tsx`: `auth && signInWithPopup(auth, ...)`
- `firestore-store.ts`: `getDb()` helper that throws if null

## Notes for Development

1. **Always use ESPN for all data** - teams, schedules, scores, and odds all come from ESPN's free API (no paid API keys needed)
2. **Vegas lines lock 1 hour before game** - stored `lockedAt` timestamp
3. **Weather multiplier is 3** - optimized from historical simulation
4. **ESPN injuries feed for injuries** (`site.api.espn.com/apis/site/v2/sports/football/nfl/injuries`, 32 teams / ~800 rows). Only the weekly game status Out/Doubtful counts as a key absence (same semantic as the old NFL.com weekly report); IR/PUP/suspension rows are listed but not counted because Elo has already absorbed them and ESPN's row date is the last news update, not the placement date. Rows whose injury type is "Coach's Decision" / "Not Injury Related" / rest / personal are healthy scratches (ESPN lists backup QBs that way every week) and are dropped entirely — they are not injuries. Known limit: with no depth chart, a genuinely injured backup QB still flags hasQBOut. When the feed fails the game summary reads "Unavailable" and the cron logs ⚠️ — never "Healthy"
5. **Avoid medium spreads (3.5-6.5)** - historically only 46.7% ATS
6. **Indoor stadiums** - no weather impact applied
7. **Live scoreboard** - polls ESPN every 60 seconds during games
8. **Always persist historical Vegas odds for every sport** - results/backtests compare predictions vs. stored odds and should never run without full historical odds coverage
9. **Do not clear historical odds on reset** - NFL reset must preserve `historicalOdds` (same behavior as NBA) so backfilled odds are not wiped
10. **NBA resets also preserve historical odds** - never clear `oddsLocks` on NBA reset to keep backtests stable while optimizing

## Access mode (paid vs free)

`src/lib/access.ts` → `FREE_ACCESS_MODE`. **true** (current, since 2026-09-11): every signed-in user is
premium — no paywall banners, no 3-game limit; Stripe checkout and webhook stay wired but unused.
**false**: premium comes from the user's Firestore doc (Stripe subscription or `/api/admin/mark-premium`).
Flip the one line and push `main`. Sign-in (Google) is still required either way.

## No-games behaviour

Sport pages render `NoGamesNotice` (why there are no games, next scheduled game, last result) when the
blob has nothing to pick. They only trigger their sync route from the browser when the blob is missing
or older than 2 hours — fresh-but-empty data means off-season, not a broken cron.

## Model freeze — 2026-09-11 (`src/lib/model-version.ts` = `2026-09-11-freeze`)

Every stored result row now carries `modelVersion`. **Rules and thresholds are frozen**: high-conviction
definitions, the 7-point totals edge, the 2-point NFL spread edge, the NBA/WNBA/CBB conviction ladders, the NHL
1.5-goal rule — all unchanged from before the freeze. Judge the model only on rows with this stamp (the edge
ledger's live view). Do not grid-search or re-tune on stored history; that is how every flattering number before
2026-09-11 was produced. If a rule must change, bump `MODEL_VERSION`, record why here, and start the clock again.

Mechanical fixes shipped with the freeze (not tuning — they correct bugs the ledger exposed):
- Home advantage was ADDED to both predicted scores in NFL/NBA/WNBA/CBB, so it inflated every total (NFL +4.5 pts,
  matching the observed +5.2 bias; NFL picked the over in 94% of games) and cancelled out of the spread entirely.
  Now subtracted from the away score: it moves the spread, not the total. NHL already had this right.
- NFL `HOME_FIELD_ADVANTAGE` 4.5 → 3.0, chosen on a 60/40 chronological split of the 282 stored games (held-out ATS
  62.5% vs 55.4% at 0; home/away pick mix goes from 31/69 to ~50/50).
- NFL conviction count (`sixtyPlusFactors`) drops large-spread (47.4% in the data) and Elo-mismatch (44.7%).
- Preseason is skipped everywhere (ESPN `season.type === 1`). 49 NFL preseason games had moved the 2026 Elo ratings
  by 35 points on average (HOU −88, CIN +87); ratings were repaired to pre-preseason values with the two week-1
  games replayed.

## Props watch (Kalshi NFL prop ladders vs sportsbook lines) — recorder lives here, analysis in kalshi-mm-v14

Two crons record the raw material for the Kalshi prop strategy; nothing here trades.
- `api/cron/kalshi-props-record` (every 5 min): every open market in the 10 NFL prop series + game/spread/total →
  `kalshi-props/snap/<day>/<HHMM>.json.gz` (compact rows, `cols` header inside), `kalshi-props/latest.json.gz`,
  `kalshi-props/index.json` (rebuilt from the Blob listing each run). Public Kalshi API, no key; prices are the
  `*_dollars` / `*_fp` fields (legacy cent fields are null on the public endpoint).
- `api/cron/odds-props-record` (every 15 min): per upcoming NFL event, fetches 15 player-prop markets (11 two-sided
  mains + 4 one-sided alternate ladders that land on Kalshi's N+ rungs) from The Odds API and stores the raw
  response at `odds-props/snap/<day>/<HHMM>-<eventId>.json.gz`; `odds-props/state.json` holds last-fetch per event
  and credits spent today. Cadence: 8h when >24h out, 3h when 6-24h, 30 min when 1.5-6h, every run inside 90 min.
  Budget: 1 credit per market per event (15/fetch); daily cap 8,000, monthly floor 20,000 remaining. Key =
  `NEXT_PUBLIC_ODDS_API_KEY` (trim it — the stored value has whitespace).
- Readers: `~/projects/kalshi-mm-v14/tools/props_watch/` (fair value from de-vigged books, rung matching, fee-adjusted
  edge, convergence report, paper sheet). Frozen paper rule lives there, not here.

## Edge ledger (does the model beat the price?)

`docs/reports/2026-09-11-edge-ledger.html` (+ `.png`, `.json`) is a full-history read of every graded pick from the
Firestore `results` collections, per sport × bet type × all/high-conviction × live/backfilled, with 95% intervals
against the −110 break-even (52.4%). Findings as of 2026-09-11: no bet type shows a demonstrated edge in games
predicted live; NFL high-conviction totals and college totals are the only candidates worth tracking forward; NHL
"ATS" is the ±1.5 puck line (74% of picks are the +1.5 side) and cannot be judged without prices; moneyline "edge"
is model confidence, not a price comparison. Preseason games (49 NFL, 65 NBA, 28 NHL, 5 WNBA) are graded into the
site's records and Elo — the ledger excludes them; the crons should skip ESPN `season.type !== 2`.

## Gotchas verified live (2026-09-11 audit)

- **Deploys**: pushing `main` auto-deploys production through the Vercel GitHub integration (every deployment carries the commit sha). The build gate is a branch push → Vercel preview build; then fast-forward `main`.
- **Weather venue names must match what ESPN sends.** `NFL_STADIUMS` in `weather.ts` is keyed by ESPN's `venue.fullName`; a miss logs `Stadium not found` and the game silently gets no weather (JAX and HOU home games had none all of 2025-26: ESPN says "EverBank Stadium" and "Reliant Stadium"). Before each season, diff every week's scoreboard venues against the map:
  `for w in $(seq 1 18); do curl -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=$w&seasontype=2" | jq -r '.events[].competitions[0].venue.fullName'; done | sort -u`
- **Stripe webhook shares StockAlarm's Stripe account.** `https://www.predictionmatrix.com/api/stripe/webhook` is a registered endpoint on the same account as pro.stockalarm.io, so every StockAlarm checkout/renewal hits it. Events with no `uid` metadata and no matching `stripeCustomerId` are logged at info and ignored — they are not PredictionMatrix customers and not errors.
- **Sport pages (NBA/NHL/CBB/WNBA) call their own sync route from the browser** when the blob has no upcoming games (`syncAll()`), which means every offseason visitor triggers a full cron. Keep each page pointed at its own route (the CBB page called `nba-sync` until 2026-09-11).
- **No local build on Shawn's Mac** (no `node_modules`, disk near full). Local proof that does work: `npm run injuries-smoke` (Node type-strips the .ts directly).
- **Injury cache hygiene.** `injuriesByWeek` is keyed by week number with no season. On load the NFL cron purges (and deletes from Firestore) any entry at or beyond the current week whose `data.source !== 'espn'`; the stale-cache fallback only reuses feed-sourced data. The old hardcoded list that sat under weeks 2-5 and 2025's 16-18 was purged on 2026-09-11 — no fake injury data remains in the cache.
- **Health endpoint**: `nhl-sync` never records `lastBlobWriteAt`, so NHL shows only `lastSyncAt` in `/api/cron/health`.
- **Offseason artifacts, not bugs**: NBA results show 0% until October (season filter rolled to 2027); NHL preseason predictions are identical until Elo diverges; CBB summary `totalGames` reads 0 while win counts are populated.

## Conventions

- TypeScript + React, strict types, 2-space indent, single quotes. Domain-named modules in `src/services`, shared utilities in `src/lib`, shared types in `src/types`.
- Commit messages: short imperative summaries ("Add…", "Fix…"). PRs note any change to cron behavior, prediction logic, or required env vars.
- Secrets live in Vercel env / `.env.local` (never committed). Cron routes: confirm `CRON_SECRET` usage and the `vercel.json` schedule when touching them.
