import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { competitions, routineResults, routines, routineScores } from "../db/schema.js";
import { collectFinalizedRoutineScores } from "./routineScoring.js";

export async function rebuildLeaderboard(competitionId: string) {
  const [comp] = await db.select().from(competitions).where(eq(competitions.id, competitionId));
  if (!comp) return;

  const rtList = await db.select().from(routines).where(eq(routines.competitionId, competitionId));

  const mapped: { routineId: string; finalScore: number; rank: number; updatedAt: string }[] = [];

  for (const routine of rtList) {
    const scores = await db.select().from(routineScores).where(eq(routineScores.routineId, routine.id));
    const totals = await collectFinalizedRoutineScores(scores);

    mapped.push({
      routineId: routine.id,
      finalScore: totals.finalScore,
      rank: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  mapped.sort((a, b) => b.finalScore - a.finalScore);
  mapped.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  const ids = rtList.map((rt) => rt.id);
  if (ids.length) await db.delete(routineResults).where(inArray(routineResults.routineId, ids));

  for (const entry of mapped) {
    await db.insert(routineResults).values({
      routineId: entry.routineId,
      finalScore: entry.finalScore,
      rank: entry.rank,
      updatedAt: entry.updatedAt,
    });
  }
}
