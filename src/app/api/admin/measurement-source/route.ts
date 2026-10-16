import { NextResponse } from 'next/server';
import { diagnoseSource } from '@/lib/measurement/diagnose';
import { SPORTS, type Sport } from '@/lib/measurement/core';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({error:'Unauthorized'},{status:401});
  const params = new URL(request.url).searchParams, sport = params.get('sport') as Sport, id = params.get('event') ?? '';
  if (!SPORTS.includes(sport) || !/^\d{6,12}$/.test(id)) return NextResponse.json({error:'Explicit sport and ESPN event required'},{status:400});
  const result = await diagnoseSource(sport,id);
  return NextResponse.json(result,{status:result.ok ? 200 : 502,headers:{'Cache-Control':'no-store'}});
}
