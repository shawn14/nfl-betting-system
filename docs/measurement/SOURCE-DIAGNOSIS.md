# Diagnose the serving source before enabling collection

The October16 collector failed on ESPN odds HTTP503 and discarded the body. That proves a failed source hop, not the provider's reason. Do not infer a permanent block or add retries from a laptop success.

`/api/admin/measurement-source` is an authenticated, read-only diagnostic that remains available while paper collection is disabled. It performs one request each to the fixed sport forecast Blob, exact ESPN event odds, and exact ESPN event summary, in the collector's order. It stops at the first failure. It imports no database client, performs no writes, runs no model, and calls no paid source. It cannot accept an arbitrary URL. Response status, content type, bounded body hash/size, elapsed time and a bounded error-body excerpt accompany the actual serving source SHA/region. A successful candidate is transient; it is never a prospective record.

```sh
# Local real-source proof; cannot establish deployed reachability.
node scripts/measurement/diagnose.mjs --local --sport nfl --event 401872996 --out /tmp/local-source.json
# Actual domain owner, exact source/main, existing secret in memory, ONE read-only request.
node scripts/measurement/diagnose.mjs --sha <full-current-main-sha> --sport nfl --event 401872996 --out /tmp/deployed-source.json
```

The script refuses an existing output file before any request. On source failure it saves the actual response and exits nonzero. Do not retry blindly. The regular collector uses the same single-request source reader and preserves structured failure evidence in its failed heartbeat; no fallback price or retry was introduced. Reads are bounded to 2 MB per public source, so oversized responses fail visibly.

Local proof at 14:23 UTC on October16 received HTTP200 JSON from all three actual endpoints and produced three eligible markets forNFL 401872996. PR9 merged 60aab496; canonical deployment `dpl_8MkXdScgPeMcEou8BtcvsWBF3fjU` served that exact SHA. The actual deployed probe at 14:28:27 UTC from iad1 also returned 200 JSON for all three hops and three transient markets. A fresh independent probe at 14:28:58 UTC reproduced it. Actual flag 0, disabled public state, zero evidence records and the original failed heartbeat/server time remained unchanged. [Deployed receipt](source-diagnosis/deployed.json), [baseline](source-diagnosis/baseline.json), [independent proof](source-diagnosis/independent.json).

This proves current deployed reachability, not the cause or permanent resolution of the 06:02 UTC 503. The forecast producer 0743025 and collector 60aab496 remain correctly distinct; the normal writer must publish current-source forecasts before activation. No collector, paid call or storage mutation was used by either diagnostic.

The subsequent continuous research loop will reuse the Kalshi desk's preregistration, immutable forecast evidence, market comparison and explicit hypothesis status. It will use the existing measurement cadence; the frozen model, historical rejected challenger and live-money restrictions remain intact.
