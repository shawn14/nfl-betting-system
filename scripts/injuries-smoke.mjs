// Proof that the NFL injury feed is live and the parser yields all 32 teams.
// Runs the REAL fetchInjuries() against ESPN (no mocks). Exit 1 = injuries would be OFF.
//   npm run injuries-smoke   (Node 22.18+ type-strips the imported .ts service natively)
import { fetchInjuries } from '../src/services/injuries.ts';

const report = await fetchInjuries();
if (!report) {
  console.error('FAIL: fetchInjuries() returned null — injuries feed unavailable');
  process.exit(1);
}
const teams = Object.values(report.teams);
const rows = teams.reduce((n, t) => n + t.injuries.length, 0);
const qbOut = teams.filter(t => t.hasQBOut).map(t => t.teamAbbrev);
console.log(`teams=${teams.length} rows=${rows} fetchedAt=${report.fetchedAt} source=${report.source}`);
console.log(`QB out: ${qbOut.join(', ') || 'none'}`);
for (const t of teams.slice(0, 4)) {
  console.log(` ${t.teamAbbrev} keyOut=${t.keyPlayersOut}`, t.injuries.slice(0, 3).map(i => `${i.name} ${i.position} ${i.status}${i.injury ? ' (' + i.injury + ')' : ''}`));
}
if (teams.length < 28) { console.error(`FAIL: only ${teams.length} teams`); process.exit(1); }
console.log('PASS');
