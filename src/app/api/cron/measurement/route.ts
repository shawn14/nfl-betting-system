import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { MeasurementStore } from '@/lib/measurement/store';
import { collect } from '@/lib/measurement/runner';
import { SourceFailure } from '@/lib/measurement/source';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({error:'Unauthorized'}, {status:401});
  if (process.env.FEATURE_MEASUREMENT_ENABLED !== '1') return NextResponse.json({enabled:false});
  const store = new MeasurementStore(getAdminDb());
  try { return NextResponse.json(await collect(store, new URL(request.url).searchParams.get('dryRun') === '1')); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.heartbeat({ok:false,updated:new Date().toISOString(),error:message,
      ...(error instanceof SourceFailure ? {sourceFailure:error.check} : {})});
    return NextResponse.json({ok:false,error:message}, {status:500});
  }
}
