import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  competitionState,
  listCompetitions,
  me,
  PANEL_ROLE_LABEL,
  selectAthleteForJudging,
  type Apparatus,
  type Athlete,
  type Competition,
  type CompetitionSnapshot,
  type JudgeAssignment,
  type JudgeCategoryAssignment,
  type PanelRole,
  type ScoreRow,
} from "../api/client";
import { useSession } from "../auth/SessionProvider";
import { DeductionPad } from "../components/DeductionPad";
import { useJudgeWs } from "../hooks/useCompetitionWs";
import {
  athleteMatchesCategoryKey,
  categoryLabel,
  deductionPresetForAthleteLevel,
  groupAthletesByCategory,
} from "@gym/shared";

function askReason(action: string): string | null {
  const reason = window.prompt(`${action}\n\nEnter a reason (at least 3 characters):`);
  if (!reason || reason.trim().length < 3) return null;
  return reason.trim();
}

export function JudgePage() {
  const nav = useNavigate();
  const session = useSession();
  const [assignments, setAssignments] = useState<JudgeAssignment[]>([]);
  const [categoryAssignments, setCategoryAssignments] = useState<JudgeCategoryAssignment[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [compId, setCompId] = useState("");
  const [snapshot, setSnapshot] = useState<CompetitionSnapshot | null>(null);
  const [activeApparatus, setActiveApparatus] = useState<Apparatus | "">("");
  const [selectedAthleteId, setSelectedAthleteId] = useState("");
  const [selectedRoutineId, setSelectedRoutineId] = useState("");
  const [panelRole, setPanelRole] = useState<PanelRole | undefined>();
  const [selectingAthleteId, setSelectingAthleteId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [dDraft, setDDraft] = useState("0");
  const [eAmendDraft, setEAmendDraft] = useState("");
  const [dAmendDraft, setDAmendDraft] = useState("");
  const [eExecutionDraft, setEExecutionDraft] = useState("");
  /** After finalizing: correction note for E (must confirm before submit). */
  const [eAmendNoteOpen, setEAmendNoteOpen] = useState(false);
  const [eAmendNoteDraft, setEAmendNoteDraft] = useState("");
  const [eAmendNoteConfirmed, setEAmendNoteConfirmed] = useState<string | null>(null);
  /** After finalizing: correction note for D (must confirm before submit). */
  const [dAmendNoteOpen, setDAmendNoteOpen] = useState(false);
  const [dAmendNoteDraft, setDAmendNoteDraft] = useState("");
  const [dAmendNoteConfirmed, setDAmendNoteConfirmed] = useState<string | null>(null);
  /** Optimistic deduction sum not yet reflected in snapshot (clears when server deductionTotal updates). */
  const [pendingDeductionSum, setPendingDeductionSum] = useState(0);
  const [judgeTab, setJudgeTab] = useState<"roster" | "calculator">("roster");

  const refresh = useCallback(async () => {
    if (!compId) return;
    const state = await competitionState(compId);
    setSnapshot(state.snapshot);
  }, [compId]);

  const { ready, send } = useJudgeWs(
    compId || undefined,
    () => {
      refresh().catch((e) =>
        setError(e instanceof Error ? e.message : "Could not refresh scores"),
      );
    },
    (msg) => {
      setError(msg);
      setInfoMsg(null);
      setPendingDeductionSum(0);
    },
  );

  useEffect(() => {
    if (!session.hydrated) return;
    if (!session.user || session.user.role !== "JUDGE") {
      nav("/login", { replace: true });
      return;
    }
    me()
      .then((d) => {
        setAssignments(d.assignments);
        setCategoryAssignments(d.categoryAssignments ?? []);
        const ids = new Set(d.assignments.map((a) => a.competitionId));
        return listCompetitions().then(({ competitions: all }) => {
          const mine = all.filter((c) => ids.has(c.id));
          setCompetitions(mine);
          setCompId((prev) => (prev && mine.some((c) => c.id === prev) ? prev : (mine[0]?.id ?? "")));
        });
      })
      .catch(() => setError("Could not load your assignments"));
  }, [session.hydrated, session.user, nav]);

  const myAssignments = useMemo(
    () => assignments.filter((a) => a.competitionId === compId),
    [assignments, compId],
  );

  useEffect(() => {
    if (!compId) {
      setSnapshot(null);
      setActiveApparatus("");
      setSelectedAthleteId("");
      setSelectedRoutineId("");
      setPanelRole(undefined);
      return;
    }
    const apparatuses = myAssignments.map((a) => a.apparatus);
    setActiveApparatus((prev) => (prev && apparatuses.includes(prev) ? prev : (apparatuses[0] ?? "")));
    setSelectedAthleteId("");
    setSelectedRoutineId("");
    setPanelRole(undefined);
    refresh().catch((e) => setError(e instanceof Error ? e.message : "Could not load competition"));
  }, [compId, myAssignments, refresh]);

  const myCategoryKeys = useMemo(
    () =>
      categoryAssignments.filter((a) => a.competitionId === compId).map((a) => a.categoryKey),
    [categoryAssignments, compId],
  );

  const visibleAthletes = useMemo(() => {
    if (myCategoryKeys.length === 0) return [];
    return (snapshot?.athletes ?? []).filter((athlete) =>
      myCategoryKeys.some((key) => athleteMatchesCategoryKey(athlete, key)),
    );
  }, [snapshot?.athletes, myCategoryKeys]);

  const athleteGroups = useMemo(() => groupAthletesByCategory(visibleAthletes), [visibleAthletes]);

  const selectedAthlete = (snapshot?.athletes ?? []).find((a) => a.id === selectedAthleteId);

  const selectedRoutine = snapshot?.routines.find((r) => r.id === selectedRoutineId);

  const myScore: ScoreRow | undefined =
    selectedRoutine && session.user && panelRole
      ? snapshot?.scores.find(
          (s) =>
            s.routineId === selectedRoutine.id &&
            s.judgeUserId === session.user!.id &&
            s.scoreType === (panelRole === "E" ? "EXECUTION" : "DIFFICULTY"),
        )
      : undefined;

  useEffect(() => {
    if (myScore?.scoreType === "DIFFICULTY") {
      setDDraft(String(myScore.computedValue));
    }
  }, [myScore?.id, myScore?.version, myScore?.scoreType, myScore?.computedValue]);

  useEffect(() => {
    if (!myScore) {
      setEAmendDraft("");
      setDAmendDraft("");
      return;
    }
    if (myScore.scoreType === "EXECUTION" && myScore.finalized) {
      setEAmendDraft(String(myScore.deductionTotal ?? 0));
      return;
    }
    if (myScore.scoreType === "DIFFICULTY" && myScore.finalized) {
      setDAmendDraft(String(myScore.computedValue));
      return;
    }
    setEAmendDraft("");
    setDAmendDraft("");
  }, [myScore?.id, myScore?.scoreType, myScore?.finalized, myScore?.deductionTotal, myScore?.computedValue]);

  useEffect(() => {
    setEAmendNoteConfirmed(null);
    setEAmendNoteDraft("");
    setEAmendNoteOpen(false);
    setDAmendNoteConfirmed(null);
    setDAmendNoteDraft("");
    setDAmendNoteOpen(false);
  }, [myScore?.id]);

  useEffect(() => {
    setEAmendNoteConfirmed(null);
  }, [eAmendDraft]);

  useEffect(() => {
    setDAmendNoteConfirmed(null);
  }, [dAmendDraft]);

  const preset = selectedAthlete ? deductionPresetForAthleteLevel(selectedAthlete.level) : "FIG_HP";
  /** Admin locked the whole routine — blocks all editing. */
  const routineLocked = !!selectedRoutine?.locked;
  /** Routine lock, or score row marked locked (includes finalized — used only before finalize). */
  const locked = !!(selectedRoutine?.locked || myScore?.locked);

  const showCalcTab = Boolean(
    panelRole === "E" && selectedAthlete && myScore && !myScore.finalized && !routineLocked,
  );

  useEffect(() => {
    if (!showCalcTab && judgeTab === "calculator") setJudgeTab("roster");
  }, [showCalcTab, judgeTab]);

  /** Next WS expectedVersion for E deductions; bumps optimistically so rapid taps do not reuse stale React state. */
  const eDeductionNextVersionRef = useRef<{ scoreId: string; v: number } | null>(null);

  useEffect(() => {
    if (!myScore || myScore.scoreType !== "EXECUTION" || myScore.finalized) {
      eDeductionNextVersionRef.current = null;
      return;
    }
    const sid = myScore.id;
    const cur = eDeductionNextVersionRef.current;
    if (!cur || cur.scoreId !== sid) {
      eDeductionNextVersionRef.current = { scoreId: sid, v: myScore.version };
      return;
    }
    if (myScore.version > cur.v) {
      cur.v = myScore.version;
    }
  }, [myScore?.id, myScore?.version, myScore?.scoreType, myScore?.finalized]);

  useEffect(() => {
    setPendingDeductionSum(0);
  }, [myScore?.id, myScore?.deductionTotal]);

  useEffect(() => {
    if (myScore?.scoreType === "EXECUTION" && !myScore.finalized) {
      setEExecutionDraft(String(myScore.computedValue));
    } else {
      setEExecutionDraft("");
    }
  }, [myScore?.id, myScore?.version, myScore?.computedValue, myScore?.scoreType, myScore?.finalized]);

  const eExecNumbers = useMemo(() => {
    if (!myScore || myScore.scoreType !== "EXECUTION") return null;
    const serverSd = myScore.deductionTotal ?? 0;
    const sv = myScore.startingValue ?? 10;
    const adj = myScore.executionAdjustment ?? 0;
    const maxSd = sv + adj;
    const displaySd = serverSd + pendingDeductionSum;
    const displayExec = Math.max(0, sv + adj - displaySd);
    const additionalHeadroom = Math.max(0, maxSd - displaySd);
    return { displaySd, displayExec, additionalHeadroom, maxSd };
  }, [
    myScore?.id,
    myScore?.scoreType,
    myScore?.deductionTotal,
    myScore?.startingValue,
    myScore?.executionAdjustment,
    pendingDeductionSum,
  ]);

  async function onSelectAthlete(athlete: Athlete) {
    if (!compId || !activeApparatus) return;
    setError(null);
    setSelectingAthleteId(athlete.id);
    try {
      const res = await selectAthleteForJudging(compId, athlete.id, activeApparatus);
      setSelectedAthleteId(athlete.id);
      setSelectedRoutineId(res.routineId);
      setPanelRole(res.panelRole);
      if (res.panelRole === "E") setJudgeTab("calculator");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start judging");
    } finally {
      setSelectingAthleteId("");
    }
  }

  function athleteLabel(athlete: Athlete) {
    return athlete.name;
  }

  function renderAthleteButton(athlete: Athlete) {
    return (
      <button
        key={athlete.id}
        type="button"
        className={`chip${selectedAthleteId === athlete.id ? " active" : ""}`}
        disabled={!activeApparatus || selectingAthleteId === athlete.id}
        onClick={() => void onSelectAthlete(athlete)}
        style={{ fontSize: "1rem", padding: "0.65rem 1rem" }}
      >
        {selectingAthleteId === athlete.id ? "Loading…" : athleteLabel(athlete)}
      </button>
    );
  }

  function onSubmitAmendedDeductions() {
    if (!ready) {
      setError("Not connected yet. Wait until the header shows “live”, then try again.");
      return;
    }
    if (!myScore || panelRole !== "E" || !myScore.finalized) return;
    const nextTotal = Number(eAmendDraft);
    if (!Number.isFinite(nextTotal)) {
      setError("Enter a valid deduction total");
      return;
    }
    if (nextTotal < 0) {
      setError("Deductions cannot be negative");
      return;
    }
    if (!eAmendNoteConfirmed) {
      setError("Confirm a note first: press “Note (required)”, explain the change, then “Confirm note”.");
      return;
    }
    setError(null);
    setInfoMsg("Correction request sent to Arena control — an admin must approve it before scores change.");
    send({
      type: "score.amendFinalized",
      correlationId: crypto.randomUUID(),
      payload: {
        routineScoreId: myScore.id,
        expectedVersion: myScore.version,
        reason: eAmendNoteConfirmed,
        newDeductionTotal: nextTotal,
      },
    });
    setEAmendNoteConfirmed(null);
    setEAmendNoteDraft("");
    setEAmendNoteOpen(false);
  }

  function onSubmitAmendedDScore() {
    if (!ready) {
      setError("Not connected yet. Wait until the header shows “live”, then try again.");
      return;
    }
    if (!myScore || panelRole !== "D" || !myScore.finalized) return;
    const nextD = Number(dAmendDraft);
    if (!Number.isFinite(nextD)) {
      setError("Enter a valid D score");
      return;
    }
    if (!dAmendNoteConfirmed) {
      setError("Confirm a note first: press “Note (required)”, explain the change, then “Confirm note”.");
      return;
    }
    setError(null);
    setInfoMsg("Correction request sent to Arena control — an admin must approve it before scores change.");
    send({
      type: "score.amendFinalized",
      correlationId: crypto.randomUUID(),
      payload: {
        routineScoreId: myScore.id,
        expectedVersion: myScore.version,
        reason: dAmendNoteConfirmed,
        newDValue: nextD,
      },
    });
    setDAmendNoteConfirmed(null);
    setDAmendNoteDraft("");
    setDAmendNoteOpen(false);
  }

  function confirmEAmendNote() {
    const t = eAmendNoteDraft.trim();
    if (t.length < 3) {
      setError("Write at least 3 characters in the note (what changed and why).");
      return;
    }
    setError(null);
    setEAmendNoteConfirmed(t);
    setEAmendNoteOpen(false);
  }

  function confirmDAmendNote() {
    const t = dAmendNoteDraft.trim();
    if (t.length < 3) {
      setError("Write at least 3 characters in the note (what changed and why).");
      return;
    }
    setError(null);
    setDAmendNoteConfirmed(t);
    setDAmendNoteOpen(false);
  }

  function onDeduction(amount: number) {
    if (!ready) return;
    if (!myScore || locked) return;
    const sv = myScore.startingValue ?? 10;
    const adj = myScore.executionAdjustment ?? 0;
    const maxSd = sv + adj;
    const serverSd = myScore.deductionTotal ?? 0;
    const displaySd = serverSd + pendingDeductionSum;
    if (displaySd + amount > maxSd + 1e-9) return;
    const slot = eDeductionNextVersionRef.current;
    if (!slot || slot.scoreId !== myScore.id) return;
    const expectedVersion = slot.v;
    slot.v = expectedVersion + 1;
    setPendingDeductionSum((p) => p + amount);
    setError(null);
    send({
      type: "score.applyDeduction",
      routineId: selectedRoutineId,
      correlationId: crypto.randomUUID(),
      payload: {
        routineScoreId: myScore.id,
        amount,
        clientRequestId: crypto.randomUUID(),
        expectedVersion,
      },
    });
  }

  function onSubmitExecutionDisplayed() {
    if (!ready) return;
    if (!myScore || locked || myScore.finalized || myScore.scoreType !== "EXECUTION") return;
    const raw = Number(eExecutionDraft);
    if (!Number.isFinite(raw)) {
      setError("Enter a valid execution score");
      return;
    }
    const next = Math.max(0, raw);
    if (Math.abs(next - myScore.computedValue) < 1e-6) {
      setError("Change the score before submitting");
      return;
    }
    const reason = askReason("Set your execution score (minimum 0). Admins will see this note.");
    if (!reason) return;
    setError(null);
    const slot = eDeductionNextVersionRef.current;
    if (!slot || slot.scoreId !== myScore.id) return;
    const expectedVersion = slot.v;
    slot.v = expectedVersion + 1;
    setPendingDeductionSum(0);
    send({
      type: "score.manualEdit",
      correlationId: crypto.randomUUID(),
      payload: {
        routineScoreId: myScore.id,
        targetField: "EXECUTION_DIRECT",
        newValue: next,
        reason,
        expectedVersion,
      },
    });
  }

  function onSetDValue() {
    if (!ready) return;
    if (!myScore || locked) return;
    const reason = askReason("Change D score");
    if (!reason) return;
    const newValue = Number(dDraft);
    if (Number.isNaN(newValue)) {
      setError("Invalid D score");
      return;
    }
    setError(null);
    send({
      type: "score.manualEdit",
      correlationId: crypto.randomUUID(),
      payload: {
        routineScoreId: myScore.id,
        targetField: "D_VALUE",
        newValue,
        reason,
        expectedVersion: myScore.version,
      },
    });
  }

  function onFinalize() {
    if (!ready) return;
    if (!myScore || locked) return;
    if (
      !window.confirm(
        "Finalize your score? Afterward you can change it only with a written reason, which admins review in the audit log.",
      )
    )
      return;
    const payload: {
      routineScoreId: string;
      expectedVersion: number;
      pendingDValue?: number;
    } = {
      routineScoreId: myScore.id,
      expectedVersion: myScore.version,
    };
    if (panelRole === "D") {
      const pending = Number(dDraft);
      if (Number.isNaN(pending)) {
        setError("Invalid D score");
        return;
      }
      payload.pendingDValue = pending;
    }
    setError(null);
    send({
      type: "score.finalize",
      correlationId: crypto.randomUUID(),
      payload,
    });
  }

  if (!session.hydrated) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className={`judge-app${showCalcTab && judgeTab === "calculator" ? " judge-app--calc" : ""}`}>
      <header className="judge-header">
        <div>
          <h1 style={{ margin: 0, fontSize: "1.35rem" }}>Judge panel</h1>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            Signed in as {session.user?.displayName}
            {ready ? " · live" : compId ? " · connecting (wait for live)…" : ""}
          </p>
        </div>
        <button type="button" className="ghost" onClick={() => void session.logoutFn().then(() => nav("/login"))}>
          Logout
        </button>
      </header>

      {showCalcTab ? (
        <nav className="judge-tablist" aria-label="Judge workspace">
          <button
            type="button"
            className={`judge-tab${judgeTab === "roster" ? " judge-tab--active" : ""}`}
            onClick={() => setJudgeTab("roster")}
          >
            Roster
          </button>
          <button
            type="button"
            className={`judge-tab${judgeTab === "calculator" ? " judge-tab--active" : ""}`}
            onClick={() => setJudgeTab("calculator")}
          >
            Calculator
          </button>
        </nav>
      ) : null}

      {error ? (
        <p className="error" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      ) : null}

      {!error && infoMsg ? (
        <p style={{ marginTop: "1rem", color: "#8dffb0", marginBottom: 0 }} role="status">
          {infoMsg}
        </p>
      ) : null}

      {competitions.length === 0 ? (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <p className="muted" style={{ margin: 0 }}>
            You are not assigned to any competition yet. Ask an admin to assign you to an apparatus and panel role.
          </p>
        </section>
      ) : (
        <div className="judge-body">
          {(!showCalcTab || judgeTab === "roster") && (
            <>
          <section className="panel">
            <h2>Competition</h2>
            <select value={compId} onChange={(e) => setCompId(e.target.value)} style={{ width: "100%" }}>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {myAssignments.length > 0 ? (
              <p className="muted" style={{ margin: "0.75rem 0 0", fontSize: "0.9rem" }}>
                Your assignments:{" "}
                {myAssignments
                  .map((a) => `${a.apparatus} (${PANEL_ROLE_LABEL[a.panelRole]})`)
                  .join(" · ")}
              </p>
            ) : null}
          </section>

          <section className="panel">
            <h2>Athletes</h2>
            {myAssignments.length > 1 ? (
              <>
                <p className="muted" style={{ margin: "0 0 0.5rem" }}>
                  Apparatus
                </p>
                <div className="row" style={{ marginBottom: "0.75rem" }}>
                  {myAssignments.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={`chip${activeApparatus === a.apparatus ? " active" : ""}`}
                      onClick={() => {
                        setActiveApparatus(a.apparatus);
                        setSelectedAthleteId("");
                        setSelectedRoutineId("");
                        setPanelRole(undefined);
                        setJudgeTab("roster");
                      }}
                    >
                      {a.apparatus}
                    </button>
                  ))}
                </div>
              </>
            ) : activeApparatus ? (
              <p className="muted" style={{ margin: "0 0 0.75rem" }}>
                Select the athlete performing on {activeApparatus}.
              </p>
            ) : null}

            {myCategoryKeys.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No athlete lists assigned to you yet. Ask an admin to assign categories in section 4 of the admin
                panel.
              </p>
            ) : visibleAthletes.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No athletes in your assigned categories yet.
              </p>
            ) : (
              <div style={{ display: "grid", gap: "1rem" }}>
                {athleteGroups.map((group) => (
                  <div key={group.categoryKey}>
                    <h3
                      style={{
                        margin: "0 0 0.5rem",
                        fontSize: "0.92rem",
                        fontWeight: 600,
                        color: "#9fb4d9",
                      }}
                    >
                      {categoryLabel(group.categoryKey)}
                    </h3>
                    <div className="row" style={{ alignItems: "stretch" }}>
                      {group.athletes.map((athlete) => renderAthleteButton(athlete))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {selectedAthlete && panelRole && !myScore ? (
            <section className="panel">
              <p className="muted" style={{ margin: 0 }}>
                Preparing score sheet for {selectedAthlete.name}…
              </p>
            </section>
          ) : null}

          {selectedAthlete && myScore && panelRole === "E" ? (
            <section className="panel judge-execution-panel">
              <h2>Execution panel</h2>
              <p className="muted" style={{ margin: "0 0 0.75rem" }}>
                {selectedAthlete.name} · {activeApparatus}
                {routineLocked ? " · locked" : myScore.finalized ? " · submitted" : ""}
              </p>
              {!myScore.finalized ? (
                <p className="muted judge-execution-hint" style={{ margin: "0 0 0.85rem", fontSize: "0.82rem" }}>
                  Execution cannot go below 0 — keys disable at the limit. Numbers update immediately; the server
                  confirms on sync.
                </p>
              ) : (
                <p className="muted" style={{ margin: "0 0 0.85rem", fontSize: "0.82rem" }}>
                  This panel hides difficulty, combined results, and other judges so you see only what you submitted.
                </p>
              )}
              {!myScore.finalized ? (
                <>
                  <details className="judge-execution-advanced">
                    <summary>Set execution score directly (optional)</summary>
                    <p className="muted" style={{ margin: "0.5rem 0", fontSize: "0.82rem" }}>
                      Enter your score (minimum 0), then apply. You must type a reason for the audit log.
                    </p>
                    <div className="row" style={{ marginBottom: "0.5rem", flexWrap: "wrap" }}>
                      <input
                        type="number"
                        step="0.001"
                        min={0}
                        value={eExecutionDraft}
                        onChange={(e) => setEExecutionDraft(e.target.value)}
                        disabled={locked || !ready}
                        style={{ width: "8.5rem" }}
                      />
                      <button type="button" disabled={locked || !ready} onClick={onSubmitExecutionDisplayed}>
                        Apply score (reason required)
                      </button>
                    </div>
                  </details>
                  {showCalcTab ? (
                    <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                      Open the <strong>Calculator</strong> tab for full-screen deduction keys.
                    </p>
                  ) : null}
                </>
              ) : (
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                    <strong>Request a correction:</strong> enter the new deduction total, press <strong>Note (required)</strong>,
                    write why it should change, press <strong>Confirm note</strong>, then <strong>Submit correction</strong>.
                    Admins review under <strong>Arena control → Corrections</strong>; scores update only if approved.
                  </p>
                  <label className="muted" style={{ display: "block", marginBottom: "0.25rem" }}>
                    New deduction total
                  </label>
                  <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="number"
                      step="0.1"
                      value={eAmendDraft}
                      onChange={(e) => setEAmendDraft(e.target.value)}
                      disabled={routineLocked || !ready}
                      style={{ width: "8rem" }}
                    />
                    <button
                      type="button"
                      disabled={routineLocked || !ready}
                      onClick={() => {
                        setEAmendNoteDraft((d) => eAmendNoteConfirmed ?? d);
                        setEAmendNoteOpen(true);
                      }}
                    >
                      {eAmendNoteConfirmed ? "Edit note" : "Note (required)"}
                    </button>
                    <button
                      type="button"
                      disabled={routineLocked || !ready || !eAmendNoteConfirmed}
                      className="primary"
                      onClick={onSubmitAmendedDeductions}
                    >
                      Submit correction
                    </button>
                  </div>
                  {eAmendNoteOpen ? (
                    <div
                      style={{
                        display: "grid",
                        gap: "0.65rem",
                        padding: "0.85rem",
                        border: "1px solid #334155",
                        borderRadius: "10px",
                        background: "#0f1729",
                      }}
                    >
                      <label className="muted" style={{ margin: 0, fontSize: "0.92rem", fontWeight: 600 }}>
                        Note to the admin (required before submit)
                      </label>
                      <textarea
                        value={eAmendNoteDraft}
                        onChange={(e) => setEAmendNoteDraft(e.target.value)}
                        rows={4}
                        placeholder='Example: "Deduction total should be higher — judge missed a large break after the release."'
                        disabled={routineLocked}
                        style={{ width: "100%", maxWidth: "100%", resize: "vertical", minHeight: "5rem" }}
                      />
                      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                        <button type="button" className="primary" onClick={confirmEAmendNote}>
                          Confirm note
                        </button>
                        <button type="button" className="ghost" onClick={() => setEAmendNoteOpen(false)}>
                          Close without confirming
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {eAmendNoteConfirmed && !eAmendNoteOpen ? (
                    <p
                      className="muted"
                      style={{
                        margin: 0,
                        fontSize: "0.88rem",
                        borderLeft: "3px solid #22c55e",
                        paddingLeft: "0.65rem",
                      }}
                    >
                      <strong>Note confirmed.</strong> You can submit the correction. If you change the deduction total, you
                      must confirm a new note.
                    </p>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}

          {selectedAthlete && myScore && panelRole === "D" ? (
            <section className="panel">
              <h2>Difficulty panel</h2>
              <p className="muted" style={{ margin: "0 0 0.75rem" }}>
                {selectedAthlete.name} · {activeApparatus}
                {routineLocked ? " · locked" : myScore.finalized ? " · submitted" : ""}
              </p>
              <div
                style={{
                  display: "grid",
                  gap: "0.5rem",
                  marginBottom: "1rem",
                  padding: "0.75rem",
                  border: "1px solid #233249",
                  borderRadius: "10px",
                }}
              >
                <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="muted">{myScore.finalized ? "Submitted D score" : "Working D score"}</span>
                  <span style={{ fontWeight: 700, fontSize: "1.35rem" }}>
                    {myScore.finalized
                      ? myScore.computedValue.toFixed(3)
                      : Number.isFinite(Number(dDraft))
                        ? Number(dDraft).toFixed(3)
                        : "—"}
                  </span>
                </div>
                <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
                  You cannot see execution judges or combined results here; only what you finalize is shown.
                </p>
              </div>
              {!myScore.finalized ? (
                <>
                  <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
                    Enter D score, then finalize. You can save early with reason, or finalize to lock in value.
                  </p>
                  <label className="muted" style={{ display: "block", marginBottom: "0.25rem" }}>
                    D score
                  </label>
                  <div className="row" style={{ marginBottom: "1rem" }}>
                    <input
                      type="number"
                      step="0.1"
                      value={dDraft}
                      onChange={(e) => setDDraft(e.target.value)}
                      disabled={locked || !ready}
                      style={{ width: "6rem" }}
                    />
                    <button type="button" disabled={locked || !ready} onClick={onSetDValue}>
                      Save now (reason required)
                    </button>
                  </div>

                  <button type="button" className="primary" disabled={locked || !ready} onClick={onFinalize}>
                    Finalize D score
                  </button>
                </>
              ) : (
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                    <strong>Request a correction:</strong> enter the new D score, press <strong>Note (required)</strong>,
                    write why it should change (e.g. missed element), press <strong>Confirm note</strong>, then{" "}
                    <strong>Submit correction</strong>. Admins review under <strong>Arena control → Corrections</strong>;
                    scores update only if approved.
                  </p>
                  <label className="muted" style={{ display: "block", marginBottom: "0.25rem" }}>
                    New D score
                  </label>
                  <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="number"
                      step="0.1"
                      value={dAmendDraft}
                      onChange={(e) => setDAmendDraft(e.target.value)}
                      disabled={routineLocked || !ready}
                      style={{ width: "6rem" }}
                    />
                    <button
                      type="button"
                      disabled={routineLocked || !ready}
                      onClick={() => {
                        setDAmendNoteDraft((d) => dAmendNoteConfirmed ?? d);
                        setDAmendNoteOpen(true);
                      }}
                    >
                      {dAmendNoteConfirmed ? "Edit note" : "Note (required)"}
                    </button>
                    <button
                      type="button"
                      disabled={routineLocked || !ready || !dAmendNoteConfirmed}
                      className="primary"
                      onClick={onSubmitAmendedDScore}
                    >
                      Submit correction
                    </button>
                  </div>
                  {dAmendNoteOpen ? (
                    <div
                      style={{
                        display: "grid",
                        gap: "0.65rem",
                        padding: "0.85rem",
                        border: "1px solid #334155",
                        borderRadius: "10px",
                        background: "#0f1729",
                      }}
                    >
                      <label className="muted" style={{ margin: 0, fontSize: "0.92rem", fontWeight: 600 }}>
                        Note to the admin (required before submit)
                      </label>
                      <textarea
                        value={dAmendNoteDraft}
                        onChange={(e) => setDAmendNoteDraft(e.target.value)}
                        rows={4}
                        placeholder='Example: "D should be lower — gymnast forgot the cast handstand in the routine."'
                        disabled={routineLocked}
                        style={{ width: "100%", maxWidth: "100%", resize: "vertical", minHeight: "5rem" }}
                      />
                      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                        <button type="button" className="primary" onClick={confirmDAmendNote}>
                          Confirm note
                        </button>
                        <button type="button" className="ghost" onClick={() => setDAmendNoteOpen(false)}>
                          Close without confirming
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {dAmendNoteConfirmed && !dAmendNoteOpen ? (
                    <p
                      className="muted"
                      style={{
                        margin: 0,
                        fontSize: "0.88rem",
                        borderLeft: "3px solid #22c55e",
                        paddingLeft: "0.65rem",
                      }}
                    >
                      <strong>Note confirmed.</strong> You can submit the correction. If you change the D score, you must
                      confirm a new note.
                    </p>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}
            </>
          )}

          {showCalcTab && judgeTab === "calculator" && selectedAthlete && myScore ? (
            <section className="judge-calc-screen" aria-label="Deduction calculator">
              <div className="judge-calc-context">
                <p className="judge-calc-athlete">{selectedAthlete.name}</p>
                <p className="judge-calc-meta muted">
                  {activeApparatus} · {preset.replace("_", " ")}
                </p>
              </div>
              <div className="judge-calc-pad-wrap">
                <DeductionPad
                  layout="fullscreen"
                  mode={preset}
                  disabled={locked || !ready}
                  maxAdditionalDeduction={eExecNumbers?.additionalHeadroom}
                  deductionTotal={eExecNumbers?.displaySd ?? myScore.deductionTotal ?? 0}
                  executionScore={eExecNumbers?.displayExec ?? myScore.computedValue}
                  onDeduction={onDeduction}
                />
              </div>
              <div className="judge-calc-actions">
                <button
                  type="button"
                  className="primary calc-pad-finalize-btn"
                  disabled={locked || !ready}
                  onClick={onFinalize}
                >
                  Finalize deductions
                </button>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
