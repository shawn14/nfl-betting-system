# Claude Code Configuration

This file provides context for Claude when working on this codebase.

## Project Overview

NFL betting prediction system built with Next.js, deployed on Vercel. Uses Elo ratings, team stats, weather data, and injury reports to generate betting predictions.

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
- Fetches data from ESPN, Odds API, OpenWeather, NFL.com
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
- `src/services/espn.ts` - ESPN API for teams, games, scores
- `src/services/odds.ts` - The Odds API for Vegas lines

### Admin Endpoints
- `/api/admin/backfill-weather` - Historical weather via Open-Meteo
- `/api/admin/optimize-weather` - Find optimal weather multiplier
- `/api/admin/recalculate-backtest` - Recalculate with weather adjustments
- `/api/admin/recalculate-with-cap` - Recalculate backtest with Elo cap
- `/api/admin/optimize-params` - Grid search for model parameters

## Key Model Parameters

```typescript
WEATHER_MULTIPLIER = 3;        // Optimal from simulation (55.7% win rate)
ELO_TO_POINTS = 0.11;          // 100 Elo = 11 point spread
HOME_FIELD_ADVANTAGE = 3.25;   // Total home advantage
SPREAD_REGRESSION = 0.45;      // Shrink spreads 45%
ELO_HOME_ADVANTAGE = 48;       // Elo bonus for home team
ELO_CAP = 16;                  // Max ±8 pts per team (prevents unrealistic 40-8 scores)
```

## Current Performance (169 games with Vegas lines)

- **ATS**: 55.1% (92-75-2)
- **ML (15%+ edge)**: 77.9% (53-15)
- **O/U (5+ pt edge)**: 57.4% (39-29)
- **Best situations**: Late season (62.9%), Large spreads (61.7%), Divisional (61.5%)
- **Avoid**: Medium spreads 3.5-6.5 (46.7%)

## Environment Variables

```bash
NEXT_PUBLIC_ODDS_API_KEY    # The Odds API
NEXT_PUBLIC_WEATHER_API_KEY # OpenWeather API
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

## Notes for Development

1. **Vegas lines lock 1 hour before game** - stored `lockedAt` timestamp
2. **Weather multiplier is 3** - optimized from historical simulation
3. **NFL.com for injuries** - ESPN API was returning corrupted data
4. **Avoid medium spreads (3.5-6.5)** - historically only 46.7% ATS
5. **Indoor stadiums** - no weather impact applied
6. **Live scoreboard** - polls ESPN every 60 seconds during games
