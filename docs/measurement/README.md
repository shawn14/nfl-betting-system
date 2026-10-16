# Prospective measurement — release candidate, 2026-10-16

**PR6 is deployed; the approved activation failed on a deployed ESPN HTTP503 before any capture, and rollback was independently verified. Collection remains off. No demonstrated edge.** [Activation incident](activation/README.md). [Release evidence](../production/README.md). Model parameters, `MODEL_VERSION`, probability transforms, blending weights and shopping thresholds are unchanged. The historical results were generated after games and cannot establish forward performance. The [audit](../reports/2026-10-15-edge-audit/edge-audit.html) explains the contamination.

## Frozen measurement contract

- One model record per sport/game: the first eligible public forecast in the final **72 hours**, at least **two minutes before scheduled start**. Store the exact public entry (forecast and published inputs), publication time, source hash/URL, current ESPN bookmaker prices/lines, provider, independently fetched ESPN scheduled status, published producer model version/source SHA when present, and a separate collector SHA. Missing producer provenance remains unknown; never substitute the collector version. Forecast publication must be at most three hours old. Missing markets are excluded; never substitute open/close prices or invented −110.
- Firestore's server creation time must precede the deadline. `MeasurementStore.create` uses a read-before-set transaction; repeat and concurrent runs retain the first record. The application exposes no update/delete path for evidence. This is application immutability, not cryptographic protection from a database administrator.
- The grader reads only that saved record and authoritative final scores for the same event/team IDs. No predictor or legacy `results` input is used. Exact saved side/line/price determines one-unit paper returns. Pushes return zero; equal forecasts make no pick. Schedule changes/cancellations are void. Missing captures cannot be backfilled.
- Producer version/source cohorts remain separate, derived from the immutable raw forecast entry. Older capture headers cannot attribute an unstamped forecast; unknown cohorts are descriptive only. [Provenance correction and proof](provenance/README.md).
- Model evaluation reports **every eligible directional forecast**, separately by sport and market, plus model-versus-market log loss. It does not retroactively select high-conviction subsets or use an historical filter to claim a betting edge. The original flags remain in the exported forecast for later preregistered analysis.
- Price shopping is a separate experiment. First flag per event/market/exact line/side/book; a valid close must be a later observation in the final **60 minutes**, persisted before kickoff. The reference book quotes must have updated after entry and be no more than 15 minutes old. Exclude the flagged book; require Pinnacle or four distinct other books. No same-snapshot closes, duplicate books or line substitutions.
- Game lines and player props are separate. Intervals cluster repeated flags by game. CLV is probability points, **not realized profit**. No wager execution, fill, stake limit or slippage is claimed. ESPN does not supply a bookmaker update timestamp: `priceObservedAt` is explicitly an observation, and `priceSourceUpdatedAt` remains null.

## Runtime and storage

`FEATURE_MEASUREMENT_ENABLED=1` enables the new collector and shopping writes. Default is off. `GET /api/cron/measurement` requires `Authorization: Bearer CRON_SECRET`, runs at minutes 12/27/42/57, and uses free public blobs and ESPN. `?dryRun=1` performs the real reads without writes. No paid odds requests originate in this collector.

Existing odds-board/props crons reuse their already-fetched payloads; existing request cadence and credit caps are unchanged. Both routes now require the cron bearer header for all requests. The paid-request state and existing output/index are persisted before measurement so its failure cannot cause a repeat purchase or hide an existing output. Retained observation times still expire; slow batches are excluded, never relabeled fresh.

New evidence is in `predictionMeasurementsV1`; mutable model-collector health is in `predictionMeasurementsV1Health/latest`. Legacy records are preserved and excluded. The model heartbeat is **not** a health claim for the paid shopping collectors. Their own route responses/logs must be checked. A last-run `missed` count covers completed games seen in the source's last 24 hours; initial commissioning can include pre-launch games and it is not an all-time coverage denominator.

