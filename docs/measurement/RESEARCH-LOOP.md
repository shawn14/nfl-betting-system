# Continuous paper research

This is a bounded research loop on the existing measurement cron, minutes 12/27/42/57. It uses no new scheduler, service, paid data request, model call or betting path. Reuse source: the actual `kalshi-research-desk` preregistration/forward-ledger/market-comparison pattern, not the obsolete `kalshi-mm-v14` location. The published prediction model and existing EV/shopping thresholds stay frozen.

## Each cycle

1. Before capturing a game, create/read one immutable `research-registration` in the measurement namespace. It contains the rules, implementation hashes, deployed source and Firestore server creation time. Existing registrations are never changed. Source drift creates a different identity; the build checks the hash manifest and fails rather than quietly updating it.
2. Capture the actual first eligible published pregame forecasts and exact prices using the existing contract. Evaluate three screens against each saved sport/market: published direction, highest raw-model expected return clearing the existing 2% threshold, and the existing frozen EV rule. Nothing is fitted on outcomes. Every declared combination counts toward the multiple-comparison adjustment, including empty ones.
3. Grade from actual final-event evidence linked by capture hash. The research evaluator recomputes the settlement contract and rejects mismatched, future or duplicate settlements. Unknown producers, captures before registration and missing prices cannot enter. Different published source/version cohorts remain separate, even when the only source change was documentation; there is no silent pooling claim.
4. Save a research summary in the collector heartbeat. The results page and evidence API derive the full current report from the immutable records. A later cycle uses the same existing records; it cannot rewrite registration, predictions or outcomes. The independent two-run proof must check server creation/update times, body hashes and a later successful heartbeat.

Price shopping remains its own CLV experiment from the existing paid collectors' already-fetched payloads. Historical market-lab winners and the rejected market challenger are not promoted or relabeled forward evidence.

## Fixed research rules, not an automated betting approval

Each experiment runs for 56 days from server registration. It requires 100 selected settled games, 100 non-push probability observations and 14 distinct game dates, all within a producer cohort. Hypothetical returns use the recorded price, one unit, minus an explicit assumed 1% cost per unit. This is a stress assumption, not measured fees/fills. Predictive comparison is model minus same-time no-vig market log loss on the exact same selected games; pushes have no binary probability score.

Approximate normal intervals use independent games and Bonferroni adjustment across all 45 declared sport/market/screen combinations per observed producer cohort, conservatively allowing three comparisons each. Candidates stay `collecting` during the horizon regardless of interim results. At the horizon they are awaiting outcomes, insufficient evidence, rejected, no demonstrated edge, or review required. Review requires positive adjusted lower return bound, negative adjusted upper loss-difference bound, and positive early/late paper returns. These are conservative screens, not a calibrated certification test. No automatic promotion or trading exists; independent review and a newly untouched confirmation sample are still required. An exhausted horizon stays closed until an explicit new experiment is registered; it is not repeatedly restarted until it wins.

The runtime pilot retains the existing 2,000-capture/settlement bounds, plus 100 registrations. Hitting a bound fails visibly. This is an operational pilot, not an unbounded historical warehouse. Prior registrations remain in the evidence export and must be reproduced with their original source/hashes.

## Independent review corrections before commissioning

The independent review reproduced two local defects using the real deployed record: changing derived prices/probabilities could pass weak admission, and the runner supplied newly captured records twice. Admission now reconstructs the entire original capture from retained forecast/odds/status at its original clock, binds the forecast's game id and returned ESPN odds event/provider/team references, and compares every non-server field. The runner supplies each stored capture once. Mutations are diagnostic evidence of rejected inputs, not allegations of production corruption.

The follow-up review found JSON key order could break linked settlement hashes and the standing proof incorrectly required old cohorts to have today's source SHA. Measurement hashes now canonicalize object keys; the namespace was confirmed disabled and empty at14:42UTC, so no stored record was rewritten or migrated. [Actual baseline](source-diagnosis/pre-canonical-hash-baseline.json). The inspector compares every exported evidence body/server time and health with actual Firestore. Exact current-SHA-only assertions are available as `--first-commissioning`; ordinary standing proof preserves older valid producer cohorts. Cycle/public candidate counts, selected/graded counts and exclusion reasons must agree. The live proof ran red against the actual disabled/failed system at14:43UTC: [receipt](source-diagnosis/research-live-red.json).

## Proof and operations

```sh
npm run test:research
# After approved activation: actual storage/public report + a later real cycle.
npm run test:research:live -- --sha <serving-sha> --out /tmp/research-run1.json
npm run test:research:live -- --sha <serving-sha> --out /tmp/research-run2.json --compare /tmp/research-run1.json
# Once an actual captured game finishes, verify its current official final event too:
npm run test:research:live -- --sha <serving-sha> --out /tmp/research-final.json --require-final
# After an intentional research implementation change, review before generating a NEW identity:
node scripts/measurement/research-identity.mjs --write
# The build only checks identity; it never silently changes it.
npm run build
```

The local proof uses the actual deployed NFL 401872996 probe from 14:28 UTC, including its raw forecast/price/status evidence. Registration/clock/outcome mutations are explicitly diagnostics only. It exercises all nine screen/market combinations, independently computes stressed returns, proves producer separation and repeat-read stability, and rejects legacy/unknown/before-registration/tampered/duplicate/future evidence. It does not create prospective evidence or prove the upcoming game's final settlement.

Deploy through the existing reviewed branch → Vercel preview → approved main auto-deploy path. Keep collection off until the read-only operator preflight confirms all candidate forecasts carry current producer source. Normal NFL refresh is every even UTC hour; do not force a paid collector or silently loosen provenance readiness. After activation, verify registration precedes captures, two actual persisted scheduled runs preserve every immutable field, current research heartbeat matches the public report, and desktop/mobile results render. Then verify the first actual final-game settlement. Until those pass, describe the loop as built and uncommissioned.
