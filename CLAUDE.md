# Claude Code Configuration

This file provides context for Claude when working on this codebase.

## Project Overview

Multi-sport betting prediction system (NFL, NBA, NHL) built with Next.js, deployed on Vercel. Uses Elo ratings, team stats, weather data, and injury reports to generate betting predictions.

**Live Site:** https://www.predictionmatrix.com

## Architecture Reference

See `ARCHITECTURE.md` for complete system documentation including:
- Data flow and storage architecture
- Prediction pipeline and model parameters
- Weather and injury systems
- API endpoints and caching strategies

## Key Files

### Primary Cron Job
`src/app/api/cron/blob-sync-simple/route.ts`
- Runs every 4 hours via Vercel Cron
- Fetches data from ESPN (teams, games, odds), OpenWeather, NFL.com (injuries)
- Generates predictions and updates Vercel Blob storage
- **Vegas Line Locking**: Odds lock 1 hour before game time

### Frontend
`src/app/page.tsx`
- Main dashboard with live scoreboard, best bets, and game cards
- Fetches data from Vercel Blob storage
- Shows locked Vegas lines with timestamp indicator

### Services
- `src/services/injuries.ts` - NFL.com injury scraping (ESPN was corrupted)
- `src/services/weather.ts` - OpenWeather API with stadium coordinates
- `src/services/elo.ts` - Elo rating calculations
- `src/services/espn.ts` - ESPN API for teams, games, scores, odds

### Admin Endpoints
- `/api/admin/backfill-weather` - Historical weather via Open-Meteo
- `/api/admin/optimize-weather` - Find optimal weather multiplier
- `/api/admin/recalculate-backtest` - Recalculate with weather adjustments
- `/api/admin/recalculate-with-cap` - Recalculate backtest with Elo cap
- `/api/admin/optimize-params` - Grid search for model parameters

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

**Vercel Blob** (Primary)
- File: `prediction-matrix-data.json`
- Contains: predictions, teams, backtest, weather cache, injury cache, historical odds

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