The bounded pilot fails visibly at 2,000 records of each model/settlement/shop kind, or 12,000 closing observations. It never truncates a performance sample. **Before reaching a ceiling, add an explicit archival/reporting partition with continuity proof; do not delete old evidence or silently reset a favorable sample.** This release does not claim indefinite retention at constant cost. The page summary is shared/cached for five minutes; the raw JSON evidence export has a five-minute CDN cache. Failures show unavailable, not zero performance.

## Proof and limits

Commands, run from the repo on Node 22.18+:

```bash
npm run test:measurement
npm run test:measurement:live
node scripts/measurement/local-ui.mjs
PM_HTTP_BASE=http://127.0.0.1:3307 node scripts/measurement/prove-http.mjs
npx tsc --noEmit
node scripts/measurement/release-check.mjs
```

`test:measurement:live` reads the existing Vercel Firebase credential into memory and uses a unique `predictionMeasurementProof_*` collection. It does not invoke production crons, call paid odds endpoints, modify customer rows or active measurement records. It cleans only its reserved collection in `finally`. Run the live proof during an eligible pregame window; absence of a real candidate is a failure, not permission to fabricate one.

Observed proof on October 16 UTC:

- Real NFL event **401872996**, DraftKings, **3 markets**, committed at **02:25:15.541**, before October 18 13:30 kickoff. Concurrent create, later forecast/price rewrite attempt and second collection retained the same record. Late server commits and in-progress settlement were rejected. [Saved evidence](proof/live.json).
- Independent context repeated real Firestore capture at **02:27:26**, verified original `updateTime`, concurrent first-writer convergence and a separate-reader round trip, then verified zero test records remain.
- Offline diagnostics run production candidate functions on captured real WNBA prices and two real NHL entry/close pairs. Boundary score/clock mutations are explicitly test-only; they are not prospective performance or deployed settlement proof. Both NHL closes retain their negative CLV (−1.551pp), and duplicate-book consensus is rejected.
- All five results pages, FAQ, About and current-price page returned 200 on the real local Next server. The three unauthenticated collector requests returned 401 before any paid work. Desktop and 390px mobile browser inspection passed: [desktop](proof/results-desktop.png), [mobile](proof/results-mobile.png).
- TypeScript check passed. No full local production build: repo runbook reserves that gate for the Vercel preview. Production collection/authentication, enabled scorecard rendering, and settlement after an actually captured game finishes remain unverified. The approved preview subsequently passed all five result routes and unauthorized collector gates; see [preview proof](../preview/README.md).

**SDK gotcha:** with firebase-admin 12.7 / `preferRest`, `doc.create()` on an existing document retried ALREADY_EXISTS for 600 seconds. Do not restore that path. Read-before-set transactions with three attempts passed concurrent and repeated real-service proofs.

## Release procedure — main and paper activation approved; verify actual state

