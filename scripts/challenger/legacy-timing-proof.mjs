import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as fair from '../../src/lib/fair-value.ts';

// Execute the existing functions verbatim, stopping before their write-producing main.
const source = fs.readFileSync('scripts/market-lab.mjs', 'utf8');
const body = source.slice(source.indexOf('const DIR ='), source.indexOf('// ------------------------------------------------------------------ main'));
const legacy = vm.runInNewContext(`${body}; ({ load, buildFeatures })`, { fs, path, process, ...fair });
const evidence = [];
for (const sport of ['nfl', 'nba', 'nhl', 'cbb', 'wnba']) {
  const games = legacy.load(sport).games;
  const forward = structuredClone(games);
  const reversed = structuredClone(games).sort((a, b) => a.t.localeCompare(b.t) || b.id.localeCompare(a.id));
  legacy.buildFeatures(sport, forward);
  legacy.buildFeatures(sport, reversed);
  const reverseById = new Map(reversed.map(g => [g.id, g]));
  const byTime = Map.groupBy(forward, g => g.t);
  const differences = forward.filter(g => byTime.get(g.t).length > 1 && Number.isFinite(g.f.ewmaTotal)
    && Math.abs(g.f.ewmaTotal - reverseById.get(g.id).f.ewmaTotal) > 1e-9);
  const g = differences[0];
  evidence.push({ sport, rows: games.length, sameKickoffPredictionsChanged: differences.length,
    example: g && { id: g.id, kickoff: g.t, home: g.hAbbr, away: g.aAbbr,
      totalForwardOrder: g.f.ewmaTotal, totalReverseOrder: reverseById.get(g.id).f.ewmaTotal,
      simultaneousGameIds: byTime.get(g.t).map(x => x.id) } });
}
const report = { kind: 'Actual historical-record replay of original market-lab functions',
  finding: 'Same-kickoff outcome ordering changes supposedly pregame total features', evidence };
fs.mkdirSync('docs/challenger', { recursive: true });
fs.writeFileSync('docs/challenger/legacy-timing-proof.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--assert-legacy-safe')) {
  assert.equal(evidence.reduce((n, r) => n + r.sameKickoffPredictionsChanged, 0), 0,
    'Pregame features must be invariant to the order of simultaneous final outcomes');
}
