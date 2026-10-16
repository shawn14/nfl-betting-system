import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEspnPrices, espnOddsUrl } from '../../../src/lib/espn-prices.ts';
const OUT=path.dirname(fileURLToPath(import.meta.url));
const REPO=path.resolve(OUT,'../../..');
let halted=false;
for (const sport of ['nfl','wnba','nhl']) {
 const stored=`${REPO}/data/price-history/${sport}.json`;
 const cache=fs.existsSync(stored)?JSON.parse(fs.readFileSync(stored,'utf8')):{};
 const rows=JSON.parse(fs.readFileSync(`${OUT}/${sport}.json`,'utf8')).backtest.results;
 const todo=rows.filter(r=>r.modelVersion && !(r.gameId in cache));
 let done=0;
 await Promise.all(Array.from({length:3},async()=>{
  while(todo.length&&!halted){
   const r=todo.shift();
   try{
    const response=await fetch(espnOddsUrl(sport,r.gameId),{signal:AbortSignal.timeout(25000)});
    if(response.status===404){cache[r.gameId]=null;continue;}
    if(!response.ok)throw Error(`${sport}/${r.gameId} HTTP${response.status}`);
    const json=await response.json();
    cache[r.gameId]=parseEspnPrices(json.items?.[0]);done++;
   }catch(e){halted=true;console.error(e.message);}
  }
 }));
 fs.writeFileSync(`${OUT}/${sport}-prices.json`,JSON.stringify(cache));
 console.log(JSON.stringify({sport,fetched:done,remaining:todo.length,halted,pricedFrozen:rows.filter(r=>r.modelVersion&&cache[r.gameId]).length,frozen:rows.filter(r=>r.modelVersion).length}));
 if(halted)break;
}
if(halted)process.exitCode=1;
