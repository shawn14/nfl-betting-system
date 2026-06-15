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
| CBB | `cron/cbb-sync/route.ts` | `0 * * * *` (hourly) | `cbb-prediction-data.json` |
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
- `injuries.ts` - NFL.com injury scraping (ESPN data was corrupted)
- `weather.ts` - OpenWeather API with stadium coordinates
- `elo.ts` - Elo rating calculations
- `espn.ts` - ESPN API for teams, games, scores, odds
- `odds.ts` - odds parsing/normalization; `nba-rest-days.ts` - NBA fatigue
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
HOME_FIELD_ADVANTAGE = 4.5;    // Increased from 3.25 to fix away team bias
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
NEXT_PUBLIC_WEATHER_API_KEY # OpenWeather API (only external API key needed)
CRON_SECRET                 # Vercel Cron auth
BLOB_READ_WRITE_TOKEN       # Vercel Blob storage
```

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
4. **NFL.com for injuries** - ESPN API was returning corrupted data
5. **Avoid medium spreads (3.5-6.5)** - historically only 46.7% ATS
6. **Indoor stadiums** - no weather impact applied
7. **Live scoreboard** - polls ESPN every 60 seconds during games
8. **Always persist historical Vegas odds for every sport** - results/backtests compare predictions vs. stored odds and should never run without full historical odds coverage
9. **Do not clear historical odds on reset** - NFL reset must preserve `historicalOdds` (same behavior as NBA) so backfilled odds are not wiped
10. **NBA resets also preserve historical odds** - never clear `oddsLocks` on NBA reset to keep backtests stable while optimizing
