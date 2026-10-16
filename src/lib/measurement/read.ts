import { unstable_cache } from 'next/cache';
import { getAdminDb } from '@/lib/firebase-admin';
import { MeasurementStore } from './store';
import { measurementReport } from './report';
const cachedSummary=unstable_cache(async()=>measurementReport(new MeasurementStore(getAdminDb())),['prediction-measurement-v1'],{revalidate:300});
export async function readMeasurement(includeEvidence=false) {
  if(process.env.FEATURE_MEASUREMENT_ENABLED!=='1') return {state:'disabled' as const,report:null};
  try { return {state:'available' as const,report:includeEvidence ? await measurementReport(new MeasurementStore(getAdminDb()),Date.now(),true) : await cachedSummary()}; }
  catch(error) { console.error('Measurement report unavailable',error); return {state:'unavailable' as const,report:null}; }
}
