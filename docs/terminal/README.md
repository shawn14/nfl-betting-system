# Research terminal — local review candidate

The first slice of the professional Prediction Matrix workspace is `/terminal`: a dense five-sport game monitor, searchable and sortable research, exact-event bookmaker prices, a device shortlist, source export, and an honest link to forward measurement. [Design and evidence](PLAN.md). **Not deployed. Collection remains off. Prediction accuracy has not improved or been established by building this screen.**

## Observed proof — October 16, 2026

- Current public sources: 79 upcoming games; 13 exact team-and-start-time board matches; 74 markets / 148 best-price sides. Eighteen games have opposing projected-score and win-probability favorites, explicitly labeled.
- Every normalized game and quote was compared with actual public source data. All 79 real local HTTP exports retained the original forecast entry and exact board event; hashes matched the current blobs. Missing/invalid versions return 400; changed versions return 409.
- Real browser flow passed: selection, selected identity and shortlist after reload, search and empty states, sorting metric, prices, disabled measurement, refresh, and 390px overflow. Native evidence attachment downloaded and was read back. [Desktop](proof/desktop.png), [phone](proof/mobile.png), [browser receipt](proof/browser-check.json).
- Existing five results pages, FAQ/About, EV and three unauthorized cron gates remain green. TypeScript and measurement/terminal regression proofs pass. No full production build was run; Vercel preview build remains a release gate.
- [Independent review](proof/independent-review.md) recalculated all 74 markets and 148 quote sides from archived raw provider payloads, verified exact identities and found the defect below. Its follow-up observed the mitigation in the running local API and confirmed malformed-row isolation.

## Critical price-identity finding

**Superseded / wrong:** the initial test reported 503 “exact” individual bookmaker total quotes. It proved copying from `prediction.liveOdds`, not that those prices belonged to the forecast game. Archived real provider payloads show the Pittsburgh–Colorado quote vector reused on two later Colorado games, and WNBA prices reused for a later game. The legacy writer matches either team's name and loses provider event identity. [Counterexamples](proof/independent-review.json).

The terminal now withholds ALL legacy per-book totals. Only board events with both exact normalized team names AND the identical start instant may join. No fuzzy time joins, synthetic prices, or pooled different lines. The local regression first failed with `503 !== 0` and then passed with zero unverified quotes. This was initially a terminal-only mitigation. The subsequent [upstream identity repair](../odds-identity/README.md) is now a local candidate across all five writers and live readers, preserving provider event identity and quote clocks. Production remains unchanged, and the terminal still withholds legacy per-book totals.

The board stores collection time, not individual provider update time. The terminal labels collection age and excludes stale observations from value ranking. A recent file publication does not prove injuries, weather or model inputs are fresh. Raw research exports retain the full original entry for audit and explicitly mark nested legacy `liveOdds` as unverified.

## Repeat the proof

Use a dedicated local process, verify its cwd, and never hit a paid collector as a test. `scripts/measurement/local-ui.mjs` reuses configured production public Firebase settings in memory and starts local Next on 3307 with collection off. It does not enable measurement.

```sh
npm run test:terminal                    # replay captured REAL source projections
npm run test:terminal:live               # six existing public Blob reads, no paid calls
PM_HTTP_BASE=http://127.0.0.1:3307 npm run test:terminal:http
PM_HTTP_BASE=http://127.0.0.1:3307 node scripts/measurement/prove-http.mjs
npx tsc --noEmit --incremental false
npm run test:measurement
```

The HTTP proof deliberately stops if a public source advances beyond the server's shared cache during comparison. The first HTTP attempt observed this at the 03:30 publication boundary; after normal cache advancement the exhaustive run passed at 03:36. Do not weaken the source-version assertion or silently compare different snapshots.

The reusable real-browser proof accepts documented CUA handles; it creates no browser, mocks, or production records:

```js
const proof = await import('/absolute/repo/scripts/terminal/prove-browser.mjs');
const result = await proof.proveBrowser(tab, browser);
```

It removes only the shortlist entry it added and resets its temporary viewport. This session ran the reusable flow with `download:false` after separately verifying the native download; the receipt records that distinction. Evidence download validates the expected hashes then uses the server's native attachment response. A browser's download event did not acknowledge the earlier Blob URL path even though files arrived; native attachment delivery produced a verifiable receipt.

## Boundaries and release

Six cached public Blob reads, five-minute cache, maximum 64 upcoming games per sport/eight days, maximum 8 MiB per source, no background polling except the local display clock. Browser projection observed at 149 KB. Malformed rows are omitted and counted instead of breaking every sport. Shortlist stores IDs only, is local to this device and is not a wager or immutable forecast. Export can fail visibly if a game leaves the pregame feed or a source changes.

No paid requests, model tuning, wagers, production writes, branch publication or deployment occurred. GitHub main / serving deployment was `6af083c277aa64fd13ec9269591fc57bdd611f68`; this branch includes that source plus the local immutable-measurement candidate. Publication, Vercel preview, main merge and enabling collection still need explicit approval under the repo runbook. See [measurement release](../measurement/README.md). Next: Shawn reviews this slice; separately repair upstream odds identity, release honest measurement, and prove real final settlement before ranking challenger models.
