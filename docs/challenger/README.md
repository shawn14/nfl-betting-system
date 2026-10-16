# Market residual challenger: rejected

This is a **retrospective research experiment**, not a replacement for the frozen production model and not evidence of an executable betting strategy. All historical periods had already been inspected in earlier research. The specification was saved before this candidate's first evaluation; that does not make the data an untouched holdout.

The candidate combines market probabilities with fixed Elo, rolling scoring and rest features. It fits a small regularized adjustment at each month boundary using earlier outcomes only. One fixed specification covers all five sports and three markets; there was no parameter sweep or post-result variant selection.

## Observed result

Evaluation covers January 2025 onward, through each sport's last archived game: **14,651 games / 43,653 market observations**, including two pushes. Feature history includes **28,520 non-preseason games**, even when their prices are missing. 4,203 evaluation observations fall back to the market because the candidate lacks sufficient history. Results include those fallbacks rather than quietly dropping them.

| Measure | Market baseline | Challenger |
|---|---:|---:|
| Log loss (lower is better) | 0.648394 | 0.648881 |
| Brier score (lower is better) | 0.230166 | 0.230395 |

Paired log-loss improvement is **−0.000487**, approximate week-clustered 95% interval **[−0.000778, −0.000195]**. The pooled result is worse. College basketball contributes most observations; see every sport/market cell in [result.json](result.json). None of the 15 individual cells has a positive lower confidence bound; those exploratory cell intervals are not adjusted for multiple comparisons.

The prespecified selection rule (expected return at least 2%, at most one market/side per game, flat one unit) chose **1,788 hypothetical bets**. Return at the recorded closing price was **−4.71%**; approximate week-clustered interval **[−9.14%, −0.27%]**. Charging an additional **1% of stake per selection** makes it **−5.71%**, interval **[−10.14%, −1.27%]**. That extra cost is a sensitivity assumption, not measured slippage or a sportsbook fee. There were no selected pushes; the grading code retains pushes in the denominator. NFL's small positive subgroup is uncertain and is not a promotion candidate.

**Decision: reject this challenger.** Do not deploy it, search this evaluation period for a flattering setting, or turn its hypothetical selections into recommendations. The useful product improvement is a reproducible rejection gate. Predictive improvement and “10x” returns have not been established.

## Why the old lab cannot certify timing

Executing the existing `market-lab.mjs` feature functions on the actual archive, then reversing same-kickoff game ordering, changes **16,329 supposedly pregame total features**. For Jacksonville–Indianapolis on October 6, 2024 at 17:00 UTC, the expected total changes from 41.7072 to 42.4621. Those simultaneous final scores were not available at kickoff. This diagnoses the research lab; it does not reconstruct what users saw or measure the size of any production performance inflation.

The old script also selects between two forecasts using evaluation log loss and uses full-sample outcome residuals for line-value calculations. Its opening-price test lacks opening-quote timestamps, so feature availability at the opening price is unverified. Preserve the old reports as historical artifacts, not forward evidence. [Actual replay and examples](legacy-timing-proof.json).

## What the replacement proves, and what it cannot

- Outcome updates wait until kickoff plus 24 hours. That is a conservative **assumption** because actual finish and source publication timestamps are absent. All feature inputs satisfy that chosen lag; this does not certify original data availability or revisions.
- Missing-price games still update ratings. Preseason does not. Training means/scales, coefficients and push estimates use earlier data only; coefficients freeze for each evaluation month.
- The market is an offset, not a label to beat by raw accuracy. Models revert to the baseline when history is insufficient, with a fixed cap on probability adjustments. There is no test-period choice of intercept, candidate or threshold.
- The archive contains “close” fields, not executable quote receipts. This is a closing-price probability diagnostic, not an opener strategy, CLV result, realized return, or proof of fills. After January 2025 the archived NBA/NHL/CBB/WNBA evaluation spread/total lines are all half-point lines; that coverage limits settlement generalization.
- One CBB game (`401828284`, three evaluation markets, zero selections) has provider name “DraftKings - Live Odds.” That label does not establish whether these archived close fields were pregame or in-play; absent timestamps, their provenance remains uncertain. The provider breakdown is preserved in the report. No after-the-fact exclusion was used to improve the result.
- Approximate uncertainty groups observations into seven-day UTC blocks, preserving within-game and within-block dependence. It is not a guarantee against dependence across blocks, source bias, historical selection or future regime changes.
- No new data request, paid call, bet, production model change or collector activation was made. Prospective collection still requires the separate activation approval recorded in the measurement runbook.

The first research priority is immutable prospective forecasts and contemporaneous executable prices. If that evidence does not support a better forecast, the system should abstain from claiming an edge. Additional team/injury/efficiency inputs would need their own timestamped availability record and a new future evaluation protocol.

## Reproduce offline

From the repository root with Node 25 (no install required):

```sh
node --no-warnings scripts/challenger/legacy-timing-proof.mjs --assert-legacy-safe
# Expected failure: original lab violates simultaneous-outcome invariance.
node --no-warnings scripts/challenger/run.mjs
node --no-warnings scripts/challenger/prove.mjs
```

[Protocol](protocol.json), [source hashes and metrics](result.json), [monthly fitted models](models.json), [every forecast](predictions.jsonl.gz), [every paper selection](paper-selections.json), [exhaustive local proof](proof.json).

The proof replays all records, checks source hashes, outcome-lag bounds, input-order invariance, changes future outcomes to verify earlier forecasts stay identical, reproduces every saved forecast/model/selection and independently checks payout arithmetic. A fresh reviewer independently reconstructed every evaluation row and all 180 monthly training sets in Python, without importing this engine or its math. It verified model first-order conditions, probability values, selected games, payouts and uncertainty. [Independent receipt](independent-review.json). College basketball is 63.3% of the pooled observations; equally weighting all 15 cells also gives a negative log-loss improvement (−0.001025).
