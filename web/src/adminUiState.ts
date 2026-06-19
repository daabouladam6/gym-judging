export type AdminSectionId =
  | "competition"
  | "athletes"
  | "judges"
  | "categories"
  | "scores"
  | "corrections"
  | "history";

export type AdminUiSnapshot = {
  section?: AdminSectionId;
  athletesBrowse?: "groups" | "detail";
  athletesDetailCategoryKey?: string | null;
  judgesBrowse?: "list" | "detail";
  judgesDetailUserId?: string | null;
};

const KEY = "gym_admin_ui";

export function loadAdminUi(): AdminUiSnapshot {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as AdminUiSnapshot;
  } catch {
    return {};
  }
}

export function saveAdminUi(patch: AdminUiSnapshot): void {
  const prev = loadAdminUi();
  sessionStorage.setItem(KEY, JSON.stringify({ ...prev, ...patch }));
}

const scoresKey = (competitionId: string) => `gym_admin_scores_sel_${competitionId}`;

export function loadScoresSelection(competitionId: string): string | null {
  try {
    return sessionStorage.getItem(scoresKey(competitionId));
  } catch {
    return null;
  }
}

export function saveScoresSelection(competitionId: string, selectedKey: string | null): void {
  try {
    if (!selectedKey) sessionStorage.removeItem(scoresKey(competitionId));
    else sessionStorage.setItem(scoresKey(competitionId), selectedKey);
  } catch {
    /* ignore */
  }
}
