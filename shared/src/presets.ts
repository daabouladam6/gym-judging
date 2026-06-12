export const FIG_HP_DEDUCTIONS = [0.05, 0.1, 0.3, 0.5, 1.0] as const;
export const USAG_DEDUCTIONS = [0.05, 0.1, 0.2, 0.3, 0.5] as const;
export type DeductionPresetMode = "FIG_HP" | "USAG";

const USAG_ATHLETE_LEVELS = new Set(["USAG_1", "USAG_2", "USAG_3", "USAG_4", "USAG_5"]);

/** USAG levels 1–5 use smaller deduction steps; HP and age categories use FIG/HP steps. */
export function deductionPresetForAthleteLevel(level: string): DeductionPresetMode {
  return USAG_ATHLETE_LEVELS.has(level) ? "USAG" : "FIG_HP";
}

export function deductionsForPreset(mode: DeductionPresetMode): readonly number[] {
  return mode === "FIG_HP" ? FIG_HP_DEDUCTIONS : USAG_DEDUCTIONS;
}

export function isValidDeduction(amount: number, mode: DeductionPresetMode): boolean {
  const list = deductionsForPreset(mode);
  return list.some((d) => Math.abs(d - amount) < 1e-9);
}
