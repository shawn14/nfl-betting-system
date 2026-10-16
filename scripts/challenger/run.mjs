import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { loadGames, buildFeatures, makeRows, evaluate, summarize } from './engine.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const protocolBytes = fs.readFileSync('docs/challenger/protocol.json');
const protocol = JSON.parse(protocolBytes);
let rows = [];
const sources = [], inventory = [];
for (const sport of protocol.sports) {
  const file = `data/market-history/${sport}.json`, bytes = fs.readFileSync(file), db = JSON.parse(bytes);
  const games = loadGames(db, sport), features = buildFeatures(games, sport, protocol.outcomeAvailabilityLagHours);
  const marketRows = makeRows(features);
  sources.push({ file, sha256: sha(bytes), bytes: bytes.length });
  inventory.push({ sport, raw: Object.keys(db.games).length, nonPreseason: games.length,
    withClose: games.filter(g => g.close).length, marketRows: marketRows.length,
    first: games[0].t, last: games.at(-1).t });
  rows.push(...marketRows);
}
const result = evaluate(rows, protocol);
const report = { generatedAt: new Date().toISOString(), classification: protocol.purpose,
  protocolSha256: sha(protocolBytes), engineSha256: sha(fs.readFileSync('scripts/challenger/engine.mjs')),
  codeSources: ['scripts/challenger/engine.mjs', 'scripts/challenger/run.mjs', 'src/lib/fair-value.ts']
    .map(file => ({ file, sha256: sha(fs.readFileSync(file)) })),
  sources, inventory, limits: protocol.limits,
  providerRows: Object.fromEntries([...Map.groupBy(result.rows, r => r.provider)].map(([name, rs]) => [name, rs.length])),
  ...summarize(result) };
fs.writeFileSync('docs/challenger/result.json', JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync('docs/challenger/models.json', JSON.stringify(result.models, null, 2) + '\n');
fs.writeFileSync('docs/challenger/predictions.jsonl.gz', zlib.gzipSync(result.rows.map(r => JSON.stringify(r)).join('\n') + '\n'));
fs.writeFileSync('docs/challenger/paper-selections.json', JSON.stringify(result.selected, null, 2) + '\n');
console.log(JSON.stringify({ inventory, overall: report.overall, paper: report.paper, cells: report.cells }, null, 2));
