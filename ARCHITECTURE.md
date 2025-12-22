# NFL + NBA Betting System Architecture

## Overview
This is a Next.js-based NFL/NBA betting prediction system that uses Elo ratings, team statistics, weather data, and injury reports to generate betting predictions. The system runs on Vercel with Firebase Firestore as the source of truth and Vercel Blob Storage as the fast read cache for the frontend.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          External APIs                               │
├─────────────────────────────────────────────────────────────────────┤
│  ESPN API  │  The Odds API  │  OpenWeather API  │  NFL.com Injuries  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Vercel Cron (Every 2 hours)                         │
│      /api/cron/blob-sync-simple + /api/cron/nba-sync                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
         ┌──────────────────┐            ┌──────────────────┐
         │  Firebase         │            │  Vercel Blob     │
         │  Firestore        │            │  Storage         │
         │  (Source of Truth)│            │  (Read Cache)    │
         └──────────────────┘            └──────────────────┘
                                                   │
                                                   ▼
                             prediction-matrix-data.json (NFL)
                               nba-prediction-data.json (NBA)
                                                   │
                                                   ▼
                                         ┌──────────────────┐
                                         │  Next.js         │
                                         │  Frontend        │
                                         │  (page.tsx)      │
                                         └──────────────────┘
```

---

## 1. Data Flow

### Primary Data Flow (Current System)

**Cron Job → External APIs → In-Memory Processing → Firestore → Blob → Frontend**

1. **Vercel Cron Trigger** (every 2 hours)
   - Endpoints: `/api/cron/blob-sync-simple/route.ts` (NFL), `/api/cron/nba-sync/route.ts` (NBA)
   - Runs with max duration: 300 seconds (5 minutes)

2. **Data Fetching** (Parallel from multiple APIs)
   - ESPN: Team data, current season games (weeks 1-18)
   - The Odds API: Vegas spreads, totals, moneylines
   - OpenWeather: Weather conditions for outdoor stadiums
   - ESPN Injuries: Player injury status by team

3. **In-Memory Processing**
   - Reads Firestore state for processed games, locked odds, caches
   - Processes completed games chronologically
   - Updates Elo ratings game-by-game
   - Generates predictions for upcoming games
   - Runs backtest on all historical games

4. **Firestore Persist**
   - Canonical writes to Firestore collections (teams, games, odds locks, predictions, results)
   - Stores sport state (`sports/{sport}`) with last sync metadata

5. **Blob Upload**
   - Writes JSON snapshot to Vercel Blob Storage
   - Public access: `prediction-matrix-data.json` (NFL), `nba-prediction-data.json` (NBA)
   - Heartbeats: `cron-heartbeat-nfl.json`, `cron-heartbeat-nba.json`

6. **Frontend Consumption**
   - Frontend fetches JSON directly from blob
   - No database queries needed for display
   - Near-instant load times

---

## 2. Storage Architecture

### Firebase Firestore (Primary - Active)

**Documents:**
- `sports/nfl` and `sports/nba` store last sync metadata and blob write info.
- Subcollections (canonical): `teams`, `games`, `oddsLocks`, `predictions`, `results`
- NFL-only caches: `weather`, `injuries`

**Key Features:**
- Durable source of truth for scoring and history
- Supports incremental updates and backtests

### Vercel Blob Storage (Read Cache)

**Files:** `prediction-matrix-data.json` (NFL), `nba-prediction-data.json` (NBA)

**Contains:**
```typescript
{
  generated: string;              // ISO timestamp of generation
  teams: TeamData[];              // All 32 NFL teams with current Elo
  processedGameIds: string[];     // IDs of games used in Elo calculation
  historicalOdds: Record<string, HistoricalOdds>;  // Vegas lines (persists across resets)
  weatherCache: Record<string, CachedWeather>;     // Weather by gameId (6h cache)
  injuriesByWeek: Record<string, CachedInjuries>;  // Past weeks injuries (permanent)
  currentWeekInjuriesCache?: CachedInjuries;       // Current week injuries (6h refresh)
  games: GameWithPrediction[];    // Upcoming games with predictions
  recentGames: Game[];            // Last 10 completed games
  backtest: BacktestResults;      // Full historical performance
}
```

**Key Features:**
- **Public access**: No authentication needed
- **Fast reads**: CDN-backed for the frontend
- **Derived data**: Firestore remains canonical

### Caching Strategy

**Historical Odds Cache** (Locked 1 hour before game)
- Vegas spreads/totals captured when games are upcoming
- Stored in `historicalOdds` map by gameId
- Tracks opening vs closing lines for line-movement analysis
- **Locking mechanism**: Odds lock 1 hour before game time
  - Before lock: Updates on each sync to capture latest lines
  - After lock: `lockedAt` timestamp set, odds never change again
- Persists across resets for accurate backtesting
- Frontend shows lock status with timestamp

**Weather Cache** (6-hour refresh)
- Stored in `weatherCache` by gameId
- Refreshed every 6 hours for upcoming games
- Becomes permanent once game is final
- Indoor stadiums return mock data (72°F, 0 wind)

**Injury Cache** (Dual strategy)
- **Past weeks**: Stored permanently in `injuriesByWeek`
- **Current week**: Cached for 6 hours in `currentWeekInjuriesCache`
- When week changes, current week cache → permanent storage
- Reduces API calls while keeping current data fresh

---

## 3. Weather System

### Data Source
**API:** OpenWeather API (https://api.openweathermap.org/data/2.5)

### Implementation

**Stadium Database** (`src/services/weather.ts`)
```typescript
NFL_STADIUMS: Record<string, { lat: number; lon: number; indoor: boolean }>
```
- 27 outdoor stadiums with GPS coordinates
- 9 indoor/dome stadiums (marked as indoor: true)

**Fetching Strategy:**
1. **Upcoming games** (< 120 hours away): Use forecast API
   - Fetches 5-day forecast
   - Finds closest forecast to game time
2. **Past/distant games**: Use current weather as approximation
3. **Indoor stadiums**: Return mock indoor conditions

**Weather Data Structure:**
```typescript
{
  temperature: number;    // Fahrenheit
  windSpeed: number;      // mph
  windDirection: string;  // N, NE, E, etc.
  precipitation: number;  // Percentage (0-100)
  humidity: number;       // Percentage
  conditions: string;     // "Clear", "Rain", "Indoor", etc.
}
```

### Weather Impact Calculation

**Impact Formula** (affects scoring predictions):
```typescript
let impact = 0;
if (windSpeed > 15) impact += 0.5;  // Affects passing game
if (windSpeed > 25) impact += 1.0;  // Severely affects passing
if (temp < 32) impact += 0.5;       // Freezing
if (temp < 20) impact += 0.5;       // Extreme cold
if (temp < 10) impact += 0.5;       // Severe cold
if (precipitation > 0) impact += 0.5;   // Any precipitation
if (precipitation > 0.1) impact += 0.5; // Heavy precipitation
```

**Applied to Predictions** (Optimized via simulation):
```typescript
// Multiplier 3 is optimal based on 227-game simulation
// Tested multipliers 0-8, multiplier 3 achieved best results:
// - Win Rate: 55.7%
// - ROI: 6.3%
predictedTotal = baseTotal - (weatherImpact * 3);
```

**Weather Performance Analysis** (from historical backtest):
| Condition | Games | Win Rate | Insight |
|-----------|-------|----------|---------|
| Calm wind (<10 mph) | 79 | 62.3% | Model performs best |
| Mild temp (40-80°F) | 74 | 60.3% | Sweet spot |
| Cold (<40°F) | 11 | 33.3% | Model struggles |
| Windy (10-20 mph) | 18 | 35.3% | Model struggles |

### Caching
- **Cache duration**: 6 hours
- **Storage**: `weatherCache` map in blob
- **Key**: gameId
- **Format**: `{ data: WeatherData, fetchedAt: string, gameId: string }`

---

## 4. Prediction Pipeline

### Overview
The system uses a **calibrated Elo + Team Stats** model, optimized through 927 parameter combinations tested on 227 games.

### Model Parameters (Optimized)

```typescript
LEAGUE_AVG_PPG = 22;           // NFL average points per game
ELO_TO_POINTS = 0.11;          // 100 Elo points = 11 point spread (was 0.0593)
HOME_FIELD_ADVANTAGE = 3.25;   // Total home advantage in points (was 2.28)
ELO_HOME_ADVANTAGE = 48;       // Elo bonus for home team
SPREAD_REGRESSION = 0.45;      // Shrink spreads 45% toward zero (was 0.55)
ELO_CAP = 16;                  // Max ±8 pts per team (prevents 40-8 scores)
```

### Step-by-Step Prediction Process

**1. Team Stats Regression** (30% toward league average)
```typescript
regress = (stat) => stat * 0.7 + LEAGUE_AVG_PPG * 0.3;
```

**2. Base Score Calculation**
```typescript
homeScore = (regressedHomePPG + regressedAwayPPGAllowed) / 2;
awayScore = (regressedAwayPPG + regressedHomePPGAllowed) / 2;
```

**3. Elo Adjustment** (with cap to prevent extreme scores)
```typescript
eloDiff = homeElo - awayElo;
eloAdjustment = (eloDiff * ELO_TO_POINTS) / 2;
// Cap at ±8 points per team to prevent unrealistic 40-8 scores
eloAdjustment = Math.max(-8, Math.min(8, eloAdjustment));
homeScore += eloAdjustment;
awayScore -= eloAdjustment;
```

**4. Home Field Advantage**
```typescript
homeScore += HOME_FIELD_ADVANTAGE / 2;  // +1.625 points
awayScore -= HOME_FIELD_ADVANTAGE / 2;  // -1.625 points
```

**5. Weather Impact**
```typescript
weatherImpact = getWeatherImpact(weather);
perTeamDelta = (weatherImpact * 3) / 2;
homeScore -= perTeamDelta;
awayScore -= perTeamDelta;
```

**6. QB Injury Adjustment**
```typescript
// -3 points if starting QB is OUT (industry standard)
if (homeQBOut) homeScore -= 3;
if (awayQBOut) awayScore -= 3;
```

**7. Spread Calculation** (with regression)
```typescript
rawSpread = awayScore - homeScore;
predictedSpread = rawSpread * (1 - SPREAD_REGRESSION);
// Shrinks spreads by 45% to reduce overconfidence
```

**8. Win Probability** (from Elo)
```typescript
adjustedHomeElo = homeElo + ELO_HOME_ADVANTAGE;
homeWinProb = 1 / (1 + 10^((awayElo - adjustedHomeElo) / 400));
```

### Elo Update Formula

**After each completed game:**
```typescript
// 1. Calculate expected scores
homeExpected = 1 / (1 + 10^((awayElo - (homeElo + 48)) / 400));
awayExpected = 1 - homeExpected;

