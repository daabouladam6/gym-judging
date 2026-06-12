import { ATHLETE_LEVEL_LABELS, ATHLETE_LEVEL_VALUES, type AthleteLevel } from "./levels.js";

export const HP_LEVELS = new Set<AthleteLevel>(["HP1", "HP2", "HP3", "HP4"]);

export function isHpLevel(level: AthleteLevel | string): boolean {
  return HP_LEVELS.has(level as AthleteLevel);
}

/** Stable key for athlete list groups and judge category assignments. */
export function athleteCategoryKey(level: AthleteLevel, yearOfBirth: number): string {
  if (isHpLevel(level)) return level;
  return `${level}:${yearOfBirth}`;
}

export function categoryLabel(categoryKey: string): string {
  if (isHpLevel(categoryKey)) {
    return ATHLETE_LEVEL_LABELS[categoryKey as AthleteLevel];
  }
  const colon = categoryKey.indexOf(":");
  if (colon === -1) return categoryKey;
  const level = categoryKey.slice(0, colon) as AthleteLevel;
  const year = categoryKey.slice(colon + 1);
  return `${ATHLETE_LEVEL_LABELS[level] ?? level} · Born ${year}`;
}

export type AthleteForCategory = { level: AthleteLevel; yearOfBirth: number };

export function sortCategoryKeys(keys: string[]): string[] {
  const levelOrder = new Map(ATHLETE_LEVEL_VALUES.map((level, index) => [level, index]));
  return [...keys].sort((a, b) => {
    const levelA = (isHpLevel(a) ? a : a.split(":")[0]!) as AthleteLevel;
    const levelB = (isHpLevel(b) ? b : b.split(":")[0]!) as AthleteLevel;
    const levelDiff = (levelOrder.get(levelA) ?? 999) - (levelOrder.get(levelB) ?? 999);
    if (levelDiff !== 0) return levelDiff;
    if (isHpLevel(a)) return 0;
    return Number(a.split(":")[1]) - Number(b.split(":")[1]);
  });
}

export function distinctCategoryKeys(athletes: AthleteForCategory[]): string[] {
  const keys = new Set<string>();
  for (const athlete of athletes) {
    keys.add(athleteCategoryKey(athlete.level, athlete.yearOfBirth));
  }
  return sortCategoryKeys([...keys]);
}

export type AthleteCategoryGroup<T extends AthleteForCategory> = {
  categoryKey: string;
  level: AthleteLevel;
  yearOfBirth?: number;
  athletes: T[];
};

export function groupAthletesByCategory<T extends AthleteForCategory & { name: string }>(
  athletes: T[],
): AthleteCategoryGroup<T>[] {
  const byKey = new Map<string, AthleteCategoryGroup<T>>();
  for (const athlete of athletes) {
    const categoryKey = athleteCategoryKey(athlete.level, athlete.yearOfBirth);
    const existing = byKey.get(categoryKey);
    if (existing) {
      existing.athletes.push(athlete);
    } else {
      byKey.set(categoryKey, {
        categoryKey,
        level: athlete.level,
        yearOfBirth: isHpLevel(athlete.level) ? undefined : athlete.yearOfBirth,
        athletes: [athlete],
      });
    }
  }

  const orderedKeys = sortCategoryKeys([...byKey.keys()]);
  return orderedKeys.map((key) => {
    const group = byKey.get(key)!;
    return {
      ...group,
      athletes: group.athletes.sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

export function athleteMatchesCategoryKey(
  athlete: AthleteForCategory,
  categoryKey: string,
): boolean {
  return athleteCategoryKey(athlete.level, athlete.yearOfBirth) === categoryKey;
}