Canonical pipeline is a pushed branch → Vercel preview → merge into clean current main → automatic production deploy. Do not run `vercel --prod` from a local checkout. Shawn approved the review branch, Vercel preview and one reserved provenance test on October15CT. Shawn subsequently requested “push to main” on October 16; [PR6](https://github.com/shawn14/nfl-betting-system/pull/6) merged as `69240a9`. Shawn subsequently replied “approval” to the explicit paper-activation request. [Preview proof/runbook](../preview/README.md).

1. Run `node scripts/measurement/release-check.mjs`. It reads the serving domain mapping and deployment SHA, freshly reads GitHub main, checks required environment names, and inspects the public measurement endpoint. Stop on drift or missing credentials. At 02:34 UTC main and the READY production alias both equaled `6af083c277aa64fd13ec9269591fc57bdd611f68`; the feature flag did not exist.
2. After approval, push the integrated `codex/prediction-terminal` branch, open a PR, and require its Vercel preview build and real page/auth checks to pass. Keep collection disabled on preview; do not attach paid cron triggers to a preview. Stop on the first infrastructure failure or code mismatch.
3. Merge through GitHub after fresh-main reconciliation. Production automatically deploys that merged SHA. Set the production-only `FEATURE_MEASUREMENT_ENABLED=1` before this deployment only if activation was included in Shawn's approval. Verify `CRON_SECRET` remains configured; the stricter bearer checks must match Vercel Cron's configured secret.
4. Verify `node scripts/measurement/release-check.mjs --expect-live <merged-main-sha>`. After the first scheduled run, add `--require-enabled` to require an available report and a successful heartbeat under 45 minutes old. Inspect saved records: provider, exact forecast and lines, commit before deadline, and second-run unchanged values. Observe existing shopping cron success without manually forcing a paid request.
5. After the first captured game finishes, compare its immutable capture, actual final ESPN result, settlement and public table. Use a fresh refuter. This is the remaining real postgame proof; a replay cannot replace it. Keep “no demonstrated edge” until sufficient independent prospective games support a justified claim.

Rollback: set the flag to `0` and redeploy the **same GitHub main SHA** through the existing Vercel integration, then verify the serving SHA and disabled endpoint. Preserve evidence. Do not restore the misleading historical performance pages. No model tuning belongs in this release.

Read-only production checks reuse the existing suites with an explicit full deployed SHA. The guard requires the canonical domain/project, READY state, exact GitHub main/source match, and disabled measurement before making unsigned HTTP requests.

```sh
PM_HTTP_BASE=https://www.predictionmatrix.com PM_EXPECT_LIVE_SHA=<full-current-main-sha> node scripts/terminal/prove-http.mjs
PM_HTTP_BASE=https://www.predictionmatrix.com PM_EXPECT_LIVE_SHA=<full-current-main-sha> node scripts/measurement/prove-http.mjs
```

## Guarded activation and rollback operator

Run from the operator checkout; the primary checkout must remain clean on freshly verified GitHub main. This operator changes only the production measurement flag and asks Vercel to build that **same** GitHub main SHA. No local source upload, model change, cron invocation, paid odds request, evidence deletion or wager is performed. Its first-commissioning gate requires a real nonempty, fresh NFL forecast set with declared producer attribution; do not use an empty refresh to clear it.

```sh
node --no-warnings scripts/measurement/activate.mjs --sha <full-current-main-sha> --value 1
# With explicit activation approval, and only after readiness is true:
node --no-warnings scripts/measurement/activate.mjs --sha <full-current-main-sha> --value 1 --apply --receipt <new-absolute-json-path>
# Approved rollback: same guarded command, --value 0 and a new receipt path.
```

The receipt records each mutation boundary. A failure after `env-write-pending` or `deployment-request-pending` can have changed state: inspect the actual env/deployment and receipt before another action. Do not blindly rerun an ambiguous write. A READY response is accepted only when the canonical domain owns that exact deployment and its public report reflects the requested flag. First/second collector runs are separate proof.

`inspect-production.mjs` reads only the two production measurement collections using the existing Vercel credential in memory. It saves every evidence body with Firestore creation/update timestamps and a canonical hash; no SDK install is needed. It also reads the public report.

```sh
node --no-warnings scripts/measurement/inspect-production.mjs --sha <full-current-main-sha> --require-enabled --out <new-first-run-json>
node --no-warnings scripts/measurement/inspect-production.mjs --sha <full-current-main-sha> --require-enabled --out <new-second-run-json> --compare <first-run-json>
```

Enabled proof requires a fresh successful real-run heartbeat, nonzero NFL captures, exact producer/collector SHA and model version, and public evidence matching the database. The second read additionally requires a later server heartbeat update and unchanged prior evidence IDs, hashes, creation and update times. Inspect price identity and verify the enabled browser pages. A collector heartbeat does not prove shopping collectors or final settlement. The first real captured final game still needs a separate end-to-end comparison and independent review.
