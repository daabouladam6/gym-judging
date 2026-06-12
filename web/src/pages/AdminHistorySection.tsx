import { FormEvent, useEffect, useState } from "react";
import {
  archiveCategory,
  ATHLETE_LEVEL_LABELS,
  ATHLETE_LEVEL_VALUES,
  competitionState,
  listArchivedCompetitionCategories,
  listCompetitionCategories,
  patchArchivedAthlete,
  patchArchivedCompetition,
  unarchiveCategory,
  type Athlete,
  type AthleteLevel,
  type ArchivedCompetitionCategory,
  type Competition,
  type CompetitionCategory,
  type CompetitionSnapshot,
} from "../api/client";
import { categoryLabel } from "@gym/shared";
import { AdminScoresSection } from "./AdminScoresSection";

type Props = {
  competitions: Competition[];
  onRefreshed: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
};

export function AdminHistorySection({ competitions, onRefreshed, onMessage, onError }: Props) {
  const [archiveCompId, setArchiveCompId] = useState("");
  const [archiveCategoryKey, setArchiveCategoryKey] = useState("");
  const [archivePw, setArchivePw] = useState("");
  const [activeCategoriesForArchive, setActiveCategoriesForArchive] = useState<CompetitionCategory[]>([]);

  const [unarchiveCompId, setUnarchiveCompId] = useState("");
  const [unarchiveCategoryKey, setUnarchiveCategoryKey] = useState("");
  const [unarchivePw, setUnarchivePw] = useState("");
  const [archivedCategoriesForUnarchive, setArchivedCategoriesForUnarchive] = useState<ArchivedCompetitionCategory[]>(
    [],
  );

  const [viewCompId, setViewCompId] = useState("");
  const [viewCategoryKey, setViewCategoryKey] = useState("");
  const [archivedCategoriesForView, setArchivedCategoriesForView] = useState<ArchivedCompetitionCategory[]>([]);
  const [snapshot, setSnapshot] = useState<CompetitionSnapshot | null>(null);
  const [viewCategories, setViewCategories] = useState<CompetitionCategory[]>([]);
  const [loading, setLoading] = useState(false);

  const [compName, setCompName] = useState("");
  const [compPreset, setCompPreset] = useState<"FIG_HP" | "USAG">("FIG_HP");
  const [compAgg, setCompAgg] = useState<"AVERAGE" | "DROP_HIGH_LOW">("AVERAGE");
  const [compReason, setCompReason] = useState("");

  const [editAthlete, setEditAthlete] = useState<Athlete | null>(null);
  const [athName, setAthName] = useState("");
  const [athLevel, setAthLevel] = useState<AthleteLevel>("USAG_1");
  const [athYob, setAthYob] = useState(2010);
  const [athReason, setAthReason] = useState("");

  const compsWithArchivedSegments = competitions.filter((c) => (c.archivedSegmentCount ?? 0) > 0);

  useEffect(() => {
    if (competitions.length > 0 && !archiveCompId) {
      setArchiveCompId(competitions[0]!.id);
    }
  }, [competitions, archiveCompId]);

  useEffect(() => {
    if (!archiveCompId) {
      setActiveCategoriesForArchive([]);
      setArchiveCategoryKey("");
      return;
    }
    let cancelled = false;
    listCompetitionCategories(archiveCompId)
      .then(({ categories }) => {
        if (cancelled) return;
        setActiveCategoriesForArchive(categories);
        setArchiveCategoryKey((prev) =>
          prev && categories.some((c) => c.categoryKey === prev) ? prev : (categories[0]?.categoryKey ?? ""),
        );
      })
      .catch((e) => onError(e instanceof Error ? e.message : "Could not load categories"));
    return () => {
      cancelled = true;
    };
  }, [archiveCompId, onError]);

  useEffect(() => {
    if (compsWithArchivedSegments.length > 0 && !unarchiveCompId) {
      setUnarchiveCompId(compsWithArchivedSegments[0]!.id);
    }
    if (compsWithArchivedSegments.length === 0) {
      setUnarchiveCompId("");
      setUnarchiveCategoryKey("");
      setArchivedCategoriesForUnarchive([]);
    }
  }, [compsWithArchivedSegments, unarchiveCompId]);

  useEffect(() => {
    if (!unarchiveCompId) {
      setArchivedCategoriesForUnarchive([]);
      setUnarchiveCategoryKey("");
      return;
    }
    let cancelled = false;
    listArchivedCompetitionCategories(unarchiveCompId)
      .then(({ categories }) => {
        if (cancelled) return;
        setArchivedCategoriesForUnarchive(categories);
        setUnarchiveCategoryKey((prev) =>
          prev && categories.some((c) => c.categoryKey === prev) ? prev : (categories[0]?.categoryKey ?? ""),
        );
      })
      .catch((e) => onError(e instanceof Error ? e.message : "Could not load archived categories"));
    return () => {
      cancelled = true;
    };
  }, [unarchiveCompId, onError]);

  useEffect(() => {
    if (compsWithArchivedSegments.length > 0 && !viewCompId) {
      setViewCompId(compsWithArchivedSegments[0]!.id);
    }
    if (compsWithArchivedSegments.length === 0) {
      setViewCompId("");
      setViewCategoryKey("");
      setArchivedCategoriesForView([]);
      setSnapshot(null);
      setViewCategories([]);
    }
  }, [compsWithArchivedSegments, viewCompId]);

  useEffect(() => {
    if (!viewCompId) {
      setArchivedCategoriesForView([]);
      setViewCategoryKey("");
      return;
    }
    let cancelled = false;
    listArchivedCompetitionCategories(viewCompId)
      .then(({ categories }) => {
        if (cancelled) return;
        setArchivedCategoriesForView(categories);
        setViewCategoryKey((prev) =>
          prev && categories.some((c) => c.categoryKey === prev) ? prev : (categories[0]?.categoryKey ?? ""),
        );
      })
      .catch((e) => onError(e instanceof Error ? e.message : "Could not load archived categories"));
    return () => {
      cancelled = true;
    };
  }, [viewCompId, onError]);

  useEffect(() => {
    if (!viewCompId || !viewCategoryKey) {
      setSnapshot(null);
      setViewCategories([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    competitionState(viewCompId, { historyCategoryKey: viewCategoryKey })
      .then((st) => {
        if (cancelled) return;
        setSnapshot(st.snapshot);
        setViewCategories([
          {
            categoryKey: viewCategoryKey,
            label: categoryLabel(viewCategoryKey),
            athleteCount: st.snapshot.athletes.length,
          },
        ]);
        const c = st.snapshot.competition;
        setCompName(c.name);
        setCompPreset(c.deductionPresetMode === "USAG" ? "USAG" : "FIG_HP");
        setCompAgg(c.aggregationRule === "DROP_HIGH_LOW" ? "DROP_HIGH_LOW" : "AVERAGE");
        setCompReason("");
      })
      .catch((e) => onError(e instanceof Error ? e.message : "Could not load History segment"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewCompId, viewCategoryKey, onError]);

  async function onArchiveCategorySubmit(e: FormEvent) {
    e.preventDefault();
    if (!archiveCompId || !archiveCategoryKey) {
      onError("Select a competition and an active athlete category.");
      return;
    }
    const pw = archivePw.trim();
    if (!pw) {
      onError("Enter the password (same as competition delete password).");
      return;
    }
    onError("");
    try {
      const { archivedCount } = await archiveCategory(archiveCompId, archiveCategoryKey, pw);
      setArchivePw("");
      await onRefreshed();
      onMessage(`Moved ${archivedCount} athlete(s) in that category to History. Other categories in this competition stay active.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Archive failed");
    }
  }

  async function onUnarchiveCategorySubmit(e: FormEvent) {
    e.preventDefault();
    if (!unarchiveCompId || !unarchiveCategoryKey) {
      onError("Select a competition and an archived category to restore.");
      return;
    }
    const pw = unarchivePw.trim();
    if (!pw) {
      onError("Enter the password.");
      return;
    }
    onError("");
    try {
      const { restoredCount } = await unarchiveCategory(unarchiveCompId, unarchiveCategoryKey, pw);
      setUnarchivePw("");
      await onRefreshed();
      onMessage(`Restored ${restoredCount} athlete(s) to the active workspace.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Unarchive failed");
    }
  }

  async function onSaveCompetition(e: FormEvent) {
    e.preventDefault();
    if (!viewCompId) return;
    const reason = compReason.trim();
    if (reason.length < 3) {
      onError("Reason must be at least 3 characters.");
      return;
    }
    onError("");
    try {
      if (!snapshot) return;
      const orig = snapshot.competition;
      const payload: {
        name?: string;
        deductionPresetMode?: "FIG_HP" | "USAG";
        aggregationRule?: "AVERAGE" | "DROP_HIGH_LOW";
        reason: string;
      } = { reason };
      const nm = compName.trim();
      if (nm !== orig.name) payload.name = nm;
      const origPreset = orig.deductionPresetMode === "USAG" ? "USAG" : "FIG_HP";
      if (compPreset !== origPreset) payload.deductionPresetMode = compPreset;
      const origAgg = orig.aggregationRule === "DROP_HIGH_LOW" ? "DROP_HIGH_LOW" : "AVERAGE";
      if (compAgg !== origAgg) payload.aggregationRule = compAgg;
      if (!payload.name && !payload.deductionPresetMode && !payload.aggregationRule) {
        onError("Change at least one field (name, preset, or aggregation) before saving.");
        return;
      }
      await patchArchivedCompetition(viewCompId, payload);
      setCompReason("");
      if (viewCategoryKey) {
        const st = await competitionState(viewCompId, { historyCategoryKey: viewCategoryKey });
        setSnapshot(st.snapshot);
      }
      await onRefreshed();
      onMessage("Competition details updated.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Update failed");
    }
  }

  function openAthleteEdit(a: Athlete) {
    setEditAthlete(a);
    setAthName(a.name);
    setAthLevel(a.level);
    setAthYob(a.yearOfBirth);
    setAthReason("");
  }

  async function onSaveAthlete(e: FormEvent) {
    e.preventDefault();
    if (!viewCompId || !editAthlete) return;
    const reason = athReason.trim();
    if (reason.length < 3) {
      onError("Reason must be at least 3 characters.");
      return;
    }
    onError("");
    try {
      const payload: { name?: string; level?: AthleteLevel; yearOfBirth?: number; reason: string } = { reason };
      if (athName.trim() !== editAthlete.name) payload.name = athName.trim();
      if (athLevel !== editAthlete.level) payload.level = athLevel;
      if (athYob !== editAthlete.yearOfBirth) payload.yearOfBirth = athYob;
      if (!payload.name && !payload.level && payload.yearOfBirth === undefined) {
        onError("Change at least one field before saving.");
        return;
      }
      await patchArchivedAthlete(viewCompId, editAthlete.id, payload);
      setEditAthlete(null);
      if (viewCategoryKey) {
        const st = await competitionState(viewCompId, { historyCategoryKey: viewCategoryKey });
        setSnapshot(st.snapshot);
      }
      await onRefreshed();
      onMessage(`Athlete “${athName.trim()}” updated.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Update failed");
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <p className="muted" style={{ margin: 0 }}>
        History is <strong>per athlete category</strong> inside a competition (for example HP2 finished, USAG Level 1
        still active). Archiving uses the <strong>same password as deleting a competition</strong> (default{" "}
        <code>admin123</code> unless the server sets <code>COMPETITION_DELETE_PASSWORD</code>). Judges cannot score
        archived categories until you restore them below.
      </p>

      <section className="panel" style={{ margin: 0 }}>
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "1.05rem" }}>Move an active category to History</h3>
        {competitions.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No competitions yet — create one under Competition setup.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "0.65rem", maxWidth: "28rem" }}>
            <label className="muted" style={{ display: "block" }}>
              Competition
              <select
                value={archiveCompId}
                onChange={(e) => setArchiveCompId(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: "0.35rem" }}
              >
                {competitions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {(c.archivedSegmentCount ?? 0) > 0 ? ` (${c.archivedSegmentCount} in History)` : ""}
                  </option>
                ))}
              </select>
            </label>
            {activeCategoriesForArchive.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No active athlete categories in this competition (every group may already be in History), or add
                athletes under Athletes roster.
              </p>
            ) : (
              <form
                onSubmit={(e) => void onArchiveCategorySubmit(e)}
                style={{ display: "grid", gap: "0.65rem", margin: 0 }}
              >
                <label className="muted" style={{ display: "block" }}>
                  Active category
                  <select
                    value={archiveCategoryKey}
                    onChange={(e) => setArchiveCategoryKey(e.target.value)}
                    style={{ display: "block", width: "100%", marginTop: "0.35rem" }}
                  >
                    {activeCategoriesForArchive.map((c) => (
                      <option key={c.categoryKey} value={c.categoryKey}>
                        {c.label} ({c.athleteCount} athletes)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="muted" style={{ display: "block" }}>
                  Password
                  <input
                    type="password"
                    value={archivePw}
                    onChange={(e) => setArchivePw(e.target.value)}
                    autoComplete="off"
                    style={{ display: "block", width: "100%", marginTop: "0.35rem" }}
                  />
                </label>
                <button type="submit" className="primary">
                  Archive this category to History
                </button>
              </form>
            )}
          </div>
        )}
      </section>

      <section className="panel" style={{ margin: 0 }}>
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "1.05rem" }}>Restore a category from History</h3>
        {compsWithArchivedSegments.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing in History yet. Archive a category above first.
          </p>
        ) : (
          <form
            onSubmit={(e) => void onUnarchiveCategorySubmit(e)}
            style={{ display: "grid", gap: "0.65rem", maxWidth: "28rem" }}
          >
            <label className="muted" style={{ display: "block" }}>
              Competition
              <select
                value={unarchiveCompId}
                onChange={(e) => setUnarchiveCompId(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: "0.35rem" }}
              >
                {compsWithArchivedSegments.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="muted" style={{ display: "block" }}>
              Archived category
              <select
                value={unarchiveCategoryKey}
                onChange={(e) => setUnarchiveCategoryKey(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: "0.35rem" }}
              >
                {archivedCategoriesForUnarchive.map((c) => (
                  <option key={c.categoryKey} value={c.categoryKey}>
                    {c.label} ({c.athleteCount} athletes)
                  </option>
                ))}
              </select>
            </label>
            <label className="muted" style={{ display: "block" }}>
              Password
              <input
                type="password"
                value={unarchivePw}
                onChange={(e) => setUnarchivePw(e.target.value)}
                autoComplete="off"
                style={{ display: "block", width: "100%", marginTop: "0.35rem" }}
              />
            </label>
            <button type="submit" className="primary">
              Restore category to active workspace
            </button>
          </form>
        )}
      </section>

      <section className="panel" style={{ margin: 0 }}>
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "1.05rem" }}>View & edit a History segment</h3>
        {compsWithArchivedSegments.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No archived categories.
          </p>
        ) : (
          <>
            <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <label className="muted" style={{ display: "block", flex: "1 1 12rem" }}>
                Competition
                <select
                  value={viewCompId}
                  onChange={(e) => setViewCompId(e.target.value)}
                  style={{ display: "block", width: "100%", marginTop: "0.35rem" }}
                >
                  {compsWithArchivedSegments.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="muted" style={{ display: "block", flex: "1 1 12rem" }}>
                History category
                <select
                  value={viewCategoryKey}
                  onChange={(e) => setViewCategoryKey(e.target.value)}
                  style={{ display: "block", width: "100%", marginTop: "0.35rem" }}
                >
                  {archivedCategoriesForView.map((c) => (
                    <option key={c.categoryKey} value={c.categoryKey}>
                      {c.label} ({c.athleteCount})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {loading ? (
              <p className="muted">Loading…</p>
            ) : snapshot ? (
              <div style={{ display: "grid", gap: "1.25rem" }}>
                <div
                  style={{
                    padding: "0.85rem",
                    border: "1px solid #233249",
                    borderRadius: "12px",
                    background: "#0c121a",
                  }}
                >
                  <h4 style={{ margin: "0 0 0.65rem", fontSize: "0.98rem" }}>Competition record</h4>
                  <p className="muted" style={{ margin: "0 0 0.65rem", fontSize: "0.88rem" }}>
                    Applies to the whole competition (including active categories). Requires at least one category in
                    History.
                  </p>
                  <form onSubmit={(e) => void onSaveCompetition(e)} style={{ display: "grid", gap: "0.55rem" }}>
                    <label className="muted">
                      Name
                      <input
                        value={compName}
                        onChange={(e) => setCompName(e.target.value)}
                        style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
                      />
                    </label>
                    <label className="muted">
                      Deduction preset
                      <select
                        value={compPreset}
                        onChange={(e) => setCompPreset(e.target.value as "FIG_HP" | "USAG")}
                        style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
                      >
                        <option value="FIG_HP">FIG / HP</option>
                        <option value="USAG">USAG</option>
                      </select>
                    </label>
                    <label className="muted">
                      Aggregation
                      <select
                        value={compAgg}
                        onChange={(e) => setCompAgg(e.target.value as "AVERAGE" | "DROP_HIGH_LOW")}
                        style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
                      >
                        <option value="AVERAGE">Average</option>
                        <option value="DROP_HIGH_LOW">Drop high / low</option>
                      </select>
                    </label>
                    <label className="muted">
                      Reason (required)
                      <textarea
                        value={compReason}
                        onChange={(e) => setCompReason(e.target.value)}
                        rows={2}
                        placeholder="Why you are changing this record…"
                        style={{ display: "block", width: "100%", marginTop: "0.25rem", resize: "vertical" }}
                      />
                    </label>
                    <button type="submit">Save competition changes</button>
                  </form>
                </div>

                <div
                  style={{
                    padding: "0.85rem",
                    border: "1px solid #233249",
                    borderRadius: "12px",
                    background: "#0c121a",
                  }}
                >
                  <h4 style={{ margin: "0 0 0.65rem", fontSize: "0.98rem" }}>Athletes in this History segment</h4>
                  <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                    {snapshot.athletes.map((a) => (
                      <li key={a.id} style={{ marginBottom: "0.35rem" }}>
                        <button type="button" className="chip" onClick={() => openAthleteEdit(a)}>
                          {a.name} · {ATHLETE_LEVEL_LABELS[a.level] ?? a.level} · {a.yearOfBirth}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {editAthlete ? (
                    <form
                      onSubmit={(e) => void onSaveAthlete(e)}
                      style={{
                        marginTop: "0.85rem",
                        paddingTop: "0.85rem",
                        borderTop: "1px solid #2a3854",
                        display: "grid",
                        gap: "0.5rem",
                        maxWidth: "22rem",
                      }}
                    >
                      <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
                        Editing <strong>{editAthlete.name}</strong>
                      </p>
                      <input value={athName} onChange={(e) => setAthName(e.target.value)} />
                      <select value={athLevel} onChange={(e) => setAthLevel(e.target.value as AthleteLevel)}>
                        {ATHLETE_LEVEL_VALUES.map((lv) => (
                          <option key={lv} value={lv}>
                            {ATHLETE_LEVEL_LABELS[lv]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={athYob}
                        onChange={(e) => setAthYob(Number(e.target.value))}
                        min={1900}
                        max={new Date().getFullYear() + 1}
                      />
                      <textarea
                        value={athReason}
                        onChange={(e) => setAthReason(e.target.value)}
                        rows={2}
                        placeholder="Reason (min 3 characters)…"
                      />
                      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                        <button type="submit">Save athlete</button>
                        <button type="button" className="ghost" onClick={() => setEditAthlete(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : null}
                </div>

                <div>
                  <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.98rem" }}>Scores</h4>
                  <AdminScoresSection
                    activeId={viewCompId}
                    categories={viewCategories}
                    scoreboard={snapshot.scoreboard}
                    embedded
                    onRefresh={async () => {
                      if (!viewCategoryKey) return;
                      const st = await competitionState(viewCompId, { historyCategoryKey: viewCategoryKey });
                      setSnapshot(st.snapshot);
                    }}
                    onError={onError}
                    onMessage={onMessage}
                  />
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
