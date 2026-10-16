# Prediction Matrix decision terminal

## Evidence, October 16, 2026

AppleCharts searched “sports betting odds”: 24 search results, six apps, 250 fetched reviews, 82 within three months, latest October 13. Four of six apps reached the requested review window. Search order is not a download chart. Modeled revenue in the raw roadmap is not used. Classifier themes are directional and contain false positives: nine subscription complaints, five reliability signals, three support complaints, two filtering signals. [Raw evidence](market-research.json).

| Search position | App | Rating | Ratings |
| --- | --- | --- | --- |
| 1 | Scores and Odds Sports Betting | 4.73 | 18,538 |
| 2 | Action Network | 4.76 | 37,966 |
| 3 | BettingPros | 4.78 | 16,149 |
| 4 | Outlier | 4.87 | 16,729 |
| 5 | Live Scores and Odds | 4.78 | 10,011 |
| 6 | OddsJam | 4.73 | 2,346 |

The professional benchmark is integrated research and decision tools ([Bloomberg](https://bloomberg.com/professional/solution/bloomberg-terminal/)). For sports, [Unabated](https://www.unabated.com/tools/odds-tools) demonstrates exact-line comparison and visible price movement; [OddsTrader](https://www.oddstrader.com/about-us/) separates information, model picks and review standards. These are workflow references, not evidence that their picks win.

Our own observed sources: 13 future NFL, 16 NBA, 47 NHL and three WNBA games; CBB empty. The latest board had 12 NFL, one WNBA and three NHL events, some already started. Raw model totals contain bookmaker-specific lines/prices, but independent review proved wrong-game reuse: they are withheld. Moneyline/spread board summaries contain only best-side quotes, not a complete book matrix. Do not pretend otherwise. Some score projections and win-probability favorites disagree; display that fact instead of merging them into confidence.

## Core three

1. **Find the game and price worth investigating.** Evidence: review request to put relevant statistics beside the pick, praise for filters; existing 79-game multi-sport source is fragmented. Build: dense searchable/sortable list, sport and horizon filters, exact-event best-side line comparisons and visible stale/missing coverage. Defer: new paid feeds and a bigger sport universe. Verify every projected row against its actual source; past/future-clock/stale prices cannot rank as current value.
2. **Understand why the model differs from the market.** Evidence: Unabated's exact-line workflow and our contradictory score/probability signals. Build: selected-game forecast, scoring inputs, injuries/weather/rest when actually supplied, model-market probability gap, source times and direct evidence export. Defer: generated AI rationales and model retuning. Verify probability math, team/time identity, price-side orientation and explicit signal disagreement.
3. **Keep a decision and learn from an honest record.** Evidence: reliability/vanishing-bet complaints and our postgame leakage audit. Build: persistent local shortlist of identities, real source export, direct immutable-measurement status/results access. A shortlist is not a bet or an immutable forecast. Defer: execution, bankroll staking, sportsbook account sync. Verify reload persistence and export provenance; the separate measurement release remains required for forward outcome claims.

## First implementation slice

A `/terminal` workspace with list + selected-game research/prices, all five existing sports, keyboard search/row navigation, local shortlist and JSON evidence download. Reuse the existing Blob writers, fair-value/line-shop engine and immutable measurement reader. The proposed per-book total matrix was removed when event identity failed independent review; the verified board retains exact-line best-side comparisons. Six shared cached public Blob reads; no new scheduler, paid request, model parameters or credentials. Bound each sport to 64 upcoming games within eight days and expose exclusions. Full-width desktop, 390px mobile, no content cards.

Primary audience: a person deciding which pregame opinion deserves further research. Product promise: inspect the forecast and offered price with their evidence in one place. No new paywall or onboarding; immediate working surface. Unknown data stays unknown. Freshness follows known collection cadence (150 minutes far from start; 45 minutes within six hours). “Refreshed screen” is not “bookmaker updated.”

Build/verify sequence: normalize and exhaustively prove real source rows; build the terminal and drive its real browser flow; independent refuter and saved desktop/mobile evidence. Then Shawn reviews this slice. The larger goal still includes releasing immutable measurement, actual postgame proof, and a preregistered challenger/research process before any model promotion. A better screen alone cannot establish improved prediction accuracy.
