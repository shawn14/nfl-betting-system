// NFL injuries — sourced from ESPN's public injuries feed.
//
// History (do not repeat): from 2025-12-21 to 2026-09-11 this module scraped NFL.com.
// NFL.com's markup never matched the parser (0 rows), so fetchInjuries() silently returned
// a HARDCODED list of 13 players and stamped it with a fresh timestamp — for nine months the
// site showed December-2025 injuries as "live" and flagged "QB Out" on healthy starters.
//
// This module now fails CLOSED. If the feed cannot be fetched or parsed, fetchInjuries()
// returns null and the caller must surface "injuries unavailable", never "Healthy".
//
// Feed: https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries
// Shape (verified against the live feed 2026-09-11, 32 teams / 800 rows):
//   { injuries: [{ id, displayName, injuries: [{ status, date,
//       athlete: { displayName, position: { abbreviation }, team: { abbreviation } },
//       details?: { type, returnDate } }] }] }
// Statuses observed: Active, Questionable, Doubtful, Out, Injured Reserve, Suspension.
// Do NOT send a browser User-Agent: ESPN's edge returns 403 to spoofed UAs; the default
// Node fetch UA is what the production crons use successfully.

const ESPN_INJURIES_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries';

// 32 NFL teams. A parse that yields fewer than this is treated as a broken feed, not a quiet week.
const MIN_TEAMS_FOR_VALID_REPORT = 28;

// Key positions for betting impact
const KEY_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'LT', 'RT', 'CB', 'EDGE', 'DE', 'DT', 'LB', 'S', 'G', 'C', 'T', 'OT', 'OG'];

// Designations that are NOT injuries. ESPN lists healthy inactives as status "Out" with one of
// these as the injury type (e.g. a third-string QB "Out — Coach's Decision" every week). Counting
// them flagged "QB Out" on LAR, NE, SF and SEA in week 1 2026 and moved each spread by 3 points.
const NON_INJURY_DESIGNATIONS = /coach'?s decision|not injury related|load management|\brest\b|personal/i;

// Fallback only: rows normally carry athlete.team.abbreviation. Keys are ESPN's abbreviations
// (note WSH, not WAS — the app's teams/games use ESPN abbreviations everywhere).
const TEAM_ABBREV_BY_NAME: Record<string, string> = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI', 'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC',
  'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC', 'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF',
  'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB', 'Tennessee Titans': 'TEN', 'Washington Commanders': 'WSH',
};

export type InjuryStatusClass = 'out' | 'questionable' | 'long_term' | 'active';

export interface PlayerInjury {
  name: string;
  position: string;
  status: string; // raw feed status: "Out", "Doubtful", "Questionable", "Injured Reserve", "Suspension", ...
  injury: string; // injury type: "Achilles", "Knee", ...
  isKeyPlayer: boolean;
  returnDate?: string;
  reportedAt?: string;
}

export interface TeamInjuries {
  teamAbbrev: string;
  injuries: PlayerInjury[];
  keyPlayersOut: number;
  hasQBOut: boolean;
}

export interface InjuryReport {
  teams: Record<string, TeamInjuries>;
  fetchedAt: string;
  source?: string;
}

interface EspnInjuryRow {
  status?: string;
  date?: string;
  athlete?: {
    displayName?: string;
    position?: { abbreviation?: string };
    team?: { abbreviation?: string };
  };
  details?: { type?: string; returnDate?: string };
}

interface EspnInjuriesResponse {
  injuries?: Array<{ id?: string; displayName?: string; injuries?: EspnInjuryRow[] }>;
}

export function classifyInjuryStatus(status: string): InjuryStatusClass {
  const s = (status || '').toLowerCase().trim();
  if (!s || s === 'active' || s === 'probable') return 'active';
  if (
    s.includes('injured reserve') || s === 'ir' || s.includes('suspension') || s.includes('suspended') ||
    s.includes('physically unable') || s === 'pup' || s.includes('non-football') || s.includes('nfi')
  ) {
    return 'long_term';
  }
  if (s === 'out' || s.startsWith('out ') || s.includes('doubtful')) return 'out';
  if (s.includes('questionable') || s.includes('day-to-day') || s.includes('day to day')) return 'questionable';
  return 'active';
}

// Does this row count as a key absence for the game-week signal? Only the weekly game status
// (Out / Doubtful) counts — the same semantic as the NFL.com weekly report the model was built
// on. IR / PUP / suspension rows are listed for display but not counted: Elo has already
// absorbed a months-long absence, and ESPN's row `date` is the last news update, not the
// placement date, so it cannot tell a fresh IR stint from an old one.
function countsAsOut(status: string): boolean {
  return classifyInjuryStatus(status) === 'out';
}