// 2. Actual result (1 = win, 0.5 = tie, 0 = loss)
homeActual = homeScore > awayScore ? 1 : (homeScore === awayScore ? 0.5 : 0);

// 3. Margin multiplier (prevents blowout overreaction)
marginMultiplier = log(abs(margin) + 1) * 0.7 + 0.8;

// 4. Update Elo
kFactor = 20;
adjustedK = kFactor * marginMultiplier;
homeNewElo = homeElo + adjustedK * (homeActual - homeExpected);
```

### Confidence Indicators

**ATS (Against The Spread) Confidence:**
- **High**: 1+ of these 60%+ factors present AND not medium spread (3.5-6.5)
- **Medium**: No special factors
- **Low**: Medium spread (3.5-6.5) - historically 46.7% ATS - AVOID

**60%+ ATS Situations** (from 169 games backtested):
- Late Season Games (Week 13+): 62.9%
- Large Spreads (≥7): 61.7%
- Divisional Games: 61.5%
- Elo Mismatch (>100): 61.4%
- Small Spreads (≤3): 60.0%

**O/U (Over/Under) Confidence:**
- **High**: Edge ≥ 4 points from Vegas total
- **Medium**: Edge 2-4 points
- **Low**: Edge < 2 points

### Best Bets

**ATS Best Bet Criteria:**
- `sixtyPlusFactors >= 1` (at least one 60%+ situation)
- `!isMediumSpread` (avoid 3.5-6.5 spreads)

**O/U Best Bet Criteria:**
- `totalEdge >= 4` (predicted total differs from Vegas by 4+ points)

---

## 5. Injury System

### Data Source
**Source:** NFL.com Injuries (https://www.nfl.com/injuries/)
- ESPN API was returning corrupted/outdated data
- NFL.com provides accurate, up-to-date injury reports
- Falls back to hardcoded current week injuries if scraping fails

### Key Positions Tracked
```typescript
KEY_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'LT', 'RT', 'CB', 'EDGE', 'DE', 'DT'];
STAR_POSITIONS = ['QB', 'RB', 'WR'];  // Highlighted positions
```

### Injury Impact on Predictions

**QB OUT Adjustment: -3 points**
```typescript
const QB_OUT_ADJUSTMENT = 3;
predHome = predHomeRaw - homeQBAdj;  // -3 if QB out
predAway = predAwayRaw - awayQBAdj;  // -3 if QB out
```

This is an industry-standard value that Vegas uses. We apply it because:
- We don't have historical injury data to backtest our own value
- Vegas already factors QB injuries into their lines
- Without this adjustment, we'd show false edges against Vegas when a QB is out

**Note:** Only QB injuries are factored into predictions. Other injuries (RB, WR, etc.) are displayed for user reference but don't affect the model.

### Injury Impact Levels (Display Only)

**Major** - QB Out for either team
- Prediction adjusted by -3 points for that team
- Highlighted with red badge "QB OUT"

**Significant** - 3+ key players out for either team
- Multiple position impacts
- Orange background
- Not factored into predictions

**Minor** - 1-2 key players out
- Some impact on game
- Yellow background
- Not factored into predictions

**None** - No key injuries

### Data Structure

```typescript
interface PlayerInjury {
  name: string;
  position: string;
  status: string;         // "Out", "Doubtful", "Questionable", "Probable", "Injured Reserve"
  injury: string;         // "Knee", "Ankle", etc.
  isKeyPlayer: boolean;
  isStarPosition: boolean;
}

