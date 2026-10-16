# Independent production release review — October 16, 2026

Fresh-context refuter: `/root/refute_production_release`. Read-only live observations completed at 2026-10-16T05:05:29Z, followed by a fresh browser inspection. This review did not build or deploy the implementation and did not rely on the builder’s proof reports for the observations below.

## Observed

- The Vercel alias for `www.predictionmatrix.com` points to the project identified by the canonical repo’s `.vercel/project.json`. Its deployment is `dpl_8WFLpDzPsvoAENdEsmMUN2yjQ8oM`, target `production`, state `READY`.
- Serving GitHub source SHA and independently queried remote `refs/heads/main` both equal `69240a9bb7b036e7ccc5b70a2550413c500085c5`.
- Production environment metadata has no `FEATURE_MEASUREMENT_ENABLED` key. A live GET of `/api/measurement` returned `{"state":"disabled","report":null}`.
- The live `/api/terminal` returned 79 unique games. Every game appeared in the actual `/terminal` server-rendered response. All 158 forecast/market hash comparisons matched the independently fetched bytes of five public source blobs. Every displayed model home probability matched its exact published forecast entry.
- All 13 joined market events matched both full team names and the kickoff instant; all 144 displayed best quote sides matched the exact source market’s bookmaker and price. Every game withheld unidentified legacy per-book totals.
- All five live results routes (`/results`, `/nba/results`, `/nhl/results`, `/cbb/results`, `/wnba/results`) returned HTTP 200 and explicitly stated that prospective collection is disabled and historical results were recalculated after games. None contained the retired “approximately 55%” claim.
- A new browser tab rendered the production research terminal, showing 79 games and “Experimental forecasts · edge unproven.” Selecting its Record tab worked and showed “Pregame collection is not enabled,” the historical-results limitation and the shortlist’s non-performance-record limitation. No browser console errors were captured. The temporary tab was closed; no viewport override was made.

## Limits

This proves the named deployed artifact serves the research terminal and honest disabled-measurement state at the observed time. It does not prove predictive edge, profitable execution, collection activation, a deployed pregame capture, postgame settlement, authenticated sport-page rendering or new output from scheduled writers. This reviewer did not repeat the builder’s full export suite, mobile interaction suite or unsigned cron probes, and did not call any cron/admin route, paid endpoint or legacy sport landing page. No database or environment writes were performed. An initial sandbox DNS failure occurred before live reads; the bounded read-only network escalation then completed successfully.

A later documentation/tooling-only main commit must receive a fresh exact-SHA deployment readback; these observations identify the application release above, not a future deployment.
