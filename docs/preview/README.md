# Approved review preview

Shawn approved the integrated review branch and one reserved provenance create/read/delete test on October 15, 2026 CT. [Draft PR6](https://github.com/shawn14/nfl-betting-system/pull/6). Production deployment/measurement activation require a separate decision. Model formulas remain frozen and edge remains unproven.

The initial a64803e preview built READY, but the actual browser threw Firebase `auth/invalid-api-key`. Its preview environment contained only the Blob token. Build success was not browser success. `scripts/measurement/prepare-preview.mjs` now reads the six existing public Firebase client settings into memory and scopes them to `codex/prediction-terminal` preview only. It refuses source/live drift or privileged preview settings, never overwrites a conflicting setting, verifies exact values/scopes, and verifies production env metadata stayed unchanged. No admin or paid key is copied; no Firebase permissions change. [Sanitized receipt](client-config.json). API [contract](https://vercel.com/docs/rest-api/projects/create-one-or-more-environment-variables).

```sh
node scripts/measurement/prepare-preview.mjs          # dry run, names only
# --apply is a write; this session's six-setting repair was already applied.
node scripts/measurement/inspect-preview.mjs          # exact current review SHA, canonical project only
PM_HTTP_BASE=https://<verified-preview>.vercel.app node scripts/terminal/prove-http.mjs
PM_HTTP_BASE=https://<verified-preview>.vercel.app node scripts/measurement/prove-http.mjs
```

The HTTP guards require the canonical project's READY preview of the current local branch SHA. Production/custom hosts and another Vercel project's build cannot qualify. Browser proof uses `scripts/terminal/prove-browser.mjs` through the documented CUA controls. Keep preview measurement disabled; never invoke authenticated paid collectors. Public terminal behavior can be proven without claiming authenticated sports-page rendering or enabled results. The reserved test has already passed and been cleaned; do not repeat it.

Current evidence: [provenance receipt](../measurement/provenance/live.json), [independent read-only review](../measurement/provenance/approved-proof-review.md).
## Verified preview

[Open the terminal](https://nfl-betting-system-580weyvmo-stock-alarm.vercel.app/terminal). Canonical deployment `dpl_AWoYNqcs6LpcNoHgRUNMfWPXPCtx` is READY at `bd1fb695c497f1b77e936b1609d621bdd74b4c60`. At 04:36 UTC, all 79 real games rendered and all 79 exports matched the exact published entries and source hashes; 144 displayed quote sides matched their exact board events. Unidentified totals were excluded; changed hashes returned 409. [HTTP receipt](http-check.json).

All five results pages plus FAQ/About/EV passed; three unauthenticated collectors returned 401 before work. [Receipt](measurement-http-check.json). Real browser selection, shortlist persistence, search/empty state, sort, tabs, refresh and 390px overflow checks passed without console errors. [Browser receipt](browser-proof.json). The native attachment downloaded successfully and retained the selected game's raw evidence: [download](downloaded-evidence.json). [Desktop](desktop.png) and [mobile](mobile.png).

The [independent review](independent-review.md) checked the actual preview, every export, every forecast source and all 144 quote sides. During that later check the public odds board advanced beyond the cached version. It verified pinned export identity/quote consistency and explicitly did not claim the later whole-board hash matched. Do not erase this distinction or equate a cached observation with executable live odds.

Production/main stayed `6af083c277aa64fd13ec9269591fc57bdd611f68`, an ancestor of the candidate. No main merge or measurement activation occurred. Authenticated sports-page rendering, attributed producer capture, scheduled second-run behavior and real final settlement remain unproven. Current forecasts remain experimental; no predictive edge established.

## Subsequent production approval

Shawn requested “push to main” on October 16. PR6 is merged and production verification is recorded in [the release evidence](../production/README.md). The earlier production hold above is historical; collection activation remains unapproved and disabled.
