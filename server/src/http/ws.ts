import { clientWsMessageSchema } from "@gym/shared";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { validateSession } from "../auth/session.js";
import { broadcast, registerGlobalSocket, subscribe } from "../realtime.js";
import { rebuildLeaderboard } from "../services/aggregation.js";
import {
  adminOverrideScore,
  applyDeduction,
  finalizeScore,
  submitJudgeCorrectionRequest,
  manualScoreEdit,
  routineAdminLock,
} from "../scores/mutations.js";

export async function registerWebSocket(app: FastifyInstance) {
  await app.register(import("@fastify/websocket"));

  app.get("/ws", { websocket: true }, (socket: WebSocket) => {
    let userId: string | null = null;
    const unsubscribers: Array<() => void> = [];
    let unregisterGlobal: (() => void) | null = null;
    const joined = new Set<string>();

    const joinCompetition = (competitionId: string) => {
      if (!joined.has(competitionId)) {
        joined.add(competitionId);
        unsubscribers.push(subscribe(competitionId, socket));
      }
    };

    const unsubAll = () => {
      unsubscribers.forEach((u) => u());
      unsubscribers.length = 0;
      joined.clear();
      unregisterGlobal?.();
      unregisterGlobal = null;
    };

    socket.on("message", async (buf) => {
      const text = Buffer.isBuffer(buf) ? buf.toString() : String(buf);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(text);
      } catch {
        return;
      }
      const decoded = clientWsMessageSchema.safeParse(parsedJson);
      if (!decoded.success) return;
      const msg = decoded.data;

      try {
        if (msg.type === "auth.session") {
          unsubAll();
          const user = await validateSession(msg.payload.sessionToken);
          if (!user) {
            socket.send(JSON.stringify({ type: "error.auth", error: "Invalid session" }));
            return;
          }
          userId = user.id;
          unregisterGlobal?.();
          unregisterGlobal = registerGlobalSocket(socket);
          socket.send(JSON.stringify({ type: "auth.ok" }));
          return;
        }

        if (!userId) {
          socket.send(JSON.stringify({ type: "error.auth", error: "Not authenticated" }));
          return;
        }

        if (msg.type === "competition.subscribe") {
          joinCompetition(msg.competitionId);
          return;
        }

        joinCompetition(msg.competitionId);

        if (msg.type === "score.applyDeduction") {
          await applyDeduction({
            userId,
            competitionId: msg.competitionId,
            routineScoreId: msg.payload.routineScoreId,
            amount: msg.payload.amount,
            clientRequestId: msg.payload.clientRequestId,
            expectedVersion: msg.payload.expectedVersion,
          });
          await rebuildLeaderboard(msg.competitionId);
          broadcast(msg.competitionId, { type: "score.updated", competitionId: msg.competitionId });
          broadcast(msg.competitionId, { type: "rankings.updated", competitionId: msg.competitionId });
          return;
        }

        if (msg.type === "score.manualEdit") {
          await manualScoreEdit({
            userId,
            competitionId: msg.competitionId,
            routineScoreId: msg.payload.routineScoreId,
            targetField: msg.payload.targetField,
            newValue: msg.payload.newValue,
            reason: msg.payload.reason,
            expectedVersion: msg.payload.expectedVersion,
          });
          await rebuildLeaderboard(msg.competitionId);
          broadcast(msg.competitionId, { type: "score.updated", competitionId: msg.competitionId });
          broadcast(msg.competitionId, { type: "rankings.updated", competitionId: msg.competitionId });
          return;
        }

        if (msg.type === "score.finalize") {
          await finalizeScore({
            userId,
            competitionId: msg.competitionId,
            routineScoreId: msg.payload.routineScoreId,
            expectedVersion: msg.payload.expectedVersion,
            pendingDValue: msg.payload.pendingDValue,
          });
          await rebuildLeaderboard(msg.competitionId);
          broadcast(msg.competitionId, { type: "score.updated", competitionId: msg.competitionId });
          broadcast(msg.competitionId, { type: "rankings.updated", competitionId: msg.competitionId });
          return;
        }

        if (msg.type === "score.amendFinalized") {
          await submitJudgeCorrectionRequest({
            userId,
            competitionId: msg.competitionId,
            routineScoreId: msg.payload.routineScoreId,
            reason: msg.payload.reason,
            expectedVersion: msg.payload.expectedVersion,
            newDeductionTotal: msg.payload.newDeductionTotal,
            newDValue: msg.payload.newDValue,
          });
          broadcast(msg.competitionId, { type: "correction.requested", competitionId: msg.competitionId });
          return;
        }

        if (msg.type === "routine.adminLock") {
          await routineAdminLock({
            adminUserId: userId,
            competitionId: msg.competitionId,
            routineId: msg.payload.routineId,
            lock: msg.payload.lock,
            expectedRoutineVersion: msg.payload.expectedRoutineVersion,
          });
          await rebuildLeaderboard(msg.competitionId);
          broadcast(msg.competitionId, { type: "score.updated", competitionId: msg.competitionId });
          broadcast(msg.competitionId, { type: "rankings.updated", competitionId: msg.competitionId });
          return;
        }

        if (msg.type === "admin.overrideScore") {
          await adminOverrideScore({
            adminUserId: userId,
            competitionId: msg.competitionId,
            routineScoreId: msg.payload.routineScoreId,
            reason: msg.payload.reason,
            expectedVersion: msg.payload.expectedVersion,
            overrideExecutionComputed: msg.payload.overrideExecutionComputed,
            overrideDValue: msg.payload.overrideDValue,
            startingValue: msg.payload.startingValue,
          });
          await rebuildLeaderboard(msg.competitionId);
          broadcast(msg.competitionId, { type: "score.updated", competitionId: msg.competitionId });
          broadcast(msg.competitionId, { type: "rankings.updated", competitionId: msg.competitionId });
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : "Unknown error";
        if (err.toLowerCase().includes("conflict")) {
          socket.send(
            JSON.stringify({
              type: "error.conflict",
              competitionId: msg.competitionId,
              payload: { message: err },
            }),
          );
        } else {
          socket.send(
            JSON.stringify({
              type: "error.ws",
              competitionId: msg.competitionId,
              payload: { message: err },
            }),
          );
        }
      }
    });

    socket.on("close", () => unsubAll());
  });
}
