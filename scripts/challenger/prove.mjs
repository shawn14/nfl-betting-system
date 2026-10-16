import fs from 'node:fs';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { loadGames, buildFeatures, makeRows, evaluate, predict, summarize, DAY } from './engine.mjs';
import { americanToDecimal } from '../../src/lib/fair-value.ts';

const protocol = JSON.parse(fs.readFileSync('docs/challenger/protocol.json'));
const saved = zlib.gunzipSync(fs.readFileSync('docs/challenger/predictions.jsonl.gz')).toString().trim().split('\n').map(JSON.parse);
const savedModels = JSON.parse(fs.readFileSync('docs/challenger/models.json'));
const savedReport = JSON.parse(fs.readFileSync('docs/challenger/result.json'));
const savedSelections = JSON.parse(fs.readFileSync('docs/challenger/paper-selections.json'));
assert.equal(crypto.createHash('sha256').update(fs.readFileSync('docs/challenger/protocol.json')).digest('hex'), savedReport.protocolSha256);
for (const source of savedReport.codeSources) assert.equal(
  crypto.createHash('sha256').update(fs.readFileSync(source.file)).digest('hex'), source.sha256);
const cutoff = Date.parse('2025-07-01T00:00:00Z');
const checks = [];
let allRows = [];
for (const sport of protocol.sports) {
  const file = `data/market-history/${sport}.json`, bytes = fs.readFileSync(file);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), savedReport.sources.find(s => s.file === file).sha256);
  const games = loadGames(JSON.parse(bytes), sport), f = buildFeatures(games, sport, protocol.outcomeAvailabilityLagHours);
  assert.deepEqual(buildFeatures([...games].reverse(), sport), f, `${sport}: input-order dependence`);
  for (const g of f) if (g.f.latestOutcomeKickoff !== null) assert.ok(g.f.latestOutcomeKickoff + DAY <= g.ms);
  // Counterfactual on actual historical rows only; never changes archive or production data.
  const changed = games.map(g => g.ms >= cutoff ? { ...g, hs: g.as, as: g.hs, margin: -g.margin, total: g.total + 11 } : g);
  const changedFeatures = buildFeatures(changed, sport);
  const earlier = f.filter(g => g.ms < cutoff);
  assert.deepEqual(changedFeatures.filter(g => g.ms < cutoff), earlier, `${sport}: future outcomes change earlier features`);
  const rows = makeRows(f), alteredRows = makeRows(changedFeatures);
  const actualBefore = evaluate(rows, protocol).rows.filter(r => r.ms < cutoff);
  const changedBefore = evaluate(alteredRows, protocol).rows.filter(r => r.ms < cutoff);
  assert.deepEqual(changedBefore, actualBefore, `${sport}: future outcomes affect earlier fitted forecasts`);
  // Every archived regular/postseason result updates feature state even with missing prices.
  const noPrices = games.filter(g => !g.close);
  const expectedUpdates = games.filter(g => g.ms + DAY <= games.at(-1).ms).length;
  assert.equal(f.at(-1).f.outcomeUpdates, expectedUpdates);
  checks.push({ sport, games: games.length, noCloseUsedInHistory: noPrices.length,
    orderInvariant: true, futureMutationInvariantPredictions: actualBefore.length,
    lastGameExpectedUpdates: expectedUpdates, allAvailabilityBounds: true });
  allRows.push(...rows);
}
const computed = evaluate(allRows, protocol);
assert.deepEqual(computed.rows, saved);
assert.deepEqual(computed.models, savedModels);
assert.deepEqual(computed.selected, savedSelections);
const summary = summarize(computed);
for (const key of ['overall', 'cells', 'paper', 'calibration']) assert.deepEqual(summary[key], savedReport[key]);
const modelById = new Map(savedModels.map(m => [m.id, m]));
let baselineFallbacks = 0;
for (const r of saved) {
  const model = modelById.get(r.modelId);
  if (model.active) assert.ok(model.latestTrainingKickoff + DAY < Date.parse(model.asOf));
  assert.equal(predict(r, model.active ? model : null, protocol), r.prediction);
  if (!r.active) { assert.equal(r.prediction, r.p); baselineFallbacks++; }
  assert.ok(r.prediction > 0 && r.prediction < 1);
}
assert.equal(new Set(savedSelections.map(r => r.gameId)).size, savedSelections.length);
const byId = new Map(saved.map(r => [r.id, r]));
for (const bet of savedSelections) {
  const row = byId.get(bet.id);
  const profit = row.y === null ? 0 : (row.y === 1) === (bet.side === 'A') ? americanToDecimal(bet.price) - 1 : -1;
  assert.equal(bet.gross, profit);
  assert.equal(bet.net, profit - protocol.paperSelection.additionalCostPerUnit);
  assert.ok(bet.expectedReturn >= protocol.paperSelection.minimumExpectedReturn);
}
const proof = { passed: true, generatedAt: new Date().toISOString(), games: checks.reduce((s, r) => s + r.games, 0),
  evaluationGames: new Set(saved.map(r => r.gameId)).size, evaluationMarketRows: saved.length,
  baselineFallbacks, monthlyModelRecords: savedModels.length, selectedGames: savedSelections.length,
  checks, limits: 'Historical source availability remains assumed, not independently timestamp-certified. This proves the local algorithm on these records, not a production trading edge.' };
fs.writeFileSync('docs/challenger/proof.json', JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify(proof, null, 2));
