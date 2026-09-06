import type { JourneyRow, JourneySession, JourneySet, RepQuality, StatMetric } from "./types";

/* ------------------------------------------------------------------ *
 * Pure helpers. No React in here so they are trivially unit-testable
 * and can be reused by the insights / progress-report code.
 * ------------------------------------------------------------------ */

export const QUALITY_LABEL: Record<RepQuality, string> = {
  1: "Needs improvement",
  2: "Completed",
  3: "Max strength",
};

/** The Analytics column cycles through these, in this order. */
export const STAT_ORDER: StatMetric[] = ["first", "low", "high", "mostReps", "fewestReps"];

export const STAT_LABEL: Record<StatMetric, { title: string; sub: string; long: string }> = {
  first: { title: "First", sub: "weight", long: "First weight on record" },
  low: { title: "Lowest", sub: "weight", long: "Lowest weight on record" },
  high: { title: "Highest", sub: "weight", long: "Highest weight on record" },
  mostReps: { title: "Most", sub: "reps", long: "Most reps in a set" },
  fewestReps: { title: "Fewest", sub: "reps", long: "Fewest reps in a set" },
};

export function nextMetric(m: StatMetric): StatMetric {
  return STAT_ORDER[(STAT_ORDER.indexOf(m) + 1) % STAT_ORDER.length];
}

/** Sets for a row in timeline order (oldest → newest), skipping empty sessions. */
export function orderedSets(row: JourneyRow, sessions: JourneySession[]): JourneySet[] {
  const out: JourneySet[] = [];
  for (const s of sessions) {
    const set = row.sets[s.id];
    if (set) out.push(set);
  }
  return out;
}

/** One aggregate: the set that produced it plus the session it came from. */
export interface StatHit {
  set: JourneySet;
  session: JourneySession;
}

export type RowStats = Record<StatMetric, StatHit | null>;

/**
 * All five aggregates for one machine in a single pass over its history.
 * Computed once per data change (useMemo in the grid), never per cell.
 *
 * Tie-breaking is intentional:
 *  - low       → the EARLIEST time they were at that weight (when the floor was set)
 *  - high      → the LATEST time they hit the max (is the ceiling still current?)
 *  - mostReps  → the LATEST tie, at whatever weight it happened
 *  - fewestReps→ the LATEST tie — the most recent struggle is the useful one
 * Timed static contractions have no rep count, so they are skipped by the two
 * rep metrics but still count for the three weight metrics.
 */
export function computeRowStats(row: JourneyRow, history: JourneySession[]): RowStats {
  const out: RowStats = { first: null, low: null, high: null, mostReps: null, fewestReps: null };
  for (const session of history) {
    const set = row.sets[session.id];
    if (!set) continue;
    const hit: StatHit = { set, session };
    if (!out.first) out.first = hit;
    if (!out.low || set.weight < out.low.set.weight) out.low = hit;
    if (!out.high || set.weight >= out.high.set.weight) out.high = hit;
    if (!set.isTSC && typeof set.reps === "number") {
      if (!out.mostReps || set.reps >= out.mostReps.set.reps!) out.mostReps = hit;
      if (!out.fewestReps || set.reps <= out.fewestReps.set.reps!) out.fewestReps = hit;
    }
  }
  return out;
}

/** "40 → 66 lb (+65%)" — the machine cell's readout. */
export function journeySummary(row: JourneyRow, history: JourneySession[]): string {
  const sets = orderedSets(row, history);
  if (sets.length === 0) return row.prescribedWeight ? `Next ${row.prescribedWeight} lb` : "No history";
  const start = row.startingWeight ?? sets[0].weight;
  const now = sets[sets.length - 1].weight;
  if (!start || start === now) return `${now} lb`;
  const pct = Math.round(((now - start) / start) * 100);
  const sign = pct > 0 ? "+" : "";
  return `${start} → ${now} lb (${sign}${pct}%)`;
}

/** Trend of a set vs the previous logged set on the same machine. */
export type Trend = "up" | "down" | "flat" | "reps-up" | "reps-down" | null;

/**
 * Pounds gained or lost against the previous logged set, or null when the
 * load did not move (or there is nothing to compare against).
 *
 * This method inroads the muscle under continuous tension; the load is what
 * the trainer is actually driving up, and reps are the by-product of how
 * deep a given load took them. 58 → 60 lb is the win even when reps halve,
 * so the delta gets its own number in the cell rather than being flattened
 * into an up-arrow that looks the same as "one more rep".
 */
export function loadDelta(current: JourneySet, previous: JourneySet | undefined): number | null {
  if (!previous) return null;
  const d = current.weight - previous.weight;
  return d === 0 ? null : d;
}

export function trendVsPrevious(current: JourneySet, previous: JourneySet | undefined): Trend {
  if (!previous) return null;
  if (current.weight > previous.weight) return "up";
  if (current.weight < previous.weight) return "down";
  const a = current.isTSC ? current.seconds ?? 0 : current.reps ?? 0;
  const b = previous.isTSC ? previous.seconds ?? 0 : previous.reps ?? 0;
  if (a > b) return "reps-up";
  if (a < b) return "reps-down";
  return "flat";
}

/** 90 → "1:30", 45 → "45s" */
export function formatSeconds(sec: number): string {
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  return `${sec}s`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-02" → "Sep 2". Avoids `new Date(iso)` so the date never shifts by timezone. */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

export function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
