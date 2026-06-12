import { and, eq } from "drizzle-orm";
import { isValidDeduction } from "@gym/shared";
import crypto from "node:crypto";
import { db } from "../db/index.js";
import {
  deductionEvents,
  judgeAssignments,
  judgeCorrectionRequests,
  routineScores,
  routines,
  athletes,
  users,
} from "../db/schema.js";
import {
  computeExecutionDisplayed,
  deductionSum,
  effectiveStartingValue,
  logModification,
  refreshExecutionStored,
  routinePresetForRoutineId,
  loadScoreAndRoutine,
} from "./helpers.js";

export async function roleOf(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  return u?.role;
}

/** Archived athlete groups are out of the judge workspace; block judge score mutations if routine's athlete is archived. */
async function assertRoutineAthleteActiveForJudging(routineId: string) {
  const [rt] = await db.select().from(routines).where(eq(routines.id, routineId));
  if (!rt) throw new Error("Routine not found");
  const [a] = await db.select().from(athletes).where(eq(athletes.id, rt.athleteId));
  if (a?.archivedAt) {
    throw new Error(
      "That athlete group is in History. Judges cannot score it until an admin restores the category from History.",
    );
  }
}

async function assertJudgeCanEdit(
  userId: string,
  competitionId: string,
  routineId: string,
  scoreType: "EXECUTION" | "DIFFICULTY",
) {
  const [rt] = await db.select().from(routines).where(eq(routines.id, routineId));
  if (!rt || rt.competitionId !== competitionId) throw new Error("Routine not in competition");
  const needRole = scoreType === "EXECUTION" ? "E" : "D";
  const [ja] = await db
    .select()
    .from(judgeAssignments)
    .where(
      and(
        eq(judgeAssignments.competitionId, competitionId),
        eq(judgeAssignments.judgeUserId, userId),
        eq(judgeAssignments.apparatus, rt.apparatus),
        eq(judgeAssignments.panelRole, needRole),
      ),
    );
  if (!ja) throw new Error("Not assigned for this routine");
  return rt;
}

