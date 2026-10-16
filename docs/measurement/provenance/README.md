# Forecast producer provenance — local candidate, October 16

The measurement candidate assigned its own installed `MODEL_VERSION` to every captured forecast. All 82 archived public forecast entries lacked a producer stamp. A real WNBA forecast reproduced the failure: expected unknown producer, received `2026-09-11-freeze`. The independent reviewer confirmed the same mismatch in the actual NFL Firestore capture saved at 02:25:15.541 UTC. Neither a collector version nor an old result-row stamp identifies the producer of a saved forecast.

The local repair adds `forecastProducer` to each of the five writers' published prediction objects: schema, declared model version and deployment source SHA (null when absent/invalid). The collector copies only that published metadata. The report derives provenance from the immutable raw entry, never from older collector-supplied header labels. Existing unstamped captures therefore remain unknown without rewriting any evidence.

Results are grouped by sport, market, full declared model version and full source SHA. Same version/different source commits remain separate; so do different versions on the same source. The UI displays version/source and the count without full attribution. Unknown cohorts are descriptive only and cannot justify a model promotion. Grouping is a single pass over bounded pilot rows; it does not repeatedly scan all captures per cohort. The cache key was revised for the new report shape.

No prediction constants, model formulas, probabilities, thresholds or prices change. A producer stamp is evidence of what the writer declared, not a prospective timestamp or proof of deployed source. Existing immutable server-time requirements still apply.

## Verification

- Red then green regression on actual archived WNBA forecast/ESPN inputs. Exhaustive source inventory: 82 entries (14 NFL,16 NBA,49 NHL,3 WNBA,0 CBB), all unstamped.
- Read-only current public proof at 04:12:57 UTC on NFL401872996: producer version/source both null, three real markets retained, no database commit. The uncommitted output correctly fails eligibility for performance reporting. [Receipt](public-read.json).
- Independent replay of the actual earlier Firestore capture: old version header ignored, raw entry remains unknown, three original markets/prices unchanged. 23 malformed metadata cases and7 diagnostic cohorts/21market rows passed. [Review](independent-review.md).
- TypeScript and provenance, measurement, odds-identity and terminal proofs passed. Metadata/score mutations are test-only diagnostics, never prospective wins or production data.
- **New real-storage proof was not run.** Automatic approval review rejected creating/deleting a reserved Firestore collection with production credentials as outside the local-only scope. No mutation occurred. The test is saved for explicit approval; no retry or alternate write path was used.
- Deployed writer metadata, persistence of the new fields, enabled browser rows and real postgame settlement remain unverified. CBB has no observed forecast sample. No full production build was run; preview remains the release gate.

## Commands

```sh
npm run test:measurement:provenance
node scripts/measurement/prove-provenance-public.mjs  # three public GETs, no credentials/writes
npx tsc --noEmit --incremental false
npm run test:measurement
npm run test:odds:identity
npm run test:terminal
```

After explicit authorization for the reserved Firestore test only:

```sh
npm run test:measurement:provenance:live
```

It reuses the existing Vercel credential wrapper, writes one real pregame capture in a unique `predictionMeasurementProof_provenance_*` collection, verifies exact producer preservation/second-reader reporting and first-writer immutability, and confirms both reserved collection/health paths are empty during cleanup. It never touches active measurement/customer collections, invokes a cron, calls paid odds endpoints or fabricates a settlement. This description is not authorization.

## Release and next decision

Read-only preflight at04:12:58 UTC: GitHub main and READY production both `6af083c277aa64fd13ec9269591fc57bdd611f68`; measurement absent, flag not configured. [Receipt](release-preflight.json). Local branch `codex/prediction-terminal` includes all audit/measurement/terminal/odds/provenance work; publish this integrated branch after approval, not the older measurement-only branch.

Next required gates: explicit publication/preview approval, reserved-storage proof approval, authenticated enabled-state UI verification, then separately approved main deployment/measurement activation. After real scheduled captures and outcomes, verify the actual settlement and accumulate independent prospective evidence before proposing a challenger or model promotion. A better terminal and cleaner measurement cannot establish better picks by themselves.
