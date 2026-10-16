# Prediction Matrix status

## 2026-10-16 — research terminal first slice, local review

`codex/prediction-terminal` builds on the immutable-measurement candidate: full-width game monitor, research/prices/record, honest disagreement and stale-data labels, device shortlist and hash-bound evidence downloads. Real sources: 79 games, 13 exact board joins, 74 markets/148 quote sides. All 79 HTTP exports checked; real browser desktop/390px, reload/shortlist, filters, sorting, native download and zero console errors verified. Independent refuter found wrong-game legacy per-book totals; terminal now suppresses all 503 unidentified quotes. Upstream writers remain unfixed. Read [terminal proof, defect, limits and commands](docs/terminal/README.md).

No tuning, paid calls, production writes or deploy. Model edge remains unproven. Main/production source remains `6af083c277aa64fd13ec9269591fc57bdd611f68`, an ancestor of this local candidate. Publication and activation are awaiting explicit approval. Next: Shawn reviews this first slice; repair upstream odds event identity as a separate iteration, release immutable measurement through the known preview pipeline, then verify actual postgame settlement. Never use source equality alone to certify game-price identity.

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
