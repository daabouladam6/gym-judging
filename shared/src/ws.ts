import { z } from "zod";

export const wsEnvelopeSchema = <T extends z.ZodTypeAny>(payload: T) =>
  z.object({
    type: z.string(),
    competitionId: z.string().uuid(),
    routineId: z.string().uuid().optional(),
    correlationId: z.string().uuid().optional(),
    payload,
    serverTime: z.string().optional(),
  });

export const scoreApplyDeductionPayload = z.object({
  routineScoreId: z.string().uuid(),
  amount: z.number(),
  clientRequestId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
});

export const scoreManualEditPayload = z.object({
  routineScoreId: z.string().uuid(),
  targetField: z.enum(["STARTING_VALUE", "EXECUTION_DIRECT", "D_VALUE"]),
  newValue: z.number(),
  reason: z.string().min(3),
  expectedVersion: z.number().int().nonnegative(),
});

export const scoreFinalizePayload = z.object({
  routineScoreId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  pendingDValue: z.number().optional(),
});

/** Judge-only: correct a finalized score with reason (logged for admins). */
export const scoreAmendFinalizedPayload = z
  .object({
    routineScoreId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().min(3),
    newDeductionTotal: z.number().optional(),
    newDValue: z.number().optional(),
  })
  .superRefine((d, ctx) => {
    const hasE = d.newDeductionTotal !== undefined;
    const hasD = d.newDValue !== undefined;
    if (hasE === hasD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Send exactly one of newDeductionTotal (E judges) or newDValue (D judges).",
        path: hasE ? ["newDValue"] : ["newDeductionTotal"],
      });
    }
    if (hasE && (d.newDeductionTotal ?? 0) < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Deduction total cannot be negative." });
    }
  });

export const routineAdminLockPayload = z.object({
  routineId: z.string().uuid(),
  lock: z.boolean(),
  expectedRoutineVersion: z.number().int().nonnegative(),
});

export const adminOverrideScorePayload = z.object({
  routineScoreId: z.string().uuid(),
  overrideExecutionComputed: z.number().optional(),
  overrideDValue: z.number().optional(),
  startingValue: z.number().optional(),
  reason: z.string().min(3),
  expectedVersion: z.number().int().nonnegative(),
});

export const clientWsMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("auth.session"),
    competitionId: z.string().uuid().optional(),
    payload: z.object({ sessionToken: z.string().uuid() }),
  }),
  z.object({
    type: z.literal("score.applyDeduction"),
    competitionId: z.string().uuid(),
    routineId: z.string().uuid().optional(),
    correlationId: z.string().uuid().optional(),
    payload: scoreApplyDeductionPayload,
  }),
  z.object({
    type: z.literal("score.manualEdit"),
    competitionId: z.string().uuid(),
    correlationId: z.string().uuid().optional(),
    payload: scoreManualEditPayload,
  }),
  z.object({
    type: z.literal("score.finalize"),
    competitionId: z.string().uuid(),
    correlationId: z.string().uuid().optional(),
    payload: scoreFinalizePayload,
  }),
  z.object({
    type: z.literal("score.amendFinalized"),
    competitionId: z.string().uuid(),
    correlationId: z.string().uuid().optional(),
    payload: scoreAmendFinalizedPayload,
  }),
  z.object({
    type: z.literal("routine.adminLock"),
    competitionId: z.string().uuid(),
    correlationId: z.string().uuid().optional(),
    payload: routineAdminLockPayload,
  }),
  z.object({
    type: z.literal("admin.overrideScore"),
    competitionId: z.string().uuid(),
    correlationId: z.string().uuid().optional(),
    payload: adminOverrideScorePayload,
  }),
]);

export type ClientWsMessage = z.infer<typeof clientWsMessageSchema>;
