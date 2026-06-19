import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { eq, and, desc, isNotNull, isNull, inArray } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ATHLETE_LEVEL_VALUES, athleteCategoryKey, categoryLabel, distinctCategoryKeys } from "@gym/shared";
import { createSession, destroySession, validateSession } from "../auth/session.js";
import { db } from "../db/index.js";
import {
  athletes,
  competitions,
  judgeAssignments,
  judgeCategoryAssignments,
  judgeCorrectionRequests,
  routines,
  routineScores,
  scoreModificationLogs,
  users,
} from "../db/schema.js";
import { spawnRoutineScores, ensureRoutineForAthlete } from "../routineSetup.js";
import { rebuildLeaderboard } from "../services/aggregation.js";
import {
  adminApproveJudgeCorrectionRequest,
  adminRejectJudgeCorrectionRequest,
  adminSetDValue,
  adminSetEDeductionTotal,
} from "../scores/mutations.js";
import {
  deleteAthleteById,
  deleteCompetitionById,
  deleteJudgeAssignmentById,
  deleteJudgeById,
} from "../services/delete.js";
import { buildCompetitionViewerPayload, listUsersSafe } from "../services/state.js";
import { dbgBoot } from "../debugBoot.js";
import { notifyCompetitionUpdated, notifyGlobalUpdated } from "../notify.js";

const AGENT_DEBUG_LOG = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../debug-5f3141.log");
function agentDebugNdjson(payload: Record<string, unknown>) {
  try {
    fs.appendFileSync(AGENT_DEBUG_LOG, JSON.stringify({ ...payload, timestamp: Date.now() }) + "\n");
  } catch {
    /* debug log best-effort */
  }
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7);
}

async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const tok = bearer(req);
  const user = await validateSession(tok);
  if (!user) {
    reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
  return user;
}

/** Must match typed confirmation to delete a competition or move a category to/from History. */
const COMPETITION_DELETE_PASSWORD =
  process.env.COMPETITION_DELETE_PASSWORD?.trim() || "admin123";

async function competitionHasArchivedAthletes(competitionId: string): Promise<boolean> {
  const [r] = await db
    .select({ id: athletes.id })
    .from(athletes)
    .where(and(eq(athletes.competitionId, competitionId), isNotNull(athletes.archivedAt)))
    .limit(1);
  return Boolean(r);
}

async function requireCompetitionHasArchivedAthletes(competitionId: string, reply: FastifyReply) {
  const [c] = await db.select({ id: competitions.id }).from(competitions).where(eq(competitions.id, competitionId));
  if (!c) {
    reply.code(404).send({ error: "Competition not found" });
    return false;
  }
  if (!(await competitionHasArchivedAthletes(competitionId))) {
    reply
      .code(400)
      .send({
        error:
          "That action applies only when at least one athlete group is in History for this competition.",
      });
    return false;
  }
  return true;
}

