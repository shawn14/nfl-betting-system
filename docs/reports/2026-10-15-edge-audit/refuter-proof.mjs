#!/usr/bin/env node
// Offline diagnostic. Reads the captured real public data beside this script; never calls a service.
// Run: node /absolute/path/to/refuter-proof.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const nfl = read('nfl.json');
const ledger = read('shop-ledger.json');
const season = nfl.backtest.results.filter(r => r.gameTime >= '2026-09-01').sort((a,b) => a.gameTime.localeCompare(b.gameTime));
const frozen = season.filter(r => r.modelVersion === '2026-09-11-freeze');
const teams = new Map(nfl.teams.map(t => [t.abbreviation,t]));
const round = (x,n=1) => Math.round(x * 10**n)/10**n;
const base = (r, h, a) => {
  const regress = s => s*.7 + 22*.3;
  const elo = Math.max(-8,Math.min(8,(r.homeElo-r.awayElo)*.11/2));
  const home = round((regress(h.ppg)+regress(a.ppgAllowed))/2+elo+1.5);
  const away = round((regress(a.ppg)+regress(h.ppgAllowed))/2-elo-1.5);
  return { home, away, rawTotal: home+away, total: Math.round((home+away)*2)/2,
    spread: Math.round((away-home)*.55*2)/2 };
};
function stats(team, rows, excludeTiesFromDenominator=true) {
  const games = rows.filter(r => r.homeTeam===team || r.awayTeam===team);
  const denominator = excludeTiesFromDenominator ? games.filter(r=>r.actualHomeScore!==r.actualAwayScore).length : games.length;
  const pointsFor = games.reduce((s,r)=>s+(r.homeTeam===team?r.actualHomeScore:r.actualAwayScore),0);
  const pointsAgainst = games.reduce((s,r)=>s+(r.homeTeam===team?r.actualAwayScore:r.actualHomeScore),0);
  return { games: games.length, denominator, pointsFor, pointsAgainst,
    ppg: denominator ? round(pointsFor/denominator) : 22,
    ppgAllowed: denominator ? round(pointsAgainst/denominator) : 22 };
}
const grade = (pred, line, actual) => actual===line ? 'push' : (pred>line)===(actual>line) ? 'win':'loss';
const gradeSpread = (pred,line,actual) => actual===line ? 'push' : (pred<line)===(actual<line) ? 'win':'loss';
const tally = (rows,field) => {
  const wins=rows.filter(r=>r[field]==='win').length, losses=rows.filter(r=>r[field]==='loss').length, pushes=rows.filter(r=>r[field]==='push').length;
  return { wins,losses,pushes,winRate:wins/(wins+losses), hypotheticalFlatMinus110Roi:(wins*100/110-losses)/(wins+losses+pushes) };
};
const week5 = frozen.filter(r=>r.week===5).map(r=>{
  const current = base(r,teams.get(r.homeTeam),teams.get(r.awayTeam));
  const before = season.filter(x=>Date.parse(x.gameTime)<Date.parse(r.gameTime));
  const h=stats(r.homeTeam,before), a=stats(r.awayTeam,before), prior=base(r,h,a);
  const postH=stats(r.homeTeam,season),postA=stats(r.awayTeam,season),post=base(r,postH,postA);
  return {gameId:r.gameId,gameTime:r.gameTime,matchup:`${r.awayTeam} @ ${r.homeTeam}`,vegasTotal:r.vegasTotal,actualTotal:r.actualTotal,
    stored:{home:r.predictedHomeScore,away:r.predictedAwayScore,total:r.predictedTotal,rawTotal:r.predictedHomeScore+r.predictedAwayScore,grade:r.ouVegasResult},
    currentLiveStatsBase:current, totalMatchesCurrent:current.total===r.predictedTotal,
    componentScoresMatchCurrent:current.home===r.predictedHomeScore && current.away===r.predictedAwayScore,
    postgameReconstructedStats:{home:postH,away:postA}, postgameReconstructedBase:post,
    priorOnlyStats:{home:h,away:a},priorOnlyBase:prior,priorOnlyGrade:grade(prior.rawTotal,r.vegasTotal,r.actualTotal),
    directionChanges:(prior.rawTotal>r.vegasTotal)!==((r.predictedHomeScore+r.predictedAwayScore)>r.vegasTotal)};
});
const diagnostic = frozen.map(r=>{
  const before=season.filter(x=>Date.parse(x.gameTime)<Date.parse(r.gameTime));
  const h=stats(r.homeTeam,before), a=stats(r.awayTeam,before);
  if(!h.games || !a.games) return null;
  const p=base(r,h,a);
  return {gameId:r.gameId,gameTime:r.gameTime,week:r.week,matchup:`${r.awayTeam} @ ${r.homeTeam}`,
    homePriorGames:h.games,awayPriorGames:a.games,homePriorStats:h,awayPriorStats:a,
    vegasTotal:r.vegasTotal,actualTotal:r.actualTotal,vegasSpread:r.vegasSpread,actualSpread:r.actualSpread,
    storedRawTotal:r.predictedHomeScore+r.predictedAwayScore,storedTotal:r.predictedTotal,storedTotalGrade:r.ouVegasResult,storedSpreadGrade:r.atsResult,
    reconstructed:p,reconstructedTotalGrade:grade(p.rawTotal,r.vegasTotal,r.actualTotal),reconstructedSpreadGrade:gradeSpread(p.spread,r.vegasSpread,r.actualSpread),
    totalDirectionChanges:(p.rawTotal>r.vegasTotal)!==((r.predictedHomeScore+r.predictedAwayScore)>r.vegasTotal)};
}).filter(Boolean);
const implied = n => n>0 ? 100/(n+100) : -n/(100-n);
const now=Date.parse(ledger.updated);
const graded=ledger.entries.filter(r=>Date.parse(r.commence)<=now && r.closeFair!=null).map(r=>({...r,
  clv:r.closeFair-implied(r.price), closeAgeHours:(Date.parse(r.commence)-Date.parse(r.closeAt))/3600000,
  sameSnapshot:r.closeAt===r.flaggedAt}));