interface TeamInjuries {
  teamAbbrev: string;
  teamName: string;
  injuries: PlayerInjury[];
  keyPlayersOut: number;
  starPlayersOut: number;
}
```

### Caching Strategy

**Past Weeks** (Permanent):
- Stored in `injuriesByWeek` map
- Key: week number (e.g., "14")
- Never refetched once week is complete

**Current Week** (6-hour refresh):
- Stored in `currentWeekInjuriesCache`
- Refreshed every 6 hours
- When week changes, moved to permanent storage

### Display

**Frontend Integration:**
- Shows injury summary for each matchup
- Highlights QB injuries in red
- Displays GTD (Game Time Decision) counts
- Example: "QB Out | 2 GTD" or "WR, RB Out | 1 GTD"

---

## 6. Backtesting System

### Process

**Historical Game Processing:**
1. Fetch all completed games from current season
2. Sort chronologically
3. For each game:
   - Predict using Elo **before** game
   - Compare to actual result
   - Track win/loss/push for spread, ML, O/U
   - Update Elo ratings **after** game

**Vegas Odds Integration:**
- Uses historical odds captured when games were upcoming
- Compares predictions to Vegas lines
- Calculates ATS (Against The Spread) results
- Tracks performance vs Vegas O/U

### Results Tracked

```typescript
interface BacktestResult {
  gameId: string;
  week: number;
  homeTeam: string;
  awayTeam: string;

