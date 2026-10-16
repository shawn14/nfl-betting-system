# Independent forecast-producer provenance review

Reviewed 2026-10-16T04:13:35.509Z in the isolated local candidate checkout. No production source was edited by this reviewer. No network request, cron, paid endpoint, deployment, or database write was performed.

## Result

No blocker found in the specific local claim: producer provenance comes from the frozen published forecast, old collector-supplied headers cannot attribute an unstamped forecast, and reporting separates model-version/source-commit cohorts across moneyline, spread and total markets.

This does not establish that the deployed writers emit provenance, that the new fields survive a new real-storage write, or that any model predicts winners better.

## Independently observed

- Loaded the actual archived Firestore capture `model-nfl-401872996`, committed at `2026-10-16T02:25:15.541Z`, from `docs/measurement/proof/live.json`. It has the old collector header `modelVersion: 2026-09-11-freeze` and no published producer stamp inside its frozen entry. The new report assigned all three markets to `[null,null]`, with attribution false.
- Ran the actual `makeCapture` implementation on that record's exact archived forecast, event, prices, publication/observation times and source. New producer fields are null; all three frozen markets and the raw forecast are unchanged. No prediction formula or price changed as a side effect.
- Converted that real NFL kickoff to a native JavaScript Date before replay. Serialization preserved the kickoff instant, forecast entry and all three markets.
- Examined every archived public forecast: NFL 14, NBA 16, NHL 49, WNBA 3, CBB 0 (82 total). All are unstamped and remain unknown. This is exhaustive for those saved archives, not an assertion about current production or unobserved CBB records.
- Independently ran 23 malformed metadata cases: missing/non-object or wrong-schema producer, empty/non-string/oversized/whitespace-padded version, and missing/malformed/uppercase/non-hex/short source SHA. Malformed producer remains unknown; a valid version with invalid source SHA retains the version but cannot be fully attributed.
- Built seven explicitly diagnostic metadata variants of the actual saved capture: unknown, known source, different source/same version, different version/same source, missing source, and delimiter-bearing version labels. Keys remained distinct and produced 21 separate market rows. For every variant, a single-capture report matched its rows in the combined report exactly.
- Used the actual `settle` function with diagnostic score/identity variations only to exercise report separation. Each grade remained in its original producer cohort. Changed capture hash, sport, game id and invalid commit timestamp were each excluded. These simulated scores are not performance evidence and were never written to storage or feeds.
- Confirmed the raw archived source object was unchanged by the reader/report checks.
- Inspected all five writer construction and serialization paths. Each upcoming prediction receives `forecastProducer(process.env.VERCEL_GIT_COMMIT_SHA)` before its games array is serialized. NFL/NBA/CBB/WNBA prediction-document spread also retains it. NHL publishes its predictions array directly. Existing legacy result-row version fields are a separate path and are not used for the new cohorts.
- Checked the UI uses the complete cohort key for row identity and shows unknown version/source explicitly. The displayed eight-character SHA is only a label; grouping uses the full SHA. The measurement cache key changed, preventing old summary shape reuse after release.

## Limits

The producer source SHA is deployment metadata supplied to the writer. Its correspondence to the actual deployed code has not been exercised here. The five writer paths were inspected without invoking their paid/mutating crons. CBB had no forecast rows in the archive. The enabled results UI was not exercised in a running browser by this reviewer. No new real-storage proof was attempted; the parent reported automatic approval review rejected that proposed test, so the existing archived real capture was replayed locally instead. Model-version/source grouping can separate evidence; it cannot prove a prospective edge or recover contaminated history.

## Reviewed artifact hashes

- `src/lib/forecast-provenance.ts`: `b6aeb8be021a00d39bf88fc5ac90250b15c9504cf66683da7446b082114194e3`
- `src/lib/measurement/core.ts`: `da765ca932dd8862e3a6832b685f2f450a557900345f556249f94b46500dbf4c`
- `src/lib/measurement/report.ts`: `04c121faa08bc1a1c1770a0236f9461d5b68203403f5f3b19f40048cf5cb58e1`
- `docs/measurement/proof/live.json`: `941cfaeca2022d9e95128b12b95ff8c5770d961515c59ad0fa98ca0f932fcca0`
