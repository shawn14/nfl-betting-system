import { createHash } from 'node:crypto';
import type { Json } from './core.ts';

export interface SourceCheck {
  url: string; status: number; contentType: string; elapsedMs: number;
  bytes: number; sha256: string; errorPreview?: string;
}
export class SourceFailure extends Error {
  check: SourceCheck;
  constructor(check: SourceCheck) {
    super(`Measurement source HTTP ${check.status} (${check.contentType}): ${check.url}`);
    this.check = check;
  }
}

/** One request, no retry/fallback. Retain enough evidence to explain a failed source hop. */
export async function readSource(url: string): Promise<{ data: Json; check: SourceCheck }> {
  const started = Date.now();
  const response = await fetch(url, { cache:'no-store', redirect:'error', signal:AbortSignal.timeout(15000) });
  const chunks: Uint8Array[] = []; let bytes = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`Empty source body: ${url}`);
  while (true) {
    const part = await reader.read(); if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 2_000_000) { await reader.cancel(); throw new Error(`Source exceeds 2MB bound: ${url}`); }
    chunks.push(part.value);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const check: SourceCheck = { url, status:response.status, contentType:response.headers.get('content-type') ?? '',
    elapsedMs:Date.now()-started, bytes, sha256:createHash('sha256').update(raw).digest('hex') };
  if (!response.ok || !check.contentType.toLowerCase().includes('json')) {
    check.errorPreview = raw.slice(0,1500).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
    throw new SourceFailure(check);
  }
  try { return { data:JSON.parse(raw), check }; }
  catch { throw new SourceFailure({...check,errorPreview:'Response declared JSON but failed JSON parsing'}); }
}
