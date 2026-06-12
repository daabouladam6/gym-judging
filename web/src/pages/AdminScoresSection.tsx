import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { categoryLabel, sortCategoryKeys } from "@gym/shared";

import {
  adminUpdateDScore,
  adminUpdateEDeductions,
  type Apparatus,
  type CompetitionCategory,
  type ScoreboardRow,
} from "../api/client";

type Props = {
  activeId: string;
  categories: CompetitionCategory[];
  scoreboard: ScoreboardRow[];
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  /** When true (e.g. History tab), scores are view-only — no admin D/E edits. */
  scoresReadOnly?: boolean;
  /** Nested in tab UI; heading / outer panel supplied by parent. */
  embedded?: boolean;
};

/** Display order: Floor, Beam, Bars, Vault (AA = sum of these four apparatus finals). */
const SCORES_APPARATUS_ORDER: Apparatus[] = ["FLOOR", "BEAM", "BARS", "VAULT"];

type ScoreboardEJ = ScoreboardRow["eJudges"][number];

/** In-app admin editor (avoids window.prompt, which often fails in embedded browsers). */
type AdminScoreModal =
  | { step: "pickKind"; row: ScoreboardRow }
  | { step: "pickEJudge"; row: ScoreboardRow }
  | { step: "d"; row: ScoreboardRow; dDraft: string; reason: string }
  | { step: "e"; row: ScoreboardRow; eJudge: ScoreboardEJ; deductionsDraft: string; reason: string };

function apparatusHeading(app: Apparatus): string {
  const m: Record<Apparatus, string> = { FLOOR: "Floor", BEAM: "Beam", BARS: "Bars", VAULT: "Vault" };
  return m[app];
}

/** Same division order as section 5 dropdown, then keys not listed there. */
function groupScoreboardRows(
  scoreboard: ScoreboardRow[],
  categories: CompetitionCategory[],
): { categoryKey: string; label: string; rows: ScoreboardRow[] }[] {
  const byKey = new Map<string, ScoreboardRow[]>();
  for (const row of scoreboard) {
    const arr = byKey.get(row.categoryKey) ?? [];
    arr.push(row);
    byKey.set(row.categoryKey, arr);
  }
  for (const [, rows] of byKey) {
    rows.sort(
      (a, b) =>
        a.athleteName.localeCompare(b.athleteName) || a.apparatus.localeCompare(b.apparatus),
    );
  }

  const orderedKeys: string[] = [];
  const used = new Set<string>();
  for (const c of categories) {
    if (byKey.has(c.categoryKey)) {
      orderedKeys.push(c.categoryKey);
      used.add(c.categoryKey);
    }
  }
  const leftovers = [...byKey.keys()].filter((k) => !used.has(k));
  orderedKeys.push(...sortCategoryKeys(leftovers));

  return orderedKeys.map((categoryKey) => ({
    categoryKey,
    label: categoryKey === "__unknown__" ? "Uncategorized" : categoryLabel(categoryKey),
    rows: byKey.get(categoryKey) ?? [],
  }));
}

type AthleteBlock = {
  athleteId: string;
  athleteName: string;
  byApp: Map<Apparatus, ScoreboardRow>;
};

function groupAthletesInCategory(rows: ScoreboardRow[]): AthleteBlock[] {
  const map = new Map<string, AthleteBlock>();
  for (const row of rows) {
    const aid = row.athleteId || row.athleteName;
    if (!map.has(aid)) {
      map.set(aid, { athleteId: aid, athleteName: row.athleteName, byApp: new Map() });
    }
    map.get(aid)!.byApp.set(row.apparatus, row);
  }
  return [...map.values()].sort((a, b) => a.athleteName.localeCompare(b.athleteName));
}

function computeAllAround(byApp: Map<Apparatus, ScoreboardRow>): number {
  let sum = 0;
  for (const app of SCORES_APPARATUS_ORDER) {
    const r = byApp.get(app);
    sum += r ? Math.max(0, r.finalScore) : 0;
  }
  return sum;
}

function athleteSelectionKey(categoryKey: string, athleteId: string): string {
  return `${categoryKey}::${athleteId}`;
}

