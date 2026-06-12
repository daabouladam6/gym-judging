import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "./db/index.js";
import { judgeAssignments, routineScores, routines } from "./db/schema.js";

export async function ensureRoutineForAthlete(
  competitionId: string,
  athleteId: string,
  apparatus: string,
) {
  const [existing] = await db
    .select()
    .from(routines)
    .where(
      and(
        eq(routines.competitionId, competitionId),
        eq(routines.athleteId, athleteId),
        eq(routines.apparatus, apparatus),
      ),
    )
    .limit(1);

  if (existing) {
    await spawnRoutineScores(existing.id, competitionId, apparatus);
    return existing;
  }

  const rid = crypto.randomUUID();
  await db.insert(routines).values({
    id: rid,
    competitionId,
    athleteId,
    apparatus,
    version: 0,
    locked: false,
  });
  await spawnRoutineScores(rid, competitionId, apparatus);
  const [created] = await db.select().from(routines).where(eq(routines.id, rid));
  return created!;
}

export async function spawnRoutineScores(routineId: string, competitionId: string, apparatus: string) {
  const assigns = await db
    .select()
    .from(judgeAssignments)
    .where(and(eq(judgeAssignments.competitionId, competitionId), eq(judgeAssignments.apparatus, apparatus)));

  const now = new Date().toISOString();
  for (const ja of assigns) {
    const scoreType = ja.panelRole === "E" ? ("EXECUTION" as const) : ("DIFFICULTY" as const);
    try {
      await db.insert(routineScores).values({
        id: crypto.randomUUID(),
        routineId,
        judgeUserId: ja.judgeUserId,
        scoreType,
        startingValue: scoreType === "EXECUTION" ? 10 : null,
        executionAdjustment: 0,
        dValue: scoreType === "DIFFICULTY" ? 0 : null,
        computedExecution: scoreType === "EXECUTION" ? 10 : 0,
        finalized: false,
        version: 0,
        updatedAt: now,
      });
    } catch {
      /* ignore duplicate */
    }
  }
}
