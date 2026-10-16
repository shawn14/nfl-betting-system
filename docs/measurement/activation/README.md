# Approved paper activation: deployed source failure, 2026-10-16

**Collection was not commissioned successfully. No new performance evidence and no proven edge.** Shawn approved activation; model/thresholds remain frozen, no bets or paid test requests were made. The first actual production request failed, so the operator stopped without retry and completed verified rollback.

## Observed sequence

- 05:45:56UTC: actual production Firestore had zero evidence records and no heartbeat; public measurement disabled. [Baseline](activation-baseline.json).
- 06:00:10UTC: normal NFL writer published all12 future-window candidates with frozen-model producer provenance. Activation preflight found31 attributed future-window candidates across NFL/NHL/WNBA; this is not a price-eligibility count.
- 06:02:11UTC: the canonical domain served READY deployment `dpl_HNC4AkNghh2yTzii7LvR8MXWxhzg`, exact GitHub main `78760202dd9ac3bde42808e5956887f4bf94409e`, production-only flag1, public report available. [Operator receipt](activation-receipt.json).
- 06:02:54–56UTC: one authenticated call to the deployed **free-source** measurement collector returned500 because its ESPN request returned503. [Exact response](manual-first-collector.json).
- 06:03:34UTC: actual Firestore had zero evidence documents and failed heartbeat with server creation/update time06:02:55.959876UTC. [Read-only storage proof](activation-failure.json).

Failing hop: deployed collector → `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401872996/competitions/401872996/odds`. The deployed response proves HTTP503, not its upstream cause. The runner discarded the response body, so provider/intermediary reasons are unknown. Prior successful laptop GETs do not establish deployed reachability. The collector failed before its first evidence create; no missing capture was backfilled.

Rollback uses the same source commit, production flag0, fresh Vercel rebuild, canonical-domain readback and independent review. Keep the failed heartbeat; never erase it to make commissioning appear green. First/second successful actual runs, enabled UI, shopping-write health and real final settlement remain unverified. Stop on the first infrastructure failure; do not blindly retry, force paid collectors, change models, or invent a data fallback.

Operator code/checks are reviewed in [PR8](https://github.com/shawn14/nfl-betting-system/pull/8); main remains the previously verified application source. No application code changed during this activation attempt.

## Verified rollback

At06:04:52UTC the canonical domain served READY `dpl_BWZSsUEH6unx7jiH7RWB8dd4kKM6`, same7876020 source, with flag0 and disabled public endpoint. [Receipt](rollback-receipt.json). A separate context at06:06:08UTC independently read the actual domain/deployment, fresh GitHub main, unique production-only flag0, public disabled state, zero Firestore evidence documents and retained failure heartbeat. [Independent receipt](independent-rollback-review.json). Browser readback showed the authentic disabled state and no console errors: [graphic](rollback-results.png). No ESPN request was retried.

Main7876020 contains reviewed release3e3ab94 and prior production6af083c. The final PR8 operations/docs commit changes no application source; verify its auto-deploy remains disabled before declaring that source-control handoff complete.
