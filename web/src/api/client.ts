import type { AthleteLevel } from "@gym/shared";
import {
  ATHLETE_LEVEL_GROUPS,
  ATHLETE_LEVEL_LABELS,
  ATHLETE_LEVEL_VALUES,
} from "@gym/shared";

export {
  ATHLETE_LEVEL_GROUPS,
  ATHLETE_LEVEL_LABELS,
  ATHLETE_LEVEL_VALUES,
  type AthleteLevel,
};

export type User = { id: string; username: string; displayName: string; role: string };
export type Competition = {
  id: string;
  name: string;
  deductionPresetMode: string;
  aggregationRule: string;
  /** Distinct athlete categories currently in History for this competition. */
  archivedSegmentCount?: number;
};
export type Athlete = {
  id: string;
  name: string;
  level: AthleteLevel;
  yearOfBirth: number;
  /** Set when this athlete's category was moved to History. */
  archivedAt?: string | null;
};
export type Apparatus = "VAULT" | "BARS" | "BEAM" | "FLOOR";
export type PanelRole = "E" | "D";
export type JudgeAssignment = {
  id: string;
  competitionId: string;
  judgeUserId: string;
  apparatus: Apparatus;
  panelRole: PanelRole;
};

export type JudgeCategoryAssignment = {
  id: string;
  competitionId: string;
  judgeUserId: string;
  categoryKey: string;
};

export type CompetitionCategory = {
  categoryKey: string;
  label: string;
  athleteCount: number;
};

export type ArchivedCompetitionCategory = CompetitionCategory & {
  archivedAt: string;
};

export const APPARATUS_OPTIONS: Apparatus[] = ["VAULT", "BARS", "BEAM", "FLOOR"];

export type ScoreRow = {
  id: string;
  routineId: string;
  judgeUserId: string;
  scoreType: "EXECUTION" | "DIFFICULTY";
  computedValue: number;
  deductionTotal?: number;
  /** Execution only: adjustment before deductions (with starting value defines pre-deduction ceiling). */
  executionAdjustment?: number;
  locked: boolean;
  finalized: boolean;
  version: number;
  startingValue?: number;
  dValue?: number;
};

export type RoutineTotal = {
  routineId: string;
  dScore: number;
  avgDeductions: number;
  eJudgeCount: number;
  finalScore: number;
};

export type ScoreboardEJudge = {
  scoreId: string;
  judgeName: string;
  deductions: number;
  version: number;
  finalized: boolean;
};

export type ScoreboardRow = {
  routineId: string;
  athleteId: string;
  athleteName: string;
  /** Matches section 5 athlete list keys (`athleteCategoryKey`). */
  categoryKey: string;
  apparatus: Apparatus;
  dScoreId: string | null;
  dValue: number;
  dVersion: number;
  dFinalized: boolean;
  eJudges: ScoreboardEJudge[];
  avgDeductions: number;
  finalScore: number;
};

export type RoutineRow = {
  id: string;
  athleteId: string;
  apparatus: Apparatus;
  version: number;
  locked: boolean;
};

export type ScoreModificationLogEntry = {
  id: string;
  routineScoreId: string;
  fieldChanged: string;
  reason: string;
  source: string;
  actorUserId: string | null;
  actorName: string | null;
  createdAt: string;
  previousSummary: string | null;
  nextSummary: string | null;
  apparatus: string;
  athleteName: string;
};

export type CompetitionSnapshot = {
  competition: Competition;
  athletes: Athlete[];
  routines: RoutineRow[];
  scores: ScoreRow[];
  routineTotals: RoutineTotal[];
  scoreboard: ScoreboardRow[];
  rankings: unknown[];
  modificationLogs: ScoreModificationLogEntry[];
};

export type CompetitionStateResponse = {
  snapshot: CompetitionSnapshot;
  assignments: JudgeAssignment[];
};

export const PANEL_ROLE_LABEL: Record<PanelRole, string> = {
  E: "E judge (execution)",
  D: "D judge (difficulty)",
};

