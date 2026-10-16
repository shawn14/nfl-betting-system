/** Prospective measurement only. Never accepts a legacy result as a forecast. */
import { createHash } from 'node:crypto';
import { americanToDecimal, devigTwoWay, probHomeCovers, probOver, RESULT_SIGMA } from '../fair-value.ts';
import { parseEspnPrices, espnOddsUrl } from '../espn-prices.ts';
import type { PriceSnapshot } from '../espn-prices.ts';
import { publishedProducer } from '../forecast-provenance.ts';

export const MEASUREMENT_VERSION = '2026-10-16-v1';
export const CAPTURE_HOURS = 72;
export const SAFETY_MS = 120_000;
export const SPORTS = ['nfl', 'nba', 'nhl', 'cbb', 'wnba'] as const;
export type Sport = typeof SPORTS[number];
export type Market = 'ml' | 'spread' | 'total';
export type Json = Record<string, any>; // Raw upstream JSON is retained, not reconstructed.
// Firestore and JSON clients may reorder map fields. Object order is not evidence identity.
const canonical = (value: unknown): unknown => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical((value as Json)[k])]))
  : value;
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const modelId = (sport: Sport, gameId: string) => `model-${sport}-${gameId}`;
export const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const price = (n: unknown): n is number => finite(n) && Math.abs(n) >= 100;

export interface EventState {
  id: string; commence: string; state: string; status: string; completed: boolean;
  homeId: string; awayId: string; homeScore: number | null; awayScore: number | null;
}
export function eventState(raw: Json): EventState {
  const header = raw.header ?? raw;
  const c = header.competitions?.[0];
  if (!c?.status?.type || !header.id) throw new Error('Missing ESPN event status');
  const home = c.competitors?.find((x: Json) => x.homeAway === 'home');
  const away = c.competitors?.find((x: Json) => x.homeAway === 'away');
  if (!home?.id || !away?.id || !Number.isFinite(Date.parse(c.date))) throw new Error('Invalid ESPN identity/date');
  const score = (v: unknown) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
  return { id: String(header.id), commence: c.date, state: c.status.type.state, status: c.status.type.name,
    completed: c.status.type.completed === true, homeId: String(home.id), awayId: String(away.id),
    homeScore: score(home.score), awayScore: score(away.score) };
}
export interface FrozenMarket {
  market: Market; line?: number; priceA: number; priceB: number;
  side: 'a' | 'b' | null; modelA: number; marketA: number;
}
export interface ModelCapture {
  id: string; kind: 'model'; version: string; modelVersion: string | null; modelSourceSha: string | null; collectorSha: string;
  sport: Sport; gameId: string; commence: string; capturedAt: string; deadline: string;
  publishedAt: string; sourceUrl: string; sourceHash: string;
  entry: Json; status: EventState; rawPrices: Json; provider: string; prices: PriceSnapshot;
  priceObservedAt: string; priceSourceUpdatedAt: null; // ESPN supplies no upstream quote timestamp.
  markets: FrozenMarket[]; missingMarkets: Market[];
  committedAt?: string;
}

