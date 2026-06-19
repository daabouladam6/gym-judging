import { FormEvent, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { useNavigate } from "react-router-dom";

import {

  addAthlete,

  APPARATUS_OPTIONS,

  approveJudgeCorrectionRequest,

  assignJudge,

  assignJudgeCategory,

  ATHLETE_LEVEL_GROUPS,

  ATHLETE_LEVEL_LABELS,

  competitionState,

  createCompetition,

  createJudge,

  deleteAthlete,

  deleteCompetition,

  deleteJudge,

  deleteJudgeAssignment,

  deleteJudgeCategoryAssignment,

  deleteAllModificationLogs,

  deleteModificationLog,

  listCompetitionCategories,

  listCompetitions,

  listJudgeAssignments,

  listJudgeCategoryAssignments,

  listJudgeCorrectionRequests,

  listUsers,

  PANEL_ROLE_LABEL,

  rejectJudgeCorrectionRequest,

  type Athlete,

  type AthleteLevel,

  type Competition,

  type CompetitionCategory,

  type CompetitionSnapshot,

  type JudgeAssignment,

  type JudgeCategoryAssignment,

  type JudgeCorrectionRequestRow,

  type PanelRole,

  type ScoreModificationLogEntry,

  type User,

} from "../api/client";

import { useSession } from "../auth/SessionProvider";

import { athleteCategoryKey, categoryLabel } from "@gym/shared";

import { AdminScoresSection } from "./AdminScoresSection";
import { AdminHistorySection } from "./AdminHistorySection";

type AdminSectionId = "competition" | "athletes" | "judges" | "categories" | "scores" | "corrections" | "history";

const ADMIN_TAB_IDS: readonly AdminSectionId[] = [
  "competition",
  "athletes",
  "judges",
  "categories",
  "scores",
  "corrections",
  "history",
] as const;

const ADMIN_TAB_LABEL: Record<AdminSectionId, string> = {
  competition: "Competition",
  athletes: "Athlete lists",
  judges: "Judges",
  categories: "Assignments",
  scores: "Scores",
  corrections: "Corrections",
  history: "History",
};

const ADMIN_HEADING: Record<AdminSectionId, string> = {
  competition: "1 · Competition setup",
  athletes: "2 · Athlete lists",
  judges: "3 · Judges & panel roles",
  categories: "4 · Judge–list assignments",
  scores: "5 · Scores",
  corrections: "6 · Judge correction requests",
  history: "7 · History (finished seasons)",
};



export function AdminPage() {

  const nav = useNavigate();

  const session = useSession();

  const [competitions, setCompetitions] = useState<Competition[]>([]);

  const [activeId, setActiveId] = useState("");

  const [athletes, setAthletes] = useState<Athlete[]>([]);

  const [judges, setJudges] = useState<User[]>([]);

  const [assignments, setAssignments] = useState<JudgeAssignment[]>([]);

  const [categories, setCategories] = useState<CompetitionCategory[]>([]);

  const [categoryAssignments, setCategoryAssignments] = useState<JudgeCategoryAssignment[]>([]);

  const [snapshot, setSnapshot] = useState<CompetitionSnapshot | null>(null);

  const [correctionRequests, setCorrectionRequests] = useState<JudgeCorrectionRequestRow[]>([]);

  const [correctionListMode, setCorrectionListMode] = useState<"PENDING" | "ALL">("PENDING");

  const [error, setError] = useState<string | null>(null);

  const [message, setMessage] = useState<string | null>(null);

  const [msg, setMsg] = useState<string | null>(null);

  const [deleteDialogCompetition, setDeleteDialogCompetition] = useState<Competition | null>(null);

  const [deletePasswordInput, setDeletePasswordInput] = useState("");

  const [adminSection, setAdminSection] = useState<AdminSectionId>("competition");

  /** Athletes tab: browse groups vs one group's roster + judges. */
  const [athletesBrowse, setAthletesBrowse] = useState<"groups" | "detail">("groups");
  const [athletesDetailCategoryKey, setAthletesDetailCategoryKey] = useState<string | null>(null);

  /** Judges tab: browse judges vs one judge's panel (apparatus/E-D) assignments. */
  const [judgesBrowse, setJudgesBrowse] = useState<"list" | "detail">("list");
  const [judgesDetailUserId, setJudgesDetailUserId] = useState<string | null>(null);

  /** Scores tab: clear-all audit logs (inline password — avoids blocked window.prompt). */
  const [auditLogClearOpen, setAuditLogClearOpen] = useState(false);
  const [auditLogClearPassword, setAuditLogClearPassword] = useState("");

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);



  const refreshCompetitions = useCallback(async () => {

    const { competitions: list } = await listCompetitions();

    setCompetitions(list);

    setActiveId((prev) => {
      if (prev && list.some((c) => c.id === prev)) return prev;
      return list[0]?.id ?? "";
    });

  }, []);



  const refreshJudges = useCallback(async () => {

    const { users } = await listUsers();

    setJudges(users.filter((u) => u.role === "JUDGE"));

  }, []);



  const refreshAthletes = useCallback(async (competitionId: string) => {

    if (!competitionId) {

      setAthletes([]);

      return;

    }

    const state = await competitionState(competitionId);

    setAthletes(state.snapshot.athletes ?? []);

  }, []);



  const refreshAssignments = useCallback(async (competitionId: string) => {

    if (!competitionId) {

      setAssignments([]);

      return;

    }

    const { assignments: rows } = await listJudgeAssignments(competitionId);

    setAssignments(rows);

  }, []);



  const refreshCategories = useCallback(async (competitionId: string) => {

    if (!competitionId) {

      setCategories([]);

      return;

    }

    const { categories: rows } = await listCompetitionCategories(competitionId);

    setCategories(rows);

  }, []);



  const refreshCategoryAssignments = useCallback(async (competitionId: string) => {

    if (!competitionId) {

      setCategoryAssignments([]);

      return;

    }

    const { assignments: rows } = await listJudgeCategoryAssignments(competitionId);

    setCategoryAssignments(rows);

  }, []);



  const refreshSnapshot = useCallback(async (competitionId: string) => {

    if (!competitionId) {

      setSnapshot(null);

      return;

    }

    const state = await competitionState(competitionId);

    setSnapshot(state.snapshot);

  }, []);

  const refreshCorrectionRequests = useCallback(async () => {

    if (!activeId) {

      setCorrectionRequests([]);

      return;

    }

    const st = correctionListMode === "ALL" ? "ALL" : "PENDING";

    const { requests } = await listJudgeCorrectionRequests(activeId, st);

    setCorrectionRequests(requests);

  }, [activeId, correctionListMode]);



  useEffect(() => {

    if (!session.hydrated) return;

    if (!session.user || session.user.role !== "ADMIN") {

      nav("/login", { replace: true });

      return;

    }

    refreshCompetitions().catch(() => setError("Could not load competitions"));

    refreshJudges().catch(() => setError("Could not load judges"));

  }, [session.hydrated, session.user, nav, refreshCompetitions, refreshJudges]);



  useEffect(() => {

    if (!activeId) return;

    refreshAthletes(activeId).catch(() => setError("Could not load athletes"));

    refreshAssignments(activeId).catch(() => setError("Could not load judge assignments"));

    refreshCategories(activeId).catch(() => setError("Could not load athlete categories"));

    refreshCategoryAssignments(activeId).catch(() => setError("Could not load category assignments"));

    refreshSnapshot(activeId).catch(() => setError("Could not load scores"));

  }, [activeId, refreshAthletes, refreshAssignments, refreshCategories, refreshCategoryAssignments, refreshSnapshot]);

  useEffect(() => {
    setAthletesBrowse("groups");
    setAthletesDetailCategoryKey(null);
    setJudgesBrowse("list");
    setJudgesDetailUserId(null);
    setAuditLogClearOpen(false);
    setAuditLogClearPassword("");
  }, [activeId]);

  useEffect(() => {
    if (adminSection !== "scores") {
      setAuditLogClearOpen(false);
      setAuditLogClearPassword("");
    }
  }, [adminSection]);

  useEffect(() => {
    if (
      athletesDetailCategoryKey &&
      !categories.some((c) => c.categoryKey === athletesDetailCategoryKey)
    ) {
      setAthletesBrowse("groups");
      setAthletesDetailCategoryKey(null);
    }
  }, [categories, athletesDetailCategoryKey]);

  useEffect(() => {
    if (judgesDetailUserId && !judges.some((j) => j.id === judgesDetailUserId)) {
      setJudgesBrowse("list");
      setJudgesDetailUserId(null);
    }
  }, [judges, judgesDetailUserId]);

  useEffect(() => {
    if (!deleteDialogCompetition) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDeleteDialogCompetition(null);
      setDeletePasswordInput("");
      setMessage(null);
      setMsg(null);
      setError(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteDialogCompetition]);

  useEffect(() => {
    if (!activeId || adminSection !== "corrections") return;
    refreshCorrectionRequests().catch(() => setError("Could not load correction requests"));
  }, [activeId, adminSection, correctionListMode, refreshCorrectionRequests]);



  async function onCreateCompetition(e: FormEvent<HTMLFormElement>) {

    e.preventDefault();

    const form = e.currentTarget;

    setError(null);

    setMsg(null);

    const name = String(new FormData(form).get("cname") ?? "").trim();

    if (!name) return;

    try {

      await createCompetition({ name });

      await refreshCompetitions();

      setMsg(`Competition “${name}” created.`);

      form.reset();

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to create competition");

    }

  }



  async function onDeleteCompetition(c: Competition) {

    if (
      !window.confirm(
        `Delete “${c.name}”? This cannot be undone.\n\n` +
          "This removes ALL athletes, routines, scores, and judge assignments for this competition.",
      )
    )
      return;

    setMessage(null);
    setMsg(null);
    setError(null);
    setDeletePasswordInput("");
    setDeleteDialogCompetition(c);
  }

  async function confirmDeleteCompetition(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const c = deleteDialogCompetition;
    if (!c) return;

    const confirmPassword = deletePasswordInput.trim();
    if (!confirmPassword) {
      setError("Enter the deletion password in the dialog, then click Delete permanently.");
      return;
    }

    setError(null);
    setMsg(null);

    try {
      await deleteCompetition(c.id, confirmPassword);
      setDeleteDialogCompetition(null);
      setDeletePasswordInput("");
      await refreshCompetitions();
      setMsg(`Competition “${c.name}” deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete competition");
    }
  }

  function cancelDeleteCompetition() {
    setDeleteDialogCompetition(null);
    setDeletePasswordInput("");
    setMessage(null);
    setMsg(null);
    setError(null);
  }


  async function onAddAthlete(e: FormEvent<HTMLFormElement>) {

    e.preventDefault();

    const form = e.currentTarget;

    if (!activeId) {

      setError("Select or create a competition first.");

      return;

    }

    setError(null);

    setMsg(null);

    const fd = new FormData(form);

    const name = String(fd.get("aname") ?? "").trim();

    const level = String(fd.get("level") ?? "") as AthleteLevel;

    const yearOfBirth = Number(fd.get("yob"));

    if (!name || !level || !Number.isFinite(yearOfBirth)) return;

    try {

      await addAthlete(activeId, { name, level, yearOfBirth });

      await refreshAthletes(activeId);

      await refreshCategories(activeId);

      setMsg(`Athlete “${name}” added.`);

      form.reset();

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to add athlete");

    }

  }



  async function onDeleteAthlete(a: Athlete) {

    if (!activeId) return;

    if (!window.confirm(`Delete athlete “${a.name}”?`)) return;

    setError(null);

    setMsg(null);

    try {

      await deleteAthlete(activeId, a.id);

      await refreshAthletes(activeId);

      await refreshCategories(activeId);

      setMsg(`Athlete “${a.name}” deleted.`);

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to delete athlete");

    }

  }



  async function onCreateJudge(e: FormEvent<HTMLFormElement>) {

    e.preventDefault();

    const form = e.currentTarget;

    setError(null);

    setMsg(null);

    const fd = new FormData(form);

    const username = String(fd.get("u") ?? "").trim();

    const password = String(fd.get("p") ?? "");

    const displayName = String(fd.get("d") ?? "").trim();

    try {

      await createJudge({ username, password, displayName });

      await refreshJudges();

      setMsg(`Judge “${displayName || username}” created.`);

      form.reset();

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to create judge");

    }

  }



  async function onDeleteJudge(j: User) {

    if (!window.confirm(`Delete judge “${j.displayName}” (${j.username})?`)) return;

    setError(null);

    setMsg(null);

    try {

      await deleteJudge(j.id);

      await refreshJudges();

      if (activeId) await refreshAssignments(activeId);

      setMsg(`Judge “${j.displayName}” deleted.`);

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to delete judge");

    }

  }



  async function onAssignJudge(e: FormEvent<HTMLFormElement>) {

    e.preventDefault();

    if (!activeId) {

      setError("Select a competition first.");

      return;

    }

    setError(null);

    setMsg(null);

    const fd = new FormData(e.currentTarget);

    const userId = String(fd.get("judge") ?? "");

    const apparatus = String(fd.get("ap") ?? "") as (typeof APPARATUS_OPTIONS)[number];

    const panelRole = String(fd.get("role") ?? "") as PanelRole;

    try {

      await assignJudge(activeId, { userId, apparatus, panelRole });

      await refreshAssignments(activeId);

      const judge = judges.find((j) => j.id === userId);

      setMsg(

        `${judge?.displayName ?? "Judge"} assigned to ${apparatus} as ${PANEL_ROLE_LABEL[panelRole]}.`,

      );

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to assign judge");

    }

  }



  async function onAssignCategory(e: FormEvent<HTMLFormElement>) {

    e.preventDefault();

    if (!activeId) {

      setError("Select a competition first.");

      return;

    }

    setError(null);

    setMsg(null);

    const fd = new FormData(e.currentTarget);

    const userId = String(fd.get("judge") ?? "");

    const categoryKey = String(fd.get("category") ?? "");

    if (!userId || !categoryKey) return;

    try {

      await assignJudgeCategory(activeId, { userId, categoryKey });

      await refreshCategoryAssignments(activeId);

      const judge = judges.find((j) => j.id === userId);

      setMsg(`${judge?.displayName ?? "Judge"} assigned to ${categoryLabel(categoryKey)}.`);

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to assign category");

    }

  }



  async function onDeleteCategoryAssignment(row: JudgeCategoryAssignment) {

    if (!activeId) return;

    if (!window.confirm(`Remove category assignment for ${judgeName(row.judgeUserId)}?`)) return;

    setError(null);

    setMsg(null);

    try {

      await deleteJudgeCategoryAssignment(activeId, row.id);

      await refreshCategoryAssignments(activeId);

      setMsg("Category assignment removed.");

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to remove category assignment");

    }

  }

  async function onDeletePanelAssignment(row: JudgeAssignment) {

    if (!activeId) return;

    if (
      !window.confirm(
        `Remove ${judgeName(row.judgeUserId)} from ${row.apparatus} as ${PANEL_ROLE_LABEL[row.panelRole]}? Their submitted scores on that apparatus stay with the athletes; they only lose access to that panel until reassigned.`,
      )
    )
      return;

    setError(null);

    setMsg(null);

    try {

      await deleteJudgeAssignment(activeId, row.id);

      await refreshAssignments(activeId);

      await refreshSnapshot(activeId);

      setMsg("Panel role removed.");

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to remove panel role");

    }

  }

  async function onApproveCorrectionRequest(row: JudgeCorrectionRequestRow) {

    if (!activeId) return;

    const kind = row.scoreType === "EXECUTION" ? "deduction total" : "D score";

    const proposed =

      row.scoreType === "EXECUTION"

        ? (row.newDeductionTotal ?? 0).toFixed(3)

        : (row.newDValue ?? 0).toFixed(3);

    if (

      !window.confirm(

        `Approve ${row.judgeDisplayName}’s correction for ${row.athleteName} on ${row.apparatus} (${kind} → ${proposed})?`,

      )

    )

      return;

    setError(null);

    setMsg(null);

    try {

      await approveJudgeCorrectionRequest(activeId, row.id);

      await refreshSnapshot(activeId);

      await refreshCorrectionRequests();

      setMsg("Correction approved; scores updated.");

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to approve correction");

    }

  }

  async function onRejectCorrectionRequest(row: JudgeCorrectionRequestRow) {

    if (!activeId) return;

    const note = window.prompt("Optional note for the audit log (visible to admins):", "") ?? "";

    if (!window.confirm("Reject this request? The score stays unchanged.")) return;

    setError(null);

    setMsg(null);

    try {

      await rejectJudgeCorrectionRequest(activeId, row.id, { reviewNote: note.trim() || undefined });

      await refreshCorrectionRequests();

      setMsg("Correction request rejected.");

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to reject correction");

    }

  }



  function judgeName(userId: string) {

    return judges.find((j) => j.id === userId)?.displayName ?? userId.slice(0, 8);

  }

  function judgePanelSlotsLabel(judgeUserId: string): string {
    const mine = assignments.filter((a) => a.judgeUserId === judgeUserId);
    if (mine.length === 0) return "—";
    const order = APPARATUS_OPTIONS;
    const sorted = [...mine].sort(
      (a, b) =>
        order.indexOf(a.apparatus as (typeof APPARATUS_OPTIONS)[number]) -
          order.indexOf(b.apparatus as (typeof APPARATUS_OPTIONS)[number]) ||
        a.panelRole.localeCompare(b.panelRole),
    );
    return sorted.map((a) => `${a.apparatus} · ${a.panelRole}`).join(", ");
  }



  function onAdminTabKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      next = (index + 1) % ADMIN_TAB_IDS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      next = (index - 1 + ADMIN_TAB_IDS.length) % ADMIN_TAB_IDS.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      next = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      next = ADMIN_TAB_IDS.length - 1;
    } else {
      return;
    }
    const id = ADMIN_TAB_IDS[next]!;
    setAdminSection(id);
    queueMicrotask(() => tabRefs.current[next]?.focus());
  }

  function tabCountSuffix(id: AdminSectionId): string {
    if (id === "athletes" && athletes.length > 0) return ` (${athletes.length})`;
    if (id === "judges") {
      const jc = judges.length;
      const ac = assignments.length;
      if (jc > 0 && ac > 0) return ` (${jc} judges · ${ac} roles)`;
      if (jc > 0) return ` (${jc})`;
      return "";
    }
    if (id === "categories" && categoryAssignments.length > 0) return ` (${categoryAssignments.length})`;
    if (id === "scores" && snapshot) {
      if (snapshot.scoreboard.length > 0) return ` (${snapshot.scoreboard.length} routines)`;
      return "";
    }
    if (id === "corrections" && correctionListMode === "PENDING" && correctionRequests.length > 0) {
      return ` (${correctionRequests.length})`;
    }
    if (id === "history") {
      const n = competitions.reduce((acc, c) => acc + (c.archivedSegmentCount ?? 0), 0);
      if (n > 0) return ` (${n})`;
    }
    return "";
  }



  function levelLabel(level: AthleteLevel | string) {

    return ATHLETE_LEVEL_LABELS[level as AthleteLevel] ?? level;

  }



  if (!session.hydrated) {

    return (

      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>

        <p className="muted">Loading…</p>

      </div>

    );

  }



  const active = competitions.find((c) => c.id === activeId);

  const currentYear = new Date().getFullYear();



  return (

    <div className="admin-app">

      <main className="admin-main" id="admin-main">

        <div className="admin-toolbar">

          <div className="admin-toolbar-row">

            <div>

              <h1>Arena control</h1>

              <p className="muted" style={{ margin: "0.35rem 0 0", maxWidth: "44rem" }}>

                Manage competitions and large judge panels. Pick a workspace below — only one area shows at a time so long
                athlete and judge lists stay in their own scrollable view.

              </p>

            </div>

            <button type="button" className="ghost" onClick={() => void session.logoutFn().then(() => nav("/login"))}>

              Logout

            </button>

          </div>

          <nav className="admin-tablist-wrap" aria-label="Admin workspaces">

            <div role="tablist" aria-label="Sections" className="admin-tablist">

              {ADMIN_TAB_IDS.map((tabId, i) => (

                <button

                  key={tabId}

                  ref={(el) => {

                    tabRefs.current[i] = el;

                  }}

                  type="button"

                  role="tab"

                  id={`adm-tab-${tabId}`}

                  aria-selected={adminSection === tabId}

                  aria-controls={`adm-panel-${tabId}`}

                  tabIndex={adminSection === tabId ? 0 : -1}

                  className={`admin-tab${adminSection === tabId ? " admin-tab-active" : ""}`}

                  onClick={() => setAdminSection(tabId)}

                  onKeyDown={(e) => onAdminTabKeyDown(e, i)}

                >

                  {ADMIN_TAB_LABEL[tabId]}

                  {tabCountSuffix(tabId)}

                </button>

              ))}

            </div>

          </nav>

          <div className="admin-toolbar-live" aria-live="polite" aria-atomic="true">

            {error ? (

              <p className="error" role="alert" style={{ margin: 0 }}>

                {error}

              </p>

            ) : null}

            {!error && message ? <p style={{ margin: 0, color: "#86efac" }}>{message}</p> : null}

            {!error && !message && msg ? (

              <p style={{ margin: 0, color: "#8dffb0" }} role="status">

                {msg}

              </p>

            ) : null}

          </div>

        </div>

        <div className="admin-panel-area">

      {adminSection === "competition" && (
        <section
          role="tabpanel"
          id="adm-panel-competition"
          aria-labelledby="adm-heading-competition"
          className="panel"
          tabIndex={0}
        >

          <h2 id="adm-heading-competition">{ADMIN_HEADING.competition}</h2>

          <p className="muted" style={{ margin: "0 0 0.75rem" }}>

            Athletes belong to a competition. Create one, then select it below.

          </p>

          <form className="row" onSubmit={onCreateCompetition}>

            <input name="cname" placeholder="Competition name" required style={{ flex: "1 1 200px" }} />

            <button type="submit">Create competition</button>

          </form>

          {competitions.length > 0 ? (

            <div className="row" style={{ marginTop: "0.75rem", alignItems: "stretch" }}>

              {competitions.map((c) => (

                <div key={c.id} className="row" style={{ gap: "0.35rem" }}>

                  <button

                    type="button"

                    className={`chip${c.id === activeId ? " active" : ""}`}

                    onClick={() => setActiveId(c.id)}

                  >

                    {c.name}
                    {(c.archivedSegmentCount ?? 0) > 0 ? ` · ${c.archivedSegmentCount} in History` : ""}

                  </button>

                  <button

                    type="button"

                    className="danger"

                    title={`Delete ${c.name}`}

                    onClick={() => void onDeleteCompetition(c)}

                  >

                    ×

                  </button>

                </div>

              ))}

            </div>

          ) : (

            <p className="muted" style={{ marginTop: "0.75rem" }}>

              No competitions yet.

            </p>

          )}

          {active ? (

            <p className="muted" style={{ marginTop: "0.5rem" }}>

              Active: <strong style={{ color: "#eaf0fb" }}>{active.name}</strong>

            </p>

          ) : null}

        </section>
      )}
      {adminSection === "athletes" && (
        <section role="tabpanel" id="adm-panel-athletes" aria-labelledby="adm-heading-athletes" className="panel" tabIndex={0}>
          <h2 id="adm-heading-athletes">{ADMIN_HEADING.athletes}</h2>
          <p className="muted" style={{ margin: "0 0 0.75rem" }}>
            {athletesBrowse === "groups"
              ? "Open a group to see its athletes and which judges are assigned to that list."
              : "Manage athletes in this group and assign or remove judges for this list."}
          </p>

          {!activeId ? (
            <p className="muted" style={{ marginTop: "0.75rem" }}>
              Select a competition first.
            </p>
          ) : athletesBrowse === "groups" ? (
            <>
              {categories.length === 0 ? (
                <>
                  <p className="muted" style={{ margin: "0 0 0.75rem" }}>
                    No groups yet. Level and year of birth define each group. Add your first athlete below.
                  </p>
                  <form className="row" onSubmit={onAddAthlete}>
                    <input
                      name="aname"
                      placeholder="Athlete name"
                      required
                      disabled={!activeId}
                      style={{ flex: "1 1 160px" }}
                    />
                    <select name="level" required disabled={!activeId} defaultValue="USAG_1">
                      {ATHLETE_LEVEL_GROUPS.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.levels.map((code) => (
                            <option key={code} value={code}>
                              {ATHLETE_LEVEL_LABELS[code]}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <input
                      name="yob"
                      type="number"
                      placeholder="Year of birth"
                      required
                      disabled={!activeId}
                      min={1900}
                      max={currentYear + 1}
                      defaultValue={currentYear - 12}
                      style={{ width: "8rem" }}
                    />
                    <button type="submit" disabled={!activeId}>
                      Add athlete
                    </button>
                  </form>
                </>
              ) : (
                <div className="table-scroll">
                  <table style={{ marginTop: 0 }}>
                    <thead>
                      <tr>
                        <th>Group</th>
                        <th>Athletes</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map((c) => (
                        <tr key={c.categoryKey}>
                          <td>{c.label}</td>
                          <td>{c.athleteCount}</td>
                          <td>
                            <button
                              type="button"
                              className="primary"
                              onClick={() => {
                                setAthletesDetailCategoryKey(c.categoryKey);
                                setAthletesBrowse("detail");
                              }}
                            >
                              Open
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="row" style={{ marginBottom: "0.75rem", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setAthletesBrowse("groups");
                    setAthletesDetailCategoryKey(null);
                  }}
                >
                  ← All groups
                </button>
                <strong>
                  {categories.find((c) => c.categoryKey === athletesDetailCategoryKey)?.label ??
                    categoryLabel(athletesDetailCategoryKey ?? "")}
                </strong>
              </div>

              <form className="row" onSubmit={onAddAthlete}>
                <input
                  name="aname"
                  placeholder="Athlete name"
                  required
                  disabled={!activeId}
                  style={{ flex: "1 1 160px" }}
                />
                <select name="level" required disabled={!activeId} defaultValue="USAG_1">
                  {ATHLETE_LEVEL_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.levels.map((code) => (
                        <option key={code} value={code}>
                          {ATHLETE_LEVEL_LABELS[code]}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <input
                  name="yob"
                  type="number"
                  placeholder="Year of birth"
                  required
                  disabled={!activeId}
                  min={1900}
                  max={currentYear + 1}
                  defaultValue={currentYear - 12}
                  style={{ width: "8rem" }}
                />
                <button type="submit" disabled={!activeId}>
                  Add athlete
                </button>
              </form>

              <h3 style={{ fontSize: "1rem", margin: "1rem 0 0.5rem" }}>Athletes in this group</h3>
              <div className="table-scroll">
                <table style={{ marginTop: 0 }}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Level</th>
                      <th>Year of birth</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {athletes.filter(
                      (a) => athleteCategoryKey(a.level, a.yearOfBirth) === athletesDetailCategoryKey,
                    ).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="muted">
                          No athletes in this group yet.
                        </td>
                      </tr>
                    ) : (
                      athletes
                        .filter((a) => athleteCategoryKey(a.level, a.yearOfBirth) === athletesDetailCategoryKey)
                        .map((a) => (
                          <tr key={a.id}>
                            <td>{a.name}</td>
                            <td>{levelLabel(a.level)}</td>
                            <td>{a.yearOfBirth}</td>
                            <td>
                              <button type="button" className="danger" onClick={() => void onDeleteAthlete(a)}>
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>

              <h3 style={{ fontSize: "1rem", margin: "1.25rem 0 0.5rem" }}>Judges on this list</h3>
              <p className="muted" style={{ margin: "0 0 0.65rem", fontSize: "0.9rem" }}>
                Assigned judges see this category when picking an athlete on their panel.
              </p>
              <form key={athletesDetailCategoryKey ?? "assign"} className="row" onSubmit={onAssignCategory}>
                <input type="hidden" name="category" value={athletesDetailCategoryKey ?? ""} />
                <select name="judge" required disabled={judges.length === 0} defaultValue="">
                  <option value="" disabled>
                    Select judge
                  </option>
                  {judges.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.displayName}
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={judges.length === 0}>
                  Assign judge to this list
                </button>
              </form>
              <div className="table-scroll">
                <table style={{ marginTop: "0.65rem" }}>
                  <thead>
                    <tr>
                      <th>Judge</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {categoryAssignments.filter((r) => r.categoryKey === athletesDetailCategoryKey).length === 0 ? (
                      <tr>
                        <td colSpan={2} className="muted">
                          No judges on this list yet.
                        </td>
                      </tr>
                    ) : (
                      categoryAssignments
                        .filter((r) => r.categoryKey === athletesDetailCategoryKey)
                        .map((row) => (
                          <tr key={row.id}>
                            <td>{judgeName(row.judgeUserId)}</td>
                            <td>
                              <button
                                type="button"
                                className="danger"
                                onClick={() => void onDeleteCategoryAssignment(row)}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
      {adminSection === "judges" && (
        <section role="tabpanel" id="adm-panel-judges" aria-labelledby="adm-heading-judges" className="panel" tabIndex={0}>
          <h2 id="adm-heading-judges">{ADMIN_HEADING.judges}</h2>

          <p className="muted" style={{ margin: "0 0 0.75rem" }}>
            {judgesBrowse === "list"
              ? "Create judge accounts, then open a judge to assign apparatus + E/D panel roles for this competition."
              : "Add or remove panel slots for this judge (Vault, Bars, etc.). Use Athlete lists to choose which roster groups they see."}
          </p>

          <form className="row" onSubmit={onCreateJudge}>
            <input name="u" placeholder="Username" required style={{ flex: "1 1 120px" }} />
            <input
              name="p"
              type="password"
              placeholder="Password (min 6)"
              required
              minLength={6}
              style={{ flex: "1 1 120px" }}
            />
            <input name="d" placeholder="Display name" required style={{ flex: "1 1 140px" }} />
            <button type="submit">Create judge</button>
          </form>

          {judgesBrowse === "list" ? (
            <div className="table-scroll">
              <table style={{ marginTop: "0.75rem" }}>
                <thead>
                  <tr>
                    <th>Judge</th>
                    <th>Username</th>
                    <th>Panel slots</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {judges.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No judges yet — use the form above.
                      </td>
                    </tr>
                  ) : (
                    judges.map((j) => {
                      const slotCount = activeId
                        ? assignments.filter((a) => a.judgeUserId === j.id).length
                        : 0;
                      return (
                        <tr key={j.id}>
                          <td>{j.displayName}</td>
                          <td>{j.username}</td>
                          <td className="muted">{activeId ? slotCount : "—"}</td>
                          <td>
                            <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                              <button
                                type="button"
                                className="primary"
                                disabled={!activeId}
                                title={!activeId ? "Select a competition first" : undefined}
                                onClick={() => {
                                  setJudgesDetailUserId(j.id);
                                  setJudgesBrowse("detail");
                                }}
                              >
                                Open
                              </button>
                              <button type="button" className="danger" onClick={() => void onDeleteJudge(j)}>
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              {(() => {
                const j = judges.find((x) => x.id === judgesDetailUserId);
                if (!j) {
                  return (
                    <p className="muted" style={{ marginTop: "0.75rem" }}>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setJudgesBrowse("list");
                          setJudgesDetailUserId(null);
                        }}
                      >
                        ← All judges
                      </button>{" "}
                      Judge not found.
                    </p>
                  );
                }
                const mine = assignments.filter((a) => a.judgeUserId === judgesDetailUserId);
                return (
                  <>
                    <div className="row" style={{ marginTop: "0.75rem", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setJudgesBrowse("list");
                          setJudgesDetailUserId(null);
                        }}
                      >
                        ← All judges
                      </button>
                      <strong>
                        {j.displayName} <span className="muted">({j.username})</span>
                      </strong>
                    </div>

                    {!activeId ? (
                      <p className="muted" style={{ marginTop: "0.75rem" }}>
                        Select a competition first (Competition tab).
                      </p>
                    ) : (
                      <>
                        <h3 style={{ margin: "1rem 0 0.5rem", fontSize: "1rem", fontWeight: 650 }}>Panel roles</h3>
                        <p className="muted" style={{ margin: "0 0 0.65rem", fontSize: "0.9rem" }}>
                          Assigning a new E or D on the same apparatus replaces that judge&apos;s previous role on that
                          apparatus only. Scores already saved on athletes stay in the system.
                        </p>
                        <form key={judgesDetailUserId ?? "pj"} className="row" onSubmit={onAssignJudge}>
                          <input type="hidden" name="judge" value={judgesDetailUserId ?? ""} />
                          <select name="ap" required disabled={!activeId} defaultValue="VAULT">
                            {APPARATUS_OPTIONS.map((ap) => (
                              <option key={ap} value={ap}>
                                {ap}
                              </option>
                            ))}
                          </select>
                          <select name="role" required disabled={!activeId} defaultValue="E">
                            <option value="E">{PANEL_ROLE_LABEL.E}</option>
                            <option value="D">{PANEL_ROLE_LABEL.D}</option>
                          </select>
                          <button type="submit" disabled={!activeId}>
                            Assign panel
                          </button>
                        </form>

                        <div className="table-scroll">
                          <table style={{ marginTop: "0.65rem" }}>
                            <thead>
                              <tr>
                                <th>Apparatus</th>
                                <th>Panel role</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {mine.length === 0 ? (
                                <tr>
                                  <td colSpan={3} className="muted">
                                    No panel assignments yet for this competition.
                                  </td>
                                </tr>
                              ) : (
                                mine.map((a) => (
                                  <tr key={a.id}>
                                    <td>{a.apparatus}</td>
                                    <td>{PANEL_ROLE_LABEL[a.panelRole]}</td>
                                    <td>
                                      <button type="button" className="danger" onClick={() => void onDeletePanelAssignment(a)}>
                                        Remove
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </section>
      )}
      {adminSection === "categories" && (
        <section role="tabpanel" id="adm-panel-categories" aria-labelledby="adm-heading-categories" className="panel" tabIndex={0}>
          <h2 id="adm-heading-categories">{ADMIN_HEADING.categories}</h2>

          <p className="muted" style={{ margin: "0 0 0.75rem" }}>
            Pick a judge and an athlete group so that judge only sees that roster on their panel. You can do the same
            from <strong>Athlete lists</strong> when you open a group. For <strong>Vault / Bars / E–D</strong> judging
            roles, use the <strong>Judges</strong> tab.
          </p>

          {!activeId ? (
            <p className="muted" style={{ marginTop: "0.75rem" }}>
              Select a competition first.
            </p>
          ) : categories.length === 0 ? (
            <p className="muted" style={{ marginTop: "0.75rem" }}>
              Add athletes under <strong>Athlete lists</strong> to create groups.
            </p>
          ) : (
            <>
              {judges.length === 0 ? (
                <p className="muted" style={{ margin: "0 0 0.75rem" }}>
                  Create judges on the <strong>Judges</strong> tab, then return here to link them to groups.
                </p>
              ) : (
                <form className="row" onSubmit={onAssignCategory} style={{ marginBottom: "1rem", flexWrap: "wrap" }}>
                  <select name="judge" required defaultValue="">
                    <option value="" disabled>
                      Select judge
                    </option>
                    {judges.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.displayName}
                      </option>
                    ))}
                  </select>
                  <select name="category" required defaultValue="" style={{ flex: "1 1 220px" }}>
                    <option value="" disabled>
                      Select athlete group
                    </option>
                    {categories.map((c) => (
                      <option key={c.categoryKey} value={c.categoryKey}>
                        {c.label} ({c.athleteCount} athletes)
                      </option>
                    ))}
                  </select>
                  <button type="submit">Assign to group</button>
                </form>
              )}
              <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem", fontWeight: 650 }}>Current links</h3>
              <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.88rem" }}>
                <strong>Apparatus · E/D</strong> lists that judge&apos;s panel roles for this competition (set on the{" "}
                <strong>Judges</strong> tab). Shown here for reference only.
              </p>
              <div className="table-scroll">
                <table style={{ marginTop: 0 }}>
                  <thead>
                    <tr>
                      <th>Judge</th>
                      <th>Group</th>
                      <th>Apparatus · E/D</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {categoryAssignments.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="muted">
                          No judge–group links yet. Use the form above.
                        </td>
                      </tr>
                    ) : (
                      categoryAssignments.map((row) => (
                        <tr key={row.id}>
                          <td>{judgeName(row.judgeUserId)}</td>
                          <td>{categoryLabel(row.categoryKey)}</td>
                          <td className="muted" style={{ fontSize: "0.92rem", maxWidth: "22rem" }}>
                            {judgePanelSlotsLabel(row.judgeUserId)}
                          </td>
                          <td>
                            <button type="button" className="danger" onClick={() => void onDeleteCategoryAssignment(row)}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}



      {adminSection === "scores" && (

        <section

          role="tabpanel"

          id="adm-panel-scores"

          aria-labelledby="adm-heading-scores"

          className="panel"

          tabIndex={0}

        >

          <h2 id="adm-heading-scores">{ADMIN_HEADING.scores}</h2>



        <AdminScoresSection

          activeId={activeId}

          categories={categories}

          scoreboard={snapshot?.scoreboard ?? []}

          embedded

          onRefresh={() => refreshSnapshot(activeId)}

          onError={(msg) => {
            setMessage(null);
            setError(msg);
          }}

          onMessage={(msg) => {
            setError(null);
            setMessage(msg);
          }}

        />

        {snapshot ? (
          <details style={{ marginTop: "1.5rem", borderTop: "1px solid #233249", paddingTop: "1rem" }}>
            <summary
              style={{
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "1rem",
                margin: "0 0 0.75rem",
                listStylePosition: "outside",
              }}
            >
              Audit log (judge corrections & edits)
            </summary>
            <p className="muted" style={{ margin: "0 0 0.65rem", fontSize: "0.88rem" }}>
              Includes judge notes, admin overrides, and approved correction requests. Sources such as{" "}
              <code>JUDGE_CORRECTION_PENDING</code> are requests awaiting review; <code>ADMIN_APPROVED_CORRECTION</code>{" "}
              and <code>ADMIN_REJECTED_CORRECTION</code> reflect decisions in the Corrections tab.
            </p>
            {snapshot.modificationLogs.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                No recorded edits yet for this competition.
              </p>
            ) : (
              <>
                <div className="row" style={{ marginBottom: "0.65rem", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                  {!auditLogClearOpen ? (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        setAuditLogClearOpen(true);
                        setAuditLogClearPassword("");
                        setError(null);
                        setMessage(null);
                      }}
                    >
                      Delete all audit logs…
                    </button>
                  ) : (
                    <div
                      className="row"
                      style={{
                        flexWrap: "wrap",
                        gap: "0.5rem",
                        alignItems: "center",
                        padding: "0.65rem 0.75rem",
                        border: "1px solid #3d4f6a",
                        borderRadius: 8,
                        background: "rgba(0,0,0,0.15)",
                      }}
                    >
                      <label htmlFor="audit-log-clear-pw" className="muted" style={{ fontSize: "0.88rem" }}>
                        Competition delete password
                      </label>
                      <input
                        id="audit-log-clear-pw"
                        type="password"
                        autoComplete="off"
                        value={auditLogClearPassword}
                        onChange={(e) => setAuditLogClearPassword(e.target.value)}
                        style={{ minWidth: 200, padding: "0.35rem 0.5rem" }}
                      />
                      <button
                        type="button"
                        className="danger"
                        disabled={!auditLogClearPassword.trim()}
                        onClick={async () => {
                          if (!activeId) return;
                          if (!window.confirm("Delete ALL audit log entries for this competition? This cannot be undone."))
                            return;
                          try {
                            const { deletedCount } = await deleteAllModificationLogs(activeId, auditLogClearPassword.trim());
                            setError(null);
                            setMessage(
                              deletedCount === 0
                                ? "No audit log entries to remove."
                                : `Removed ${deletedCount} audit log entr${deletedCount === 1 ? "y" : "ies"}.`,
                            );
                            setAuditLogClearOpen(false);
                            setAuditLogClearPassword("");
                            await refreshSnapshot(activeId);
                          } catch (e) {
                            setMessage(null);
                            setError(e instanceof Error ? e.message : String(e));
                          }
                        }}
                      >
                        Clear all logs
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setAuditLogClearOpen(false);
                          setAuditLogClearPassword("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <span className="muted" style={{ fontSize: "0.82rem" }}>
                    Uses the same password as deleting a competition. Scores are not changed.
                  </span>
                </div>
                <div className="scroll-table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th scope="col">When</th>
                        <th scope="col">Athlete</th>
                        <th scope="col">Piece</th>
                        <th scope="col">Source</th>
                        <th scope="col">Field</th>
                        <th scope="col">Before</th>
                        <th scope="col">After</th>
                        <th scope="col">Who</th>
                        <th scope="col">Reason</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...snapshot.modificationLogs]
                        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
                        .map((row: ScoreModificationLogEntry) => (
                          <tr key={row.id}>
                            <td>
                              {new Date(row.createdAt).toLocaleString(undefined, {
                                dateStyle: "short",
                                timeStyle: "medium",
                              })}
                            </td>
                            <td>{row.athleteName}</td>
                            <td>{row.apparatus}</td>
                            <td>
                              <code style={{ fontSize: "0.78rem", whiteSpace: "nowrap" }}>{row.source}</code>
                            </td>
                            <td
                              style={{
                                maxWidth: 120,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {row.fieldChanged}
                            </td>
                            <td style={{ maxWidth: 140 }}>
                              <span title={row.previousSummary ?? undefined}>{row.previousSummary ?? "—"}</span>
                            </td>
                            <td style={{ maxWidth: 140 }}>
                              <span title={row.nextSummary ?? undefined}>{row.nextSummary ?? "—"}</span>
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {(row.actorName ?? row.actorUserId ?? "").toString()}
                            </td>
                            <td style={{ minWidth: 180, wordBreak: "break-word", fontSize: "0.86rem" }}>
                              {row.reason}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="danger ghost"
                                style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}
                                onClick={async () => {
                                  if (!activeId || !window.confirm("Remove this audit log entry? Scores stay the same."))
                                    return;
                                  try {
                                    await deleteModificationLog(activeId, row.id);
                                    setError(null);
                                    setMessage("Audit log entry removed.");
                                    await refreshSnapshot(activeId);
                                  } catch (e) {
                                    setMessage(null);
                                    setError(e instanceof Error ? e.message : String(e));
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </details>
        ) : null}

        </section>


      )}

      {adminSection === "corrections" && (
        <section
          role="tabpanel"
          id="adm-panel-corrections"
          aria-labelledby="adm-heading-corrections"
          className="panel"
          tabIndex={0}
        >
          <h2 id="adm-heading-corrections">{ADMIN_HEADING.corrections}</h2>
          <p className="muted" style={{ margin: "0 0 1rem" }}>
            Judges submit finalized score corrections from their panels; those requests land here.{" "}
            <strong>Approve</strong> applies the requested value to the score. <strong>Reject</strong> leaves the score as it was.
          </p>
          {!activeId ? (
            <p className="muted" style={{ margin: 0 }}>
              Select a competition first (Competition tab).
            </p>
          ) : (
            <>
              <div className="row" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
                <button
                  type="button"
                  className={correctionListMode === "PENDING" ? "primary" : "ghost"}
                  onClick={() => setCorrectionListMode("PENDING")}
                >
                  Pending
                </button>
                <button
                  type="button"
                  className={correctionListMode === "ALL" ? "primary" : "ghost"}
                  onClick={() => setCorrectionListMode("ALL")}
                >
                  All recent
                </button>
                <button type="button" className="ghost" onClick={() => void refreshCorrectionRequests()}>
                  Refresh
                </button>
              </div>
              {correctionRequests.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  No correction requests to show.
                </p>
              ) : (
                <div className="table-scroll">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th scope="col">Submitted</th>
                        <th scope="col">Athlete</th>
                        <th scope="col">Apparatus</th>
                        <th scope="col">Judge</th>
                        <th scope="col">Type</th>
                        <th scope="col">Requested</th>
                        <th scope="col">Judge note</th>
                        <th scope="col">Status</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {correctionRequests.map((row) => (
                        <tr key={row.id}>
                          <td>
                            {new Date(row.createdAt).toLocaleString(undefined, {
                              dateStyle: "short",
                              timeStyle: "medium",
                            })}
                          </td>
                          <td>{row.athleteName}</td>
                          <td>{row.apparatus}</td>
                          <td>{row.judgeDisplayName}</td>
                          <td>{row.scoreType === "EXECUTION" ? "E (deductions)" : "D"}</td>
                          <td>
                            {row.scoreType === "EXECUTION"
                              ? (row.newDeductionTotal ?? 0).toFixed(3)
                              : (row.newDValue ?? 0).toFixed(3)}
                          </td>
                          <td style={{ maxWidth: 240, wordBreak: "break-word", fontSize: "0.88rem" }}>{row.reason}</td>
                          <td>{row.status}</td>
                          <td>
                            {row.status === "PENDING" ? (
                              <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  className="primary"
                                  onClick={() => void onApproveCorrectionRequest(row)}
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => void onRejectCorrectionRequest(row)}
                                >
                                  Reject
                                </button>
                              </div>
                            ) : (
                              <span className="muted" style={{ fontSize: "0.85rem" }}>
                                {row.reviewNote ?? "—"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {adminSection === "history" && (
        <section
          role="tabpanel"
          id="adm-panel-history"
          aria-labelledby="adm-heading-history"
          className="panel"
          tabIndex={0}
        >
          <h2 id="adm-heading-history">{ADMIN_HEADING.history}</h2>
          <AdminHistorySection
            competitions={competitions}
            onRefreshed={async () => {
              await refreshCompetitions();
            }}
            onMessage={(m) => setMsg(m)}
            onError={(m) => setError(m || null)}
          />
        </section>
      )}

        </div>

      </main>

      {deleteDialogCompetition ? (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) cancelDeleteCompetition();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-competition-title"
            className="panel"
            style={{ maxWidth: 420, width: "100%", margin: 0 }}
            onMouseDown={(ev) => ev.stopPropagation()}
          >
            <h2 id="delete-competition-title" style={{ marginTop: 0, fontSize: "1.1rem" }}>
              Delete competition
            </h2>
            <p className="muted" style={{ margin: "0 0 1rem" }}>
              You are deleting <strong>{deleteDialogCompetition.name}</strong>. This wipes every athlete, score, routine,
              and judge assignment tied to it.
            </p>
            <form
              style={{ display: "grid", gap: "0.75rem" }}
              onSubmit={(e) => {
                void confirmDeleteCompetition(e);
              }}
            >
              <label style={{ display: "grid", gap: "0.35rem", fontWeight: 500 }}>
                Type deletion password
                <input
                  type="password"
                  autoComplete="off"
                  autoFocus
                  value={deletePasswordInput}
                  placeholder="Required"
                  onChange={(e) => setDeletePasswordInput(e.target.value)}
                />
              </label>
              <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                Default password is documented in README (normally <strong>admin123</strong>). Use Cancel or Escape if you
                do not want to delete this competition.
              </p>
              <div className="row" style={{ gap: "0.5rem", justifyContent: "flex-end" }}>
                <button type="button" className="ghost" onClick={cancelDeleteCompetition}>
                  Cancel
                </button>
                <button type="submit" className="danger">
                  Delete permanently
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

    </div>

  );

}


