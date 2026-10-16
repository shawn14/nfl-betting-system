import { NextResponse } from 'next/server';
import { terminalEvidence } from '@/lib/terminal/data';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const id=new URL(request.url).searchParams.get('id')??'';
 if(!/^(nfl|nba|nhl|cbb|wnba):\d{1,16}$/.test(id))return NextResponse.json({error:'Invalid game identity'},{status:400});
 const params=new URL(request.url).searchParams,forecastHash=params.get('forecastHash'),marketHash=params.get('marketHash');
 if(!/^[a-f0-9]{64}$/.test(forecastHash??'')||!/^([a-f0-9]{64})?$/.test(marketHash??''))return NextResponse.json({error:'Expected source versions are required'},{status:400});
 const evidence=await terminalEvidence(id);
 if(!evidence)return NextResponse.json({error:'Game is no longer in the current pregame source. No historical forecast was substituted.'},{status:404});
 if(evidence.game.sourceHash!==forecastHash||evidence.game.marketSourceHash!==(marketHash??''))return NextResponse.json({error:'Source changed. Refresh the terminal before exporting.'},{status:409});
 return NextResponse.json(evidence,{headers:{'Content-Disposition':`attachment; filename="prediction-matrix-${id.replace(':','-')}.json"`,'Cache-Control':'no-store'}});
}
