import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at").notNull(),
});

export const competitions = sqliteTable("competitions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  deductionPresetMode: text("deduction_preset_mode").notNull(),
  aggregationRule: text("aggregation_rule").notNull(),
  createdAt: text("created_at").notNull(),
});

export const athletes = sqliteTable("athletes", {
  id: text("id").primaryKey(),
  competitionId: text("competition_id")
    .notNull()
    .references(() => competitions.id),
  name: text("name").notNull(),
  level: text("level").notNull().default("USAG_1"),
  yearOfBirth: integer("year_of_birth").notNull().default(2010),
  /** ISO timestamp when this athlete's category was moved to History; null = active workspace. */
  archivedAt: text("archived_at"),
});

export const routines = sqliteTable("routines", {
  id: text("id").primaryKey(),
  competitionId: text("competition_id")
    .notNull()
    .references(() => competitions.id),
  athleteId: text("athlete_id")
    .notNull()
    .references(() => athletes.id),
  apparatus: text("apparatus").notNull(),
  version: integer("version").notNull().default(0),
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
});

export const judgeAssignments = sqliteTable(
  "judge_assignments",
  {
    id: text("id").primaryKey(),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id),
    judgeUserId: text("judge_user_id")
      .notNull()
      .references(() => users.id),
    apparatus: text("apparatus").notNull(),
    panelRole: text("panel_role").notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("ja_uniq").on(t.competitionId, t.judgeUserId, t.apparatus, t.panelRole),
  }),
);

export const judgeCategoryAssignments = sqliteTable(
  "judge_category_assignments",
  {
    id: text("id").primaryKey(),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id),
    judgeUserId: text("judge_user_id")
      .notNull()
      .references(() => users.id),
    categoryKey: text("category_key").notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("jca_uniq").on(t.competitionId, t.judgeUserId, t.categoryKey),
  }),
);

export const routineScores = sqliteTable(
  "routine_scores",
  {
    id: text("id").primaryKey(),
    routineId: text("routine_id")
      .notNull()
      .references(() => routines.id),
    judgeUserId: text("judge_user_id")
      .notNull()
      .references(() => users.id),
    scoreType: text("score_type").notNull(),
    startingValue: real("starting_value"),
    executionAdjustment: real("execution_adjustment").notNull().default(0),
    dValue: real("d_value"),
    computedExecution: real("computed_execution"),
    adminOverrideExe: real("admin_override_exe"),
    adminOverrideD: real("admin_override_d"),
    adminOverrideSv: real("admin_override_sv"),
    finalized: integer("finalized", { mode: "boolean" }).notNull().default(false),
    version: integer("version").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({
    uniqScore: uniqueIndex("rs_uniq").on(t.routineId, t.judgeUserId, t.scoreType),
  }),
);

/** Judge asks to change a finalized score; admin approves (applies values) or rejects (no score change). */
export const judgeCorrectionRequests = sqliteTable("judge_correction_requests", {
  id: text("id").primaryKey(),
  competitionId: text("competition_id")
    .notNull()
    .references(() => competitions.id),
  routineScoreId: text("routine_score_id")
    .notNull()
    .references(() => routineScores.id, { onDelete: "cascade" }),
  judgeUserId: text("judge_user_id")
    .notNull()
    .references(() => users.id),
  newDeductionTotal: real("new_deduction_total"),
  newDValue: real("new_d_value"),
  reason: text("reason").notNull(),
  expectedVersion: integer("expected_version").notNull(),
  status: text("status").notNull().default("PENDING"),
  createdAt: text("created_at").notNull(),
  reviewedAt: text("reviewed_at"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
  reviewNote: text("review_note"),
});

export const deductionEvents = sqliteTable(
  "deduction_events",
  {
    id: text("id").primaryKey(),
    routineScoreId: text("routine_score_id")
      .notNull()
      .references(() => routineScores.id),
    amount: real("amount").notNull(),
    clientRequestId: text("client_request_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    uniqClient: uniqueIndex("deduction_client_uniq").on(t.routineScoreId, t.clientRequestId),
  }),
);

export const scoreModificationLogs = sqliteTable("score_modification_logs", {
  id: text("id").primaryKey(),
  routineScoreId: text("routine_score_id")
    .notNull()
    .references(() => routineScores.id),
  fieldChanged: text("field_changed").notNull(),
  reason: text("reason").notNull(),
  source: text("source").notNull(),
  actorUserId: text("actor_user_id").references(() => users.id),
  createdAt: text("created_at").notNull(),
  /** Human-readable “before” for admin audit (scores, deductions, etc.) */
  previousSummary: text("previous_summary"),
  /** Human-readable “after” */
  nextSummary: text("next_summary"),
});

export const routineResults = sqliteTable("routine_results", {
  routineId: text("routine_id")
    .primaryKey()
    .references(() => routines.id),
  finalScore: real("final_score").notNull(),
  rank: integer("rank").notNull(),
  updatedAt: text("updated_at").notNull(),
});
