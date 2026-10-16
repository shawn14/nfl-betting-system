# Independent review of approved publication and provenance proof

Reviewed October 15, 2026, 11:29–11:30 PM America/Chicago (October 16, 04:29–04:30 UTC). The reviewer did not run the write proof, modify production, invoke a cron, or call a paid odds endpoint.

**No contradiction found in the reserved proof's bounded claim.** GitHub independently reports review branch `codex/prediction-terminal` at `a64803ebc3638a4aec0002c7b39ebd25238e6eb3`; main remains `6af083c277aa64fd13ec9269591fc57bdd611f68`. Vercel preview/build/browser verification is outside this independent review and belongs to the parent session's separate evidence.

## Direct observations

- Read both actual reserved Firestore paths using the existing project's Firebase credential, held only in memory. At 04:29:17.548 UTC, `predictionMeasurementProof_provenance_94611_1792124849490` and its `Health` sibling each contained **0 documents**. No test rerun and no writes were performed. [Read receipt](approved-proof-independent-read.json).
- Independently fetched the public NFL source, ESPN event and ESPN provider prices at 04:29:41.124 UTC. The entire public source hash exactly matches the proof receipt: `e9d860d0d068f065145f7cc7abbe63d2d0665418df29fd4e54dbb0c316860274`. The saved forecast entry also matches exactly. ESPN event `401872996` is still scheduled/pre-game, with Jacksonville home (`30`), Houston away (`34`), and kickoff October 18 at 13:30 UTC. All eight current DraftKings price fields match the saved capture. [Public refetch receipt](approved-proof-public-refetch.json).
- Reparsed the receipt's raw ESPN odds through the real production parser: provider and all normalized prices match the capture. Raw ESPN event and team reference IDs match the captured identity. Source quote time remains null; local observation time was not relabeled as provider quote time.
- Replayed the actual report function on the saved capture without any settlement. It yields exactly three market rows (moneyline, spread, total), each in cohort `[null,null]`, each with one capture, zero wins/losses, zero settled observations, and null ROI/confidence interval. The immutable entry has no published producer stamp; null version/source is therefore correct, regardless of collector version. [Read/replay receipt](approved-proof-independent-read.json).

## Receipt and implementation inspection

The saved [live proof receipt](live.json) records a Firestore-backed create time of `2026-10-16T04:27:30.756Z`, before the October 18 13:28 UTC safety deadline. The forecast was published at 04:00:10.467 UTC and captured at 04:27:30.214 UTC. Inspection of `MeasurementStore.get()` confirms `committedAt` comes from Firestore document `createTime`, not a submitted timestamp. The test uses first-writer-wins `create()`, attempts a conflicting metadata write, reads through a fresh store instance, and invokes the real measurement report before cleanup. Its receipt asserts those steps passed.

Because the parent had already cleaned the record, this reviewer could independently inspect the real empty state, the source data, the receipt, and report behavior, but could not reread the deleted document's original server metadata or independently observe the conflicting-write transaction while it occurred. No replacement record was created to hide that limit.

## Limits

This run exercised a real **unstamped** published forecast. It proves the unknown-provenance path and preserves actual prices; it does not prove a deployed producer publishes the new metadata or that an attributed version/SHA survives a live production capture. Those positive paths remain covered only by local diagnostic tests until the producer deployment and a real stamped forecast exist. It does not establish enabled production collection, browser rendering of live enabled rows, scheduled second-run behavior, postgame settlement, profitability, or improved predictions. The reserved record was deleted and is not a live forward-performance sample. No model constants or thresholds were changed by this review.
