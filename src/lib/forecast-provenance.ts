/** Producer identity travels with the forecast. The collector cannot supply it later. */
import { MODEL_VERSION } from './model-version.ts';
export interface ForecastProducer {
  schemaVersion: 'forecast-producer-v1';
  modelVersion: string;
  sourceSha: string | null;
}
const validSha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
export function forecastProducer(sourceSha: unknown): ForecastProducer {
  return { schemaVersion: 'forecast-producer-v1', modelVersion: MODEL_VERSION,
    sourceSha: validSha(sourceSha) ? sourceSha : null };
}
export function publishedProducer(entry: unknown): ForecastProducer | null {
  const value = (entry as { prediction?: { forecastProducer?: unknown } } | null)?.prediction?.forecastProducer;
  if (!value || typeof value !== 'object') return null;
  const p = value as Partial<ForecastProducer>;
  if (p.schemaVersion !== 'forecast-producer-v1' || typeof p.modelVersion !== 'string'
    || !p.modelVersion.length || p.modelVersion.length > 100 || p.modelVersion !== p.modelVersion.trim()) return null;
  return {schemaVersion:p.schemaVersion, modelVersion:p.modelVersion, sourceSha:validSha(p.sourceSha) ? p.sourceSha : null};
}
/** Old captures falsely stamped with collector MODEL_VERSION must stay in the unknown cohort. */
export function forecastCohort(entry: unknown) {
  const producer = publishedProducer(entry);
  const modelVersion = producer?.modelVersion ?? null, sourceSha = producer?.sourceSha ?? null;
  return { key:JSON.stringify([modelVersion,sourceSha]), modelVersion, sourceSha,
    attributed:modelVersion !== null && sourceSha !== null };
}