  // Pre-game data
  homeElo: number;
  awayElo: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedSpread: number;
  predictedTotal: number;
  homeWinProb: number;

  // Actual results
  actualHomeScore: number;
  actualAwayScore: number;
  actualSpread: number;
  actualTotal: number;
  homeWon: boolean;

  // Performance vs model
  spreadPick: 'home' | 'away';
  spreadResult: 'win' | 'loss' | 'push';
  mlPick: 'home' | 'away';
  mlResult: 'win' | 'loss';
  ouPick: 'over' | 'under';
  ouResult: 'win' | 'loss' | 'push';

  // Performance vs Vegas
  vegasSpread?: number;
  vegasTotal?: number;
  atsResult?: 'win' | 'loss' | 'push';
  ouVegasResult?: 'win' | 'loss' | 'push';

  // Situation flags (for analysis)
  isDivisional: boolean;
  isLateSeasonGame: boolean;
  isLargeSpread: boolean;
  isSmallSpread: boolean;
  isMediumSpread: boolean;
  isEloMismatch: boolean;
}
```

### Summary Statistics

```typescript
{
  totalGames: number;
  spread: { wins: number; losses: number; pushes: number; winPct: number };
  moneyline: { wins: number; losses: number; winPct: number };
  overUnder: { wins: number; losses: number; pushes: number; winPct: number };
}
```

**Current Performance** (169 games with Vegas lines):
- ATS: 55.1% (92-75-2)
- ML (15%+ edge): 77.9% (53-15)
- O/U (5+ pt edge): 57.4% (39-29)

---

## 7. Key API Endpoints

### Production Endpoints

#### `/api/cron/blob-sync-simple` (Primary)
- **Method**: GET
- **Trigger**: Vercel Cron (every 2 hours)
- **Duration**: Up to 300 seconds
- **Function**:
  1. Fetch teams from ESPN
  2. Fetch schedule (current week or all weeks on first run)
  3. Fetch Vegas odds
  4. Fetch weather for upcoming games
  5. Fetch injuries for current week
  6. Process completed games for Elo updates
  7. Generate predictions for upcoming games
  8. Run full backtest on all games
  9. Persist canonical data to Firestore
  10. Upload JSON to Vercel Blob
- **Output**: `prediction-matrix-data.json` in blob storage

#### `/api/cron/nba-sync` (Primary - NBA)
- **Method**: GET
- **Trigger**: Vercel Cron (every 2 hours, offset by 30 minutes)
- **Duration**: Up to 300 seconds
- **Output**: `nba-prediction-data.json` in blob storage

#### `/prediction-data.json` (Frontend endpoint)
- **Method**: GET (via fetch)
- **Source**: Vercel Blob Storage
- **Content**: Complete prediction data
- **Caching**: `cache: 'no-cache'` to ensure fresh data

### Legacy/Alternative Endpoints

#### `/api/cron/blob-sync` (Deprecated)
- Legacy implementation; kept for reference

### Admin Endpoints (Development/Testing)

#### `/api/admin/optimize-params`
- Parameter optimization via grid search
- Tests combinations of ELO_TO_POINTS, HOME_FIELD_ADVANTAGE, SPREAD_REGRESSION

#### `/api/admin/backfill-weather`
- Fetch historical weather for past games using Open-Meteo Archive API
- Populates `historicalWeather` in blob for all backtest games
- Calculates weather impact for each game
- Useful for backtesting improvements

#### `/api/admin/optimize-weather`
- Tests weather multipliers 0-8 on historical data
- Calculates win rate and ROI for each multiplier
- Analyzes performance by temperature, wind, precipitation
- Found optimal multiplier of 3 (55.7% win rate)

#### `/api/admin/recalculate-backtest`
- Recalculates all 227 backtest games with weather adjustments
- Uses optimized multiplier (3) to adjust predictions
- Updates O/U results based on weather-adjusted totals
- Logs which picks were flipped due to weather

#### `/api/admin/recalculate-with-cap`
- Recalculates all backtest predictions with current Elo cap
- Re-evaluates ATS, ML, and O/U results
- Reports which games were affected by the cap
- Updates blob with recalculated stats

#### `/api/admin/backfill-injuries`
- Fetch historical injury data
- Populate past weeks injury cache

#### `/api/admin/fetch-historical-odds`
- Capture Vegas lines for upcoming games
- Store in historical odds cache

#### `/api/admin/situational`
- Analyze backtest results by situation
- Find 60%+ ATS scenarios

#### `/api/backtest/analysis`
- Detailed backtest analysis
- Performance breakdowns by week, team, situation

---

## 8. External API Dependencies

### ESPN API

**Team Data:** `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams`
- Returns: Team IDs, names, abbreviations
- Used for: Team roster

**Standings:** `https://site.api.espn.com/apis/v2/sports/football/nfl/standings`
- Returns: Wins, losses, points for/against
- Used for: Calculate PPG stats, initial Elo

