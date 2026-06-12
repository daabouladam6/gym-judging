import type { routineScores } from "../db/schema.js";
import { deductionSum } from "../scores/helpers.js";
import { computeRoutineFinalScore } from "@gym/shared";

export async function collectFinalizedRoutineScores(scores: (typeof routineScores.$inferSelect)[]) {
  const eDeductionTotals: number[] = [];
  const dScores: number[] = [];

  for (const row of scores) {
    if (!row.finalized) continue;
    if (row.scoreType === "EXECUTION") {
      eDeductionTotals.push(await deductionSum(row.id));
    } else {
      dScores.push(row.adminOverrideD ?? row.dValue ?? 0);
    }
  }

  return computeRoutineFinalScore(dScores, eDeductionTotals);
}
