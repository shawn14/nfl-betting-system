// Model freeze marker. Stamped on every stored result row as `modelVersion` so the edge ledger
// can judge the model strictly on games predicted after the freeze.
//
// 2026-09-11-freeze: mechanical fixes only (home advantage taken out of predicted totals and put
// into the spread; NFL home field 3.0; NFL conviction count drops large-spread and Elo-mismatch;
// preseason games no longer ingested). Every threshold and conviction rule is frozen as of this
// date. Do NOT re-tune on stored history — judge on live results only. Bump this string when (and
// only when) the model or a rule changes, and record why in CLAUDE.md.
export const MODEL_VERSION = '2026-09-11-freeze';
