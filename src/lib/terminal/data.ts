import { createHash } from 'node:crypto';
import { BLOB_BASE,FILES } from '../measurement/runner.ts';
import { normalizeTerminal,TERMINAL_SPORTS,type Source } from './core.ts';
const BOARD_URL=`${BLOB_BASE}/odds-board/latest.json`;
async function source(sport:string,url:string):Promise<Source> {
 try {
  const response=await fetch(url,{next:{revalidate:300},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  if(Number(response.headers.get('content-length'))>8*1024*1024)throw new Error('Source exceeds 8 MiB limit');
  const bytes=await response.text();if(Buffer.byteLength(bytes)>8*1024*1024)throw new Error('Source exceeds 8 MiB limit');
  return {sport,url,hash:createHash('sha256').update(bytes).digest('hex'),fetchedAt:new Date().toISOString(),data:JSON.parse(bytes)};
 }catch(error){return {sport,url,hash:'',fetchedAt:new Date().toISOString(),data:null,error:error instanceof Error?error.message:'Read failed'};}
}
export async function loadTerminalSources(){
 const all=await Promise.all([...TERMINAL_SPORTS.map(sport=>source(sport,`${BLOB_BASE}/${FILES[sport]}`)),source('board',BOARD_URL)]);
 return {sources:all.slice(0,5),board:all[5]};
}
export async function loadTerminal(){const {sources,board}=await loadTerminalSources();return normalizeTerminal(sources,board);}
export async function terminalEvidence(id:string){
 const {sources,board}=await loadTerminalSources();const projected=normalizeTerminal(sources,board),game=projected.games.find(g=>g.id===id);
 if(!game)return null;
 const source=sources.find(s=>s.sport===game.sport)!;
 return {kind:'research-export',exportedAt:new Date().toISOString(),notice:'Current research observation, not a placed bet or immutable pregame measurement. The raw forecast entry includes legacy liveOdds without provider event identity; those nested prices are unverified and excluded from displayed prices.',game,
  forecastSource:{url:source.url,sha256:source.hash,publishedAt:source.data!.generated,readAt:source.fetchedAt},
  exactPublishedEntry:source.data!.games.find((x:{game:{id:string}})=>String(x?.game?.id)===game.gameId),
  marketSource:{url:board.url,sha256:board.hash,observedAt:game.marketAt,readAt:board.fetchedAt},
  exactBoardEvent:game.marketEventId?board.data?.sports?.[game.sport]?.events?.find((x:{id:string})=>x?.id===game.marketEventId):null};
}