// Pure parser — testable against a saved copy of the feed.
export function parseEspnInjuries(data: EspnInjuriesResponse, now: Date = new Date()): InjuryReport {
  const teams: Record<string, TeamInjuries> = {};

  for (const teamBlock of data.injuries || []) {
    const rows = teamBlock.injuries || [];
    // Resolve the team abbreviation from any row; fall back to the block's display name.
    const abbrev =
      rows.find(r => r.athlete?.team?.abbreviation)?.athlete?.team?.abbreviation ||
      TEAM_ABBREV_BY_NAME[teamBlock.displayName || ''];
    if (!abbrev) continue;

    const team: TeamInjuries = teams[abbrev] || { teamAbbrev: abbrev, injuries: [], keyPlayersOut: 0, hasQBOut: false };
    teams[abbrev] = team;

    for (const row of rows) {
      const status = (row.status || '').trim();
      if (classifyInjuryStatus(status) === 'active') continue; // healthy / cleared — not an injury
      const injuryType = (row.details?.type || '').trim();
      if (NON_INJURY_DESIGNATIONS.test(injuryType)) continue; // healthy scratch — not an injury

      const position = (row.athlete?.position?.abbreviation || '').toUpperCase();
      const isKeyPlayer = KEY_POSITIONS.includes(position);
      const out = countsAsOut(status);

      team.injuries.push({
        name: (row.athlete?.displayName || 'Unknown').trim(),
        position,
        status,
        injury: injuryType,
        isKeyPlayer,
        returnDate: row.details?.returnDate,
        reportedAt: row.date,
      });

      if (out && isKeyPlayer) team.keyPlayersOut++;
      if (out && position === 'QB') team.hasQBOut = true;
    }
  }

  return { teams, fetchedAt: now.toISOString(), source: 'espn' };
}

export async function fetchInjuries(): Promise<InjuryReport | null> {
  try {
    const response = await fetch(ESPN_INJURIES_URL, { headers: { Accept: 'application/json' } });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('json')) {
      console.error(`Injuries feed unavailable (injuries OFF): HTTP ${response.status} ${contentType}`);
      return null;
    }

    const data = (await response.json()) as EspnInjuriesResponse;
    const report = parseEspnInjuries(data);
    const teamCount = Object.keys(report.teams).length;
    if (teamCount < MIN_TEAMS_FOR_VALID_REPORT) {
      console.error(`Injuries feed parsed only ${teamCount} teams; treating feed as broken (injuries OFF)`);
      return null;
    }
    return report;
  } catch (error) {
    console.error('Injuries feed error (injuries OFF):', error);
    return null;
  }
}

// Get summary for a specific team
export function getTeamInjurySummary(injuries: InjuryReport | null, teamAbbrev: string): {
  hasQBOut: boolean;
  keyPlayersOut: PlayerInjury[];
  questionablePlayers: PlayerInjury[];
} {
  const empty = { hasQBOut: false, keyPlayersOut: [], questionablePlayers: [] };
  if (!injuries) return empty;

  const teamInjuries = injuries.teams[teamAbbrev];
  if (!teamInjuries) return empty;

  const keyPlayersOut = teamInjuries.injuries.filter(i => i.isKeyPlayer && countsAsOut(i.status));
  const questionablePlayers = teamInjuries.injuries.filter(
    i => i.isKeyPlayer && classifyInjuryStatus(i.status) === 'questionable'
  );

  return { hasQBOut: teamInjuries.hasQBOut, keyPlayersOut, questionablePlayers };
}

// Get game-level injury impact. When the report is null the feed was unavailable: say so
// ("Unavailable"), never "Healthy".
export function getGameInjuryImpact(
  injuries: InjuryReport | null,
  homeTeam: string,
  awayTeam: string
): {
  homeInjuries: { hasQBOut: boolean; keyOut: number; summary: string };
  awayInjuries: { hasQBOut: boolean; keyOut: number; summary: string };
  impactLevel: 'none' | 'minor' | 'significant' | 'major';
} {
  if (!injuries) {
    const unavailable = { hasQBOut: false, keyOut: 0, summary: 'Unavailable' };
    return { homeInjuries: unavailable, awayInjuries: unavailable, impactLevel: 'none' };
  }

  const homeSummary = getTeamInjurySummary(injuries, homeTeam);
  const awaySummary = getTeamInjurySummary(injuries, awayTeam);

  const homeKeyOut = homeSummary.keyPlayersOut.length;
  const awayKeyOut = awaySummary.keyPlayersOut.length;

  const formatSummary = (summary: typeof homeSummary): string => {
    const parts: string[] = [];
    if (summary.hasQBOut) parts.push('QB Out');
    else if (summary.keyPlayersOut.length > 0) {
      const positions = [...new Set(summary.keyPlayersOut.map(p => p.position))];
      parts.push(`${positions.slice(0, 3).join(', ')} Out`);
    }
    if (summary.questionablePlayers.length > 0) {
      parts.push(`${summary.questionablePlayers.length} GTD`);
    }
    return parts.join(' | ') || 'Healthy';
  };

  let impactLevel: 'none' | 'minor' | 'significant' | 'major' = 'none';
  if (homeSummary.hasQBOut || awaySummary.hasQBOut) {
    impactLevel = 'major';
  } else if (homeKeyOut >= 3 || awayKeyOut >= 3) {
    impactLevel = 'significant';
  } else if (homeKeyOut >= 1 || awayKeyOut >= 1) {
    impactLevel = 'minor';
  }

  return {
    homeInjuries: { hasQBOut: homeSummary.hasQBOut, keyOut: homeKeyOut, summary: formatSummary(homeSummary) },
    awayInjuries: { hasQBOut: awaySummary.hasQBOut, keyOut: awayKeyOut, summary: formatSummary(awaySummary) },
    impactLevel,
  };
}
