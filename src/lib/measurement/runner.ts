import { CAPTURE_HOURS, digest, eventState, makeCapture, modelId, settle, validCapture, SPORTS, type Sport, type Json, type ModelCapture, type Settlement } from './core.ts';
import { espnOddsUrl } from '../espn-prices.ts';
import { MeasurementStore } from './store.ts';

export const BLOB_BASE = 'https://0luulmjdaimldet9.public.blob.vercel-storage.com';
export const FILES: Record<Sport,string> = { nfl:'prediction-matrix-data.json', nba:'nba-prediction-data.json', nhl:'nhl-prediction-data.json', cbb:'cbb-prediction-data.json', wnba:'wnba-prediction-data.json' };
const PATHS: Record<Sport,string> = { nfl:'football/nfl', nba:'basketball/nba', wnba:'basketball/wnba', nhl:'hockey/nhl', cbb:'basketball/mens-college-basketball' };
export const eventUrl = (sport: Sport, id: string) => `https://site.api.espn.com/apis/site/v2/sports/${PATHS[sport]}/summary?event=${id}`;
export async function json(url: string): Promise<Json> {
  const r = await fetch(url, { cache:'no-store', signal:AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Measurement source HTTP ${r.status}: ${url}`);
  return r.json();
}

/** Read the actual published forecasts. Never invoke a predictor or read legacy results to grade. */
export async function collect(store: MeasurementStore, dryRun = false) {
  const started = Date.now(), observations: Json[] = [], captures: ModelCapture[] = [], settlements: Settlement[] = [];
  const existing = new Map((await store.list<ModelCapture>('model')).map(c => [c.id,c]));
  const settled = new Set((await store.list<Settlement>('settlement')).map(s => s.captureId));
  for (const sport of SPORTS) {
    if (Date.now()-started>240000) throw new Error('Measurement run exceeded safe time budget');
    const sourceUrl = `${BLOB_BASE}/${FILES[sport]}`;
    const blob = await json(sourceUrl), sourceHash = digest(blob);
    for (const entry of blob.games ?? []) {
      const id = modelId(sport, String(entry.game?.id)), kick = Date.parse(entry.game?.gameTime);
      if (existing.has(id) || !Number.isFinite(kick) || kick <= Date.now() || kick > Date.now()+CAPTURE_HOURS*36e5) continue;
      if (Date.now()-started>240000) throw new Error('Measurement run exceeded safe time budget');
      const url = eventUrl(sport, String(entry.game.id));
      // Status fetched AFTER prices, so a game that starts during the odds request cannot sneak in.
      const odds = await json(espnOddsUrl(sport, String(entry.game.id)));
      const event = eventState(await json(url)), observedAt = new Date().toISOString();
      const rawPrices = odds.items?.find((x: Json) => String(x.provider?.id) === '100') ?? odds.items?.[0] ?? {};
      const c = makeCapture({ sport, entry, publishedAt: blob.generated, sourceUrl, sourceHash, rawPrices, event,
        observedAt, collectorSha: process.env.VERCEL_GIT_COMMIT_SHA });
      observations.push({sport,gameId:entry.game.id,status:c ? 'eligible' : 'excluded', eventState:event.status,
        reason:c ? undefined : 'Outside timing/status/freshness/identity/price contract'});
      if (!c) continue;
      const stored = dryRun ? c : await store.create(c);
      if (!dryRun && !validCapture(stored)) throw new Error(`Late or invalid persisted capture ${id}`);
      captures.push(stored); existing.set(id,stored);
    }
    // Coverage: completed games without a saved forecast are explicit misses, never backfilled wins.
    for (const result of blob.backtest?.results ?? []) {
      const kick = Date.parse(result.gameTime);
      if (kick > started || kick < started-864e5 || existing.has(modelId(sport,String(result.gameId)))) continue;
      observations.push({sport,gameId:String(result.gameId),status:'missed',reason:'No immutable pregame forecast'});
    }
  }
  for (const c of existing.values()) {
    if (Date.now()-started>240000) throw new Error('Measurement run exceeded safe time budget');
    if (settled.has(c.id) || Date.parse(c.commence) > Date.now() || !validCapture(c)) continue;
    const url = eventUrl(c.sport,c.gameId), event = eventState(await json(url));
    const result = settle(c,event,url);
    if (result) settlements.push(dryRun ? result : await store.create(result));
    else observations.push({sport:c.sport,gameId:c.gameId,status:'pending-final',eventState:event.status});
  }
  const run = { ok:true, dryRun, updated:new Date().toISOString(), ms:Date.now()-started,
    captured:captures.length, settled:settlements.length, observations };
  if (!dryRun) await store.heartbeat(run);
  return {...run, captures, settlements};
}
