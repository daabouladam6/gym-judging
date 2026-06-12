import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  athletes,
  competitions,
  deductionEvents,
  judgeAssignments,
  judgeCategoryAssignments,
  routineResults,
  routineScores,
  routines,
  scoreModificationLogs,
  sessions,
  users,
} from "../db/schema.js";
import { rebuildLeaderboard } from "./aggregation.js";

async function deleteRoutinesCascade(routineIds: string[]) {
  if (!routineIds.length) return;
  const scores = await db
    .select({ id: routineScores.id })
    .from(routineScores)
    .where(inArray(routineScores.routineId, routineIds));
  const scoreIds = scores.map((s) => s.id);
  if (scoreIds.length) {
    await db.delete(deductionEvents).where(inArray(deductionEvents.routineScoreId, scoreIds));
    await db.delete(scoreModificationLogs).where(inArray(scoreModificationLogs.routineScoreId, scoreIds));
    await db.delete(routineScores).where(inArray(routineScores.id, scoreIds));
  }
  await db.delete(routineResults).where(inArray(routineResults.routineId, routineIds));
  await db.delete(routines).where(inArray(routines.id, routineIds));
}

export async function deleteAthleteById(athleteId: string) {
  const rts = await db.select({ id: routines.id }).from(routines).where(eq(routines.athleteId, athleteId));
  await deleteRoutinesCascade(rts.map((r) => r.id));
  await db.delete(athletes).where(eq(athletes.id, athleteId));
}

export async function deleteCompetitionById(competitionId: string) {
  const rts = await db
    .select({ id: routines.id })
    .from(routines)
    .where(eq(routines.competitionId, competitionId));
  await deleteRoutinesCascade(rts.map((r) => r.id));
  await db.delete(judgeCategoryAssignments).where(eq(judgeCategoryAssignments.competitionId, competitionId));
  await db.delete(judgeAssignments).where(eq(judgeAssignments.competitionId, competitionId));
  await db.delete(athletes).where(eq(athletes.competitionId, competitionId));
  await db.delete(competitions).where(eq(competitions.id, competitionId));
}

export async function deleteJudgeById(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new Error("User not found");
  if (u.role !== "JUDGE") throw new Error("Only judge accounts can be deleted here");

  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(judgeCategoryAssignments).where(eq(judgeCategoryAssignments.judgeUserId, userId));
  await db.delete(judgeAssignments).where(eq(judgeAssignments.judgeUserId, userId));

  const scores = await db
    .select({ id: routineScores.id })
    .from(routineScores)
    .where(eq(routineScores.judgeUserId, userId));
  const scoreIds = scores.map((s) => s.id);
  if (scoreIds.length) {
    await db.delete(deductionEvents).where(inArray(deductionEvents.routineScoreId, scoreIds));
    await db.delete(scoreModificationLogs).where(inArray(scoreModificationLogs.routineScoreId, scoreIds));
    await db.delete(routineScores).where(inArray(routineScores.id, scoreIds));
  }

  await db.delete(users).where(eq(users.id, userId));
}

/** Remove one apparatus + E/D panel row only. Routine scores stay on the athlete’s routine. */
export async function deleteJudgeAssignmentById(competitionId: string, assignmentId: string) {
  const [ja] = await db.select().from(judgeAssignments).where(eq(judgeAssignments.id, assignmentId));
  if (!ja || ja.competitionId !== competitionId) throw new Error("Assignment not found");

  await db.delete(judgeAssignments).where(eq(judgeAssignments.id, assignmentId));
  await rebuildLeaderboard(competitionId);
}
