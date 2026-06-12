/** Stored athlete level codes (validated server-side). */
export const ATHLETE_LEVEL_VALUES = [
  "USAG_1",
  "USAG_2",
  "USAG_3",
  "USAG_4",
  "USAG_5",
  "HP1",
  "HP2",
  "HP3",
  "HP4",
  "YOUTH_12",
  "YOUTH_13",
  "YOUTH_14",
  "PRE_JUNIOR",
  "JUNIOR",
  "SENIOR",
] as const;

export type AthleteLevel = (typeof ATHLETE_LEVEL_VALUES)[number];

export const ATHLETE_LEVEL_LABELS: Record<AthleteLevel, string> = {
  USAG_1: "USAG Level 1",
  USAG_2: "USAG Level 2",
  USAG_3: "USAG Level 3",
  USAG_4: "USAG Level 4",
  USAG_5: "USAG Level 5",
  HP1: "HP1",
  HP2: "HP2",
  HP3: "HP3",
  HP4: "HP4",
  YOUTH_12: "Youth 12",
  YOUTH_13: "Youth 13",
  YOUTH_14: "Youth 14",
  PRE_JUNIOR: "Pre-Junior",
  JUNIOR: "Junior",
  SENIOR: "Senior",
};

export const ATHLETE_LEVEL_GROUPS: { label: string; levels: AthleteLevel[] }[] = [
  { label: "USAG", levels: ["USAG_1", "USAG_2", "USAG_3", "USAG_4", "USAG_5"] },
  { label: "HP", levels: ["HP1", "HP2", "HP3", "HP4"] },
  {
    label: "Age category",
    levels: ["YOUTH_12", "YOUTH_13", "YOUTH_14", "PRE_JUNIOR", "JUNIOR", "SENIOR"],
  },
];