export async function registerHttpRoutes(app: FastifyInstance) {
  dbgBoot("routes.ts:registerHttpRoutes", "enter", { hypothesisId: "H1" });
  app.post("/api/auth/login", async (req, reply) => {
    const body = z
      .object({ username: z.string().min(1), password: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid body" });
    const [u] = await db.select().from(users).where(eq(users.username, body.data.username));
    if (!u || !bcrypt.compareSync(body.data.password, u.passwordHash))
      return reply.code(401).send({ error: "Invalid credentials" });
    const sessionToken = await createSession(u.id);
    return {
      sessionToken,
      user: { id: u.id, username: u.username, displayName: u.displayName, role: u.role },
    };
  });

  app.get("/api/auth/me", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const assigns = await db.select().from(judgeAssignments).where(eq(judgeAssignments.judgeUserId, user.id));
    const categoryAssigns = await db
      .select()
      .from(judgeCategoryAssignments)
      .where(eq(judgeCategoryAssignments.judgeUserId, user.id));
    return {
      user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
      assignments: assigns,
      categoryAssignments: categoryAssigns,
    };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    await destroySession(bearer(req));
    reply.code(204).send();
  });

  app.get("/api/competitions", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    try {
      const list = await db.select().from(competitions);
      const archivedRows = await db
        .select({
          competitionId: athletes.competitionId,
          level: athletes.level,
          yearOfBirth: athletes.yearOfBirth,
        })
        .from(athletes)
        .where(isNotNull(athletes.archivedAt));
      const segByComp = new Map<string, Set<string>>();
      for (const r of archivedRows) {
        const k = athleteCategoryKey(r.level as (typeof ATHLETE_LEVEL_VALUES)[number], r.yearOfBirth);
        if (!segByComp.has(r.competitionId)) segByComp.set(r.competitionId, new Set());
        segByComp.get(r.competitionId)!.add(k);
      }
      // #region agent log
      {
        const p = {
          sessionId: "5f3141",
          location: "routes.ts:GET /api/competitions:ok",
          message: "competitions list ok",
          data: { n: list.length, archivedRowCount: archivedRows.length },
          timestamp: Date.now(),
          hypothesisId: "H1",
        };
        agentDebugNdjson(p);
        void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
          body: JSON.stringify(p),
        }).catch(() => {});
      }
      // #endregion
      return {
        competitions: list.map((c) => ({
          ...c,
          archivedSegmentCount: segByComp.get(c.id)?.size ?? 0,
        })),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // #region agent log
      {
        const p = {
          sessionId: "5f3141",
          location: "routes.ts:GET /api/competitions:err",
          message: "competitions list threw",
          data: { errMsg: msg.slice(0, 500) },
          timestamp: Date.now(),
          hypothesisId: "H1",
        };
        agentDebugNdjson(p);
        void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
          body: JSON.stringify(p),
        }).catch(() => {});
      }
      // #endregion
      req.log.error({ err }, "GET /api/competitions failed");
      return reply.code(500).send({ error: "Could not load competitions." });
    }
  });

  app.post("/api/competitions", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const parsed = z
      .object({
        name: z.string().min(1),
        deductionPresetMode: z.enum(["FIG_HP", "USAG"]),
        aggregationRule: z.enum(["AVERAGE", "DROP_HIGH_LOW"]),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Bad competition payload" });

    const id = crypto.randomUUID();
    await db.insert(competitions).values({
      id,
      name: parsed.data.name,
      deductionPresetMode: parsed.data.deductionPresetMode,
      aggregationRule: parsed.data.aggregationRule,
      createdAt: new Date().toISOString(),
    });
    await rebuildLeaderboard(id);
    const [created] = await db.select().from(competitions).where(eq(competitions.id, id));
    notifyGlobalUpdated();
    notifyCompetitionUpdated(id);
    return { competition: created };
  });

  app.delete("/api/competitions/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const parsed = z
      .object({ confirmPassword: z.string().min(1) })
      .safeParse(typeof req.body === "object" && req.body !== null ? req.body : {});
    if (!parsed.success)
      return reply.code(400).send({ error: "Deletion confirmation password is required." });
    if (parsed.data.confirmPassword !== COMPETITION_DELETE_PASSWORD)
      return reply.code(403).send({ error: "Incorrect deletion password." });
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(competitions).where(eq(competitions.id, id));
    if (!row) return reply.code(404).send({ error: "Not found" });
    await deleteCompetitionById(id);
    notifyGlobalUpdated();
    reply.code(204).send();
  });

  app.get("/api/competitions/:id/state", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    // #region agent log
    agentDebugNdjson({
      sessionId: "5f3141",
      location: "routes.ts:state:entry",
      message: "GET /state",
      data: { idLen: id.length },
      hypothesisId: "H7",
    });
    // #endregion
    try {
      const rawHistory = (req.query as { historyCategoryKey?: string }).historyCategoryKey;
      const historyCategoryKey =
        typeof rawHistory === "string" && rawHistory.length > 0 ? rawHistory : undefined;
      if (historyCategoryKey && user.role !== "ADMIN") {
        return reply.code(403).send({ error: "Forbidden" });
      }
      const body = await buildCompetitionViewerPayload(
        id,
        { id: user.id, role: user.role },
        historyCategoryKey ? { historyCategoryKey } : undefined,
      );
      if (!body) {
        // #region agent log
        agentDebugNdjson({
          sessionId: "5f3141",
          location: "routes.ts:state:notFound",
          message: "GET /state competition missing",
          data: {},
          hypothesisId: "H7",
        });
        // #endregion
        return reply.code(404).send({ error: "Not found" });
      }
      // #region agent log
      agentDebugNdjson({
        sessionId: "5f3141",
        location: "routes.ts:state:ok",
        message: "GET /state ok",
        data: {},
        hypothesisId: "H7",
      });
      // #endregion
      return { snapshot: body.snapshot, assignments: body.assignments };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // #region agent log
      {
        const p = {
          sessionId: "5f3141",
          location: "routes.ts:state:err",
          message: "GET /state threw",
          data: { errMsg: msg.slice(0, 400) },
          hypothesisId: "H3",
          timestamp: Date.now(),
        };
        agentDebugNdjson(p);
        void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
          body: JSON.stringify(p),
        }).catch(() => {});
      }
      // #endregion
      req.log.error({ err }, "buildCompetitionViewerPayload failed");
      return reply.code(500).send({ error: "Could not load competition state." });
    }
  });

  app.post("/api/competitions/:id/athletes", async (req, reply) => {
    const preId = (req.params as { id?: string }).id ?? "";
    // #region agent log
    {
      const p = {
        sessionId: "5f3141",
        location: "routes.ts:addAthlete:preAuth",
        message: "POST /athletes route invoked",
        data: { compIdLen: preId.length },
        hypothesisId: "H6",
      };
      agentDebugNdjson(p);
      void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
        body: JSON.stringify(p),
      }).catch(() => {});
    }
    // #endregion
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { id } = req.params as { id: string };
    // #region agent log
    {
      const p = {
        sessionId: "5f3141",
        location: "routes.ts:addAthlete:entry",
        message: "POST /athletes past auth",
        data: {
          compIdLen: id.length,
          bodyType: typeof req.body,
          bodyKeys: typeof req.body === "object" && req.body !== null ? Object.keys(req.body as object) : [],
        },
        hypothesisId: "H2",
      };
      agentDebugNdjson(p);
      void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
        body: JSON.stringify(p),
      }).catch(() => {});
    }
    // #endregion
    const maxYob = new Date().getFullYear() + 1;
    const parsed = z
      .object({
        name: z.string().min(1),
        level: z.enum(ATHLETE_LEVEL_VALUES),
        yearOfBirth: z.coerce.number().int().min(1900).max(maxYob),
      })
      .safeParse(req.body);
    // #region agent log
    {
      const p = {
        sessionId: "5f3141",
        location: "routes.ts:addAthlete:afterZod",
        message: "zod parse result",
        data: { ok: parsed.success, issueCount: parsed.success ? 0 : parsed.error.issues.length },
        hypothesisId: "H2",
      };
      agentDebugNdjson(p);
      void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
        body: JSON.stringify(p),
      }).catch(() => {});
    }
    // #endregion
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid athlete data (name, level, or year of birth)." });

    const [comp] = await db.select().from(competitions).where(eq(competitions.id, id));
    // #region agent log
    {
      const p = {
        sessionId: "5f3141",
        location: "routes.ts:addAthlete:compLookup",
        message: "competition row lookup",
        data: { compFound: !!comp },
        hypothesisId: "H3",
      };
      agentDebugNdjson(p);
      void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
        body: JSON.stringify(p),
      }).catch(() => {});
    }
    // #endregion
    if (!comp) return reply.code(404).send({ error: "Competition not found. Refresh the page and select a competition again." });

    const aid = crypto.randomUUID();
    try {
      await db.insert(athletes).values({
        id: aid,
        competitionId: id,
        name: parsed.data.name,
        level: parsed.data.level,
        yearOfBirth: parsed.data.yearOfBirth,
      });
      // #region agent log
      {
        const p = {
          sessionId: "5f3141",
          location: "routes.ts:addAthlete:insertOk",
          message: "insert athletes succeeded",
          data: { aidLen: aid.length },
          hypothesisId: "H1",
        };
        agentDebugNdjson(p);
        void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
          body: JSON.stringify(p),
        }).catch(() => {});
      }
      // #endregion

      const [created] = await db.select().from(athletes).where(eq(athletes.id, aid));
      // #region agent log
      {
        const p = {
          sessionId: "5f3141",
          location: "routes.ts:addAthlete:beforeReturn",
          message: "loaded row after insert",
          data: {
            hasRow: !!created,
            yobType: created ? typeof created.yearOfBirth : null,
          },
          hypothesisId: "H5",
        };
        agentDebugNdjson(p);
        void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
          body: JSON.stringify(p),
        }).catch(() => {});
      }
      // #endregion
      notifyCompetitionUpdated(id);
      return { athlete: created };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // #region agent log
      {
        const p = {
          sessionId: "5f3141",
          location: "routes.ts:addAthlete:dbErr",
          message: "insert or post-insert select failed",
          data: {
            errMsg: msg.slice(0, 200),
            fkLike: /FOREIGN KEY|SQLITE_CONSTRAINT/i.test(msg),
          },
          hypothesisId: "H1",
        };
        agentDebugNdjson(p);
        void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
          body: JSON.stringify(p),
        }).catch(() => {});
      }
      // #endregion
      if (/FOREIGN KEY|SQLITE_CONSTRAINT/i.test(msg)) {
        return reply.code(400).send({
          error:
            "Could not add athlete (competition may be missing or the database is out of date). Refresh the admin page or run npm run db:push in the server folder.",
        });
      }
      req.log.error({ err }, "add athlete failed");
      return reply.code(500).send({ error: "Could not save athlete. Check the server log for details." });
    }
  });

  app.delete("/api/competitions/:compId/athletes/:athleteId", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { compId, athleteId } = req.params as { compId: string; athleteId: string };
    const [row] = await db.select().from(athletes).where(eq(athletes.id, athleteId));
    if (!row || row.competitionId !== compId) return reply.code(404).send({ error: "Not found" });
    await deleteAthleteById(athleteId);
    notifyCompetitionUpdated(compId);
    reply.code(204).send();
  });

  app.post("/api/competitions/:id/routines", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ athleteId: z.string().uuid(), apparatus: z.enum(["VAULT", "BARS", "BEAM", "FLOOR"]) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Bad body" });
    const [athRow] = await db.select().from(athletes).where(eq(athletes.id, parsed.data.athleteId));
    if (!athRow || athRow.competitionId !== id) return reply.code(404).send({ error: "Athlete not found" });
    if (athRow.archivedAt) {
      return reply.code(400).send({
        error: "That athlete group is in History. Unarchive the category from History before adding routines.",
      });
    }
    const rid = crypto.randomUUID();
    await db.insert(routines).values({
      id: rid,
      competitionId: id,
      athleteId: parsed.data.athleteId,
      apparatus: parsed.data.apparatus,
      version: 0,
      locked: false,
    });
    await spawnRoutineScores(rid, id, parsed.data.apparatus);
    await rebuildLeaderboard(id);
    const [created] = await db.select().from(routines).where(eq(routines.id, rid));
    notifyCompetitionUpdated(id);
    return { routine: created };
  });

  app.post("/api/competitions/:id/judge/select-athlete", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "JUDGE") return reply.code(403).send({ error: "Forbidden" });

    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        athleteId: z.string().uuid(),
        apparatus: z.enum(["VAULT", "BARS", "BEAM", "FLOOR"]).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Bad body" });

    const myAssigns = await db
      .select()
      .from(judgeAssignments)
      .where(and(eq(judgeAssignments.competitionId, id), eq(judgeAssignments.judgeUserId, user.id)));
    if (myAssigns.length === 0) return reply.code(403).send({ error: "Not assigned to this competition" });

    let apparatus = parsed.data.apparatus;
    if (!apparatus) {
      if (myAssigns.length > 1) return reply.code(400).send({ error: "Select apparatus" });
      apparatus = myAssigns[0]!.apparatus as "VAULT" | "BARS" | "BEAM" | "FLOOR";
    }

    const assignment = myAssigns.find((a) => a.apparatus === apparatus);
    if (!assignment) return reply.code(403).send({ error: "Not assigned for this apparatus" });

    const [athlete] = await db.select().from(athletes).where(eq(athletes.id, parsed.data.athleteId));
    if (!athlete || athlete.competitionId !== id) return reply.code(404).send({ error: "Athlete not found" });
    if (athlete.archivedAt) {
      return reply.code(400).send({
        error: "That athlete group is in History. Judges cannot score it until an admin restores the category.",
      });
    }

    const categoryAssigns = await db
      .select()
      .from(judgeCategoryAssignments)
      .where(
        and(
          eq(judgeCategoryAssignments.competitionId, id),
          eq(judgeCategoryAssignments.judgeUserId, user.id),
        ),
      );
    if (categoryAssigns.length > 0) {
      const athleteKey = athleteCategoryKey(
        athlete.level as (typeof ATHLETE_LEVEL_VALUES)[number],
        athlete.yearOfBirth,
      );
      if (!categoryAssigns.some((a) => a.categoryKey === athleteKey)) {
        return reply.code(403).send({ error: "Not assigned to this athlete category" });
      }
    }

    const routine = await ensureRoutineForAthlete(id, parsed.data.athleteId, apparatus);
    await rebuildLeaderboard(id);
    notifyCompetitionUpdated(id);

    return {
      routineId: routine.id,
      apparatus,
      panelRole: assignment.panelRole,
      athleteName: athlete.name,
    };
  });

  app.get("/api/competitions/:id/judge-assignments", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const rows = await db.select().from(judgeAssignments).where(eq(judgeAssignments.competitionId, id));
    return { assignments: rows };
  });

  app.post("/api/competitions/:id/judge-assignments", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        userId: z.string().uuid(),
        apparatus: z.enum(["VAULT", "BARS", "BEAM", "FLOOR"]),
        panelRole: z.enum(["E", "D"]),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Bad body" });

    const sameSlot = await db
      .select({ id: judgeAssignments.id })
      .from(judgeAssignments)
      .where(
        and(
          eq(judgeAssignments.competitionId, id),
          eq(judgeAssignments.judgeUserId, parsed.data.userId),
          eq(judgeAssignments.apparatus, parsed.data.apparatus),
        ),
      );
    const removeIds = sameSlot.map((r) => r.id);
    if (removeIds.length > 0) {
      await db.delete(judgeAssignments).where(inArray(judgeAssignments.id, removeIds));
    }

    const jid = crypto.randomUUID();
    await db.insert(judgeAssignments).values({
      id: jid,
      competitionId: id,
      judgeUserId: parsed.data.userId,
      apparatus: parsed.data.apparatus,
      panelRole: parsed.data.panelRole,
    });
    const rts = await db
      .select()
      .from(routines)
      .where(eq(routines.competitionId, id))
      .then((rows) => rows.filter((r) => r.apparatus === parsed.data.apparatus));
    for (const rt of rts) {
      await spawnRoutineScores(rt.id, id, rt.apparatus);
    }
    await rebuildLeaderboard(id);
    const [row] = await db.select().from(judgeAssignments).where(eq(judgeAssignments.id, jid));
    notifyCompetitionUpdated(id);
    return { assignment: row };
  });

  app.delete("/api/competitions/:compId/judge-assignments/:assignmentId", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { compId, assignmentId } = req.params as { compId: string; assignmentId: string };
    try {
      await deleteJudgeAssignmentById(compId, assignmentId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "Assignment not found") return reply.code(404).send({ error: "Not found" });
      throw e;
    }
    notifyCompetitionUpdated(compId);
    reply.code(204).send();
  });

  app.get("/api/competitions/:id/categories", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    // #region agent log
    agentDebugNdjson({
      sessionId: "5f3141",
      location: "routes.ts:categories:entry",
      message: "GET /categories",
      data: { idLen: id.length },
      hypothesisId: "H7",
    });
    // #endregion
    try {
      const ath = await db
        .select()
        .from(athletes)
        .where(and(eq(athletes.competitionId, id), isNull(athletes.archivedAt)));
      const keys = distinctCategoryKeys(
        ath.map((a) => ({
          level: a.level as (typeof ATHLETE_LEVEL_VALUES)[number],
          yearOfBirth: a.yearOfBirth,
        })),
      );
      const counts = new Map<string, number>();
      for (const a of ath) {
        const key = athleteCategoryKey(a.level as (typeof ATHLETE_LEVEL_VALUES)[number], a.yearOfBirth);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      // #region agent log
      agentDebugNdjson({
        sessionId: "5f3141",
        location: "routes.ts:categories:ok",
        message: "GET /categories ok",
        data: { athleteCount: ath.length, categoryKeyCount: keys.length },
        hypothesisId: "H7",
      });
      // #endregion
      return {
        categories: keys.map((categoryKey) => ({
          categoryKey,
          label: categoryLabel(categoryKey),
          athleteCount: counts.get(categoryKey) ?? 0,
        })),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // #region agent log
      agentDebugNdjson({
        sessionId: "5f3141",
        location: "routes.ts:categories:err",
        message: "GET /categories threw",
        data: { errMsg: msg.slice(0, 400) },
        hypothesisId: "H7",
      });
      // #endregion
      req.log.error({ err }, "competition categories failed");
      return reply.code(500).send({ error: "Could not load categories." });
    }
  });

  app.get("/api/competitions/:id/archived-categories", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { id } = req.params as { id: string };
    const arch = await db
      .select()
      .from(athletes)
      .where(and(eq(athletes.competitionId, id), isNotNull(athletes.archivedAt)));
    const map = new Map<string, { athleteCount: number; archivedAt: string }>();
    for (const a of arch) {
      const k = athleteCategoryKey(a.level as (typeof ATHLETE_LEVEL_VALUES)[number], a.yearOfBirth);
      const ts = a.archivedAt as string;
      const prev = map.get(k);
      if (!prev) map.set(k, { athleteCount: 1, archivedAt: ts });
      else
        map.set(k, {
          athleteCount: prev.athleteCount + 1,
          archivedAt: prev.archivedAt > ts ? prev.archivedAt : ts,
        });
    }
    const categories = [...map.entries()]
      .map(([categoryKey, v]) => ({
        categoryKey,
        label: categoryLabel(categoryKey),
        athleteCount: v.athleteCount,
        archivedAt: v.archivedAt,
      }))
      .sort((x, y) => x.label.localeCompare(y.label));
    return { categories };
  });

  app.get("/api/competitions/:id/judge-category-assignments", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const rows = await db
      .select()
      .from(judgeCategoryAssignments)
      .where(eq(judgeCategoryAssignments.competitionId, id));
    return { assignments: rows };
  });

  app.post("/api/competitions/:id/judge-category-assignments", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ userId: z.string().uuid(), categoryKey: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Bad body" });

    const ath = await db
      .select()
      .from(athletes)
      .where(and(eq(athletes.competitionId, id), isNull(athletes.archivedAt)));
    const validKeys = new Set(
      ath.map((a) => athleteCategoryKey(a.level as (typeof ATHLETE_LEVEL_VALUES)[number], a.yearOfBirth)),
    );
    if (!validKeys.has(parsed.data.categoryKey)) {
      return reply.code(400).send({ error: "Category not found in this competition" });
    }

    const cid = crypto.randomUUID();
    try {
      await db.insert(judgeCategoryAssignments).values({
        id: cid,
        competitionId: id,
        judgeUserId: parsed.data.userId,
        categoryKey: parsed.data.categoryKey,
      });
    } catch {
      return reply.code(409).send({ error: "Assignment exists" });
    }
    const [row] = await db
      .select()
      .from(judgeCategoryAssignments)
      .where(eq(judgeCategoryAssignments.id, cid));
    notifyCompetitionUpdated(id);
    return { assignment: row };
  });

  app.delete("/api/competitions/:compId/judge-category-assignments/:assignmentId", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { compId, assignmentId } = req.params as { compId: string; assignmentId: string };
    const [row] = await db
      .select()
      .from(judgeCategoryAssignments)
      .where(eq(judgeCategoryAssignments.id, assignmentId));
    if (!row || row.competitionId !== compId) return reply.code(404).send({ error: "Not found" });
    await db.delete(judgeCategoryAssignments).where(eq(judgeCategoryAssignments.id, assignmentId));
    notifyCompetitionUpdated(compId);
    reply.code(204).send();
  });

  app.get("/api/competitions/:id/judge-correction-requests", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { id } = req.params as { id: string };
    const raw = (req.query as { status?: string }).status;
    const status =
      raw === "APPROVED" || raw === "REJECTED" || raw === "PENDING" || raw === "ALL" ? raw : "PENDING";

    const whereClause =
      status === "ALL"
        ? eq(judgeCorrectionRequests.competitionId, id)
        : and(eq(judgeCorrectionRequests.competitionId, id), eq(judgeCorrectionRequests.status, status));

    const rows = await db
      .select({
        id: judgeCorrectionRequests.id,
        competitionId: judgeCorrectionRequests.competitionId,
        routineScoreId: judgeCorrectionRequests.routineScoreId,
        judgeUserId: judgeCorrectionRequests.judgeUserId,
        newDeductionTotal: judgeCorrectionRequests.newDeductionTotal,
        newDValue: judgeCorrectionRequests.newDValue,
        reason: judgeCorrectionRequests.reason,
        expectedVersion: judgeCorrectionRequests.expectedVersion,
        status: judgeCorrectionRequests.status,
        createdAt: judgeCorrectionRequests.createdAt,
        reviewedAt: judgeCorrectionRequests.reviewedAt,
        reviewedByUserId: judgeCorrectionRequests.reviewedByUserId,
        reviewNote: judgeCorrectionRequests.reviewNote,
        apparatus: routines.apparatus,
        athleteName: athletes.name,
        scoreType: routineScores.scoreType,
        judgeDisplayName: users.displayName,
      })
      .from(judgeCorrectionRequests)
      .innerJoin(routineScores, eq(routineScores.id, judgeCorrectionRequests.routineScoreId))
      .innerJoin(routines, eq(routines.id, routineScores.routineId))
      .innerJoin(athletes, eq(athletes.id, routines.athleteId))
      .innerJoin(users, eq(users.id, judgeCorrectionRequests.judgeUserId))
      .where(whereClause)
      .orderBy(desc(judgeCorrectionRequests.createdAt))
      .limit(status === "ALL" ? 200 : 100);

    return { requests: rows };
  });

  app.post("/api/competitions/:compId/judge-correction-requests/:requestId/approve", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { compId, requestId } = req.params as { compId: string; requestId: string };
    try {
      await adminApproveJudgeCorrectionRequest({
        adminUserId: user.id,
        competitionId: compId,
        requestId,
      });
      await rebuildLeaderboard(compId);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m === "Request not found") return reply.code(404).send({ error: m });
      return reply.code(400).send({ error: m });
    }
    notifyCompetitionUpdated(compId);
    return { ok: true };
  });

  app.post("/api/competitions/:compId/judge-correction-requests/:requestId/reject", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { compId, requestId } = req.params as { compId: string; requestId: string };
    const parsed = z.object({ reviewNote: z.string().max(2000).optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Bad body" });
    try {
      await adminRejectJudgeCorrectionRequest({
        adminUserId: user.id,
        competitionId: compId,
        requestId,
        reviewNote: parsed.data.reviewNote,
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m === "Request not found") return reply.code(404).send({ error: m });
      return reply.code(400).send({ error: m });
    }
    notifyCompetitionUpdated(compId);
    return { ok: true };
  });

  app.delete("/api/competitions/:compId/modification-logs/:logId", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { compId, logId } = req.params as { compId: string; logId: string };
    const [hit] = await db
      .select({ id: scoreModificationLogs.id })
      .from(scoreModificationLogs)
      .innerJoin(routineScores, eq(routineScores.id, scoreModificationLogs.routineScoreId))
      .innerJoin(routines, eq(routines.id, routineScores.routineId))
      .where(and(eq(scoreModificationLogs.id, logId), eq(routines.competitionId, compId)))
      .limit(1);
    if (!hit) return reply.code(404).send({ error: "Not found" });
    await db.delete(scoreModificationLogs).where(eq(scoreModificationLogs.id, logId));
    notifyCompetitionUpdated(compId);
    reply.code(204).send();
  });

  /** POST (not DELETE) so JSON body is reliably parsed; same auth as competition delete. */
  app.post("/api/competitions/:compId/modification-logs/clear", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const parsed = z.object({ confirmPassword: z.string().min(1) }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Password required." });
    if (parsed.data.confirmPassword !== COMPETITION_DELETE_PASSWORD)
      return reply.code(403).send({ error: "Incorrect password." });
    const { compId } = req.params as { compId: string };
    const [c] = await db.select().from(competitions).where(eq(competitions.id, compId));
    if (!c) return reply.code(404).send({ error: "Not found" });

    const rows = await db
      .select({ id: scoreModificationLogs.id })
      .from(scoreModificationLogs)
      .innerJoin(routineScores, eq(routineScores.id, scoreModificationLogs.routineScoreId))
      .innerJoin(routines, eq(routines.id, routineScores.routineId))
      .where(eq(routines.competitionId, compId));
    const ids = [...new Set(rows.map((r) => r.id))];
    if (ids.length === 0) return { deletedCount: 0 };
    await db.delete(scoreModificationLogs).where(inArray(scoreModificationLogs.id, ids));
    notifyCompetitionUpdated(compId);
    return { deletedCount: ids.length };
  });

  app.get("/api/admin/users", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    return { users: await listUsersSafe() };
  });

  app.post("/api/admin/judges", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const parsed = z
      .object({ username: z.string().min(1), password: z.string().min(6), displayName: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Bad judge payload" });

    const id = crypto.randomUUID();
    const hash = bcrypt.hashSync(parsed.data.password, 10);
    try {
      await db.insert(users).values({
        id,
        username: parsed.data.username,
        passwordHash: hash,
        displayName: parsed.data.displayName,
        role: "JUDGE",
        createdAt: new Date().toISOString(),
      });
    } catch {
      return reply.code(409).send({ error: "Username exists" });
    }

    const [created] = await db.select().from(users).where(eq(users.id, id));
    notifyGlobalUpdated();
    return {
      user: { id: created.id, username: created.username, displayName: created.displayName, role: created.role },
    };
  });

  app.delete("/api/admin/judges/:userId", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { userId } = req.params as { userId: string };
    try {
      await deleteJudgeById(userId);
      notifyGlobalUpdated();
      reply.code(204).send();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      reply.code(400).send({ error: msg });
    }
  });

  app.post("/api/competitions/:id/admin/scores/:scoreId/d-value", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { id, scoreId } = req.params as { id: string; scoreId: string };
    const parsed = z
      .object({
        dValue: z.number(),
        reason: z.string().min(3),
        expectedVersion: z.number().int().nonnegative(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Bad body" });
    try {
      await adminSetDValue({
        adminUserId: user.id,
        competitionId: id,
        routineScoreId: scoreId,
        dValue: parsed.data.dValue,
        reason: parsed.data.reason,
        expectedVersion: parsed.data.expectedVersion,
      });
      await rebuildLeaderboard(id);
      notifyCompetitionUpdated(id);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Update failed";
      return reply.code(400).send({ error: msg });
    }
  });

  app.post("/api/competitions/:id/admin/scores/:scoreId/e-deductions", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { id, scoreId } = req.params as { id: string; scoreId: string };
    const parsed = z
      .object({
        totalDeductions: z.number().min(0),
        reason: z.string().min(3),
        expectedVersion: z.number().int().nonnegative(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Bad body" });
    try {
      await adminSetEDeductionTotal({
        adminUserId: user.id,
        competitionId: id,
        routineScoreId: scoreId,
        totalDeductions: parsed.data.totalDeductions,
        reason: parsed.data.reason,
        expectedVersion: parsed.data.expectedVersion,
      });
      await rebuildLeaderboard(id);
      notifyCompetitionUpdated(id);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Update failed";
      return reply.code(400).send({ error: msg });
    }
  });

  app.post("/api/competitions/:id/archive-category", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const parsed = z
      .object({ categoryKey: z.string().min(1), confirmPassword: z.string().min(1) })
      .safeParse(typeof req.body === "object" && req.body !== null ? req.body : {});
    if (!parsed.success)
      return reply.code(400).send({ error: "Category key and confirmation password are required." });
    if (parsed.data.confirmPassword !== COMPETITION_DELETE_PASSWORD)
      return reply.code(403).send({ error: "Incorrect password." });
    const { id } = req.params as { id: string };
    const [c] = await db.select().from(competitions).where(eq(competitions.id, id));
    if (!c) return reply.code(404).send({ error: "Not found" });

    const active = await db
      .select()
      .from(athletes)
      .where(and(eq(athletes.competitionId, id), isNull(athletes.archivedAt)));
    const toArchive = active.filter(
      (a) =>
        athleteCategoryKey(a.level as (typeof ATHLETE_LEVEL_VALUES)[number], a.yearOfBirth) ===
        parsed.data.categoryKey,
    );
    if (toArchive.length === 0) {
      return reply.code(400).send({
        error:
          "No active athletes in that category. They may already be in History, or the category does not match the current roster.",
      });
    }
    const ts = new Date().toISOString();
    await db
      .update(athletes)
      .set({ archivedAt: ts })
      .where(
        inArray(
          athletes.id,
          toArchive.map((a) => a.id),
        ),
      );
    await rebuildLeaderboard(id);
    notifyCompetitionUpdated(id);
    return { ok: true as const, archivedCount: toArchive.length };
  });

  app.post("/api/competitions/:id/unarchive-category", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const parsed = z
      .object({ categoryKey: z.string().min(1), confirmPassword: z.string().min(1) })
      .safeParse(typeof req.body === "object" && req.body !== null ? req.body : {});
    if (!parsed.success)
      return reply.code(400).send({ error: "Category key and confirmation password are required." });
    if (parsed.data.confirmPassword !== COMPETITION_DELETE_PASSWORD)
      return reply.code(403).send({ error: "Incorrect password." });
    const { id } = req.params as { id: string };
    const [c] = await db.select().from(competitions).where(eq(competitions.id, id));
    if (!c) return reply.code(404).send({ error: "Not found" });

    const archivedRows = await db
      .select()
      .from(athletes)
      .where(and(eq(athletes.competitionId, id), isNotNull(athletes.archivedAt)));
    const toRestore = archivedRows.filter(
      (a) =>
        athleteCategoryKey(a.level as (typeof ATHLETE_LEVEL_VALUES)[number], a.yearOfBirth) ===
        parsed.data.categoryKey,
    );
    if (toRestore.length === 0) {
      return reply.code(400).send({
        error: "No archived athletes in that category for this competition.",
      });
    }
    await db
      .update(athletes)
      .set({ archivedAt: null })
      .where(
        inArray(
          athletes.id,
          toRestore.map((a) => a.id),
        ),
      );
    await rebuildLeaderboard(id);
    notifyCompetitionUpdated(id);
    return { ok: true as const, restoredCount: toRestore.length };
  });

  app.patch("/api/competitions/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { id } = req.params as { id: string };
    if (!(await requireCompetitionHasArchivedAthletes(id, reply))) return;
    const parsed = z
      .object({
        name: z.string().min(1).optional(),
        deductionPresetMode: z.enum(["FIG_HP", "USAG"]).optional(),
        aggregationRule: z.enum(["AVERAGE", "DROP_HIGH_LOW"]).optional(),
        reason: z.string().min(3),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Bad body" });
    if (!parsed.data.name && !parsed.data.deductionPresetMode && !parsed.data.aggregationRule) {
      return reply.code(400).send({ error: "Provide at least one field to change (name, preset, or aggregation)." });
    }
    const patch: Partial<typeof competitions.$inferInsert> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.deductionPresetMode !== undefined) patch.deductionPresetMode = parsed.data.deductionPresetMode;
    if (parsed.data.aggregationRule !== undefined) patch.aggregationRule = parsed.data.aggregationRule;
    await db.update(competitions).set(patch).where(eq(competitions.id, id));
    await rebuildLeaderboard(id);
    const [updated] = await db.select().from(competitions).where(eq(competitions.id, id));
    void parsed.data.reason;
    notifyGlobalUpdated();
    notifyCompetitionUpdated(id);
    return { competition: updated };
  });

  app.patch("/api/competitions/:compId/athletes/:athleteId", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (user.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });
    const { compId, athleteId } = req.params as { compId: string; athleteId: string };
    const parsed = z
      .object({
        name: z.string().min(1).optional(),
        level: z.enum(ATHLETE_LEVEL_VALUES).optional(),
        yearOfBirth: z.coerce.number().int().min(1900).max(new Date().getFullYear() + 1).optional(),
        reason: z.string().min(3),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Bad body" });
    if (!parsed.data.name && parsed.data.level === undefined && parsed.data.yearOfBirth === undefined) {
      return reply.code(400).send({ error: "Provide at least one of name, level, or year of birth to change." });
    }
    const [row] = await db.select().from(athletes).where(eq(athletes.id, athleteId));
    if (!row || row.competitionId !== compId) return reply.code(404).send({ error: "Not found" });
    if (!row.archivedAt) {
      return reply.code(400).send({
        error:
          "That athlete is in the active workspace. Edit them under Athletes roster, or move their category to History first.",
      });
    }
    const patch: Partial<typeof athletes.$inferInsert> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.level !== undefined) patch.level = parsed.data.level;
    if (parsed.data.yearOfBirth !== undefined) patch.yearOfBirth = parsed.data.yearOfBirth;
    await db.update(athletes).set(patch).where(eq(athletes.id, athleteId));
    void parsed.data.reason;
    await rebuildLeaderboard(compId);
    const [updated] = await db.select().from(athletes).where(eq(athletes.id, athleteId));
    notifyCompetitionUpdated(compId);
    return { athlete: updated };
  });
}
