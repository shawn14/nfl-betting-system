import { digest, eventState, makeCapture, SPORTS, type Sport } from './core.ts';
import { BLOB_BASE, FILES, eventUrl } from './runner.ts';
import { espnOddsUrl } from '../espn-prices.ts';
import { readSource, SourceFailure, type SourceCheck } from './source.ts';

/** Fixed public sources only. No storage imports, credentials, writes, model runs or paid calls. */
export async function diagnoseSource(sport: Sport, id: string) {
  if (!SPORTS.includes(sport) || !/^\d{6,12}$/.test(id)) throw new Error('Invalid sport or ESPN event id');
  const checks: SourceCheck[] = [];
  const read = async (url: string) => { const result = await readSource(url); checks.push(result.check); return result.data; };
  const base = { checkedAt:new Date().toISOString(), sport, eventId:id,
    sourceSha:process.env.VERCEL_GIT_COMMIT_SHA ?? 'local-unreleased', region:process.env.VERCEL_REGION ?? 'local',
    scope:'Read-only source diagnosis; no evidence writes or collector execution' };
  try {
    const sourceUrl = `${BLOB_BASE}/${FILES[sport]}`, blob = await read(sourceUrl);
    const entry = blob.games?.find((x: any) => String(x.game?.id) === id);
    const odds = await read(espnOddsUrl(sport,id));
    const event = eventState(await read(eventUrl(sport,id))), observedAt = new Date().toISOString();
    const rawPrices = odds.items?.find((x: any) => String(x.provider?.id) === '100') ?? odds.items?.[0] ?? {};
    const candidate = entry ? makeCapture({sport,entry,publishedAt:blob.generated,sourceUrl,sourceHash:digest(blob),
      rawPrices,event,observedAt,collectorSha:process.env.VERCEL_GIT_COMMIT_SHA}) : null;
    return {...base,ok:true,checks,event,publishedAt:blob.generated,entryFound:!!entry,
      providers:(odds.items ?? []).map((x: any) => x.provider),candidate};
  } catch (error) {
    if (error instanceof SourceFailure) checks.push(error.check);
    return {...base,ok:false,checks,error:error instanceof Error ? error.message : String(error)};
  }
}