const TOKEN_KEY = "gym_session_token";

export function getToken(): string | undefined {
  return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
}

export function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export async function login(username: string, password: string) {
  return api<{ sessionToken: string; user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function me() {
  return api<{
    user: User;
    assignments: JudgeAssignment[];
    categoryAssignments: JudgeCategoryAssignment[];
  }>("/api/auth/me");
}

export async function logout() {
  await api<null>("/api/auth/logout", { method: "POST", body: "{}" });
  clearToken();
}

export async function listCompetitions() {
  return api<{ competitions: Competition[] }>("/api/competitions");
}

export async function createCompetition(input: {
  name: string;
  deductionPresetMode?: "FIG_HP" | "USAG";
  aggregationRule?: "AVERAGE" | "DROP_HIGH_LOW";
}) {
  return api<{ competition: Competition }>("/api/competitions", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      deductionPresetMode: input.deductionPresetMode ?? "FIG_HP",
      aggregationRule: input.aggregationRule ?? "AVERAGE",
    }),
  });
}

export async function deleteCompetition(competitionId: string, confirmPassword: string) {
  return api<null>(`/api/competitions/${competitionId}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmPassword }),
  });
}

export async function archiveCategory(competitionId: string, categoryKey: string, confirmPassword: string) {
  return api<{ ok: true; archivedCount: number }>(`/api/competitions/${competitionId}/archive-category`, {
    method: "POST",
    body: JSON.stringify({ categoryKey, confirmPassword }),
  });
}

export async function unarchiveCategory(competitionId: string, categoryKey: string, confirmPassword: string) {
  return api<{ ok: true; restoredCount: number }>(`/api/competitions/${competitionId}/unarchive-category`, {
    method: "POST",
    body: JSON.stringify({ categoryKey, confirmPassword }),
  });
}

export async function patchArchivedCompetition(
  competitionId: string,
  input: {
    name?: string;
    deductionPresetMode?: "FIG_HP" | "USAG";
    aggregationRule?: "AVERAGE" | "DROP_HIGH_LOW";
    reason: string;
  },
) {
  return api<{ competition: Competition }>(`/api/competitions/${competitionId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function patchArchivedAthlete(
  competitionId: string,
  athleteId: string,
  input: { name?: string; level?: AthleteLevel; yearOfBirth?: number; reason: string },
) {
  return api<{ athlete: Athlete }>(`/api/competitions/${competitionId}/athletes/${athleteId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function competitionState(competitionId: string, opts?: { historyCategoryKey?: string }) {
  const q =
    opts?.historyCategoryKey && opts.historyCategoryKey.length > 0
      ? `?historyCategoryKey=${encodeURIComponent(opts.historyCategoryKey)}`
      : "";
  return api<CompetitionStateResponse>(`/api/competitions/${competitionId}/state${q}`);
}

export async function addAthlete(
  competitionId: string,
  input: { name: string; level: AthleteLevel; yearOfBirth: number },
) {
  return api<{ athlete: Athlete }>(`/api/competitions/${competitionId}/athletes`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteAthlete(competitionId: string, athleteId: string) {
  return api<null>(`/api/competitions/${competitionId}/athletes/${athleteId}`, { method: "DELETE" });
}

export async function selectAthleteForJudging(
  competitionId: string,
  athleteId: string,
  apparatus?: Apparatus,
) {
  return api<{ routineId: string; apparatus: Apparatus; panelRole: PanelRole; athleteName: string }>(
    `/api/competitions/${competitionId}/judge/select-athlete`,
    {
      method: "POST",
      body: JSON.stringify({ athleteId, apparatus }),
    },
  );
}

export async function listUsers() {
  return api<{ users: User[] }>("/api/admin/users");
}

export async function createJudge(input: { username: string; password: string; displayName: string }) {
  return api<{ user: User }>("/api/admin/judges", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteJudge(userId: string) {
  return api<null>(`/api/admin/judges/${userId}`, { method: "DELETE" });
}

export async function listJudgeAssignments(competitionId: string) {
  return api<{ assignments: JudgeAssignment[] }>(`/api/competitions/${competitionId}/judge-assignments`);
}

export async function assignJudge(
  competitionId: string,
  input: { userId: string; apparatus: Apparatus; panelRole: PanelRole },
) {
  return api<{ assignment: JudgeAssignment }>(`/api/competitions/${competitionId}/judge-assignments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteJudgeAssignment(competitionId: string, assignmentId: string) {
  return api<null>(`/api/competitions/${competitionId}/judge-assignments/${assignmentId}`, {
    method: "DELETE",
  });
}

export async function listCompetitionCategories(competitionId: string) {
  return api<{ categories: CompetitionCategory[] }>(`/api/competitions/${competitionId}/categories`);
}

export async function listArchivedCompetitionCategories(competitionId: string) {
  return api<{ categories: ArchivedCompetitionCategory[] }>(
    `/api/competitions/${competitionId}/archived-categories`,
  );
}

export async function listJudgeCategoryAssignments(competitionId: string) {
  return api<{ assignments: JudgeCategoryAssignment[] }>(
    `/api/competitions/${competitionId}/judge-category-assignments`,
  );
}

export async function assignJudgeCategory(competitionId: string, input: { userId: string; categoryKey: string }) {
  return api<{ assignment: JudgeCategoryAssignment }>(
    `/api/competitions/${competitionId}/judge-category-assignments`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function deleteJudgeCategoryAssignment(competitionId: string, assignmentId: string) {
  return api<null>(`/api/competitions/${competitionId}/judge-category-assignments/${assignmentId}`, {
    method: "DELETE",
  });
}

export type JudgeCorrectionRequestRow = {
  id: string;
  competitionId: string;
  routineScoreId: string;
  judgeUserId: string;
  newDeductionTotal: number | null;
  newDValue: number | null;
  reason: string;
  expectedVersion: number;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewNote: string | null;
  apparatus: string;
  athleteName: string;
  scoreType: string;
  judgeDisplayName: string;
};

export async function listJudgeCorrectionRequests(
  competitionId: string,
  status?: "PENDING" | "APPROVED" | "REJECTED" | "ALL",
) {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return api<{ requests: JudgeCorrectionRequestRow[] }>(
    `/api/competitions/${competitionId}/judge-correction-requests${q}`,
  );
}

export async function approveJudgeCorrectionRequest(competitionId: string, requestId: string) {
  return api<{ ok: true }>(
    `/api/competitions/${competitionId}/judge-correction-requests/${requestId}/approve`,
    { method: "POST", body: "{}" },
  );
}

export async function rejectJudgeCorrectionRequest(
  competitionId: string,
  requestId: string,
  input?: { reviewNote?: string },
) {
  return api<{ ok: true }>(
    `/api/competitions/${competitionId}/judge-correction-requests/${requestId}/reject`,
    { method: "POST", body: JSON.stringify(input ?? {}) },
  );
}

export async function deleteModificationLog(competitionId: string, logId: string) {
  return api<null>(`/api/competitions/${competitionId}/modification-logs/${logId}`, { method: "DELETE" });
}

export async function deleteAllModificationLogs(competitionId: string, confirmPassword: string) {
  return api<{ deletedCount: number }>(`/api/competitions/${competitionId}/modification-logs/clear`, {
    method: "POST",
    body: JSON.stringify({ confirmPassword }),
  });
}

export async function adminUpdateDScore(
  competitionId: string,
  scoreId: string,
  input: { dValue: number; reason: string; expectedVersion: number },
) {
  return api<{ ok: true }>(`/api/competitions/${competitionId}/admin/scores/${scoreId}/d-value`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function adminUpdateEDeductions(
  competitionId: string,
  scoreId: string,
  input: { totalDeductions: number; reason: string; expectedVersion: number },
) {
  return api<{ ok: true }>(`/api/competitions/${competitionId}/admin/scores/${scoreId}/e-deductions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
