/** Final routine score = max(0, D − average of E judges' total deductions) (same apparatus). */
export function averageJudgeScores(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type RoutineFinalScore = {
  dScore: number;
  avgDeductions: number;
  eJudgeCount: number;
  finalScore: number;
};

export function computeRoutineFinalScore(
  dScores: number[],
  eDeductionTotals: number[],
): RoutineFinalScore {
  const dScore = averageJudgeScores(dScores);
  const avgDeductions = averageJudgeScores(eDeductionTotals);
  return {
    dScore,
    avgDeductions,
    eJudgeCount: eDeductionTotals.length,
    finalScore: Math.max(0, dScore - avgDeductions),
  };
}
