# Prediction Matrix status

## 2026-10-15 — prediction edge audit

Repo: `shawn14/nfl-betting-system`; production: https://www.predictionmatrix.com.
Verified live alias READY on `6af083c277aa64fd13ec9269591fc57bdd611f68`, matching freshly fetched GitHub main and the clean primary checkout. This documentation branch does not change production code.

**Result: no trustworthy demonstrated prediction edge.** Current public results cover 815 games, including 222 rows with the frozen version stamp (77 NFL, 99 NHL, 46 WNBA). The strongest NFL totals record (54–23) is contaminated: the grader generates predictions after outcomes, with current team scoring averages. Independent diagnostic: 63 eligible rows go from 42–21 stored to 21–42 with earlier-game-only inputs. This is not recovered actual published performance. NFL PPG also excludes ties from games played. Current NBA/CBB blobs contain no result rows; their older Firestore history was not fetched in this audit.

Line shopping: 160 started flags / 89 games show +0.440pp CLV; remove same-snapshot closes and require a later close within an hour: 126 flags / 72 games, +0.325pp, game-cluster approximate 95% interval −0.153 to +0.803pp. No execution-profit proof. The old props replay repeats snapshot/book observations across 47 games and understates dependence.

Evidence: [audit](docs/reports/2026-10-15-edge-audit/edge-audit.html), [graphic](docs/reports/2026-10-15-edge-audit/edge-audit.png), [independent proof](docs/reports/2026-10-15-edge-audit/refuter-proof.json). Reproduce without network: `node docs/reports/2026-10-15-edge-audit/refuter-proof.mjs`; broader statistics: `node --no-warnings docs/reports/2026-10-15-edge-audit/analyze.mjs`.

Next work, if requested: immutable pregame prediction/price capture; grade saved predictions; fix tie denominators; strict closing-reference validity and grouped uncertainty. Keep model parameters and thresholds frozen. Do not describe historical recomputed results as forward validation. No crons, paid odds requests, bets, production data repairs or deployments were performed. Fresh HTTP/browser reload showed current EV content; an initial cached browser view is not evidence of a live freshness bug.
