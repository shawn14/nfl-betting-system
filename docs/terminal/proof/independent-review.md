# Independent terminal refutation — 2026-10-16

Read-only inspection of the running local terminal at `127.0.0.1:3307`, public prediction blobs, and existing archived provider responses. No paid provider calls, production writes, deployments, bets, or model changes. Captured at 03:29–03:32 UTC. This was an independent check; calculations below did not import the terminal or line-shop math.

## Blocker found: totals belonged to a different game

Before correction, the actual API returned 79 games and 503 individual bookmaker total quotes. Forecast blob hashes fetched directly matched the API's hashes. The per-book totals had no provider event ID, teams or start time in the forecast blob.

Observed counterexamples, then traced backward to the archived provider response:

| Terminal game | Provider event whose quotes it displayed | Exact shared book matches |
|---|---|---:|
| Colorado at Philadelphia, Oct 19 23:00 UTC, `401892536` | Pittsburgh at Colorado, Oct 17 01:10 UTC, `343be4cf732ddd9fd0a058953456d811` | 9 / 9 |
| Colorado at New Jersey, Oct 20 23:00 UTC, `401892540` | Same Pittsburgh–Colorado provider event | 9 / 9 |
| Atlanta at Golden State, Oct 20 00:00 UTC, `401918306` | Atlanta at Golden State, Oct 17 19:30 UTC, `fd0477adb898dbbdf52c129d0ea6c15e` | 9 / 9 |

Provider evidence: [NHL 02:07 snapshot](https://0luulmjdaimldet9.public.blob.vercel-storage.com/odds-board/snap/2026-10-16/0207-nhl.json.gz), [WNBA 03:07 snapshot](https://0luulmjdaimldet9.public.blob.vercel-storage.com/odds-board/snap/2026-10-16/0307-wnba.json.gz). Exact quote values, source hashes and timestamps are retained in [independent-review.json](independent-review.json).

Only after those observations, source inspection located the identity loss in every legacy sport writer: `gameKey.includes(homeTeam.name) || gameKey.includes(awayTeam.name)` accepts either team alone and does not require the date/time; the copied `liveOdds` also drops provider identity. See `src/app/api/cron/nhl-sync/route.ts` near line 672 and equivalent NFL/NBA/CBB/WNBA paths. Terminal's exact board match protected its board path but did not protect this separate embedded-totals path.

Required local mitigation: withhold all embedded per-book totals until their source event identity can be proven. Do not simply deduplicate identical prices, loosen event matching, or infer a provider ID from one team. The deployed legacy data writer remains a separate unmodified issue.

## Exact board path passed independent real-source checks

All 79 displayed forecasts exactly matched their published game's identities, times, probabilities and score/total/spread values. Every one of 13 joined games had exact home/away names and start time in both the board and original archived provider event. Every one of 74 markets and 148 displayed best sides matched the exact book, side, line and raw provider price. An independent American-odds conversion, bisection power de-vig, multiplicative de-vig, distinct-book median and leave-one-out EV calculation matched every published reference and EV to `1e-10`.

This proves transformation arithmetic and identity for these observed snapshots. It does not prove that model probabilities are calibrated, future picks have an edge, prices can be executed, or that the next provider snapshot will remain valid.

## Clocks and export

Provider timestamps for those 148 selected sides were 0.04–3.22 minutes before collection. The board summary discards those timestamps. Its `fetchedAt` proves collection age only, not individual quote freshness; label that distinction in the UI. Forecast publication likewise does not establish freshness of injury/weather/team-stat inputs.

The actual read-only evidence API returned HTTP 200 with exactly the selected NFL game's forecast, board event and hashes. Missing expected forecast hash returned 400; stale forecast hash and stale market hash each returned 409; invalid game ID returned 400. No silent substitution occurred.

## Additional fault found

Fault injection into copies of the actual fetched sources showed a single null entry in `games`, `events`, or `markets` threw from the normalizer and could fail the whole page/API. Current production payload did not contain those malformed entries. Add object guards and omit the affected record instead. An object-valued side label was rejected by the builder's in-progress label guard.

## Retest status

Retested the running API at 03:33:59 UTC: HTTP 200, 79 games, zero embedded per-book totals, 13 exact board joins, and an explicit withheld explanation on every game. The three counterexample games remain listed with their valid forecasts and no misidentified totals. Repeated all null-entry fault cases after object guards: all return 79 valid games without throwing; malformed side labels are rejected. The UI now states that individual provider update times are unavailable. The local terminal mitigation and malformed-row guards pass this independent check. The upstream legacy writer still needs separate repair before per-book quotes can return. Browser layout/interactions are being checked separately by the parent context.