**Schedule:** `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week={week}`
- Returns: Games, scores, status, venue, game time
- Used for: Game data, completed games

**Injuries:** `https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries`
- Returns: Player injuries by team
- Used for: Injury impact analysis

### The Odds API

**NFL Odds:** `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/`
- Params: `regions=us`, `markets=spreads,totals,h2h`
- Returns: Spreads, totals, moneylines from multiple bookmakers
- Used for: Vegas consensus lines

**API Key Required:** `NEXT_PUBLIC_ODDS_API_KEY`

**Rate Limits:** Check API docs (typically limited requests per month)

### OpenWeather API

**Current Weather:** `https://api.openweathermap.org/data/2.5/weather`
- Params: `lat`, `lon`, `units=imperial`
- Returns: Current conditions

**Forecast:** `https://api.openweathermap.org/data/2.5/forecast`
- Params: `lat`, `lon`, `units=imperial`
- Returns: 5-day / 3-hour forecast

**API Key Required:** `NEXT_PUBLIC_WEATHER_API_KEY`

---

## 9. Frontend Architecture

### Main Dashboard (`src/app/page.tsx`)

**Component Structure:**
```typescript
Dashboard
├── Live Scoreboard (ESPN-style, horizontally scrollable)
│   ├── Left/Right navigation arrows
│   ├── Live games with real-time scores
│   └── Completed games with final scores
├── Best Bets Section (60%+ ATS situations, collapsible)
│   └── Cards for high-confidence picks
└── Upcoming Picks Grid
    └── GameCard (per game)
        ├── Game Header (teams, score prediction, time)
        ├── Weather Info (if outdoor game, shows adjustment)
        ├── Injury Info (if significant injuries)
        ├── Vegas Line Status (locked/live indicator)
        └── Picks Grid
            ├── Spread (with ATS confidence)
            ├── Moneyline
            └── Over/Under (with O/U confidence)
```