export function AdminScoresSection({
  activeId,
  categories,
  scoreboard,
  onRefresh,
  onError,
  onMessage,
  scoresReadOnly = false,
  embedded = false,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState("");
  const [adminModal, setAdminModal] = useState<AdminScoreModal | null>(null);

  const groups = useMemo(
    () => groupScoreboardRows(scoreboard, categories),
    [scoreboard, categories],
  );

  useEffect(() => {
    setSelectedKey(null);
    setNameFilter("");
    setAdminModal(null);
  }, [activeId]);

  useEffect(() => {
    if (!selectedKey) return;
    const exists = groups.some((g) =>
      groupAthletesInCategory(g.rows).some(
        (b) => athleteSelectionKey(g.categoryKey, b.athleteId) === selectedKey,
      ),
    );
    if (!exists) setSelectedKey(null);
  }, [groups, selectedKey]);

  const selectedEntry = useMemo(() => {
    if (!selectedKey) return null;
    for (const g of groups) {
      const block = groupAthletesInCategory(g.rows).find(
        (b) => athleteSelectionKey(g.categoryKey, b.athleteId) === selectedKey,
      );
      if (block) return { g, block };
    }
    return null;
  }, [groups, selectedKey]);

  const filterLower = nameFilter.trim().toLowerCase();

  function openAdminEdit(row: ScoreboardRow | undefined) {
    if (!row) return;
    const hasD = Boolean(row.dScoreId);
    const hasE = row.eJudges.length > 0;
    if (!hasD && !hasE) return;
    if (hasD && !hasE) {
      setAdminModal({ step: "d", row, dDraft: String(row.dValue), reason: "" });
      return;
    }
    if (!hasD && hasE) {
      if (row.eJudges.length === 1) {
        const ej = row.eJudges[0];
        setAdminModal({
          step: "e",
          row,
          eJudge: ej,
          deductionsDraft: String(ej.deductions),
          reason: "",
        });
        return;
      }
      setAdminModal({ step: "pickEJudge", row });
      return;
    }
    setAdminModal({ step: "pickKind", row });
  }

  async function submitAdminModal() {
    if (!adminModal || !activeId) return;
    if (adminModal.step === "pickKind" || adminModal.step === "pickEJudge") return;

    if (adminModal.step === "d") {
      const { row, dDraft, reason } = adminModal;
      if (!row.dScoreId) return;
      const dValue = Number(dDraft);
      if (Number.isNaN(dValue)) {
        onError("Invalid D score");
        return;
      }
      const r = reason.trim();
      if (r.length < 3) {
        onError("Reason must be at least 3 characters.");
        return;
      }
      try {
        await adminUpdateDScore(activeId, row.dScoreId, {
          dValue,
          reason: r,
          expectedVersion: row.dVersion,
        });
        setAdminModal(null);
        await onRefresh();
        onMessage(`D score updated for ${row.athleteName} (${row.apparatus}).`);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to update D score");
      }
      return;
    }

    const { row, eJudge, deductionsDraft, reason } = adminModal;
    const totalDeductions = Number(deductionsDraft);
    if (Number.isNaN(totalDeductions) || totalDeductions < 0) {
      onError("Invalid deduction total");
      return;
    }
    const r = reason.trim();
    if (r.length < 3) {
      onError("Reason must be at least 3 characters.");
      return;
    }
    try {
      await adminUpdateEDeductions(activeId, eJudge.scoreId, {
        totalDeductions,
        reason: r,
        expectedVersion: eJudge.version,
      });
      setAdminModal(null);
      await onRefresh();
      onMessage(`E deductions updated for ${row.athleteName} (${row.apparatus}).`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update E deductions");
    }
  }

  function renderAdminModal() {
    if (!adminModal || typeof document === "undefined") return null;

    const row = adminModal.row;
    const appLabel = apparatusHeading(row.apparatus);

    let body: JSX.Element | null;
    if (adminModal.step === "pickKind") {
      body = (
        <>
          <p className="muted" style={{ margin: "0 0 1rem" }}>
            What should be edited for <strong>{row.athleteName}</strong> — {appLabel}?
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <button
              type="button"
              className="primary"
              onClick={() =>
                setAdminModal({ step: "d", row, dDraft: String(row.dValue), reason: "" })
              }
            >
              D score
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (row.eJudges.length === 1) {
                  const ej = row.eJudges[0];
                  setAdminModal({
                    step: "e",
                    row,
                    eJudge: ej,
                    deductionsDraft: String(ej.deductions),
                    reason: "",
                  });
                } else {
                  setAdminModal({ step: "pickEJudge", row });
                }
              }}
            >
              E deductions
            </button>
            <button type="button" className="ghost" onClick={() => setAdminModal(null)}>
              Cancel
            </button>
          </div>
        </>
      );
    } else if (adminModal.step === "pickEJudge") {
      body = (
        <>
          <p className="muted" style={{ margin: "0 0 1rem" }}>
            Which execution judge for <strong>{row.athleteName}</strong> — {appLabel}?
          </p>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {row.eJudges.map((ej) => (
              <button
                key={ej.scoreId}
                type="button"
                className="chip"
                style={{ justifySelf: "start" }}
                onClick={() =>
                  setAdminModal({
                    step: "e",
                    row,
                    eJudge: ej,
                    deductionsDraft: String(ej.deductions),
                    reason: "",
                  })
                }
              >
                {ej.judgeName}
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: "1rem" }}>
            <button type="button" className="ghost" onClick={() => setAdminModal(null)}>
              Cancel
            </button>
          </div>
        </>
      );
    } else if (adminModal.step === "d") {
      body = (
        <>
          <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
            <strong>{row.athleteName}</strong> · {appLabel}
          </p>
          <label className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
            D score
          </label>
          <input
            type="number"
            step="0.001"
            value={adminModal.dDraft}
            onChange={(e) =>
              setAdminModal((m) => (m && m.step === "d" ? { ...m, dDraft: e.target.value } : m))
            }
            style={{ width: "100%", maxWidth: "12rem", marginBottom: "0.85rem" }}
          />
          <label className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
            Reason (required, audit log)
          </label>
          <textarea
            value={adminModal.reason}
            onChange={(e) =>
              setAdminModal((m) => (m && m.step === "d" ? { ...m, reason: e.target.value } : m))
            }
            rows={4}
            placeholder="At least 3 characters explaining why the D score is changed."
            style={{ width: "100%", resize: "vertical", marginBottom: "1rem" }}
          />
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <button type="button" className="primary" onClick={() => void submitAdminModal()}>
              Save D score
            </button>
            <button type="button" className="ghost" onClick={() => setAdminModal(null)}>
              Cancel
            </button>
          </div>
        </>
      );
    } else {
      const ej = adminModal.eJudge;
      body = (
        <>
          <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
            <strong>{row.athleteName}</strong> · {appLabel} · E: {ej.judgeName}
          </p>
          <label className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
            Total deductions
          </label>
          <input
            type="number"
            step="0.001"
            min={0}
            value={adminModal.deductionsDraft}
            onChange={(e) =>
              setAdminModal((m) => (m && m.step === "e" ? { ...m, deductionsDraft: e.target.value } : m))
            }
            style={{ width: "100%", maxWidth: "12rem", marginBottom: "0.85rem" }}
          />
          <label className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
            Reason (required, audit log)
          </label>
          <textarea
            value={adminModal.reason}
            onChange={(e) =>
              setAdminModal((m) => (m && m.step === "e" ? { ...m, reason: e.target.value } : m))
            }
            rows={4}
            placeholder="At least 3 characters explaining why deductions are changed."
            style={{ width: "100%", resize: "vertical", marginBottom: "1rem" }}
          />
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <button type="button" className="primary" onClick={() => void submitAdminModal()}>
              Save E deductions
            </button>
            <button type="button" className="ghost" onClick={() => setAdminModal(null)}>
              Cancel
            </button>
          </div>
        </>
      );
    }

    return createPortal(
      <div
        className="admin-scores-dialog-backdrop"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setAdminModal(null);
        }}
      >
        <div
          className="admin-scores-dialog panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-scores-dialog-title"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <h3 id="admin-scores-dialog-title" style={{ margin: "0 0 0.75rem", fontSize: "1.1rem" }}>
            Admin edit score
          </h3>
          {body}
        </div>
      </div>,
      document.body,
    );
  }

  function renderAthleteScoresCard(block: AthleteBlock) {
    const aa = computeAllAround(block.byApp);
    return (
      <article className="admin-scores-athlete-card">
        <h4>{block.athleteName}</h4>
        <div className="table-scroll">
          <table className="admin-scores-athlete-table">
            <thead>
              <tr>
                <th scope="col">Apparatus</th>
                <th scope="col">D score</th>
                <th scope="col">Avg E ded.</th>
                <th scope="col">Final</th>
                <th scope="col">Admin</th>
              </tr>
            </thead>
            <tbody>
              {SCORES_APPARATUS_ORDER.map((app) => {
                const r = block.byApp.get(app);
                const canFix =
                  !scoresReadOnly && Boolean(r && (r.dScoreId || r.eJudges.length > 0));
                return (
                  <tr key={app}>
                    <th scope="row">{apparatusHeading(app)}</th>
                    <td>
                      {r ? (
                        <>
                          {r.dValue.toFixed(3)}
                          {r.dFinalized ? "" : " *"}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{r ? r.avgDeductions.toFixed(3) : "—"}</td>
                    <td>{r ? Math.max(0, r.finalScore).toFixed(3) : "—"}</td>
                    <td>
                      {canFix ? (
                        <button type="button" onClick={() => openAdminEdit(r)}>
                          Edit
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="admin-scores-aa-row">
                <th scope="row">AA (sum)</th>
                <td className="muted">—</td>
                <td className="muted">—</td>
                <td>
                  <strong>{aa.toFixed(3)}</strong>
                </td>
                <td className="muted">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    );
  }

  const footer =
    scoreboard.length > 0 ? (
      <p className="muted" style={{ margin: embedded ? "0.75rem 0 0" : "0.75rem 0 0", fontSize: "0.85rem" }}>
        * Not finalized yet — only finalized judge scores count toward the final. All-around (AA) = sum of the four
        apparatus finals (missing apparatus counts as 0).
      </p>
    ) : null;

  const mainBlock = (
    <>
      <p className="muted" style={{ margin: "0 0 0.75rem" }}>
        {selectedKey ? (
          <>
            {scoresReadOnly ? (
              <>
                Archived results (read-only scores). Use the forms below to adjust competition or athlete metadata with a
                reason — scores stay frozen.
              </>
            ) : (
              <>
                Scores for the selected athlete. Each row is one apparatus: <strong>D</strong>,{" "}
                <strong>average E deductions</strong>, <strong>final</strong> (max(0, D − avg E)), and <strong>Edit</strong>{" "}
                to fix D or E. <strong>AA</strong> = sum of the four apparatus finals (missing = 0).
              </>
            )}
          </>
        ) : (
          <>
            Pick an athlete by name (grouped by <strong>level / category</strong>). The score grid opens after you
            select someone — use the filter to narrow the list.
          </>
        )}
      </p>

      {!activeId ? (
        <p className="muted" style={{ margin: 0 }}>
          Select a competition first.
        </p>
      ) : scoreboard.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No routines scored yet.
        </p>
      ) : selectedKey && selectedEntry ? (
        <div className="admin-scores-layout">
          <div className="admin-scores-detail-toolbar">
            <button type="button" className="ghost" onClick={() => setSelectedKey(null)}>
              ← Back to athlete list
            </button>
          </div>
          <section className="admin-scores-category">
            <h3 className="admin-scores-category-title">
              {selectedEntry.g.label} · {selectedEntry.block.athleteName}
            </h3>
            {renderAthleteScoresCard(selectedEntry.block)}
          </section>
        </div>
      ) : (

        <div className="admin-scores-layout">
          <div className="admin-scores-picker-tools">
            <label className="muted" htmlFor="admin-scores-name-filter" style={{ display: "block", marginBottom: "0.35rem" }}>
              Filter by name
            </label>
            <input
              id="admin-scores-name-filter"
              type="search"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              placeholder="Type part of a name…"
              autoComplete="off"
              style={{ maxWidth: "20rem", width: "100%" }}
            />
          </div>
          {groups.map((g) => {
            const allBlocks = groupAthletesInCategory(g.rows);
            const blocks = filterLower
              ? allBlocks.filter((b) => b.athleteName.toLowerCase().includes(filterLower))
              : allBlocks;
            if (blocks.length === 0) return null;
            return (
              <section key={g.categoryKey} className="admin-scores-category">
                <h3 className="admin-scores-category-title">{g.label}</h3>
                <ul className="admin-scores-athlete-picker" role="list">
                  {blocks.map((block) => {
                    const key = athleteSelectionKey(g.categoryKey, block.athleteId);
                    return (
                      <li key={key} role="listitem">
                        <button
                          type="button"
                          className="admin-scores-athlete-picker-btn"
                          onClick={() => setSelectedKey(key)}
                        >
                          {block.athleteName}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {filterLower &&
          !groups.some((g) =>
            groupAthletesInCategory(g.rows).some((b) => b.athleteName.toLowerCase().includes(filterLower)),
          ) ? (
            <p className="muted" style={{ margin: 0 }}>
              No names match this filter.
            </p>
          ) : null}
        </div>
      )}
      {footer}
    </>
  );

  if (embedded) {
    return (
      <>
        <div className="admin-scores-embedded">{mainBlock}</div>
        {renderAdminModal()}
      </>
    );
  }

  return (
    <>
      <section className="panel" aria-labelledby="admin-scores-heading">
        <h2 id="admin-scores-heading">6. Scores</h2>
        {mainBlock}
      </section>
      {renderAdminModal()}
    </>
  );
}
