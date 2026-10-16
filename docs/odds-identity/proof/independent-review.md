# Independent odds-identity review

Reviewed by a fresh refuter against the actual production parser/matcher module and complete archived provider responses, not the builder's proof result. No paid provider calls, cron executions, production writes, deploys or model changes were performed.

## Evidence observed

| Archived sport | Raw events | Retained events | Raw total-book quotes | Retained exact quotes | Forecast games | Exact matches |
|---|---:|---:|---:|---:|---:|---:|
| NFL | 13 | 13 | 128 | 128 | 14 | 12 |
| NHL | 8 | 8 | 62 | 62 | 49 | 0 |
| WNBA | 1 | 1 | 10 | 10 | 3 | 1 |
| Total | 22 | 22 | 200 | 200 | 66 | 13 |

For every raw total quote I independently calculated price validity and margin, then compared retained book identity, offered line, Over/Under prices and provider update time directly against the raw event. All 200 valid quotes were preserved exactly. No manufactured prices or averaged American prices appeared in the output. Every matched forecast had exactly the same two named teams in the same roles and the same parsed start instant as exactly one provider event.

Separate mutations of real records rejected wrong sport, swapped home/away, wrong date, empty event ID, future collection clocks, duplicated bookmaker records, future/stale/missing provider clocks and invalid American prices. Real minute-precision ESPN timestamps match equivalent second-precision provider timestamps. February 30 is rejected.

The transport still requests the same sport endpoint, US region, spreads/totals/h2h markets and American format through the existing paid fetch path. This review never invoked that transport. Repository-wide caller search found no remaining internal dependency on the removed spread/ML return fields or averaged-price helper. All five writer diffs replace the either-team substring match with the shared identity matcher, without changing model constants or forecast formulae.

## Limits and findings

1. **Strict matching deliberately withholds coverage.** Of 66 forecasts, 53 have no accepted quote match. Of these, 47 have no same-team-pair provider record in the archived response, and six have a different start instant. NHL has zero matches in this replay. The four same-team NHL candidates differ by 8m05s or 10m; this alone is NOT evidence they are different games. NFL Seattle–Denver differs by 50s. WNBA Atlanta–Golden State differs by more than three days, representing the repeated matchup/date problem. An identity mapping resolved by authoritative schedule evidence would be a separate improvement; silently widening the tolerance would weaken this guard.
2. **NBA and CBB provider data are untested.** Their source wiring is inspected, but these archives only contain real NFL, NHL and WNBA responses. Do not claim five-sport real-provider runtime proof.
3. **Writer and deployed runtime remain unverified.** The shared parser/matcher executed locally on archived real responses. Real cron routes were not run because they can spend credits and mutate production; deployment is not approved. The browser/render work is owned by the parent reviewer.
4. **Initial wiring defect corrected in the reviewed source:** all five live pages now import `verifiedLiveOdds`. The independent recheck inspected each import and each loader call. TypeScript/build verification remains the parent review's separate responsibility.
5. **Initial presentation caveat corrected in the reviewed source:** all five pages now describe periodically observed lines and render “Quotes as of” from `lastUpdated`; the manufactured consensus-price display is removed. For every accepted raw event I independently verified that `lastUpdated` equals the oldest retained bookmaker quote timestamp. This is source inspection and data execution, not a rendered-browser claim. Near/live-game observations can still be up to 45 minutes old, as the guard specifies.

6. **Native NFL kickoff type independently verified:** `fetchNFLSchedule` produces native `Date` values. I reran every one of the 22 provider events through `matchGameOdds` with both its ISO start string and the equivalent native `Date`: outputs are identical. Invalid Dates, absent kickoff values and numeric timestamps are rejected. All 200 retained prices were rechecked against the original response after this normalization change.

The test establishes local identity/quote integrity, not profitable edge, predictive accuracy, live availability, or released behavior.

Reviewed at: 2026-10-16T04:01:34.456649+00:00

Parser SHA-256: `63a5ff7e913602e901400dd03132605d00375769f94776e5e7aa91ef7d10ba15`.
