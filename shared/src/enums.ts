export type UserRole = "ADMIN" | "JUDGE";
export type PanelRole = "E" | "D";
export type Apparatus = "VAULT" | "BARS" | "BEAM" | "FLOOR";
export type ScoreType = "EXECUTION" | "DIFFICULTY";
export type AggregationRule = "AVERAGE" | "DROP_HIGH_LOW";
export type ModificationActorType = "JUDGE" | "ADMIN";
export type ModificationSource =
  | "DEDUCTION_ADD"
  | "DEDUCTION_REMOVE"
  | "MANUAL_SCORE_EDIT"
  | "ADMIN_OVERRIDE"
  | "SYSTEM";