**Live Scoreboard Features:**
- Fetches from ESPN Scoreboard API every 60 seconds during games
- Horizontal scroll with navigation arrows
- Touch-friendly for mobile
- Shows quarter/time for in-progress games
- Winner highlighted on completed games

**Data Flow:**
1. `useEffect` → `fetchData()` on mount
2. Fetch `/prediction-data.json` (no-cache)
3. If no data → trigger `/api/cron/blob-sync-simple`
4. Set state: `games`, `recentGames`
5. Render components

**Manual Sync:**
```typescript
syncAll() → fetch('/api/cron/blob-sync-simple') → fetchData()
```

### Styling System

**Framework:** Tailwind CSS 4.x
- PostCSS-based configuration
- Utility-first approach
- Responsive design (mobile-first)

**Color Scheme:**
- Primary: Red (`red-600`, `red-700`)
- Success: Green (`green-600`, `green-700`)
- Warning: Yellow (`yellow-500`, `yellow-600`)
- Danger: Red (`red-400`, `red-600`)

**Confidence Indicators:**
- High: Green dot (`bg-green-500`)
- Medium: Yellow dot (`bg-yellow-500`)
- Low: Red dot (`bg-red-400`)

### Team Logos
**Source:** ESPN CDN
```typescript
https://a.espncdn.com/i/teamlogos/nfl/500-dark/${abbreviation}.png
```

---

## 10. Deployment Configuration

### Vercel Settings

**Build Command:** `next build`
**Output Directory:** `.next`
**Install Command:** `npm install`

**Environment Variables Required:**
```bash
NEXT_PUBLIC_ODDS_API_KEY=<your_odds_api_key>
NEXT_PUBLIC_WEATHER_API_KEY=<your_openweather_key>
CRON_SECRET=<your_cron_secret>
BLOB_READ_WRITE_TOKEN=<vercel_blob_token>
NEXT_PUBLIC_FIREBASE_API_KEY=<firebase_api_key>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<firebase_auth_domain>
NEXT_PUBLIC_FIREBASE_PROJECT_ID=<firebase_project_id>
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=<firebase_storage_bucket>
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<firebase_messaging_sender_id>
NEXT_PUBLIC_FIREBASE_APP_ID=<firebase_app_id>
FIREBASE_ADMIN_CREDENTIALS=<service_account_json_or_base64>
```

**Vercel Blob Storage:**
- Files: `prediction-matrix-data.json`, `nba-prediction-data.json`
- Access: Public
- Updates: Every 2 hours via cron