export async function applyDeduction(input: {
  userId: string;
  competitionId: string;
  routineScoreId: string;
  amount: number;
  clientRequestId: string;
  expectedVersion: number;
}) {
  const ctx = await loadScoreAndRoutine(input.routineScoreId);
  if (!ctx || ctx.row.scoreType !== "EXECUTION") throw new Error("Invalid score");
  if (ctx.routine.competitionId !== input.competitionId) throw new Error("Wrong competition");
  if (ctx.row.judgeUserId !== input.userId) throw new Error("Not your score");
  await assertRoutineAthleteActiveForJudging(ctx.row.routineId);
  await assertJudgeCanEdit(input.userId, input.competitionId, ctx.row.routineId, "EXECUTION");
  if (ctx.routine.locked) throw new Error("Routine locked");
  if (ctx.row.finalized) throw new Error("Finalized");

  const preset = await routinePresetForRoutineId(ctx.row.routineId);
  if (!isValidDeduction(input.amount, preset)) throw new Error("Deduction amount not allowed");
  if (ctx.row.version !== input.expectedVersion) throw new Error("Version conflict");

  const sd = await deductionSum(ctx.row.id);
  const sv = effectiveStartingValue(ctx.row);
  const adj = ctx.row.executionAdjustment ?? 0;
  const maxDeductionSum = sv + adj;
  if (sd + input.amount > maxDeductionSum + 1e-9) {
    throw new Error("Deductions cannot take your execution score below zero.");
  }

  try {
    await db.insert(deductionEvents).values({
      id: crypto.randomUUID(),
      routineScoreId: ctx.row.id,
      amount: input.amount,
      clientRequestId: input.clientRequestId,
      createdAt: new Date().toISOString(),
    });
  } catch {
    return;
  }

  await db
    .update(routineScores)
    .set({
      version: ctx.row.version + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(routineScores.id, ctx.row.id));

  await refreshExecutionStored(ctx.row.id);
  await logModification({
    routineScoreId: ctx.row.id,
    fieldChanged: `DEDUCTION:${input.amount}`,
    reason: "Judge deduction pad",
    source: "DEDUCTION_ADD",
    actorUserId: input.userId,
  });
}

export async function manualScoreEdit(input: {
  userId: string;
  competitionId: string;
  routineScoreId: string;
  targetField: "STARTING_VALUE" | "EXECUTION_DIRECT" | "D_VALUE";
  newValue: number;
  reason: string;
  expectedVersion: number;
}) {
  const ctx = await loadScoreAndRoutine(input.routineScoreId);
  if (!ctx) throw new Error("Invalid score");
  if (ctx.routine.competitionId !== input.competitionId) throw new Error("Wrong competition");
  if (ctx.row.judgeUserId !== input.userId) throw new Error("Not your score");
  await assertRoutineAthleteActiveForJudging(ctx.row.routineId);
  if (ctx.routine.locked) throw new Error("Routine locked");
  if (ctx.row.finalized) throw new Error("Finalized");

  if (input.targetField === "D_VALUE") {
    if (ctx.row.scoreType !== "DIFFICULTY") throw new Error("Wrong score type");
    await assertJudgeCanEdit(input.userId, input.competitionId, ctx.row.routineId, "DIFFICULTY");
  } else if (input.targetField === "STARTING_VALUE" || input.targetField === "EXECUTION_DIRECT") {
    if (ctx.row.scoreType !== "EXECUTION") throw new Error("Wrong score type");
    await assertJudgeCanEdit(input.userId, input.competitionId, ctx.row.routineId, "EXECUTION");
  }

  if (ctx.row.version !== input.expectedVersion) throw new Error("Version conflict");

  if (input.targetField === "STARTING_VALUE") {
    const prevSv = ctx.row.adminOverrideSv ?? ctx.row.startingValue ?? undefined;
    await db
      .update(routineScores)
      .set({
        startingValue: input.newValue,
        executionAdjustment: 0,
        adminOverrideSv: null,
        version: ctx.row.version + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(routineScores.id, ctx.row.id));
    await logModification({
      routineScoreId: ctx.row.id,
      fieldChanged: "STARTING_VALUE",
      reason: input.reason,
      source: "MANUAL_SCORE_EDIT",
      actorUserId: input.userId,
      previousSummary: prevSv != null ? `Starting value ${Number(prevSv).toFixed(3)}` : null,
      nextSummary: `Starting value ${input.newValue.toFixed(3)}`,
    });
  } else if (input.targetField === "EXECUTION_DIRECT") {
    const sd = await deductionSum(ctx.row.id);
    const prevCv = computeExecutionDisplayed(ctx.row, sd);
    const sv = effectiveStartingValue(ctx.row);
    const clampedDisplay = Math.max(0, input.newValue);
    const execAdj = clampedDisplay - sv + sd;
    await db
      .update(routineScores)
      .set({
        executionAdjustment: execAdj,
        version: ctx.row.version + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(routineScores.id, ctx.row.id));
    await logModification({
      routineScoreId: ctx.row.id,
      fieldChanged: "EXECUTION_DIRECT",
      reason: input.reason,
      source: "MANUAL_SCORE_EDIT",
      actorUserId: input.userId,
      previousSummary: `Displayed execution ${prevCv.toFixed(3)}`,
      nextSummary: `Displayed execution ${clampedDisplay.toFixed(3)}`,
    });
  } else if (input.targetField === "D_VALUE") {
    const prevD = ctx.row.adminOverrideD ?? ctx.row.dValue ?? 0;
    await db
      .update(routineScores)
      .set({
        dValue: input.newValue,
        version: ctx.row.version + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(routineScores.id, ctx.row.id));
    await logModification({
      routineScoreId: ctx.row.id,
      fieldChanged: "D_VALUE",
      reason: input.reason,
      source: "MANUAL_SCORE_EDIT",
      actorUserId: input.userId,
      previousSummary: `D score ${prevD.toFixed(3)}`,
      nextSummary: `D score ${input.newValue.toFixed(3)}`,
    });
  }

  await refreshExecutionStored(ctx.row.id);
}

export async function finalizeScore(input: {
  userId: string;
  competitionId: string;
  routineScoreId: string;
  expectedVersion: number;
  pendingDValue?: number;
}) {
  const ctx = await loadScoreAndRoutine(input.routineScoreId);
  if (!ctx) throw new Error("Invalid score");
  if (ctx.routine.competitionId !== input.competitionId) throw new Error("Wrong competition");
  if (ctx.row.judgeUserId !== input.userId) throw new Error("Not your score");
  await assertRoutineAthleteActiveForJudging(ctx.row.routineId);
  if (ctx.routine.locked) throw new Error("Routine locked");
  if (ctx.row.finalized) throw new Error("Already finalized");

  const st = ctx.row.scoreType as "EXECUTION" | "DIFFICULTY";
  await assertJudgeCanEdit(input.userId, input.competitionId, ctx.row.routineId, st);
  if (ctx.row.version !== input.expectedVersion) throw new Error("Version conflict");

  const patch: Partial<typeof routineScores.$inferInsert> = {
    finalized: true,
    version: ctx.row.version + 1,
    updatedAt: new Date().toISOString(),
  };

  if (st === "DIFFICULTY" && input.pendingDValue != null) {
    patch.dValue = input.pendingDValue;
    patch.adminOverrideD = null;
  }

  await db.update(routineScores).set(patch).where(eq(routineScores.id, ctx.row.id));

  if (st === "DIFFICULTY" && input.pendingDValue != null) {
    const prevD = ctx.row.adminOverrideD ?? ctx.row.dValue ?? 0;
    await logModification({
      routineScoreId: ctx.row.id,
      fieldChanged: "D_VALUE",
      reason: "Set on finalize",
      source: "MANUAL_SCORE_EDIT",
      actorUserId: input.userId,
      previousSummary: `Before finalize D ${prevD.toFixed(3)}`,
      nextSummary: `Finalized D ${input.pendingDValue.toFixed(3)}`,
    });
  }

  if (st === "EXECUTION") {
    const sd = await deductionSum(ctx.row.id);
    const prevDed = sd;
    await logModification({
      routineScoreId: ctx.row.id,
      fieldChanged: "FINALIZED_E",
      reason: "Judge finalized execution deductions",
      source: "SYSTEM",
      actorUserId: input.userId,
      previousSummary: null,
      nextSummary: `Total deductions ${prevDed.toFixed(3)} (frozen for this judge until amended with reason)`,
    });
  }

  await logModification({
    routineScoreId: ctx.row.id,
    fieldChanged: "FINALIZED",
    reason: "Judge finalized score",
    source: "SYSTEM",
    actorUserId: input.userId,
  });
}

type LoadedScoreCtx = NonNullable<Awaited<ReturnType<typeof loadScoreAndRoutine>>>;

/** Apply E or D amendment to DB + audit log (used only after admin approves a pending request). */
export async function applyStoredJudgeAmendment(input: {
  ctx: LoadedScoreCtx;
  newDeductionTotal?: number;
  newDValue?: number;
  reason: string;
  logSource: string;
  actorUserId: string;
}) {
  const { ctx } = input;
  const st = ctx.row.scoreType as "EXECUTION" | "DIFFICULTY";
  const hasE = input.newDeductionTotal != null;
  const hasD = input.newDValue != null;
  if (hasE && st === "EXECUTION" && input.newDeductionTotal !== undefined) {
    const prevDed = await deductionSum(ctx.row.id);
    await db.delete(deductionEvents).where(eq(deductionEvents.routineScoreId, ctx.row.id));

    if (input.newDeductionTotal > 0) {
      await db.insert(deductionEvents).values({
        id: crypto.randomUUID(),
        routineScoreId: ctx.row.id,
        amount: input.newDeductionTotal,
        clientRequestId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      });
    }

    await db
      .update(routineScores)
      .set({
        adminOverrideExe: null,
        executionAdjustment: 0,
        version: ctx.row.version + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(routineScores.id, ctx.row.id));

    await refreshExecutionStored(ctx.row.id);

    await logModification({
      routineScoreId: ctx.row.id,
      fieldChanged: "E_DEDUCTIONS_AMEND",
      reason: input.reason,
      source: input.logSource,
      actorUserId: input.actorUserId,
      previousSummary: `Total deductions ${prevDed.toFixed(3)}`,
      nextSummary: `Total deductions ${input.newDeductionTotal.toFixed(3)}`,
    });
    return;
  }

  if (hasD && st === "DIFFICULTY" && input.newDValue !== undefined) {
    const prevD = ctx.row.adminOverrideD ?? ctx.row.dValue ?? 0;

    await db
      .update(routineScores)
      .set({
        dValue: input.newDValue,
        adminOverrideD: null,
        version: ctx.row.version + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(routineScores.id, ctx.row.id));

    await logModification({
      routineScoreId: ctx.row.id,
      fieldChanged: "D_VALUE_AMEND",
      reason: input.reason,
      source: input.logSource,
      actorUserId: input.actorUserId,
      previousSummary: `D score ${prevD.toFixed(3)}`,
      nextSummary: `D score ${input.newDValue.toFixed(3)}`,
    });
    return;
  }

  throw new Error("Internal: amendment type mismatch");
}

async function validateJudgeCorrectionEligibility(input: {
  userId: string;
  competitionId: string;
  routineScoreId: string;
  expectedVersion: number;
  newDeductionTotal?: number;
  newDValue?: number;
}): Promise<{
  ctx: LoadedScoreCtx;
  newDeductionTotal?: number;
  newDValue?: number;
}> {
  const hasE = input.newDeductionTotal != null;
  const hasD = input.newDValue != null;
  if ((hasE && hasD) || (!hasE && !hasD)) throw new Error("Provide either newDeductionTotal or newDValue");
  if (input.newDeductionTotal != null && input.newDeductionTotal < 0) throw new Error("Deductions cannot be negative");

  const ctx = await loadScoreAndRoutine(input.routineScoreId);
  if (!ctx) throw new Error("Invalid score");
  if (ctx.routine.competitionId !== input.competitionId) throw new Error("Wrong competition");
  if (ctx.routine.locked) throw new Error("Routine locked");
  if (ctx.row.judgeUserId !== input.userId) throw new Error("Not your score");
  await assertRoutineAthleteActiveForJudging(ctx.row.routineId);
  if (!ctx.row.finalized) throw new Error("Finalize your score before amending this way");

  const st = ctx.row.scoreType as "EXECUTION" | "DIFFICULTY";
  if (hasE && st !== "EXECUTION") throw new Error("Wrong score type for deduction amendment");
  if (hasD && st !== "DIFFICULTY") throw new Error("Wrong score type for D amendment");

  if (ctx.row.version !== input.expectedVersion) throw new Error("Version conflict");

  try {
    await assertJudgeCanEdit(input.userId, input.competitionId, ctx.row.routineId, st);
  } catch (e) {
    if (!(e instanceof Error && e.message === "Not assigned for this routine")) throw e;
  }

  return {
    ctx,
    newDeductionTotal: input.newDeductionTotal,
    newDValue: input.newDValue,
  };
}

/** Judge WS: queue a finalized-score change for admin review (does not change scores yet). */
export async function submitJudgeCorrectionRequest(input: {
  userId: string;
  competitionId: string;
  routineScoreId: string;
  reason: string;
  expectedVersion: number;
  newDeductionTotal?: number;
  newDValue?: number;
}) {
  if (input.reason.trim().length < 3) throw new Error("Reason must be at least 3 characters");

  const { ctx, newDeductionTotal, newDValue } = await validateJudgeCorrectionEligibility({
    userId: input.userId,
    competitionId: input.competitionId,
    routineScoreId: input.routineScoreId,
    expectedVersion: input.expectedVersion,
    newDeductionTotal: input.newDeductionTotal,
    newDValue: input.newDValue,
  });

  const existing = await db
    .select({ id: judgeCorrectionRequests.id })
    .from(judgeCorrectionRequests)
    .where(
      and(
        eq(judgeCorrectionRequests.routineScoreId, input.routineScoreId),
        eq(judgeCorrectionRequests.status, "PENDING"),
      ),
    );
  if (existing.length > 0) throw new Error("A correction request is already pending for this score");

  const id = crypto.randomUUID();
  await db.insert(judgeCorrectionRequests).values({
    id,
    competitionId: input.competitionId,
    routineScoreId: input.routineScoreId,
    judgeUserId: input.userId,
    newDeductionTotal: newDeductionTotal ?? null,
    newDValue: newDValue ?? null,
    reason: input.reason.trim(),
    expectedVersion: input.expectedVersion,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  });

  await logModification({
    routineScoreId: ctx.row.id,
    fieldChanged: newDeductionTotal != null ? "E_CORRECTION_REQUEST" : "D_CORRECTION_REQUEST",
    reason: input.reason.trim(),
    source: "JUDGE_CORRECTION_PENDING",
    actorUserId: input.userId,
    previousSummary:
      newDeductionTotal != null
        ? `Pending admin review — requested total deductions ${newDeductionTotal.toFixed(3)}`
        : `Pending admin review — requested D ${(newDValue ?? 0).toFixed(3)}`,
    nextSummary: null,
  });
}

export async function adminApproveJudgeCorrectionRequest(input: {
  adminUserId: string;
  competitionId: string;
  requestId: string;
}) {
  if ((await roleOf(input.adminUserId)) !== "ADMIN") throw new Error("Admin only");

  const [req] = await db.select().from(judgeCorrectionRequests).where(eq(judgeCorrectionRequests.id, input.requestId));
  if (!req || req.competitionId !== input.competitionId) throw new Error("Request not found");
  if (req.status !== "PENDING") throw new Error("Request is not pending");

  const hasE = req.newDeductionTotal != null;
  const hasD = req.newDValue != null;
  if (hasE === hasD) throw new Error("Invalid correction request");

  const ctx = await loadScoreAndRoutine(req.routineScoreId);
  if (!ctx) throw new Error("Score not found");
  if (ctx.row.version !== req.expectedVersion) {
    throw new Error("Score changed since this request — reject it and ask the judge to submit a new request");
  }

  const reason = `Admin approved correction. Judge had written: ${req.reason}`;

  await applyStoredJudgeAmendment({
    ctx,
    newDeductionTotal: hasE ? (req.newDeductionTotal as number) : undefined,
    newDValue: hasD ? (req.newDValue as number) : undefined,
    reason,
    logSource: "ADMIN_APPROVED_CORRECTION",
    actorUserId: input.adminUserId,
  });

  const now = new Date().toISOString();
  await db
    .update(judgeCorrectionRequests)
    .set({
      status: "APPROVED",
      reviewedAt: now,
      reviewedByUserId: input.adminUserId,
      reviewNote: null,
    })
    .where(eq(judgeCorrectionRequests.id, input.requestId));
}

export async function adminRejectJudgeCorrectionRequest(input: {
  adminUserId: string;
  competitionId: string;
  requestId: string;
  reviewNote?: string;
}) {
  if ((await roleOf(input.adminUserId)) !== "ADMIN") throw new Error("Admin only");

  const [req] = await db.select().from(judgeCorrectionRequests).where(eq(judgeCorrectionRequests.id, input.requestId));
  if (!req || req.competitionId !== input.competitionId) throw new Error("Request not found");
  if (req.status !== "PENDING") throw new Error("Request is not pending");

  const now = new Date().toISOString();
  await db
    .update(judgeCorrectionRequests)
    .set({
      status: "REJECTED",
      reviewedAt: now,
      reviewedByUserId: input.adminUserId,
      reviewNote: input.reviewNote?.trim() || null,
    })
    .where(eq(judgeCorrectionRequests.id, input.requestId));

  const ctx = await loadScoreAndRoutine(req.routineScoreId);
  if (ctx) {
    await logModification({
      routineScoreId: req.routineScoreId,
      fieldChanged: req.newDeductionTotal != null ? "E_CORRECTION_REQUEST" : "D_CORRECTION_REQUEST",
      reason: input.reviewNote?.trim()
        ? `Admin rejected correction request. Note: ${input.reviewNote.trim()}`
        : "Admin rejected correction request",
      source: "ADMIN_REJECTED_CORRECTION",
      actorUserId: input.adminUserId,
      previousSummary: "Pending request",
      nextSummary: "Rejected — score unchanged",
    });
  }
}

export async function routineAdminLock(input: {
  adminUserId: string;
  competitionId: string;
  routineId: string;
  lock: boolean;
  expectedRoutineVersion: number;
}) {
  if ((await roleOf(input.adminUserId)) !== "ADMIN") throw new Error("Admin only");

  const [rt] = await db.select().from(routines).where(eq(routines.id, input.routineId));
  if (!rt || rt.competitionId !== input.competitionId) throw new Error("Routine not found");
  if (rt.version !== input.expectedRoutineVersion) throw new Error("Routine version conflict");

  await db
    .update(routines)
    .set({ locked: input.lock, version: rt.version + 1 })
    .where(eq(routines.id, rt.id));
}

export async function adminOverrideScore(input: {
  adminUserId: string;
  competitionId: string;
  routineScoreId: string;
  reason: string;
  expectedVersion: number;
  overrideExecutionComputed?: number;
  overrideDValue?: number;
  startingValue?: number;
}) {
  if ((await roleOf(input.adminUserId)) !== "ADMIN") throw new Error("Admin only");

  const ctx = await loadScoreAndRoutine(input.routineScoreId);
  if (!ctx || ctx.routine.competitionId !== input.competitionId) throw new Error("Invalid score");
  if (ctx.row.version !== input.expectedVersion) throw new Error("Version conflict");

  const patch: Partial<typeof routineScores.$inferInsert> = {
    version: ctx.row.version + 1,
    updatedAt: new Date().toISOString(),
  };
  if (input.overrideExecutionComputed != null) patch.adminOverrideExe = input.overrideExecutionComputed;
  if (input.overrideDValue != null) patch.adminOverrideD = input.overrideDValue;
  if (input.startingValue != null) patch.adminOverrideSv = input.startingValue;

  await db.update(routineScores).set(patch).where(eq(routineScores.id, ctx.row.id));

  await logModification({
    routineScoreId: ctx.row.id,
    fieldChanged: "ADMIN_OVERRIDE",
    reason: input.reason,
    source: "ADMIN_OVERRIDE",
    actorUserId: input.adminUserId,
  });

  await refreshExecutionStored(ctx.row.id);
}

export async function adminSetDValue(input: {
  adminUserId: string;
  competitionId: string;
  routineScoreId: string;
  dValue: number;
  reason: string;
  expectedVersion: number;
}) {
  if ((await roleOf(input.adminUserId)) !== "ADMIN") throw new Error("Admin only");

  const ctx = await loadScoreAndRoutine(input.routineScoreId);
  if (!ctx || ctx.routine.competitionId !== input.competitionId) throw new Error("Invalid score");
  if (ctx.row.scoreType !== "DIFFICULTY") throw new Error("Not a D score");
  if (ctx.row.version !== input.expectedVersion) throw new Error("Version conflict");

  const prevD = ctx.row.adminOverrideD ?? ctx.row.dValue ?? 0;

  await db
    .update(routineScores)
    .set({
      dValue: input.dValue,
      adminOverrideD: null,
      version: ctx.row.version + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(routineScores.id, ctx.row.id));

  await logModification({
    routineScoreId: ctx.row.id,
    fieldChanged: "D_VALUE",
    reason: input.reason,
    source: "ADMIN_OVERRIDE",
    actorUserId: input.adminUserId,
    previousSummary: `Admin D score ${prevD.toFixed(3)}`,
    nextSummary: `Admin D score ${input.dValue.toFixed(3)}`,
  });
}

export async function adminSetEDeductionTotal(input: {
  adminUserId: string;
  competitionId: string;
  routineScoreId: string;
  totalDeductions: number;
  reason: string;
  expectedVersion: number;
}) {
  if ((await roleOf(input.adminUserId)) !== "ADMIN") throw new Error("Admin only");

  const ctx = await loadScoreAndRoutine(input.routineScoreId);
  if (!ctx || ctx.routine.competitionId !== input.competitionId) throw new Error("Invalid score");
  if (ctx.row.scoreType !== "EXECUTION") throw new Error("Not an E score");
  if (ctx.row.version !== input.expectedVersion) throw new Error("Version conflict");
  if (input.totalDeductions < 0) throw new Error("Deductions cannot be negative");

  const prevDed = await deductionSum(ctx.row.id);

  await db.delete(deductionEvents).where(eq(deductionEvents.routineScoreId, ctx.row.id));

  if (input.totalDeductions > 0) {
    await db.insert(deductionEvents).values({
      id: crypto.randomUUID(),
      routineScoreId: ctx.row.id,
      amount: input.totalDeductions,
      clientRequestId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
  }

  await db
    .update(routineScores)
    .set({
      adminOverrideExe: null,
      version: ctx.row.version + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(routineScores.id, ctx.row.id));

  await refreshExecutionStored(ctx.row.id);

  await logModification({
    routineScoreId: ctx.row.id,
    fieldChanged: `E_DEDUCTIONS:${input.totalDeductions}`,
    reason: input.reason,
    source: "ADMIN_OVERRIDE",
    actorUserId: input.adminUserId,
    previousSummary: `Deduction total ${prevDed.toFixed(3)}`,
    nextSummary: `Deduction total ${input.totalDeductions.toFixed(3)}`,
  });
}
