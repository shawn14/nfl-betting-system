import { NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';
import { gzipSync } from 'zlib';
import { snapshotNflLadders, stampParts, SNAPSHOT_COLS } from '@/lib/kalshi-props';

// Props watch, Kalshi side. Every 5 minutes: snapshot every open NFL prop ladder (plus game/spread/
// total for reference) into one gzipped JSON under kalshi-props/snap/<day>/<HHMM>.json.gz, refresh
// kalshi-props/latest.json.gz, and rebuild kalshi-props/index.json from the Blob listing (the listing
// is authoritative; the index is a convenience for offline readers). No auth needed on the Kalshi side.

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PREFIX = 'kalshi-props';

async function rebuildIndex(): Promise<number> {
  const entries: Array<{ path: string; size: number; uploadedAt: string }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < 40; page++) {
    const res = await list({ prefix: `${PREFIX}/snap/`, limit: 1000, cursor });
    for (const b of res.blobs) entries.push({ path: b.pathname, size: b.size, uploadedAt: b.uploadedAt.toISOString() });
    if (!res.hasMore || !res.cursor) break;
    cursor = res.cursor;
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  await put(`${PREFIX}/index.json`, JSON.stringify({ updated: new Date().toISOString(), count: entries.length, snapshots: entries }), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
  });
  return entries.length;
}

export async function GET() {
  const started = Date.now();
  try {
    const { rows, counts, failed } = await snapshotNflLadders();
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'no rows captured', failed }, { status: 502 });
    }
    const { day, hhmm, iso } = stampParts();
    const payload = { ts: iso, source: 'kalshi public trade-api/v2', cols: SNAPSHOT_COLS, counts, failed, rows };
    const gz = gzipSync(Buffer.from(JSON.stringify(payload)));
    const path = `${PREFIX}/snap/${day}/${hhmm}.json.gz`;
    const opts = { access: 'public' as const, contentType: 'application/gzip', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 };
    const blob = await put(path, gz, opts);
    await put(`${PREFIX}/latest.json.gz`, gz, opts);
    const indexed = await rebuildIndex();
    return NextResponse.json({ ok: true, path, url: blob.url, rows: rows.length, bytes: gz.length, counts, failed, indexed, ms: Date.now() - started });
  } catch (error) {
    console.error('kalshi-props-record failed:', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
