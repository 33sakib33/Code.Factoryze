import { scoringV1Schema, type BaselineComparison, type PromptAssessment, type ScoringV1, type ScoringContext } from '@factoryze/protocol';

/** v1: correctness gates the total; available components use spec weights 0.5/0.2/0.15 normalized by 0.85. */
export function scorePractice(correctness: { passed: number; total: number }, comparisons: BaselineComparison[], prompts: PromptAssessment[],
  context: ScoringContext = { baselineEligible: true, promptHistoryComplete: true }): ScoringV1 {
  const round = (n: number): number => Math.round(n * 10) / 10;
  const solved = correctness.total > 0 && correctness.passed === correctness.total;
  const valid = context.baselineEligible && comparisons.length === 1 ? comparisons[0] : undefined;
  const efficiency = valid ? round(100 * Math.min(1, 2 / (valid.weightedTokensRatio + valid.promptTurnsRatio))) : null;
  const assessed = context.promptHistoryComplete && prompts.length > 0 && prompts.every(p => p.status === 'scored' && p.verdict);
  const specificity = assessed ? round(prompts.reduce((sum, p) => sum + p.verdict!.specificity * (p.acceptedEdit ? 2 : 1), 0)
    / prompts.reduce((sum, p) => sum + (p.acceptedEdit ? 2 : 1), 0)) : null;
  const score = round(100 * correctness.passed / correctness.total);
  return scoringV1Schema.parse({ scoring_version: 1, correctness: score, efficiency, specificity,
    total: !solved ? 0 : efficiency === null || specificity === null ? null : round((10 * score + 4 * efficiency + 3 * specificity) / 17),
    unavailable: [...(!valid ? ['matching-baseline-unavailable'] : []), ...(!assessed ? ['judge-assessments-unavailable'] : [])] });
}
