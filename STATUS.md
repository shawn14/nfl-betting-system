# Prediction Matrix status

## 2026-10-16 — approved review publication and reserved proof

Shawn approved publishing `codex/prediction-terminal` for a Vercel preview plus one reserved provenance test. [Draft PR6](https://github.com/shawn14/nfl-betting-system/pull/6) is open. The test passed at04:27UTC: exact unknown provenance survived immutability/second-reader/report checks; zero settlements and cleanup confirmed independently. [Evidence](docs/measurement/provenance/approved-proof-review.md). Prior authorization-block notes below are superseded for these two approved steps only.

The initial a64803e preview built READY but its browser failed `auth/invalid-api-key`: preview had only the Blob setting. Six existing public Firebase client settings are now branch-scoped in Vercel, value-verified, with no admin/paid key/measurement flag or production-env changes. Rebuilding through GitHub and verifying actual browser/HTTP behavior is next. [Runbook](docs/preview/README.md). Production/main remains `6af083c277aa64fd13ec9269591fc57bdd611f68`, ancestor of the review branch. Production merge/deployment/activation remain unapproved. Models frozen; no predictive edge proven.

## 2026-10-16 — producer provenance repair, local candidate

The collector incorrectly assigned its installed model version to unstamped published forecasts. Red/green actual-record proof and an independent replay of the previously saved real Firestore capture confirmed the gap. All five writers now stamp declared version/source; capture/report use only published provenance and keep version/source cohorts separate. All82archived entries remain unknown, preserving the original evidence. [Contract/proof](docs/measurement/provenance/README.md).

TypeScript plus provenance/measurement/odds/terminal regressions pass. Current-public read at04:12:57 UTC confirms NFL401872996 remains unattributed and uncommitted output is excluded from reporting. Independent23malformed metadata cases/7diagnostic cohorts/21market rows pass. No formulas/weights changed; no new predictive edge proven.

Automatic approval review rejected the reserved real-Firestore create/delete proof because production-credential writes exceed current local-only authorization. Test saved, not run or retried. Publication remains separately unapproved. Main/live4:12:58UTC both `6af083c277aa64fd13ec9269591fc57bdd611f68`, ancestor of candidate; measurement absent. Next requires explicit branch/preview and reserved-proof approval, followed by authenticated enabled UI and separately approved deployment/activation. No further local UI breadth or model tuning substitutes for those gates and actual prospective outcomes.

## 2026-10-16 — exact-event odds repair, local candidate

All five writers now share strict sport/both-teams/start-time matching and preserve provider identity and per-book source clocks. Five live readers reject unidentified legacy quotes; periodic-observation copy and source timestamps replace the misleading live-price/averaged-price display. No model changes. [Contract and proof](docs/odds-identity/README.md).

Actual archived replay: 22 provider events, all 200 valid book quotes preserved; 13 exact joins of 66 forecasts; 53 withheld, including all three confirmed wrong-game examples. NHL coverage is zero because start times differ; NBA/CBB provider payloads remain untested. TypeScript and odds/terminal/measurement proofs pass; all five local routes compile/HTTP200. Browser reached auth shell only, so authenticated quote layout remains unproven. Fresh independent refuter passed actual-record replay.

Not pushed, deployed or enabled. GitHub main / live last checked at 04:03:52 UTC: `6af083c277aa64fd13ec9269591fc57bdd611f68`, an ancestor of this branch. Next: review local candidate; with explicit release approval, use the known preview/main pipeline, verify authenticated quote rendering and normal scheduled writer output, then begin the forward measurement proof. No paid cron tests.

## 2026-10-16 — research terminal first slice, local review

`codex/prediction-terminal` builds on the immutable-measurement candidate: full-width game monitor, research/prices/record, honest disagreement and stale-data labels, device shortlist and hash-bound evidence downloads. Real sources: 79 games, 13 exact board joins, 74 markets/148 quote sides. All 79 HTTP exports checked; real browser desktop/390px, reload/shortlist, filters, sorting, native download and zero console errors verified. Independent refuter found wrong-game legacy per-book totals; terminal now suppresses all 503 unidentified quotes. Upstream repair is now a local candidate above; production remains unchanged. Read [terminal proof, defect, limits and commands](docs/terminal/README.md).

No tuning, paid calls, production writes or deploy. Model edge remains unproven. Main/production source remains `6af083c277aa64fd13ec9269591fc57bdd611f68`, an ancestor of this local candidate. Publication and activation are awaiting explicit approval. Next: Shawn reviews this first slice; review the upstream identity candidate above, release immutable measurement through the known preview pipeline, then verify actual postgame settlement. Never use source equality alone to certify game-price identity.

## 2026-10-16 — immutable measurement candidate, awaiting release approval

Branch `codex/prediction-measurement` contains the audit plus immutable pregame capture and grading, separate model/price-shopping evaluation, authenticated collection, and removal/labeling of misleading historical accuracy claims. **Built and locally verified; not deployed or enabled. No edge established.** Model parameters, weights and thresholds remain frozen.

Real Firestore proof captured NFL 401872996 / DraftKings / three markets at 02:25:15 UTC. Concurrent/repeat write and second-run read invariants passed. An independent context repeated that proof at 02:27:26 and confirmed cleanup. Local HTTP checks passed all five results pages, FAQ/About and three unauthorized cron gates. Desktop/mobile proof is saved. The SDK duplicate-create retry problem is fixed with a transaction. Paid request accounting/output is persisted before optional measurement.

Canonical [contract, evidence, commands and release/rollback](docs/measurement/README.md). Storage is a bounded pilot with explicit ceilings; old data is excluded, never silently truncated. Collection defaults off. No paid calls, bets, production collection or deploy were performed. Deployed collection and settlement after a captured game finishes remain unverified.

Read-only serving preflight at 02:34 UTC: freshly queried GitHub main and READY production both `6af083c277aa64fd13ec9269591fc57bdd611f68`; feature flag absent. Main is an ancestor of this candidate; candidate is not live. Next: obtain explicit branch publication/main merge/activation approval, require Vercel preview proof, merge current main, verify the exact deployed SHA and first two collector runs, then the first real final settlement with a fresh refuter. Do not rerun paid odds collectors manually or tune the model.

## 2026-10-15 — prediction edge audit

Repo: `shawn14/nfl-betting-system`; production: https://www.predictionmatrix.com.
Verified live alias READY on `6af083c277aa64fd13ec9269591fc57bdd611f68`, matching freshly fetched GitHub main and the clean primary checkout. This documentation branch does not change production code.

**Result: no trustworthy demonstrated prediction edge.** Current public results cover 815 games, including 222 rows with the frozen version stamp (77 NFL, 99 NHL, 46 WNBA). The strongest NFL totals record (54–23) is contaminated: the grader generates predictions after outcomes, with current team scoring averages. Independent diagnostic: 63 eligible rows go from 42–21 stored to 21–42 with earlier-game-only inputs. This is not recovered actual published performance. NFL PPG also excludes ties from games played. Current NBA/CBB blobs contain no result rows; their older Firestore history was not fetched in this audit.

Line shopping: 160 started flags / 89 games show +0.440pp CLV; remove same-snapshot closes and require a later close within an hour: 126 flags / 72 games, +0.325pp, game-cluster approximate 95% interval −0.153 to +0.803pp. No execution-profit proof. The old props replay repeats snapshot/book observations across 47 games and understates dependence.

Evidence: [audit](docs/reports/2026-10-15-edge-audit/edge-audit.html), [graphic](docs/reports/2026-10-15-edge-audit/edge-audit.png), [independent proof](docs/reports/2026-10-15-edge-audit/refuter-proof.json). Reproduce without network: `node docs/reports/2026-10-15-edge-audit/refuter-proof.mjs`; broader statistics: `node --no-warnings docs/reports/2026-10-15-edge-audit/analyze.mjs`.

Superseded next-step note: measurement work is now the local candidate above. The tie-denominator defect remains a separate frozen-model issue; do not mix it into this measurement repair. Keep model parameters and thresholds frozen. Do not describe historical recomputed results as forward validation. No crons, paid odds requests, bets, production data repairs or deployments were performed. Fresh HTTP/browser reload showed current EV content; an initial cached browser view is not evidence of a live freshness bug.
