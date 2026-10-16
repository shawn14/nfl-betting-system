# Production release — October 16, 2026

Shawn requested “push to main.” [PR6](https://github.com/shawn14/nfl-betting-system/pull/6) merged as `69240a9bb7b036e7ccc5b70a2550413c500085c5`; GitHub main and the actual production domain matched that READY Vercel deployment at 05:04 UTC (12:04 AM Chicago). Both prior production `6af083c` and verified review `3e3ab94` are ancestors. [Release receipt](release.json).

The [live terminal](https://www.predictionmatrix.com/terminal) passed all 79 game exports against exact public-source entries/hashes, all 144 displayed quote sides, invalid identity rejection and source-version409 checks. [HTTP proof](http-check.json). All five results pages plus FAQ/About/EV returned200 and explicitly avoided unsupported performance claims. Three unsigned collector routes returned401 before work. The measurement API returned disabled with a null report.

Real browser selection, shortlist/reload, search/empty state, sorting, price/record tabs, refresh and390px no-overflow checks passed without console errors. [Browser proof](browser-proof.json), [screenshot](desktop.png). Native download was proven on the equivalent preview; production proof verified all actual attachment responses, without repeating the browser download.

[Independent review](independent-review.md) records the fresh context’s actual observations and limits. Collection was not enabled, no paid collectors were manually run, and no database repair was performed. Models remain frozen and predictive edge remains unproven. Authenticated sports rendering, normal scheduled producer output, attributed capture, enabled scorecard and real final settlement need separate evidence.

Production verification is reproducible with `scripts/measurement/release-check.mjs --expect-live <full-current-main-sha>` and the two read-only HTTP suites documented in [the measurement runbook](../measurement/README.md). The final evidence/docs commit changes no application source; verify its exact serving SHA after its automatic deployment.