**Cron Configuration** (`vercel.json`):
```json
{
  "crons": [{
    "path": "/api/cron/blob-sync-simple",
    "schedule": "0 */2 * * *"
  }, {
    "path": "/api/cron/nba-sync",
    "schedule": "30 */2 * * *"
  }]
}
```
- Runs at: every 2 hours (NBA offset by 30 minutes)

---

## 11. Performance Optimizations

### Data Loading
- Single JSON blob fetch (< 1MB typical)
- No database queries from frontend
- Public CDN delivery from Vercel Blob
- Client-side caching disabled for freshness

### Computation
- In-memory processing only
- Canonical writes to Firestore during cron (blob is a read cache)
- Chronological game processing (single pass)
- Efficient Map structures for lookups

### API Rate Limiting
- Weather cache: 6 hours → reduces API calls
- Injury cache: 6 hours → reduces API calls
- Historical odds: Permanent → never refetch
- Cron frequency: 2 hours → balances freshness vs cost

### Frontend Optimizations
- Next.js server components
- Automatic code splitting
- Image optimization (team logos via ESPN CDN)
- Minimal JavaScript bundle

---

## 12. Data Persistence Strategy

### What's Stored Where

**Firestore (Primary)**
- ✅ All predictions
- ✅ Team Elo ratings (current state)
- ✅ Backtest results
- ✅ Historical Vegas odds
- ✅ Weather and injury caches
- ✅ Recent game results
- ✅ Cron metadata and blob write info

**Not Persisted (Regenerated Each Run)**
- Team PPG stats (fetched fresh from ESPN)
- Current week schedule
- Latest Vegas odds
- Current week weather

**Vercel Blob (Read Cache)**
- ✅ Frontend snapshots (NFL + NBA)
- ✅ Cron heartbeats

---

## 13. Key Business Logic

### Division Lookup
```typescript
DIVISIONS = {
  'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'],
  'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
  'AFC South': ['HOU', 'IND', 'JAX', 'TEN'],
  'AFC West': ['DEN', 'KC', 'LV', 'LAC'],
  'NFC East': ['DAL', 'NYG', 'PHI', 'WAS'],
  'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
  'NFC South': ['ATL', 'CAR', 'NO', 'TB'],
  'NFC West': ['ARI', 'LAR', 'SEA', 'SF']
}
```

### Team Name Variants (for Odds API matching)
```typescript
TEAM_NAME_VARIANTS = {
  'Arizona Cardinals': ['Cardinals', 'Arizona'],
  'Los Angeles Chargers': ['Chargers', 'LA Chargers'],
  // ... etc
}
```

### Situation Detection
```typescript
isDivisional = homeDiv === awayDiv;
isLateSeasonGame = week >= 13;
isLargeSpread = abs(vegasSpread) >= 7;
isSmallSpread = abs(vegasSpread) <= 3;
isMediumSpread = abs(vegasSpread) > 3 && abs(vegasSpread) < 7;
isEloMismatch = abs(homeElo - awayElo) > 100;
```

---

## 14. Error Handling & Resilience

### API Failures
- **Odds API fails**: Continue without Vegas lines, predictions still generated
- **Weather API fails**: Continue without weather, no impact applied
- **Injury API fails**: Continue without injury data, fall back to cached data
- **ESPN API fails**: Cron job fails, previous blob data still available to frontend

### Data Validation
- Team matching: Fuzzy matching for odds by team name + date
- Missing scores: Skip games without complete data
- Undefined values: Sanitized before Firestore writes
- Date parsing: All dates converted to ISO strings for consistency

### Caching Fallbacks
- Weather: Use stale cache if API fails
- Injuries: Use stale cache if API fails
- Odds: Use previously captured historical odds

---

## 15. Future Improvements (Ideas)

### Potential Enhancements
1. **Schema hardening**: Add validation for stored Firestore documents
2. **Injury impact modeling**: Quantify injury impact on spreads/totals
3. **Weather correlation**: More sophisticated weather impact model
4. **Live updating**: WebSocket or polling for in-game updates
5. **User accounts**: Save favorite teams, track personal bets
6. **Advanced stats**: EPA, DVOA integration
7. **Playoff predictions**: Extend to postseason
8. **Historical seasons**: Backtest on multiple years
9. **Line movement tracking**: Track how Vegas lines move over time
10. **Consensus vs sharp**: Compare recreational vs sharp money

