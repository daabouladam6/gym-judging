import { broadcast, broadcastGlobal } from "./realtime.js";

/** Competition-scoped data changed (roster, scores, assignments, etc.). */
export function notifyCompetitionUpdated(competitionId: string) {
  broadcast(competitionId, { type: "competition.updated", competitionId });
}

/** App-wide data changed (competition list, judges, etc.). */
export function notifyGlobalUpdated() {
  broadcastGlobal({ type: "global.updated" });
}
