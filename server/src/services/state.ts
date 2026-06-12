import { athleteCategoryKey, athleteMatchesCategoryKey, type AthleteLevel } from "@gym/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  athletes,
  competitions,
  judgeAssignments,
  judgeCategoryAssignments,
  routineResults,
  routineScores,
  routines,
  scoreModificationLogs,
  users,
} from "../db/schema.js";
import { computeExecutionDisplayed, deductionSum } from "../scores/helpers.js";
import { collectFinalizedRoutineScores } from "./routineScoring.js";

/** SQLite DBs created before audit columns existed will error on SELECT; retry without those columns. */
function auditSummaryColumnMissing(err: unknown): boolean {
  const m = String(err instanceof Error ? err.message : err);
  // SQLite may report `no such column: previous_summary` or `...score_modification_logs.previous_summary`
  return /no such column:.*(previous_summary|next_summary)/i.test(m);
}

export type BuildStatePayloadOptions = {
  /** When set, snapshot is limited to archived athletes in this category (History viewer). */
  historyCategoryKey?: string;
};

export async function buildStatePayload(competitionId: string, opts?: BuildStatePayloadOptions) {
  const [competition] = await db.select().from(competitions).where(eq(competitions.id, competitionId));
  if (!competition) return null;

  const allAth = await db.select().from(athletes).where(eq(athletes.competitionId, competitionId));

  let ath: typeof allAth;
  if (opts?.historyCategoryKey) {
    ath = allAth.filter(
      (a) =>
        Boolean(a.archivedAt) &&
        athleteCategoryKey(a.level as AthleteLevel, a.yearOfBirth) === opts.historyCategoryKey,
    );
  } else {
    ath = allAth.filter((a) => !a.archivedAt);
  }

  const athIds = new Set(ath.map((a) => a.id));

  const allRts = await db.select().from(routines).where(eq(routines.competitionId, competitionId));
  const rts = allRts.filter((r) => athIds.has(r.athleteId));
  const visibleRoutineIds = new Set(rts.map((r) => r.id));

  const scoresRows =
    rts.length === 0
      ? []
      : await db
          .select()
          .from(routineScores)
          .where(inArray(routineScores.routineId, rts.map((x) => x.id)));

  const allUsers = await db.select().from(users);
  const userNameById = new Map(allUsers.map((u) => [u.id, u.displayName]));

  const mapLogRows = (
    rows: {
      id: string;
      routineScoreId: string;
      fieldChanged: string;
      reason: string;
      source: string;
      actorUserId: string | null;
      createdAt: string;
      apparatus: string;
      athleteName: string;
      previousSummary?: string | null;
      nextSummary?: string | null;
    }[],
  ) =>
    rows.map((row) => ({
      id: row.id,
      routineScoreId: row.routineScoreId,
      fieldChanged: row.fieldChanged,
      reason: row.reason,
      source: row.source,
      actorUserId: row.actorUserId,
      actorName: row.actorUserId ? (userNameById.get(row.actorUserId) ?? row.actorUserId.slice(0, 8)) : null,
      createdAt: row.createdAt,
      previousSummary: row.previousSummary ?? null,
      nextSummary: row.nextSummary ?? null,
      apparatus: row.apparatus,
      athleteName: row.athleteName,
    }));

  let modificationLogs;
  try {
    const modificationLogsJoined = await db
      .select({
        id: scoreModificationLogs.id,
        routineScoreId: scoreModificationLogs.routineScoreId,
        fieldChanged: scoreModificationLogs.fieldChanged,
        reason: scoreModificationLogs.reason,
        source: scoreModificationLogs.source,
        actorUserId: scoreModificationLogs.actorUserId,
        createdAt: scoreModificationLogs.createdAt,
        previousSummary: scoreModificationLogs.previousSummary,
        nextSummary: scoreModificationLogs.nextSummary,
        apparatus: routines.apparatus,
        athleteName: athletes.name,
        routineId: routines.id,
      })
      .from(scoreModificationLogs)
      .innerJoin(routineScores, eq(routineScores.id, scoreModificationLogs.routineScoreId))
      .innerJoin(routines, eq(routines.id, routineScores.routineId))
      .innerJoin(athletes, eq(athletes.id, routines.athleteId))
      .where(eq(routines.competitionId, competitionId))
      .orderBy(desc(scoreModificationLogs.createdAt))
      .limit(220);

    modificationLogs = mapLogRows(
      modificationLogsJoined.filter((row) => visibleRoutineIds.has(row.routineId)),
    );
  } catch (err) {
    if (!auditSummaryColumnMissing(err)) throw err;

    const modificationLogsJoined = await db
      .select({
        id: scoreModificationLogs.id,
        routineScoreId: scoreModificationLogs.routineScoreId,
        fieldChanged: scoreModificationLogs.fieldChanged,
        reason: scoreModificationLogs.reason,
        source: scoreModificationLogs.source,
        actorUserId: scoreModificationLogs.actorUserId,
        createdAt: scoreModificationLogs.createdAt,
        apparatus: routines.apparatus,
        athleteName: athletes.name,
        routineId: routines.id,
      })
      .from(scoreModificationLogs)
      .innerJoin(routineScores, eq(routineScores.id, scoreModificationLogs.routineScoreId))
      .innerJoin(routines, eq(routines.id, routineScores.routineId))
      .innerJoin(athletes, eq(athletes.id, routines.athleteId))
      .where(eq(routines.competitionId, competitionId))
      .orderBy(desc(scoreModificationLogs.createdAt))
      .limit(220);

    modificationLogs = mapLogRows(
      modificationLogsJoined.filter((row) => visibleRoutineIds.has(row.routineId)),
    );
  }

  const rankingsJoined = await db
    .select({
      rr: routineResults,
      athlete: athletes,
      routine: routines,
    })
    .from(routineResults)
    .innerJoin(routines, eq(routines.id, routineResults.routineId))
    .innerJoin(athletes, eq(athletes.id, routines.athleteId))
    .where(eq(routines.competitionId, competitionId));

  const rankingsVisible = rankingsJoined.filter((row) => athIds.has(row.athlete.id));
  rankingsVisible.sort((a, b) => a.rr.rank - b.rr.rank);

  const assignments = await db
    .select()
    .from(judgeAssignments)
    .where(eq(judgeAssignments.competitionId, competitionId));

  const routineById = new Map(rts.map((r) => [r.id, r]));
  const outScores = [];
  for (const s of scoresRows) {
    const rt = routineById.get(s.routineId);
    const lockedUi = !!(rt?.locked || s.finalized);
    let computedValue = 0;
    if (s.scoreType === "EXECUTION") {
      const sd = await deductionSum(s.id);
      computedValue = computeExecutionDisplayed(s, sd);
      outScores.push({
        id: s.id,
        routineId: s.routineId,
        judgeUserId: s.judgeUserId,
        scoreType: s.scoreType,
        computedValue,
        deductionTotal: sd,
        locked: lockedUi,
        finalized: s.finalized,
        version: s.version,
        startingValue: s.adminOverrideSv ?? s.startingValue ?? undefined,
        executionAdjustment: s.executionAdjustment ?? 0,
      });
      continue;
    }

    computedValue = s.adminOverrideD ?? s.dValue ?? 0;
    outScores.push({
      id: s.id,
      routineId: s.routineId,
      judgeUserId: s.judgeUserId,
      scoreType: s.scoreType,
      computedValue,
      locked: lockedUi,
      finalized: s.finalized,
      version: s.version,
      dValue: s.dValue ?? 0,
    });
  }

  const routineTotals = [];
  for (const routine of rts) {
    const rows = scoresRows.filter((score) => score.routineId === routine.id);
    const totals = await collectFinalizedRoutineScores(rows);
    routineTotals.push({
      routineId: routine.id,
      dScore: totals.dScore,
      avgDeductions: totals.avgDeductions,
      eJudgeCount: totals.eJudgeCount,
      finalScore: totals.finalScore,
    });
  }

  const athleteById = new Map(ath.map((a) => [a.id, a]));

  const scoreboard = [];
  for (const routine of rts) {
    const athlete = athleteById.get(routine.athleteId);
    const rows = scoresRows.filter((score) => score.routineId === routine.id);
    const dRow = rows.find((score) => score.scoreType === "DIFFICULTY");
    const eRows = rows.filter((score) => score.scoreType === "EXECUTION");
    const total = routineTotals.find((entry) => entry.routineId === routine.id);

    const eJudges = [];
    for (const eRow of eRows) {
      eJudges.push({
        scoreId: eRow.id,
        judgeName: userNameById.get(eRow.judgeUserId) ?? eRow.judgeUserId.slice(0, 8),
        deductions: await deductionSum(eRow.id),
        version: eRow.version,
        finalized: eRow.finalized,
      });
    }

    const categoryKey = athlete ? athleteCategoryKey(athlete.level as AthleteLevel, athlete.yearOfBirth) : "__unknown__";

    scoreboard.push({
      routineId: routine.id,
      athleteId: athlete?.id ?? "",
      athleteName: athlete?.name ?? "Unknown",
      categoryKey,
      apparatus: routine.apparatus,
      dScoreId: dRow?.id ?? null,
      dValue: dRow ? (dRow.adminOverrideD ?? dRow.dValue ?? 0) : 0,
      dVersion: dRow?.version ?? 0,
      dFinalized: dRow?.finalized ?? false,
      eJudges,
      avgDeductions: total?.avgDeductions ?? 0,
      finalScore: total?.finalScore ?? 0,
    });
  }

  scoreboard.sort(
    (a, b) =>
      a.categoryKey.localeCompare(b.categoryKey) ||
      a.athleteName.localeCompare(b.athleteName) ||
      a.apparatus.localeCompare(b.apparatus),
  );

  const snapshot = {
    competition: {
      id: competition.id,
      name: competition.name,
      deductionPresetMode: competition.deductionPresetMode,
      aggregationRule: competition.aggregationRule,
    },
    athletes: ath.map((a) => ({
      id: a.id,
      name: a.name,
      level: a.level,
      yearOfBirth: a.yearOfBirth,
      archivedAt: a.archivedAt ?? null,
    })),
    routines: rts.map((r) => ({
      id: r.id,
      athleteId: r.athleteId,
      apparatus: r.apparatus,
      version: r.version,
      locked: r.locked,
    })),
    scores: outScores,
    routineTotals,
    scoreboard,
    rankings: rankingsVisible.map(({ rr, athlete, routine }) => ({
      rank: rr.rank,
      athleteName: athlete.name,
      apparatus: routine.apparatus,
      finalScore: rr.finalScore,
      routineId: routine.id,
    })),
    modificationLogs,
  };

  return { snapshot, assignments };
}

