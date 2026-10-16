# Independent preview review

Reviewed October 15, 2026, approximately 11:36–11:40 PM America/Chicago (October 16, 04:36–04:40 UTC). All external actions were read-only. No cron, paid endpoint, sports landing page, deployment, environment change, or database write was invoked. Only this report was written.

**The bounded review-preview claims passed, with a source-version limitation noted below.**

- Independently queried Vercel deployment metadata at 04:39:03 UTC. Preview `dpl_AWoYNqcs6LpcNoHgRUNMfWPXPCtx` is READY at exact source `bd1fb695c497f1b77e936b1609d621bdd74b4c60`, serving [this terminal](https://nfl-betting-system-580weyvmo-stock-alarm.vercel.app/terminal). The production domain still resolves to READY deployment `dpl_BsncVNYf3joHMopMcH55SmfFnSDQ`, source `6af083c277aa64fd13ec9269591fc57bdd611f68`.
- Opened a fresh Chrome tab without signing in or altering viewport. The actual rendered terminal showed **79 games**, **13 within price-age limits**, experimental-forecast/edge-unproven copy, and forecast capture off. Selected the Record tab: it said “Pregame collection is not enabled,” with no win rate or ROI. The actual `/api/measurement` response was exactly `{"state":"disabled","report":null}`.
- Selected Houston at Jacksonville and the Prices tab. It rendered the correct matchup and kickoff, distinct lines, provider names and quotes (including Jacksonville ML DraftKings −142, Houston ML Pinnacle +127, and separate Jacksonville −2 / −2.5 spreads). The surface explicitly calls prices observations, identifies its collection age, and distinguishes market-derived EV from model forecasts. No warnings/errors were captured in this fresh tab. The tab was closed after inspection.
- Wrote and ran a separate read-only HTTP checker instead of invoking the builder's suite. Inspected **all 79 exports** from the actual preview; all return attachment/no-store responses. Every exact forecast entry matches its independently fetched published source and whole-source hash. All five projected forecast values, both team names, game IDs and kickoff instants match their raw entries. All 79 omit unidentified individual bookmaker totals.
- All **13 joined events** retain exact home, away and kickoff identity. All **144 displayed quote sides** match the exported board event's exact market ID, line, label, provider and price. The other 66 exports have no board event/markets. A deliberately mismatched forecast hash returns HTTP409 rather than silently exporting a different version.

## Source-version boundary

During this review, the public board advanced while the preview retained a cached version. The preview/export board hash was `4f7dc1ee7e694f7938eab0474bb0dba471c733a5f8f2c6de5ca78ccfb042ac6c`; the independently fetched current board hash was `c88c2bd79d53ee8ebbc07ec8907bb2b7e8c1a8d4999597d5bfdac22d3c560774`. The first whole-source comparison correctly failed. The subsequent check did **not** treat those versions as equal: it verified all forecast sources in full and verified board identity/quote consistency against each pinned export, while recording **0 independently matched whole-board source versions** at this later instant. This is compatible with the documented five-minute cache and periodic-price labels, but limits the independent claim. The builder's earlier full-board proof is separate evidence, not a substitute for this distinction.

The initial independent measurement checker expected an omitted report; the real documented disabled response has `report:null`. This was corrected in the checker after inspecting the reader contract. No application change was needed.

## Limits

This verifies an actual publicly reachable review preview, its disabled measurement presentation, exhaustive forecast export fidelity, and exact exported game/price identity. It does not prove every historical board quote against a retained raw provider response, every browser interaction, every viewport, enabled-state authentication, deployed producer stamps, scheduled collection, settlement, profitability, or better predictions. Production was not replaced and measurement was not activated. CBB has no current game rows to exercise.