---

## 16. Architecture Decisions

### Why Firestore + Blob?
1. **Durability**: Firestore is canonical and survives blob failures
2. **Performance**: Blob provides fast, CDN-backed reads
3. **Scoring**: Post-game results are stored and queryable
4. **Reliability**: Cron heartbeats and state tracking for monitoring
5. **Flexibility**: Firestore supports future analytics and user features

### Why In-Memory Processing?
1. **Speed**: No database round trips during computation
2. **Consistency**: Single canonical write to Firestore, then blob publish
3. **Simplicity**: Easier to reason about state
4. **Debugging**: Logs show complete run from start to finish

### Why Cron Every 2 Hours?
1. **API costs**: Balances paid API usage with freshness
2. **Freshness**: Keeps odds/weather/injuries current
3. **Game schedule**: Handles NFL week transitions and NBA daily games
4. **Resource usage**: Keeps Vercel invocations reasonable

### Why Two Cron Routes?
- `/api/cron/blob-sync-simple`: NFL pipeline
- `/api/cron/nba-sync`: NBA pipeline
- `/api/cron/blob-sync`: Legacy version retained for reference

---

## 17. Code Organization

```
src/
├── app/
│   ├── page.tsx                    # Main dashboard
│   ├── api/
│   │   ├── cron/
│   │   │   ├── blob-sync-simple/route.ts  # PRIMARY CRON (NFL)
│   │   │   ├── nba-sync/route.ts          # PRIMARY CRON (NBA)
│   │   │   ├── blob-sync/route.ts         # Legacy (deprecated)
│   │   │   └── sync/route.ts              # Legacy
│   │   └── admin/
│   │       ├── optimize-params/route.ts
│   │       ├── backfill-weather/route.ts
│   │       ├── backfill-injuries/route.ts
│   │       ├── recalculate-with-cap/route.ts
│   │       └── ... (other admin tools)
├── services/
│   ├── espn.ts           # ESPN API client
│   ├── odds.ts           # The Odds API client
│   ├── weather.ts        # OpenWeather API client
│   ├── injuries.ts       # ESPN Injuries API client
│   ├── elo.ts            # Elo calculations & predictions
│   └── database.ts       # Firebase (deprecated)
├── types/
│   └── index.ts          # TypeScript type definitions
└── lib/
    └── firebase.ts       # Firebase config (deprecated)
```

---

## 18. Monitoring & Debugging

### Logs
- All cron runs log to Vercel console
- Each step logs progress: "Fetching teams...", "Synced X games", etc.
- Errors logged with full stack traces
- Frontend errors logged to browser console

### Health Checks
- Check blob generation timestamp: `blobData.generated`
- Check cron heartbeat blobs: `cron-heartbeat-nfl.json`, `cron-heartbeat-nba.json`
- Verify upcoming games count > 0
- Check backtest summary win percentages
- Verify historical odds exist for recent games

### Manual Testing
- Trigger cron manually: Visit `/api/cron/blob-sync-simple` in browser
- Check blob: Fetch `/prediction-data.json` directly
- Reset & reprocess: `/api/cron/blob-sync-simple?reset=true`

---

## Summary

This NFL/NBA betting system is a **serverless prediction engine** that:

1. **Fetches** data from ESPN, The Odds API, OpenWeather, and NFL.com injuries
2. **Processes** games chronologically to maintain accurate Elo ratings
3. **Predicts** spreads, totals, and moneylines using calibrated models
4. **Backtests** on historical games to validate accuracy
5. **Identifies** high-confidence situations (60%+ ATS scenarios)
6. **Caches** weather, injuries, and Vegas odds to reduce API costs
7. **Stores** canonical data in Firestore with blob snapshots for instant frontend access
8. **Updates** every 2 hours via Vercel Cron
9. **Publishes** heartbeat blobs for cron monitoring

The architecture prioritizes **reliability and speed** by keeping Firestore as the source of truth and using blob storage as a CDN-backed cache.