function clvSummary(rows) {
  const n=rows.length,mean=rows.reduce((s,r)=>s+r.clv,0)/n;
  const group=new Map(); for(const r of rows) group.set(r.eventId,(group.get(r.eventId)||0)+r.clv-mean);
  const G=group.size, se=Math.sqrt(rows.reduce((s,r)=>s+(r.clv-mean)**2,0)/(n-1)/n);
  const clusterSe=Math.sqrt(G/(G-1)*[...group.values()].reduce((s,x)=>s+x*x,0)/n**2);
  return {flags:n,games:G,meanClvProbabilityPoints:mean*100,positive:rows.filter(r=>r.clv>0).length,
    naiveSeProbabilityPoints:se*100,gameClusterSeProbabilityPoints:clusterSe*100,
    approximateNormalGameCluster95ProbabilityPoints:[(mean-1.96*clusterSe)*100,(mean+1.96*clusterSe)*100]};
}
const out={
  generatedAt:new Date().toISOString(), inputs:{nflGenerated:nfl.generated,ledgerUpdated:ledger.updated},
  scope:'Independent offline reconstruction from public live data captured by parent. Refuter separately fetched public NFL JSON and ledger and confirmed the same counts/timestamps. No crons, paid APIs, mutations, model fitting or optimization.',
  caveats:[
    'Prior-only forecasts are diagnostic reconstructions, NOT recovered published pregame picks. Original pregame PPG/snapshot timestamps are absent.',
    'Uses stored home/away Elo, recorded odds, current frozen constants, prior captured regular-season final games, and the same stats formula. This does not certify Elo or market data were available pregame.',
    'Source-faithful PPG denominator is wins+losses, excluding tied games even while retaining their points. This existing defect is preserved; all retained prior-game diagnostics precede or are unaffected by the only captured tie.',
    'Result generator omits weather and QB adjustments used in displayed predictions; diagnostics omit them too. No retrospective adjustment selection.',
    'Hypothetical -110 ROI is only a standardized diagnostic, NOT realized return or evidence of executable historic prices.',
    'Game-cluster confidence intervals use normal approximation and do not account for cross-game, day, book, selection, or stale-quote dependence. CLV is not realized profit.',
    'Cached browser October4 /ev rendering is NOT evidence of published pregame content; fresh direct HTTP shows current content. No stale-production claim.'
  ],
  frozen:{games:frozen.length,storedTotals:tally(frozen.map(r=>({result:r.ouVegasResult})),'result'),timestampFields:[...new Set(frozen.flatMap(r=>Object.keys(r).filter(k=>/time/i.test(k)||/at$/i.test(k))))].sort()},
  week5Summary:{games:week5.length,currentLiveStatsTotalMatches:week5.filter(r=>r.totalMatchesCurrent).length,currentLiveStatsComponentMatches:week5.filter(r=>r.componentScoresMatchCurrent).length},
  leakageExamples:week5.filter(r=>['401872982','401872992'].includes(r.gameId)),week5,
  priorOnlyDiagnostic:{included:diagnostic.length,excludedFrozenWithoutPriorGame:frozen.length-diagnostic.length,
    storedSameSubsetTotals:tally(diagnostic,'storedTotalGrade'),reconstructedTotals:tally(diagnostic,'reconstructedTotalGrade'),
    storedSameSubsetSpreads:tally(diagnostic,'storedSpreadGrade'),reconstructedSpreads:tally(diagnostic,'reconstructedSpreadGrade'),
    totalDirectionChanges:diagnostic.filter(r=>r.totalDirectionChanges).length,
    winsTurnedLosses:diagnostic.filter(r=>r.storedTotalGrade==='win'&&r.reconstructedTotalGrade==='loss').length,
    lossesTurnedWins:diagnostic.filter(r=>r.storedTotalGrade==='loss'&&r.reconstructedTotalGrade==='win').length,
    rows:diagnostic},
  lineShopping:{all:clvSummary(graded),withoutSameSnapshot:clvSummary(graded.filter(r=>!r.sameSnapshot)),
    independentCloseWithin1h:clvSummary(graded.filter(r=>!r.sameSnapshot && r.closeAgeHours>0 && r.closeAgeHours<=1)),
    sameSnapshotCount:graded.filter(r=>r.sameSnapshot).length,sameSnapshotPositiveCount:graded.filter(r=>r.sameSnapshot&&r.clv>0).length,
    closeOlderThan1h:graded.filter(r=>r.closeAgeHours>1).length,maxCloseAgeHours:Math.max(...graded.map(r=>r.closeAgeHours)),
    perSport:Object.fromEntries([...new Set(graded.map(r=>r.sport))].map(s=>[s,clvSummary(graded.filter(r=>r.sport===s))]))},
  sourceReferences:[
    {file:'src/services/espn.ts',line:125,finding:'gamesPlayed = wins + losses; current standings points feed PPG at148–149'},
    {file:'src/app/api/cron/blob-sync-simple/route.ts',line:314,finding:'Refreshes current ESPN PPG before final-game grading'},
    {file:'src/app/api/cron/blob-sync-simple/route.ts',line:328,finding:'Selects already-completed games'},
    {file:'src/app/api/cron/blob-sync-simple/route.ts',line:369,finding:'Computes new base prediction for each final game'},
    {file:'src/app/api/cron/blob-sync-simple/route.ts',line:462,finding:'Stamps modelVersion at result generation'},
    {file:'src/app/api/cron/blob-sync-simple/route.ts',line:784,finding:'Displayed forecast subtracts weather and QB adjustments; result grading does not'},
    {file:'src/app/api/cron/blob-sync-simple/route.ts',line:1144,finding:'Prediction documents keyed only by game ID with updatedAt'},
    {file:'src/services/firestore-admin-store.ts',line:66,finding:'Prediction records overwritten/merged at same game ID'},
    {file:'src/app/api/cron/odds-board-record/route.ts',line:132,finding:'Initial observation can immediately become closeFair/closeAt'},
    {file:'src/lib/odds-board.ts',line:42,finding:'Any closeFair accepted after kickoff; no later-observation/freshness gate'},
    {file:'src/lib/odds-board.ts',line:46,finding:'Uncertainty treats flags as independent observations'},
    {file:'scripts/line-shop-proof.mjs',line:58,finding:'Props replay repeats snapshot/book observations across47 games'},
    {file:'scripts/line-shop-proof.mjs',line:86,finding:'Props uncertainty calculated over863 flags, without clustering'}
  ]
};
fs.writeFileSync(path.join(dir,'refuter-proof.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({week5:out.week5Summary,diagnostic:{...out.priorOnlyDiagnostic,rows:undefined},lineShopping:out.lineShopping},null,2));
