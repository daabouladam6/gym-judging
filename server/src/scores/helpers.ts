import { eq } from "drizzle-orm";
import type { DeductionPresetMode } from "@gym/shared";
import { deductionPresetForAthleteLevel } from "@gym/shared";
import { db } from "../db/index.js";
import {
  athletes,
  competitions,
  deductionEvents,
  routineScores,
  routines,
  scoreModificationLogs,
} from "../db/schema.js";
import crypto from "node:crypto";

export async function deductionSum(rsId: string): Promise<number> {
  const rows = await db.select().from(deductionEvents).where(eq(deductionEvents.routineScoreId, rsId));
  return rows.reduce((a, r) => a + r.amount, 0);
}

export function effectiveStartingValue(row: typeof routineScores.$inferSelect): number {
  return row.adminOverrideSv ?? row.startingValue ?? 10;
}

export function computeExecutionDisplayed(row: typeof routineScores.$inferSelect, sumDeductions: number): number {
  if (row.adminOverrideExe != null) return row.adminOverrideExe;
  const sv = effectiveStartingValue(row);
  const adj = row.executionAdjustment ?? 0;
  return Math.max(0, sv + adj - sumDeductions);
}

export async function refreshExecutionStored(rowId: string) {
  const [row] = await db.select().from(routineScores).where(eq(routineScores.id, rowId));
  if (!row || row.scoreType !== "EXECUTION") return;
  const sd = await deductionSum(row.id);
  const computed = computeExecutionDisplayed(row, sd);
  await db
    .update(routineScores)
    .set({ computedExecution: computed, updatedAt: new Date().toISOString() })
    .where(eq(routineScores.id, rowId));
}

export async function logModification(input: {
  routineScoreId: string;
  fieldChanged: string;
  reason: string;
  source: string;
  actorUserId?: string | null;
  previousSummary?: string | null;
  nextSummary?: string | null;
}) {
  await db.insert(scoreModificationLogs).values({
    id: crypto.randomUUID(),
    routineScoreId: input.routineScoreId,
    fieldChanged: input.fieldChanged,
    reason: input.reason,
    source: input.source,
    actorUserId: input.actorUserId ?? null,
    previousSummary: input.previousSummary ?? null,
    nextSummary: input.nextSummary ?? null,
    createdAt: new Date().toISOString(),
  });
}

export async function routinePresetForRoutineId(routineId: string): Promise<DeductionPresetMode> {
  const [joined] = await db
    .select({ level: athletes.level, preset: competitions.deductionPresetMode })
    .from(routines)
    .innerJoin(competitions, eq(competitions.id, routines.competitionId))
    .innerJoin(athletes, eq(athletes.id, routines.athleteId))
    .where(eq(routines.id, routineId));
  if (joined?.level) return deductionPresetForAthleteLevel(joined.level);
  return ((joined?.preset as DeductionPresetMode) || "FIG_HP") as DeductionPresetMode;
}

export async function loadScoreAndRoutine(rsId: string) {
  const [joined] = await db
    .select({ row: routineScores, routine: routines })
    .from(routineScores)
    .innerJoin(routines, eq(routines.id, routineScores.routineId))
    .where(eq(routineScores.id, rsId));
  return joined;
}
