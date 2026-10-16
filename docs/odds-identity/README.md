# Exact-event observed odds — local repair candidate

All five sport writers previously accepted an Odds API event when either team name appeared in its key. They discarded provider identity and source quote clocks, and substituted missing prices with -110. Three real counterexamples were independently established: NHL 401892536 and 401892540 reused Pittsburgh–Colorado prices; WNBA 401918306 reused an earlier Atlanta–Golden State matchup. [Original evidence](../terminal/proof/independent-review.json).

The local repair routes all five writers through `src/lib/event-odds.ts`. Matching requires sport, both normalized full names in the correct roles, the identical start instant, and one unambiguous provider event ID. It preserves event identity, actual collection time, per-book provider update time and whether that clock belongs to the market or bookmaker. Missing/invalid prices, duplicate events/books, conflicting lines and future clocks are rejected. No -110 substitutions or averaged American odds remain. The optional summary total is a uniquely most common offered line, supported by at least two books; tied modes are unavailable.

The five live-page readers accept only the new identified schema and recheck identity and quote age. The existing terminal age policy applies: at most 150 minutes when kickoff is over six hours away, otherwise 45 minutes. Pages call them periodic observations and display the oldest retained source quote time. This does not make them executable live prices. Legacy blobs show no verified quote until a repaired writer publishes accepted data. The terminal's separate suppression of legacy per-book totals remains in place.

## Real-record proof

`npm run test:odds:identity` runs the actual production parser, matcher and reader against complete captured public provider responses and published forecasts. No paid API request, cron invocation, model tuning or production write is involved. Provider archives retain their URL, retrieval time, original collector time and compressed-response hash under `proof/`.

| Evidence | Observed result |
|---|---:|
| Provider events / valid per-book totals | 22 / 200, all retained exactly |
| Forecast games evaluated | 66 |
| Exact accepted joins | 13 (12 NFL, 1 WNBA) |
| Withheld forecasts | 53 |
| Legacy quote objects rejected | 46 |
| Confirmed wrong-game regressions withheld | 3 |

The red legacy check (`node scripts/odds-identity/prove.mjs --legacy`) fails with 33 of 46 quoted games lacking an exact provider match. **That does not mean all 33 were wrong games**: absent provider coverage and start-time discrepancies also fail that check. The independent replay found 47 of the 53 withheld forecasts lack the same team pair and six differ in start time. NHL has 0/49 accepted forecast joins: four same-team candidates differ by 8m05s or 10m. Silently widening time tolerance would undo the identity guarantee; a future mapping needs authoritative schedule evidence.

Positive controls cover every real event, equivalent minute/second ISO times and the native `Date` values used by the NFL schedule service. Invalid/missing Date inputs, missing prices, stale/future clocks, swapped sides, wrong dates and ambiguous duplicate identities fail closed. [Full result](proof/check.json). [Independent refuter](proof/independent-review.md).

TypeScript, the existing terminal and immutable-measurement regressions passed. All five changed live routes compiled and returned HTTP 200 in a dedicated local Next process: [HTTP receipt](proof/http-check.json). A browser inspection reached the authentication shell with no console errors; **authenticated quote rendering, desktop/mobile quote layout and runtime cron publication are not proven**. No test account or auth bypass was introduced to hide that boundary. NBA and CBB source wiring compiles, but their actual provider payloads were unavailable in this archive set. Vercel preview production build remains a release gate; no local full production build was run.

## Release and remaining work

This is a local source candidate on `codex/prediction-terminal`, after the measurement and terminal commits. GitHub main and READY production were last checked at 04:03:52 UTC on 2026-10-16: `6af083c277aa64fd13ec9269591fc57bdd611f68`, an ancestor of the candidate. Nothing was pushed, deployed or enabled. Frozen model parameters and predictive-edge conclusions are unchanged.

Follow the approved [measurement release path](../measurement/README.md). Publication/main merge/activation still requires explicit approval. After an approved preview: verify the authenticated live UI with an actual accepted new-schema record; after normal scheduled production collection, inspect the exact deployed writer output and source times with a fresh refuter. Never manually trigger the paid collectors as a test. Do not claim a site-wide live repair before those checks pass.