export async function buildCompetitionViewerPayload(
  competitionId: string,
  viewer: { id: string; role: string },
  opts?: BuildStatePayloadOptions,
) {
  const base = await buildStatePayload(competitionId, opts);
  if (!base) return null;

  if (viewer.role !== "JUDGE") return base;

  const myCats = await db
    .select()
    .from(judgeCategoryAssignments)
    .where(
      and(eq(judgeCategoryAssignments.competitionId, competitionId), eq(judgeCategoryAssignments.judgeUserId, viewer.id)),
    );

  const myAssignments = await db
    .select()
    .from(judgeAssignments)
    .where(
      and(eq(judgeAssignments.competitionId, competitionId), eq(judgeAssignments.judgeUserId, viewer.id)),
    );

  const categoryKeys = new Set(myCats.map((c) => c.categoryKey));
  const apparatusSet = new Set(myAssignments.map((a) => a.apparatus));

  const visibleAthletes =
    categoryKeys.size === 0
      ? []
      : base.snapshot.athletes.filter((a) =>
          [...categoryKeys].some((k) =>
            athleteMatchesCategoryKey({ level: a.level as AthleteLevel, yearOfBirth: a.yearOfBirth }, k),
          ),
        );

  const athleteIdSet = new Set(visibleAthletes.map((a) => a.id));
  const routines = base.snapshot.routines.filter((r) => apparatusSet.has(r.apparatus) && athleteIdSet.has(r.athleteId));

  const routineIdSet = new Set(routines.map((r) => r.id));
  const scores = base.snapshot.scores.filter(
    (s) => s.judgeUserId === viewer.id && routineIdSet.has(s.routineId),
  );

  return {
    snapshot: {
      ...base.snapshot,
      athletes: visibleAthletes,
      routines,
      scores,
      routineTotals: [],
      scoreboard: [],
      rankings: [],
      modificationLogs: [],
    },
    assignments: base.assignments.filter((a) => a.judgeUserId === viewer.id),
  };
}

export async function listUsersSafe() {
  const all = await db.select().from(users);
  return all.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
  }));
}