export function makeCapture(input: { sport: Sport; entry: Json; publishedAt: string; sourceUrl: string;
  sourceHash: string; rawPrices: Json; event: EventState; observedAt: string; now?: number; collectorSha?: string }): ModelCapture | null {
  const { sport, entry, event, observedAt } = input;
  const now = input.now ?? Date.now(), kick = Date.parse(entry.game?.gameTime), pub = Date.parse(input.publishedAt);
  const observed = Date.parse(observedAt), g = entry.game, pred = entry.prediction;
  if (!g || !pred || !Number.isFinite(kick) || kick - now <= SAFETY_MS || kick - now > CAPTURE_HOURS * 36e5) return null;
  if (!Number.isFinite(pub) || pub > observed || now - pub > 3 * 36e5 || observed > now || now - observed > SAFETY_MS) return null;
  if (g.status !== 'scheduled' || event.state !== 'pre' || event.status !== 'STATUS_SCHEDULED' || event.completed) return null;
  if (event.id !== String(g.id) || event.homeId !== String(g.homeTeamId) || event.awayId !== String(g.awayTeamId)
      || Date.parse(event.commence) !== kick) return null;
  if (String(pred.gameId) !== String(g.id)) return null;
  // Bind the returned odds payload, not only the requested URL, to this event and both teams.
  try {
    const expected = new URL(espnOddsUrl(sport,String(g.id))).pathname;
    const reference = (value: unknown) => {
      if (typeof value !== 'string') throw new Error('Missing ESPN identity');
      const url = new URL(value);
      if (!['http:','https:'].includes(url.protocol) || url.hostname !== 'sports.core.api.espn.com') throw new Error('Unexpected ESPN identity');
      return url.pathname;
    };
    if (reference(input.rawPrices.$ref) !== `${expected}/${input.rawPrices.provider?.id}`) return null;
    const prefix = expected.split('/events/')[0]+'/';
    for (const [side,id] of [['home',event.homeId],['away',event.awayId]]) {
      const team = reference(input.rawPrices[`${side}TeamOdds`]?.team?.$ref);
      if (!team.startsWith(prefix) || !team.endsWith(`/teams/${id}`)) return null;
    }
  } catch { return null; }
  if (![pred.predictedHomeScore, pred.predictedAwayScore, pred.predictedSpread, pred.predictedTotal, pred.homeWinProbability].every(finite)
      || pred.homeWinProbability < 0 || pred.homeWinProbability > 1) return null;
  const parsed = parseEspnPrices(input.rawPrices);
  if (!parsed || parsed.provider === 'unknown') return null;
  const p = parsed.current; // Never fall back to open/close or manufacture -110.
  const markets: FrozenMarket[] = [];
  const add = (market: Market, a: unknown, b: unknown, modelA: number, line?: number, direction = modelA - 0.5) => {
    if (!price(a) || !price(b)) return;
    markets.push({ market, ...(line === undefined ? {} : { line }), priceA: a, priceB: b,
      side: direction === 0 ? null : direction > 0 ? 'a' : 'b', modelA,
      marketA: devigTwoWay(a, b, market === 'ml' ? 'power' : 'multiplicative') });
  };
  add('ml', p.mlHome, p.mlAway, pred.homeWinProbability);
  if (finite(p.spreadLine)) add('spread', p.spreadHomePrice, p.spreadAwayPrice,
    probHomeCovers(pred.predictedSpread, p.spreadLine, RESULT_SIGMA[sport].margin), p.spreadLine, p.spreadLine - pred.predictedSpread);
  if (finite(p.totalLine) && p.totalLine > 0) add('total', p.overPrice, p.underPrice,
    probOver(pred.predictedTotal, p.totalLine, RESULT_SIGMA[sport].total), p.totalLine, pred.predictedTotal - p.totalLine);
  if (!markets.length) return null;
  return clean({ id: modelId(sport, String(g.id)), kind: 'model', version: MEASUREMENT_VERSION,
    modelVersion: publishedProducer(entry)?.modelVersion ?? null, modelSourceSha: publishedProducer(entry)?.sourceSha ?? null, collectorSha: input.collectorSha ?? 'local-unreleased', sport, gameId: String(g.id),
    commence: new Date(kick).toISOString(), deadline: new Date(kick - SAFETY_MS).toISOString(),
    capturedAt: new Date(now).toISOString(), publishedAt: input.publishedAt, sourceUrl: input.sourceUrl,
    sourceHash: input.sourceHash, entry, status: event, rawPrices: input.rawPrices, provider: parsed.provider,
    prices: p, priceObservedAt: observedAt, priceSourceUpdatedAt: null, markets,
    missingMarkets: (['ml','spread','total'] as Market[]).filter(m => !markets.some(x => x.market === m)) });
}
export function validCapture(c: ModelCapture): boolean {
  return c.kind === 'model' && c.version === MEASUREMENT_VERSION && !!c.committedAt
    && Date.parse(c.committedAt) <= Date.parse(c.deadline)
    && Date.parse(c.capturedAt) <= Date.parse(c.committedAt)
    && Date.parse(c.publishedAt) <= Date.parse(c.capturedAt);
}
export interface Grade {
  market: Market; side: 'a' | 'b' | null; line?: number; price?: number;
  result: 'win' | 'loss' | 'push' | 'no-pick'; units: number;
  modelBrier?: number; marketBrier?: number; modelLogLoss?: number; marketLogLoss?: number;
}
export interface Settlement {
  id: string; kind: 'settlement'; captureId: string; captureHash: string; sport: Sport; gameId: string;
  settledAt: string; status: 'final' | 'void'; reason?: string; event: EventState; sourceUrl: string; grades: Grade[];
  committedAt?: string;
}
const logLoss = (p: number, y: number) => -(y * Math.log(Math.max(1e-12, p)) + (1-y) * Math.log(Math.max(1e-12, 1-p)));
export function settle(c: ModelCapture, event: EventState, sourceUrl: string, now = Date.now()): Settlement | null {
  if (!validCapture(c) || event.id !== c.gameId || event.homeId !== c.status.homeId || event.awayId !== c.status.awayId) return null;
  if (now < Date.parse(c.commence)) return null;
  let reason: string | undefined;
  if (Date.parse(event.commence) !== Date.parse(c.commence)) reason = 'Schedule changed: original market not assumed to carry over';
  if (/CANCELED|POSTPONED/.test(event.status)) reason = event.status;
  if (!reason && (!event.completed || event.state !== 'post' || !/FINAL/.test(event.status))) return null;
  if (!reason && (event.homeScore === null || event.awayScore === null || event.homeScore < 0 || event.awayScore < 0)) return null;
  const grades: Grade[] = reason ? [] : c.markets.map(m => {
    const h = event.homeScore!, a = event.awayScore!;
    const delta = m.market === 'ml' ? h - a : m.market === 'spread' ? h - a + m.line! : h + a - m.line!;
    const y = delta > 0 ? 1 : 0;
    const px = m.side === 'a' ? m.priceA : m.side === 'b' ? m.priceB : undefined;
    const result = m.side === null ? 'no-pick' : delta === 0 ? 'push' : (m.side === 'a') === (delta > 0) ? 'win' : 'loss';
    return clean({ market: m.market, line: m.line, side: m.side, price: px, result,
      units: result === 'win' ? americanToDecimal(px!) - 1 : result === 'loss' ? -1 : 0,
      ...(delta === 0 ? {} : { modelBrier: (m.modelA-y)**2, marketBrier: (m.marketA-y)**2,
        modelLogLoss: logLoss(m.modelA,y), marketLogLoss: logLoss(m.marketA,y) }) });
  });
  return clean({ id: `settled-${c.id}`, kind: 'settlement', captureId: c.id, captureHash: digest(c),
    sport: c.sport, gameId: c.gameId, settledAt: new Date(now).toISOString(), status: reason ? 'void' : 'final', reason, event, sourceUrl, grades });
}

/** Cluster-robust SE for the flag-weighted mean; repeated flags never count as independent games. */
export function clustered(values: { game: string; value: number }[]) {
  const n = values.length, mean = n ? values.reduce((s,x) => s+x.value,0)/n : null;
  const groups = new Map<string, number>();
  for (const x of values) groups.set(x.game, (groups.get(x.game) ?? 0) + x.value - mean!);
  const games = groups.size;
  const se = games > 1 ? Math.sqrt(games/(games-1) * [...groups.values()].reduce((s,x) => s+x*x,0) / n**2) : null;
  return { n, games, mean, se, lo: se === null ? null : mean! - 1.96*se, hi: se === null ? null : mean! + 1.96*se };
}
