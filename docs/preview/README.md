# Approved review preview

Shawn approved the integrated review branch and one reserved provenance create/read/delete test on October15,2026CT. [Draft PR6](https://github.com/shawn14/nfl-betting-system/pull/6). Production deployment/measurement activation require a separate decision. Model formulas remain frozen and edge remains unproven.

The initial a64803e preview built READY, but the actual browser threw Firebase `auth/invalid-api-key`. Its preview environment contained only the Blob token. Build success was not browser success. `scripts/measurement/prepare-preview.mjs` now reads the six existing public Firebase client settings into memory and scopes them to `codex/prediction-terminal` preview only. It refuses source/live drift or privileged preview settings, never overwrites a conflicting setting, verifies exact values/scopes, and verifies production env metadata stayed unchanged. No admin or paid key is copied; no Firebase permissions change. [Sanitized receipt](client-config.json). API [contract](https://vercel.com/docs/rest-api/projects/create-one-or-more-environment-variables).

```sh
node scripts/measurement/prepare-preview.mjs          # dry run, names only
# --apply is a write; this session's six-setting repair was already applied.
node scripts/measurement/inspect-preview.mjs          # exact current review SHA, canonical project only
PM_HTTP_BASE=https://<verified-preview>.vercel.app node scripts/terminal/prove-http.mjs
PM_HTTP_BASE=https://<verified-preview>.vercel.app node scripts/measurement/prove-http.mjs
```

The HTTP guards require the canonical project's READY preview of the current local branch SHA. Production/custom hosts and another Vercel project's build cannot qualify. Browser proof uses `scripts/terminal/prove-browser.mjs` through the documented CUA controls. Keep preview measurement disabled; never invoke authenticated paid collectors. Public terminal behavior can be proven without claiming authenticated sports-page rendering or enabled results. The reserved test has already passed and been cleaned; do not repeat it.

Current evidence: [provenance receipt](../measurement/provenance/live.json), [independent read-only review](../measurement/provenance/approved-proof-review.md). Rebuilt preview browser/HTTP verification pending.
